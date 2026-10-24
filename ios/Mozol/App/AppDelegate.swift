import MozolCore
import UIKit

/// Remote notification registration, silent pushes and the background refresh task.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let environment = AppEnvironment.shared
        BackgroundRefresh.register(events: environment.events, sync: environment.sync)
        BackgroundRefresh.schedule()
        Log.notify.info("registering for remote notifications")
        application.registerForRemoteNotifications()
        #if DEBUG
        LaunchArguments.listenForDebugPushes()
        #endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        AppEnvironment.shared.push.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppEnvironment.shared.push.didFailToRegister(error)
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        let payload = Dictionary(uniqueKeysWithValues: userInfo.map { ("\($0.key)", $0.value) })
        let raw: String
        do {
            raw = try RawJSON.text(from: payload)
        } catch {
            Log.notify.error("silent push payload is not JSON: \(String(describing: error), privacy: .public)")
            completionHandler(.failed)
            return
        }
        Log.notify.info("silent push received bytes=\(raw.utf8.count)")
        Task {
            let outcome = await AppEnvironment.shared.events.handle(.silentPush(raw: raw))
            completionHandler(outcome.fetchResult)
        }
    }
}

private extension SyncOutcome {
    var fetchResult: UIBackgroundFetchResult {
        switch self {
        case .newData: .newData
        case .noData, .skipped: .noData
        case .failed: .failed
        }
    }
}
