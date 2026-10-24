import Foundation
import MozolCore
import Observation

/// The APNs device token and whether the server has it: docs/ios/messages.md.
@Observable
final class PushRegistration {
    enum TokenState: Equatable {
        case none
        case registered(String)
        case failed
    }

    enum ServerState: Equatable {
        case notSent
        case sending
        case sent
        case failed(APIError)
    }

    static let sentTokenKey = "mozol.sentDeviceToken"

    private(set) var token: TokenState = .none
    private(set) var server: ServerState

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let session: SessionStore
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let environment: String

    init(api: APIClient, session: SessionStore, defaults: UserDefaults, environment: String) {
        self.api = api
        self.session = session
        self.defaults = defaults
        self.environment = environment
        server = defaults.string(forKey: Self.sentTokenKey) == nil ? .notSent : .sent
    }

    var tokenHex: String? {
        if case let .registered(hex) = token { hex } else { nil }
    }

    func didRegister(deviceToken: Data) {
        let hex = DeviceToken.hex(deviceToken)
        token = .registered(hex)
        Log.notify.info("apns token received prefix=\(String(hex.prefix(8)), privacy: .public) environment=\(self.environment, privacy: .public)")
        Task { await sendIfNeeded() }
    }

    func didFailToRegister(_ error: Error) {
        token = .failed
        let nsError = error as NSError
        Log.notify.error("apns registration failed domain=\(nsError.domain, privacy: .public) code=\(nsError.code)")
    }

    /// Sends the token with POST /api/devices when signed in and the server does not have this token yet.
    func sendIfNeeded() async {
        guard session.isSignedIn, let hex = tokenHex, server != .sending else { return }
        guard defaults.string(forKey: Self.sentTokenKey) != hex else {
            server = .sent
            return
        }
        server = .sending
        do {
            _ = try await api.post("api/devices", json: DeviceBody(token: hex, platform: "ios", environment: environment))
            defaults.set(hex, forKey: Self.sentTokenKey)
            server = .sent
            Log.notify.info("device token sent to the server")
        } catch {
            server = .failed(error)
            Log.notify.error("device token not sent: \(String(describing: error), privacy: .public)")
        }
    }

    /// Sign-out: the next account sends the token again.
    func resetServerState() {
        Self.clearDefaults(defaults)
        server = .notSent
    }

    static func clearDefaults(_ defaults: UserDefaults) {
        defaults.removeObject(forKey: sentTokenKey)
    }

    private struct DeviceBody: Encodable {
        let token: String
        let platform: String
        let environment: String
    }
}
