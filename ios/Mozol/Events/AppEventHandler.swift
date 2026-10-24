import Foundation
import MozolCore
import Observation

/// The one entry point for push, timer, Refresh, background refresh, shortcuts, sign-in and sign-out: docs/ios/messages.md.
@Observable
final class AppEventHandler {
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let session: SessionStore
    @ObservationIgnored private let sync: DeliverySync
    @ObservationIgnored private let devices: DeviceRegistration

    init(api: APIClient, session: SessionStore, sync: DeliverySync, devices: DeviceRegistration) {
        self.api = api
        self.session = session
        self.sync = sync
        self.devices = devices
    }

    @discardableResult
    func handle(_ event: AppEvent) async -> SyncOutcome {
        Log.sync.info("event \(event.trigger, privacy: .public)")
        guard session.isSignedIn else {
            Log.sync.info("claim skipped trigger=\(event.trigger, privacy: .public): signed out")
            return .skipped
        }
        await devices.register(trigger: event.trigger)
        if case let .failed(error) = devices.server, error.isUnauthorized {
            return expireSession(error)
        }
        let outcome = await sync.run(trigger: event.trigger)
        if case let .failed(error) = outcome, error.isUnauthorized {
            return expireSession(error)
        }
        return outcome
    }

    /// A silent push (APNs or the Debug path of scripts/sim-push.sh).
    func handlePush(_ userInfo: [String: Any]) async -> SyncOutcome {
        let message: PushMessage
        do {
            message = try PushMessage.parse(userInfo)
        } catch {
            Log.notify.error("push not understood: \(String(describing: error), privacy: .public)")
            return .noData
        }
        Log.notify.info("push received type=\(message.kind.rawValue, privacy: .public) pending=\(message.pending ?? 0)")
        switch message.kind {
        case .test:
            devices.recordTestPush()
            return .noData
        case .deliveries:
            return await handle(.silentPush)
        }
    }

    /// Step 3 of the sign-in handoff: the code from mozol://auth becomes an app session token.
    func completeSignIn(code: String) async throws(APIError) {
        let body = AppTokenBody(code: code, installationId: session.installationID)
        let data = try await api.post("api/auth/app-token", json: body)
        let answer = try api.decode(AppTokenResponse.self, from: data, path: "api/auth/app-token")
        session.signIn(token: answer.token, email: answer.user.email)
        await devices.register(trigger: "signin")
    }

    /// Removes the device and ends the session on the server, then on the phone. Server failures are logged and do not stop it.
    func signOut() async {
        await devices.unregister()
        do {
            _ = try await api.post("api/auth/sign-out")
        } catch {
            Log.api.error("server sign-out failed: \(String(describing: error), privacy: .public)")
        }
        endLocalSession()
    }

    /// The server no longer knows the app session: sign out on this device only.
    private func expireSession(_ error: APIError) -> SyncOutcome {
        Log.store.error("app session no longer valid; signing out on this device")
        endLocalSession()
        return .failed(error)
    }

    private func endLocalSession() {
        session.signOut()
        sync.reset()
        devices.resetServerState()
    }
}
