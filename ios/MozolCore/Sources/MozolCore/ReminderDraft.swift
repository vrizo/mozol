import Foundation

/// The editable fields of one Apple Reminders item, apart from EventKit.
public struct ReminderDraft: Equatable, Sendable {
    public var title: String
    public var notes: String
    public var listID: String?
    public var dueDate: Date?
    public var isCompleted: Bool

    public init(title: String = "", notes: String = "", listID: String? = nil, dueDate: Date? = nil, isCompleted: Bool = false) {
        self.title = title
        self.notes = notes
        self.listID = listID
        self.dueDate = dueDate
        self.isCompleted = isCompleted
    }

    public var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Notes as EventKit stores them: nil when empty.
    public var storedNotes: String? {
        let value = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    public var canSave: Bool { !trimmedTitle.isEmpty && listID != nil }
}
