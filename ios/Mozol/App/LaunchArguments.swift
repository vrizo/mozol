#if DEBUG
import Foundation
import MozolCore

/// DEBUG launch arguments that put the app in a known state: docs/ios/app-rules.md.
enum LaunchArguments {
    static let reset = "-uitest.reset"
    static let signedIn = "-uitest.signedIn"
    static let skipPermissions = "-uitest.skipPermissions"

    static let testEmail = "uitest@example.com"
    static let testToken = "uitest-token"

    static func applyBeforeLaunch(arguments: [String] = ProcessInfo.processInfo.arguments) {
        let defaults = UserDefaults.standard
        let keychain = Keychain(service: Keychain.appService)
        if arguments.contains(reset) {
            Log.store.info("launch argument: reset")
            SessionStore.clear(keychain: keychain)
            SessionStore.clearInstallation(keychain: keychain)
            DeliverySync.clearDefaults(defaults)
            DeviceRegistration.clearDefaults(defaults)
            defaults.removeObject(forKey: SessionStore.permissionsShownKey)
            resetStoreFiles()
        }
        if arguments.contains(signedIn) {
            Log.store.info("launch argument: signedIn")
            SessionStore.write(email: testEmail, token: testToken, keychain: keychain)
        }
        if arguments.contains(skipPermissions) {
            defaults.set(true, forKey: SessionStore.permissionsShownKey)
        }
    }

    static let debugPushNotification = "net.vrizo.mozol.debug.push"
    static let debugPushFile = "debug-push.json"

    /// scripts/sim-push.sh writes a payload to <app container>/tmp/debug-push.json and posts the Darwin
    /// notification net.vrizo.mozol.debug.push; the app feeds the payload to the silent push handler.
    /// The simulator delivers `simctl push` silent pushes without their payload, so local checks use this path.
    static func listenForDebugPushes() {
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            nil,
            { _, _, _, _, _ in Task { @MainActor in LaunchArguments.deliverDebugPush() } },
            debugPushNotification as CFString,
            nil,
            .deliverImmediately
        )
    }

    private static func deliverDebugPush() {
        let url = URL.temporaryDirectory.appending(path: debugPushFile)
        let payload: [String: Any]
        do {
            let data = try Data(contentsOf: url)
            try FileManager.default.removeItem(at: url)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                Log.notify.error("debug push is not a JSON object")
                return
            }
            payload = object
        } catch {
            Log.notify.error("debug push failed: \(String(describing: error), privacy: .public)")
            return
        }
        Log.notify.info("debug push received")
        Task { await AppEnvironment.shared.events.handlePush(payload) }
    }

    private static func resetStoreFiles() {
        let support = URL.applicationSupportDirectory
        let store = AppEnvironment.storeName
        for name in ["\(store).store", "\(store).store-shm", "\(store).store-wal"] {
            let url = support.appending(path: name)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            do {
                try FileManager.default.removeItem(at: url)
            } catch {
                fatalError("reset could not delete \(name): \(error)")
            }
        }
    }
}
#endif
