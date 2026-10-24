import MozolCore
import Observation

/// The one entry point for push, timer, Refresh, background refresh and shortcuts: docs/ios/messages.md.
@Observable
final class AppEventHandler {
    @ObservationIgnored private let session: SessionStore
    @ObservationIgnored private let sync: MessageSync
    @ObservationIgnored private let push: PushRegistration

    init(session: SessionStore, sync: MessageSync, push: PushRegistration) {
        self.session = session
        self.sync = sync
        self.push = push
    }

    @discardableResult
    func handle(_ event: AppEvent) async -> SyncOutcome {
        Log.sync.info("event \(event.trigger, privacy: .public)")
        var storedPush = false
        if case let .silentPush(raw) = event {
            do {
                try sync.storePush(raw: raw)
                storedPush = true
            } catch {
                Log.store.error("push not stored: \(String(describing: error), privacy: .public)")
                return .failed
            }
        }
        guard session.isSignedIn else {
            Log.sync.info("fetch skipped trigger=\(event.trigger, privacy: .public): signed out")
            return storedPush ? .newData(count: 1) : .skipped
        }
        let outcome = await sync.run(trigger: event.trigger)
        if storedPush, outcome == .noData || outcome == .skipped {
            return .newData(count: 1)
        }
        return outcome
    }

    func signIn(_ credentials: Credentials) async throws {
        try await session.signIn(credentials)
        await push.sendIfNeeded()
    }

    func signOut() {
        session.signOut()
        do {
            try sync.reset()
        } catch {
            fatalError("inbox reset failed: \(error)")
        }
        push.resetServerState()
    }
}
