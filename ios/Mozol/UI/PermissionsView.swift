import SwiftUI

/// Asks for notifications, then for Reminders, with one Continue button: docs/ios/permissions.md.
struct PermissionsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(NotificationPermission.self) private var notifications
    @Environment(RemindersStore.self) private var reminders

    @State private var isAsking = false
    @ScaledMetric(relativeTo: .title) private var iconSize = 28

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s6) {
            Spacer()
            SectionLabel(text: "Before you start")
            Text("Notifications and Reminders")
                .font(.heading)
                .foregroundStyle(Color.ink)
            Text("MOZOL uses two system features.")
                .font(.sans(18, relativeTo: .title3))
                .foregroundStyle(Color.ink2)
            VStack(spacing: 0) {
                row(systemImage: "bell.badge", text: "Notifications: MOZOL will use them for short hints in a later version.")
                CardDivider()
                row(systemImage: "checklist", text: "Reminders: MOZOL adds what to learn, as a line in a reminder that mentions the same word, or as a new reminder.")
            }
            .card()
            Spacer()
            if isAsking {
                PlusLoadingRow()
            }
            Button(action: ask) {
                Text("Continue ->")
            }
            .buttonStyle(.primary)
            .accessibilityLabel("Continue")
            .disabled(isAsking)
            .accessibilityIdentifier("permissions.continue")
        }
        .padding(Space.s6)
        .paperBackground()
    }

    private func row(systemImage: String, text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: Space.s4) {
            Image(systemName: systemImage)
                .font(.title3)
                .frame(width: iconSize)
                .foregroundStyle(Color.ink)
                .accessibilityHidden(true)
            Text(text)
                .font(.bodyText)
                .foregroundStyle(Color.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(Space.s4)
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
