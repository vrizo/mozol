import BackgroundTasks
import MozolCore

/// The BGAppRefreshTask that fetches messages while the app is in the background.
enum BackgroundRefresh {
    static func register(events: AppEventHandler, sync: MessageSync) {
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: SyncPolicy.backgroundTaskID, using: .main) { task in
            schedule()
            Log.sync.info("background refresh started")
            let work = Task {
                let outcome = await events.handle(.backgroundRefresh)
                sync.recordBackgroundRun()
                Log.sync.info("background refresh finished outcome=\(String(describing: outcome), privacy: .public)")
                task.setTaskCompleted(success: outcome != .failed)
            }
            task.expirationHandler = { @Sendable in
                Log.sync.error("background refresh expired")
                work.cancel()
            }
        }
        guard registered else { fatalError("BGTaskScheduler refused \(SyncPolicy.backgroundTaskID); check BGTaskSchedulerPermittedIdentifiers") }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: SyncPolicy.backgroundTaskID)
        request.earliestBeginDate = .now.addingTimeInterval(SyncPolicy.backgroundEarliestDelay)
        do {
            try BGTaskScheduler.shared.submit(request)
            Log.sync.info("background refresh scheduled in \(Int(SyncPolicy.backgroundEarliestDelay))s")
        } catch {
            // The simulator has no background task scheduler and always lands here (BGTaskSchedulerErrorCodeUnavailable).
            let nsError = error as NSError
            Log.sync.error("background refresh not scheduled code=\(nsError.code)")
        }
    }
}
