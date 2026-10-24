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
        AppEnvironment.shared.devices.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppEnvironment.shared.devices.didFailToRegister(error)
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        let payload = Dictionary(uniqueKeysWithValues: userInfo.map { ("\($0.key)", $0.value) })
        Task {
            let outcome = await AppEnvironment.shared.events.handlePush(payload)
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
