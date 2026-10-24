import EventKit
import MozolCore
import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppEventHandler.self) private var events
    @Environment(PushRegistration.self) private var push
    @Environment(NotificationPermission.self) private var notifications
    @Environment(RemindersStore.self) private var reminders
    @Environment(MessageSync.self) private var sync
    @Environment(\.appConfig) private var config
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s8) {
                    section("Account") {
                        if let email = session.email {
                            Text("Signed in as \(email)")
                                .font(.bodyText)
                                .foregroundStyle(Color.ink)
                                .padding(Space.s4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } footer: {
                        Button("Sign Out", role: .destructive) { events.signOut() }
                            .buttonStyle(.secondary)
                            .accessibilityIdentifier("settings.signOut")
                    }

                    section("Permissions") {
                        CardRow(label: "Notifications") { Text(notificationStatus) }
                        CardDivider()
                        CardRow(label: "Reminders") { Text(remindersStatus) }
                    } footer: {
                        Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                            .buttonStyle(.secondary)
                    }

                    section("Push") {
                        CardRow(label: "Device Token") {
                            switch push.token {
                            case .none: Text("Not registered yet")
                            case .failed: Text("Registration failed")
                            case .registered(let hex):
                                Text(hex)
                                    .font(.mono(.caption))
                                    .textSelection(.enabled)
                                    .lineLimit(2)
                            }
                        }
                        CardDivider()
                        CardRow(label: "Server Registration") { Text(serverStatus) }
                    } footer: {
                        if let hex = push.tokenHex {
                            Button("Copy Token") { UIPasteboard.general.string = hex }
                                .buttonStyle(.secondary)
                        }
                    }

                    section("Server") {
                        CardRow(label: "Server") {
                            Text(verbatim: config.baseURL.absoluteString)
                                .font(.mono(.footnote))
                        }
                    }

                    section("Background") {
                        CardRow(label: "Last Background Check") {
                            if let date = sync.lastBackgroundRun {
                                Text(date, format: .dateTime.month().day().hour().minute())
                            } else {
                                Text("Never")
                            }
                        }
                    }

                    DottedRule()

                    Text("Version \(Self.version) (\(Self.build))")
                        .font(.mono(.caption))
                        .foregroundStyle(Color.ink2)
                }
                .padding(Space.s4)
            }
            .paperBackground()
            .navigationTitle("Settings")
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await notifications.refresh()
            reminders.refreshAuthorization()
        }
    }

    private func section<Content: View, Footer: View>(
        _ title: LocalizedStringKey,
        @ViewBuilder content: () -> Content,
        @ViewBuilder footer: () -> Footer = { EmptyView() }
    ) -> some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            SectionLabel(text: title)
            VStack(spacing: 0) { content() }
                .card()
            footer()
        }
    }

    private var notificationStatus: LocalizedStringKey {
        switch notifications.status {
        case .authorized: "Allowed"
        case .denied: "Not allowed"
        case .notDetermined: "Not asked yet"
        case .provisional: "Quiet only"
        case .ephemeral: "Temporary"
        @unknown default: "Not asked yet"
        }
    }

    private var remindersStatus: LocalizedStringKey {
        switch reminders.authorization {
        case .fullAccess: "Full access"
        case .writeOnly: "Add only"
        case .denied: "No access"
        case .notDetermined: "Not asked yet"
        case .restricted: "Restricted by the device"
        @unknown default: "No access"
        }
    }

    private var serverStatus: LocalizedStringKey {
        switch push.server {
        case .notSent: "Not sent yet"
        case .sending: "Sending"
        case .sent: "Sent"
        case .failed(.http(let code, _)): "Failed: error \(code)"
        case .failed(.unreachable), .failed(.unreadable): "Failed: server not reached"
        }
    }

    private static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as! String
    private static let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as! String
}
