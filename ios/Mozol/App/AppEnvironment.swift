import Foundation
import SwiftData

/// Holds every long-lived service. One instance for the app; tests and previews build their own.
final class AppEnvironment {
    static let shared: AppEnvironment = {
        #if DEBUG
        LaunchArguments.applyBeforeLaunch()
        #endif
        return AppEnvironment(config: .load(), defaults: .standard, keychainService: Keychain.appService, inMemory: false)
    }()

    let config: Config
    let modelContainer: ModelContainer
    let session: SessionStore
    let api: APIClient
    let sync: MessageSync
    let push: PushRegistration
    let notifications: NotificationPermission
    let reminders: RemindersStore
    let events: AppEventHandler

    init(config: Config, defaults: UserDefaults, keychainService: String, inMemory: Bool, urlSession: URLSession = .shared) {
        self.config = config
        do {
            if !inMemory {
                try FileManager.default.createDirectory(at: .applicationSupportDirectory, withIntermediateDirectories: true)
            }
            modelContainer = try ModelContainer(
                for: InboxEntry.self,
                configurations: ModelConfiguration(isStoredInMemoryOnly: inMemory)
            )
        } catch {
            fatalError("SwiftData container failed: \(error)")
        }
        session = SessionStore(keychain: Keychain(service: keychainService), defaults: defaults, auth: PlaceholderAuthService())
        api = APIClient(baseURL: config.baseURL, urlSession: urlSession, token: { [session] in session.token })
        sync = MessageSync(api: api, context: modelContainer.mainContext, defaults: defaults)
        push = PushRegistration(api: api, session: session, defaults: defaults, environment: config.apnsEnvironment)
        notifications = NotificationPermission()
        reminders = RemindersStore()
        events = AppEventHandler(session: session, sync: sync, push: push)
    }
}
