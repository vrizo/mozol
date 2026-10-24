import XCTest

/// Sign-in, sign-out and the Placed screen against the in-process stub server.
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

    private static let user = #"{"id":"usr_1","email":"learner@example.com","displayName":"Learner","nativeLanguage":"ru","speakerNames":["Learner"],"reminderSettings":{"embedInMyReminders":true,"intensity":"normal","activeFrom":"09:00","activeTo":"21:00"},"createdAt":"2026-10-24T12:00:00.000Z"}"#
    private static let device = #"{"device":{"id":"dev_1","installationId":"x","platform":"ios","appVersion":null,"osVersion":null,"pushEnabled":false,"remindersAccess":"denied","lastSeenAt":"2026-10-24T12:00:00.000Z"}}"#
    /// Stands in for /app/signin: its button hands the code to the app the way the real page does.
    private static let signInPage = """
    <!doctype html><meta name=viewport content="width=device-width"><title>MOZOL</title>
    <h1>Stub sign-in</h1>
    <button onclick="location.href='mozol://auth?code=code-1'">Continue to MOZOL</button>
    """

    private func routeSignedInBasics() {
        server.route("PUT /api/devices/*", body: Self.device)
        server.route("POST /api/deliveries/claim", body: #"{"deliveries":[],"leaseSeconds":120,"embedInMyReminders":true}"#)
    }

    @MainActor
    func testSignInThroughTheWebPageOpensTheTabs() {
        server.route("GET /app/signin", body: Self.signInPage, contentType: "text/html")
        server.route("POST /api/auth/app-token", status: 201, body: #"{"token":"tok_1","user":\#(Self.user)}"#)
        server.route("DELETE /api/devices/*", status: 204, body: "")
        server.route("POST /api/auth/sign-out", status: 204, body: "")
        routeSignedInBasics()
        let app = launch(["-uitest.skipPermissions"])

        let start = app.buttons["signin.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        screenshot("signin")
        start.tap()

        let pageButton = app.webViews.buttons["Continue to MOZOL"]
        XCTAssertTrue(pageButton.waitForExistence(timeout: 10))
        screenshot("signin-page")
        pageButton.tap()

        XCTAssertTrue(app.tabBars.buttons["Placed"].waitForExistence(timeout: 10))
        screenshot("after-signin")
        XCTAssertTrue(server.requestLines.contains { $0.hasPrefix("GET /app/signin?return=mozol://auth") })
        XCTAssertTrue(server.requestLines.contains { $0.hasPrefix("PUT /api/devices/") })

        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Signed in as learner@example.com"].waitForExistence(timeout: 5))
        screenshot("settings")

        app.buttons["settings.signOut"].tap()
        XCTAssertTrue(app.buttons["signin.start"].waitForExistence(timeout: 10))
        let lines = server.requestLines
        let delete = lines.firstIndex { $0.hasPrefix("DELETE /api/devices/") }
        let signOut = lines.firstIndex(of: "POST /api/auth/sign-out")
        XCTAssertNotNil(delete)
        XCTAssertNotNil(signOut)
        XCTAssertLessThan(delete ?? .max, signOut ?? .min)
    }

    @MainActor
    func testARefusedCodeSaysWhatToDo() {
        server.route("GET /app/signin", body: Self.signInPage, contentType: "text/html")
        server.route("POST /api/auth/app-token", status: 400, body: #"{"error":"code_invalid"}"#)
        let app = launch(["-uitest.skipPermissions"])

        app.buttons["signin.start"].tap()
        let pageButton = app.webViews.buttons["Continue to MOZOL"]
        XCTAssertTrue(pageButton.waitForExistence(timeout: 10))
        pageButton.tap()

        let failure = app.staticTexts["signin.failure"]
        XCTAssertTrue(failure.waitForExistence(timeout: 10))
        XCTAssertTrue(failure.label.contains("did not work"))
        screenshot("signin-code-refused")
    }

    @MainActor
    func testWithoutRemindersAccessTheScreenSaysSo() {
        routeSignedInBasics()
        XCUIApplication().resetAuthorizationStatus(for: .reminders)
        let app = launch(["-uitest.signedIn", "-uitest.skipPermissions"])

        XCTAssertTrue(app.staticTexts["placed.noAccess"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Check Now"].exists)
        screenshot("placed-no-access")
        XCTAssertFalse(server.requestLines.contains("POST /api/deliveries/claim"))
    }
}
