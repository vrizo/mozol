import MozolCore
import SwiftUI

/// Sign-in, then the Permissions screen once, then the tabs.
struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        if !session.isSignedIn {
            SignInView()
        } else if !session.hasSeenPermissions {
            PermissionsView()
        } else {
            MainTabView()
        }
    }
}

struct MainTabView: View {
    @Environment(AppEventHandler.self) private var events
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            InboxView()
                .tabItem { Label("Inbox", systemImage: "tray") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gear") }
        }
        .tint(Color.ink)
        .task(id: scenePhase) {
            guard scenePhase == .active else {
                if scenePhase == .background { BackgroundRefresh.schedule() }
                return
            }
            await events.handle(.becameActive)
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: SyncPolicy.foregroundInterval)
                } catch {
                    return
                }
                await events.handle(.foregroundTimer)
            }
        }
    }
}
