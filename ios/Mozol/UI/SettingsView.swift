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
            Form {
                Section("Account") {
                    if let email = session.email {
                        Text("Signed in as \(email)")
                    }
                    Button("Sign Out", role: .destructive) { events.signOut() }
                        .accessibilityIdentifier("settings.signOut")
                }

                Section("Permissions") {
                    LabeledContent("Notifications") { Text(notificationStatus) }
                    LabeledContent("Reminders") { Text(remindersStatus) }
                    Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                }

                Section("Push") {
                    LabeledContent("Device Token") {
                        switch push.token {
                        case .none: Text("Not registered yet")
                        case .failed: Text("Registration failed")
                        case .registered(let hex):
                            Text(hex)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                                .lineLimit(2)
                        }
                    }
                    if let hex = push.tokenHex {
                        Button("Copy Token") { UIPasteboard.general.string = hex }
                    }
                    LabeledContent("Server Registration") { Text(serverStatus) }
                }

                Section("Server") {
                    LabeledContent("Server") { Text(verbatim: config.baseURL.absoluteString) }
                }

                Section("Background") {
                    LabeledContent("Last Background Check") {
                        if let date = sync.lastBackgroundRun {
                            Text(date, format: .dateTime.month().day().hour().minute())
                        } else {
                            Text("Never")
                        }
                    }
                }

                Section("About") {
                    Text("Version \(Self.version) (\(Self.build))")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await notifications.refresh()
            reminders.refreshAuthorization()
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
