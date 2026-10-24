#if DEBUG
import MozolCore
import SwiftUI

private struct PreviewEnvironment: ViewModifier {
    func body(content: Content) -> some View {
        let environment = PreviewData.environment
        content
            .environment(environment.session)
            .environment(environment.sync)
            .environment(environment.push)
            .environment(environment.notifications)
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

#Preview("Inbox") {
    InboxView().modifier(PreviewEnvironment())
}

#Preview("Inbox entry") {
    NavigationStack {
        InboxEntryView(entry: InboxEntry(key: "push:1", source: .push, receivedAt: .now, body: PreviewData.pushBody))
    }
}

#Preview("Status line failures") {
    List {
        SyncStatusLine(status: .failed(.http(status: 404, code: nil)), lastSuccess: nil)
        SyncStatusLine(status: .failed(.unreachable), lastSuccess: nil)
        SyncStatusLine(status: .checking, lastSuccess: nil)
        SyncStatusLine(status: .idle, lastSuccess: .now)
    }
}

#Preview("Settings") {
    SettingsView().modifier(PreviewEnvironment())
}
#endif
