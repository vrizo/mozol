import SwiftUI

@main
struct MozolApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    private let environment = AppEnvironment.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(environment.session)
                .environment(environment.sync)
                .environment(environment.push)
                .environment(environment.notifications)
                .environment(environment.reminders)
                .environment(environment.events)
                .environment(\.appConfig, environment.config)
        }
        .modelContainer(environment.modelContainer)
    }
}

extension EnvironmentValues {
    @Entry var appConfig = Config(baseURL: Config.defaultBaseURL)
}
