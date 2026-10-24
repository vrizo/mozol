import AppIntents
import MozolCore

/// Skeleton for the future Shortcuts action: docs/ios/shortcuts.md. Hidden from the Shortcuts app.
struct CheckMessagesIntent: AppIntent {
    static let title: LocalizedStringResource = "Check for Messages"
    static let description = IntentDescription("Asks the MOZOL server for new messages.")
    static let isDiscoverable = false
    static let openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult {
        await AppEnvironment.shared.events.handle(.shortcut(name: "checkMessages"))
        return .result()
    }
}
