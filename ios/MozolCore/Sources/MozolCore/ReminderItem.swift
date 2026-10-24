import Foundation

/// One Apple Reminders item as the app shows it, copied out of EventKit.
public struct ReminderItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let notes: String?
    public let dueDate: Date?
    public let listID: String
    public let isCompleted: Bool

    public init(id: String, title: String, notes: String?, dueDate: Date?, listID: String, isCompleted: Bool) {
        self.id = id
        self.title = title
        self.notes = notes
        self.dueDate = dueDate
        self.listID = listID
        self.isCompleted = isCompleted
    }

    public var draft: ReminderDraft {
        ReminderDraft(title: title, notes: notes ?? "", listID: listID, dueDate: dueDate, isCompleted: isCompleted)
    }
}

/// One Apple Reminders list.
public struct ReminderList: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String

    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}
