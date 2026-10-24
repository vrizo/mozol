import EventKit
import Foundation
import MozolCore
import Observation
import UIKit
import UserNotifications

/// The APNs token and this device on the server (PUT /api/devices/:installationId): docs/ios/messages.md.
@Observable
final class DeviceRegistration {
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

    static let lastTestPushKey = "mozol.lastTestPush"

    private(set) var token: TokenState = .none
    private(set) var server: ServerState = .notSent
    private(set) var lastTestPush: Date?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let session: SessionStore
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let environment: APNsEnvironment
    @ObservationIgnored private let notifications: NotificationPermission
    @ObservationIgnored private let reminders: RemindersStore
    /// The body the server accepted last in this launch, so the first call of every launch sends.
    @ObservationIgnored private var accepted: PutDeviceBody?
    @ObservationIgnored private var isSending = false
    @ObservationIgnored private var sendAgain = false

    init(api: APIClient, session: SessionStore, defaults: UserDefaults, environment: APNsEnvironment,
         notifications: NotificationPermission, reminders: RemindersStore) {
        self.api = api
        self.session = session
        self.defaults = defaults
        self.environment = environment
        self.notifications = notifications
        self.reminders = reminders
        lastTestPush = defaults.object(forKey: Self.lastTestPushKey) as? Date
    }

    var tokenHex: String? {
        if case let .registered(hex) = token { hex } else { nil }
    }

    func didRegister(deviceToken: Data) {
        let hex = DeviceToken.hex(deviceToken)
        token = .registered(hex)
        Log.notify.info("apns token received prefix=\(String(hex.prefix(8)), privacy: .public) environment=\(self.environment.rawValue, privacy: .public)")
        Task { await register(trigger: "token") }
    }

    func didFailToRegister(_ error: Error) {
        token = .failed
        let nsError = error as NSError
        Log.notify.error("apns registration failed domain=\(nsError.domain, privacy: .public) code=\(nsError.code)")
    }

    func recordTestPush(at date: Date = .now) {
        lastTestPush = date
        defaults.set(date, forKey: Self.lastTestPushKey)
        Log.notify.info("test push received")
    }

    /// Sends the device when signed in and the body differs from the one the server accepted in this launch.
    func register(trigger: String) async {
        guard session.isSignedIn else { return }
        if isSending {
            sendAgain = true
            return
        }
        isSending = true
        defer { isSending = false }
        repeat {
            sendAgain = false
            await notifications.refresh()
            reminders.refreshAuthorization()
            let body = makeBody()
            guard body != accepted else { break }
            server = .sending
            do {
                _ = try await api.put("api/devices/\(session.installationID)", json: body)
                accepted = body
                server = .sent
                Log.notify.info("device registered trigger=\(trigger, privacy: .public) hasToken=\(body.apnsToken != nil)")
            } catch {
                server = .failed(error)
                Log.notify.error("device not registered trigger=\(trigger, privacy: .public): \(String(describing: error), privacy: .public)")
                break
            }
        } while sendAgain
    }

    /// DELETE /api/devices/:installationId before sign-out. A failure is logged; sign-out goes on.
    func unregister() async {
        do {
            _ = try await api.delete("api/devices/\(session.installationID)")
            Log.notify.info("device removed from the server")
        } catch {
            Log.notify.error("device not removed: \(String(describing: error), privacy: .public)")
        }
        resetServerState()
    }

    func resetServerState() {
        accepted = nil
        server = .notSent
    }

    static func clearDefaults(_ defaults: UserDefaults) {
        defaults.removeObject(forKey: lastTestPushKey)
    }

    private func makeBody() -> PutDeviceBody {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = (info["CFBundleShortVersionString"] as? String).map { "\($0) (\(info["CFBundleVersion"] as? String ?? "?"))" }
        return PutDeviceBody(
            bundleId: Bundle.main.bundleIdentifier!,
            appVersion: version,
            osVersion: UIDevice.current.systemVersion,
            timezone: TimeZone.current.identifier,
            apnsToken: tokenHex,
            environment: environment,
            remindersAccess: Self.access(reminders.authorization),
            notificationsAccess: Self.access(notifications.status)
        )
    }

    static func access(_ status: EKAuthorizationStatus) -> RemindersAccess {
        switch status {
        case .fullAccess, .authorized: .full
        case .writeOnly: .writeOnly
        case .denied: .denied
        case .restricted: .restricted
        case .notDetermined: .notDetermined
        @unknown default: fatalError("unknown EKAuthorizationStatus \(status.rawValue)")
        }
    }

    static func access(_ status: UNAuthorizationStatus) -> NotificationsAccess {
        switch status {
        case .authorized: .authorized
        case .provisional: .provisional
        case .ephemeral: .ephemeral
        case .denied: .denied
        case .notDetermined: .notDetermined
        @unknown default: fatalError("unknown UNAuthorizationStatus \(status.rawValue)")
        }
    }
}
