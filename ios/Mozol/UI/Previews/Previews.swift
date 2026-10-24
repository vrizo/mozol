#if DEBUG
import MozolCore
import SwiftUI

private struct PreviewEnvironment: ViewModifier {
    func body(content: Content) -> some View {
        let environment = PreviewData.environment
        content
            .environment(environment.session)
            .environment(environment.sync)
            .environment(environment.devices)
            .environment(environment.reminders)
            .environment(environment.events)
            .environment(\.appConfig, environment.config)
            .modelContainer(environment.modelContainer)
    }
}

#Preview("Sign in") {
    SignInView().modifier(PreviewEnvironment())
}

#Preview("Permissions") {
    PermissionsView().modifier(PreviewEnvironment())
}

#Preview("Placed") {
    InboxView().modifier(PreviewEnvironment())
}

#Preview("Status line failures") {
    List {
        SyncStatusLine(status: .failed(.http(status: 404, code: nil)), lastSuccess: nil)
        SyncStatusLine(status: .needsRemindersAccess, lastSuccess: nil)
        SyncStatusLine(status: .failed(.unreachable), lastSuccess: nil)
        SyncStatusLine(status: .checking, lastSuccess: nil)
        SyncStatusLine(status: .idle, lastSuccess: .now)
    }
}

#Preview("Settings") {
    SettingsView().modifier(PreviewEnvironment())
}
#endif
