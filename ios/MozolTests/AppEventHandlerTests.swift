import Foundation
import MozolCore
import Testing
@testable import Mozol

/// Sign-in, device registration, sign-out and pushes through the one event handler,
/// against a URLProtocol stub and an in-memory store. Applying deliveries is covered in MozolCore.
@MainActor
@Suite(.serialized)
struct AppEventHandlerTests {
    let environment: AppEnvironment

    init() {
        let suite = "mozol.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        StubURLProtocol.reset()
        environment = AppEnvironment(
            config: Config(baseURL: URL(string: "http://stub.test")!),
            defaults: defaults,
            keychainService: "net.vrizo.mozol.tests.\(UUID().uuidString)",
            inMemory: true,
            urlSession: URLSession(configuration: configuration)
        )
    }

    private var installationID: String { environment.session.installationID }

    private static let user = #"{"id":"usr_1","email":"learner@example.com","displayName":"Learner","nativeLanguage":"ru","speakerNames":["Learner"],"reminderSettings":{"embedInMyReminders":true},"createdAt":"2026-10-24T12:00:00.000Z"}"#
    private static let device = #"{"device":{"id":"dev_1","installationId":"x","platform":"ios","appVersion":null,"osVersion":null,"pushEnabled":false,"remindersAccess":"denied","lastSeenAt":"2026-10-24T12:00:00.000Z"}}"#

    private func signIn() async throws {
        StubURLProtocol.route("POST /api/auth/app-token", 201, #"{"token":"tok_1","user":\#(Self.user)}"#)
        StubURLProtocol.route("PUT /api/devices/\(installationID)", 200, Self.device)
        try await environment.events.completeSignIn(code: "code-1")
    }

    @Test func signInExchangesTheCodeAndRegistersTheDevice() async throws {
        try await signIn()
        #expect(environment.session.isSignedIn)
        #expect(environment.session.email == "learner@example.com")
        #expect(environment.devices.server == .sent)

        let token = try #require(StubURLProtocol.request("POST /api/auth/app-token"))
        #expect(token.value(forHTTPHeaderField: "Authorization") == nil)
        let tokenBody = try #require(StubURLProtocol.body(of: token))
        #expect(tokenBody["code"] as? String == "code-1")
        #expect(tokenBody["installationId"] as? String == installationID)

        let put = try #require(StubURLProtocol.request("PUT /api/devices/\(installationID)"))
        #expect(put.value(forHTTPHeaderField: "Authorization") == "Bearer tok_1")
        #expect(put.value(forHTTPHeaderField: "X-Request-Id")?.count == 12)
        let body = try #require(StubURLProtocol.body(of: put))
        #expect(body["platform"] as? String == "ios")
        #expect(body["apnsToken"] is NSNull)
        #expect(body["apnsEnvironment"] is NSNull)
        #expect(body["remindersAccess"] != nil)
        #expect(body["timezone"] == nil && body["notificationsAccess"] == nil)
    }

    @Test func aRefusedCodeKeepsTheAppSignedOut() async {
        StubURLProtocol.route("POST /api/auth/app-token", 400, #"{"error":"code_invalid"}"#)
        await #expect(throws: APIError.http(status: 400, code: "code_invalid")) {
            try await environment.events.completeSignIn(code: "old")
        }
        #expect(!environment.session.isSignedIn)
    }

    @Test func theDeviceIsSentOncePerLaunchUntilItChanges() async throws {
        try await signIn()
        await environment.devices.register(trigger: "test")
        #expect(StubURLProtocol.count("PUT /api/devices/\(installationID)") == 1)
    }

    @Test func anExpiredSessionSignsOutOnThisDevice() async throws {
        try await signIn()
        environment.devices.resetServerState()
        StubURLProtocol.route("PUT /api/devices/\(installationID)", 401, #"{"error":"unauthorized"}"#)
        let outcome = await environment.events.handle(.manualRefresh)
        #expect(outcome == .failed(.http(status: 401, code: "unauthorized")))
        #expect(!environment.session.isSignedIn)
    }

    @Test func signOutRemovesTheDeviceThenEndsTheSession() async throws {
        try await signIn()
        StubURLProtocol.route("DELETE /api/devices/\(installationID)", 204, "")
        StubURLProtocol.route("POST /api/auth/sign-out", 204, "")
        await environment.events.signOut()
        #expect(!environment.session.isSignedIn)
        let lines = StubURLProtocol.requestLines
        let delete = try #require(lines.firstIndex(of: "DELETE /api/devices/\(installationID)"))
        let signOut = try #require(lines.firstIndex(of: "POST /api/auth/sign-out"))
        #expect(delete < signOut)
        #expect(StubURLProtocol.request("POST /api/auth/sign-out")?.value(forHTTPHeaderField: "Authorization") == "Bearer tok_1")
    }

    @Test func signOutGoesOnWhenTheServerIsNotReached() async throws {
        try await signIn()
        let id = installationID
        await environment.events.signOut()
        #expect(!environment.session.isSignedIn)
        #expect(environment.session.installationID == id)
    }

    @Test func eventsAreSkippedWhenSignedOut() async {
        #expect(await environment.events.handle(.manualRefresh) == .skipped)
        #expect(StubURLProtocol.requestLines.isEmpty)
    }

    @Test func aTestPushIsRecordedWithoutARequest() async {
        let outcome = await environment.events.handlePush(["aps": ["content-available": 1], "mozol": ["v": 1, "type": "test"]])
        #expect(outcome == .noData)
        #expect(environment.devices.lastTestPush != nil)
        #expect(StubURLProtocol.requestLines.isEmpty)
    }

    @Test func anUnknownPushIsIgnored() async {
        #expect(await environment.events.handlePush(["aps": ["content-available": 1], "word": "hola"]) == .noData)
        #expect(StubURLProtocol.requestLines.isEmpty)
    }

    @Test func signInCodeComesOnlyFromTheMozolAuthAddress() {
        #expect(Config.signInCode(from: URL(string: "mozol://auth?code=abc-_1")!) == "abc-_1")
        #expect(Config.signInCode(from: URL(string: "mozol://auth?code=")!) == nil)
        #expect(Config.signInCode(from: URL(string: "mozol://other?code=abc")!) == nil)
        #expect(Config.signInCode(from: URL(string: "https://auth?code=abc")!) == nil)
        #expect(Config(baseURL: URL(string: "http://localhost:8790")!).appSignInURL.absoluteString
            == "http://localhost:8790/app/signin?return=mozol://auth")
    }
}

/// Answers requests by "METHOD /path" and records them. A request without a route fails as unreachable.
nonisolated final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var routes: [String: (Int, Data)] = [:]
    nonisolated(unsafe) private static var recorded: [(line: String, request: URLRequest, body: Data?)] = []

    static var requestLines: [String] { lock.withLock { recorded.map(\.line) } }

    static func reset() {
        lock.withLock {
            routes = [:]
            recorded = []
        }
    }

    static func route(_ key: String, _ status: Int, _ body: String) {
        lock.withLock { routes[key] = (status, Data(body.utf8)) }
    }

    static func request(_ line: String) -> URLRequest? {
        lock.withLock { recorded.last { $0.line == line }?.request }
    }

    static func count(_ line: String) -> Int {
        lock.withLock { recorded.filter { $0.line == line }.count }
    }

    static func body(of request: URLRequest) -> [String: Any]? {
        let data = lock.withLock { recorded.last { $0.request == request }?.body }
        return data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let line = "\(request.httpMethod ?? "GET") \(request.url?.path() ?? "")"
        let body = request.httpBody ?? Self.read(request.httpBodyStream)
        let answer: (Int, Data)? = Self.lock.withLock {
            Self.recorded.append((line, request, body))
            return Self.routes[line]
        }
        guard let (status, data) = answer else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream?) -> Data? {
        guard let stream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
