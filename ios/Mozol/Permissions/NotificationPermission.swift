import MozolCore
import Observation
import UserNotifications

/// Notification permission: docs/ios/permissions.md.
@Observable
final class NotificationPermission {
    private(set) var status: UNAuthorizationStatus = .notDetermined

    func refresh() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func request() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            Log.notify.info("notification permission answered granted=\(granted)")
        } catch {
            Log.notify.error("notification permission request failed: \(String(describing: error), privacy: .public)")
        }
        await refresh()
    }
}
