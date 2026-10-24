import SwiftUI

/// Asks for notifications, then for Reminders, with one Continue button: docs/ios/permissions.md.
struct PermissionsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(NotificationPermission.self) private var notifications
    @Environment(RemindersStore.self) private var reminders

    @State private var isAsking = false
    @ScaledMetric(relativeTo: .title) private var iconSize = 28

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Spacer()
            Text("Notifications and Reminders")
                .font(.largeTitle.bold())
            Text("MOZOL uses two system features.")
                .foregroundStyle(.secondary)
            row(systemImage: "bell.badge", text: "Notifications: MOZOL uses them to show your messages.")
            row(systemImage: "checklist", text: "Reminders: MOZOL uses them to add short language tips and to update reminders that match a tip.")
            Spacer()
            Button(action: ask) {
                Text("Continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isAsking)
            .accessibilityIdentifier("permissions.continue")
        }
        .padding(24)
    }

    private func row(systemImage: String, text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: systemImage)
                .font(.title2)
                .frame(width: iconSize)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text(text)
        }
        .accessibilityElement(children: .combine)
    }

    private func ask() {
        isAsking = true
        Task {
            await notifications.request()
            await reminders.requestAccess()
            session.markPermissionsShown()
            isAsking = false
        }
    }
}
