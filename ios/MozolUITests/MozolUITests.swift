import XCTest

/// Sign-in and Inbox flows against the in-process stub server.
final class MozolUITests: XCTestCase {
    private var server: StubServer!

    override func setUp() async throws {
        continueAfterFailure = false
        server = try StubServer()
        try server.start()
    }

    override func tearDown() async throws {
        server.stop()
    }

    @MainActor
    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US",
            "-mozol.apiBaseURL", server.baseURL,
            "-uitest.reset",
        ] + arguments
        app.launch()
        return app
    }

    /// tests/screenshots/<date>/ in the repository; folders older than 7 days are deleted once per run.
    private static let screenshotDir: URL = {
        let root = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let base = root.appending(path: "tests/screenshots")
        let fm = FileManager.default
        let cutoff = Date.now.addingTimeInterval(-7 * 24 * 3600)
        for folder in (try? fm.contentsOfDirectory(at: base, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
            let created = (try? folder.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? .now
            if created < cutoff { try! fm.removeItem(at: folder) }
        }
        let dir = base.appending(path: Date.now.formatted(.iso8601.year().month().day()))
        try! fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    @MainActor
    private func screenshot(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        try! shot.pngRepresentation.write(to: Self.screenshotDir.appending(path: "\(name).png"))
    }

    @MainActor
    func testSignInWithEmailAndPasswordOpensTheTabs() {
        server.route("GET /api/messages", body: #"{"messages":[],"cursor":null}"#)
        let app = launch(["-uitest.skipPermissions"])

        let submit = app.buttons["signin.submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 10))
        XCTAssertFalse(submit.isEnabled)

        let email = app.textFields["signin.email"]
        email.tap()
        email.typeText("learner@example.com")
        let password = app.secureTextFields["signin.password"]
        password.tap()
        password.typeText("secret")
        XCTAssertTrue(submit.isEnabled)
        screenshot("signin-filled")
        submit.tap()

        XCTAssertTrue(app.tabBars.buttons["Inbox"].waitForExistence(timeout: 10))
        screenshot("after-signin")
        // iOS offers to save the password when the sign-in form disappears.
        let savePassword = app.sheets["Save Password?"]
        if savePassword.waitForExistence(timeout: 3) {
            savePassword.buttons["Not Now"].tap()
            XCTAssertTrue(savePassword.waitForNonExistence(timeout: 5))
        }
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Signed in as learner@example.com"].waitForExistence(timeout: 5))
        screenshot("settings")

        app.buttons["settings.signOut"].tap()
        let remembered = app.textFields["signin.email"]
        XCTAssertTrue(remembered.waitForExistence(timeout: 5))
        XCTAssertEqual(remembered.value as? String, "learner@example.com")
        app.buttons["signin.email.clear"].tap()
        XCTAssertEqual(remembered.value as? String, "Email")
        XCTAssertFalse(app.buttons["signin.email.clear"].exists)
    }

    @MainActor
    func testInboxShowsAFetchedMessage() {
        server.route("GET /api/messages", body: #"{"messages":[{"id":"m1","word":"hola"}],"cursor":"m1"}"#)
        server.route("POST /api/devices", body: #"{"ok":true}"#)
        let app = launch(["-uitest.signedIn", "-uitest.skipPermissions"])

        let row = app.buttons.matching(identifier: "inbox.row").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        screenshot("inbox")
        row.tap()
        let body = app.staticTexts["inboxEntry.body"]
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        XCTAssertTrue(body.label.contains("\"word\" : \"hola\""))
        XCTAssertTrue(server.requestLines.contains("GET /api/messages"))
    }

    @MainActor
    func testServerFailureIsShownWithItsCode() {
        server.route("GET /api/messages", status: 500, body: #"{"error":"boom"}"#)
        let app = launch(["-uitest.signedIn", "-uitest.skipPermissions"])

        let status = app.staticTexts["Couldn't check for messages: error 500"]
        XCTAssertTrue(status.waitForExistence(timeout: 10))
    }
}
