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

    /// The SwiftData store name: Application Support/mozol.store.
    static let storeName = "mozol"

    let config: Config
    let modelContainer: ModelContainer
    let session: SessionStore
    let api: APIClient
    let reminders: RemindersStore
    let devices: DeviceRegistration
    let sync: DeliverySync
    let events: AppEventHandler

    init(config: Config, defaults: UserDefaults, keychainService: String, inMemory: Bool, urlSession: URLSession = .shared) {
        self.config = config
        do {
            if !inMemory {
                try FileManager.default.createDirectory(at: .applicationSupportDirectory, withIntermediateDirectories: true)
            }
            modelContainer = try ModelContainer(
                for: DeliveryRecord.self,
                configurations: ModelConfiguration(Self.storeName, isStoredInMemoryOnly: inMemory)
            )
        } catch {
            fatalError("SwiftData container failed: \(error)")
        }
        session = SessionStore(keychain: Keychain(service: keychainService), defaults: defaults)
        api = APIClient(baseURL: config.baseURL, urlSession: urlSession, token: { [session] in session.token })
        reminders = RemindersStore()
        devices = DeviceRegistration(
            api: api, session: session, defaults: defaults, environment: config.apnsEnvironment, reminders: reminders
        )
        sync = DeliverySync(api: api, session: session, reminders: reminders, context: modelContainer.mainContext, defaults: defaults)
        events = AppEventHandler(api: api, session: session, sync: sync, devices: devices)
    }
}
