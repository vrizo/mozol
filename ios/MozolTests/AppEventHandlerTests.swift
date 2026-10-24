import Foundation
import MozolCore
import SwiftData
import Testing
@testable import Mozol

/// Push and fetch through the one event handler, against a URLProtocol stub and an in-memory store.
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

    private var entries: [InboxEntry] {
        get throws {
            try environment.modelContainer.mainContext.fetch(FetchDescriptor<InboxEntry>(sortBy: [SortDescriptor(\.key)]))
        }
    }

    private func signIn() async throws {
        try await environment.events.signIn(Credentials(email: "a@b.co", password: "p"))
    }

    @Test func silentPushIsStoredWhenSignedOutWithoutAFetch() async throws {
        let outcome = await environment.events.handle(.silentPush(raw: #"{"x":1}"#))
        #expect(outcome == .newData(count: 1))
        #expect(try entries.map(\.source) == [.push])
        #expect(StubURLProtocol.requests.isEmpty)
    }

    @Test func fetchStoresMessagesOnceAndSendsTheCursor() async throws {
        try await signIn()
        StubURLProtocol.respond(200, #"{"messages":[{"id":"m1","text":"a"},{"id":"m2"}],"cursor":"c2"}"#)
        #expect(await environment.events.handle(.manualRefresh) == .newData(count: 2))

        StubURLProtocol.respond(200, #"{"messages":[{"id":"m2"}],"cursor":null}"#)
        #expect(await environment.events.handle(.foregroundTimer) == .noData)

        #expect(try entries.map(\.key) == ["message:m1", "message:m2"])
        let second = try #require(StubURLProtocol.requests.last)
        #expect(second.url?.query == "after=c2")
        #expect(second.value(forHTTPHeaderField: "Authorization") == "Bearer placeholder")
        #expect(second.value(forHTTPHeaderField: "X-Request-Id")?.count == 12)
    }

    @Test func httpFailureIsShownAndStoresNothing() async throws {
        try await signIn()
        StubURLProtocol.respond(503, #"{"error":"down"}"#)
        #expect(await environment.events.handle(.manualRefresh) == .failed)
        #expect(environment.sync.status == .failed(.http(status: 503, code: "down")))
        #expect(try entries.isEmpty)
    }

    @Test func malformedAnswerIsUnreadable() async throws {
        try await signIn()
        StubURLProtocol.respond(200, #"{"items":[]}"#)
        #expect(await environment.events.handle(.manualRefresh) == .failed)
        #expect(environment.sync.status == .failed(.unreadable))
    }

    @Test func signOutClearsInboxAndSession() async throws {
        try await signIn()
        _ = await environment.events.handle(.silentPush(raw: "{}"))
        environment.events.signOut()
        #expect(!environment.session.isSignedIn)
        #expect(try entries.isEmpty)
    }

    @Test func placeholderRefusesAnIncompleteEmail() async {
        await #expect(throws: AuthError.incompleteCredentials) {
            try await environment.events.signIn(Credentials(email: "nope", password: "p"))
        }
    }
}

/// Answers every request with the queued response and records the requests.
nonisolated final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var queued: [(Int, Data)] = []
    nonisolated(unsafe) private static var recorded: [URLRequest] = []

    static var requests: [URLRequest] { lock.withLock { recorded } }

    static func reset() {
        lock.withLock {
            queued = []
            recorded = []
        }
    }

    static func respond(_ status: Int, _ body: String) {
        lock.withLock { queued.append((status, Data(body.utf8))) }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let next: (Int, Data)? = Self.lock.withLock {
            Self.recorded.append(request)
            return Self.queued.isEmpty ? nil : Self.queued.removeFirst()
        }
        guard let (status, body) = next else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
