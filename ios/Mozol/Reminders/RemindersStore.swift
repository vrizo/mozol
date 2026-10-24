import EventKit
import MozolCore
import Observation

enum RemindersError: Error, Equatable {
    case noAccess
    case fetchFailed
    case notFound
    case listNotFound
    case eventKit(code: Int)
}

/// The user's Apple Reminders through EventKit, with no screen of its own: docs/ios/reminders.md.
@Observable
final class RemindersStore {
    private(set) var authorization: EKAuthorizationStatus = EKEventStore.authorizationStatus(for: .reminder)

    @ObservationIgnored private let store = EKEventStore()

    var hasFullAccess: Bool { authorization == .fullAccess }

    func refreshAuthorization() {
        authorization = EKEventStore.authorizationStatus(for: .reminder)
    }

    func requestAccess() async {
        do {
            let granted = try await store.requestFullAccessToReminders()
            Log.store.info("reminders permission answered granted=\(granted)")
        } catch {
            Log.store.error("reminders permission request failed: \(String(describing: error), privacy: .public)")
        }
        refreshAuthorization()
    }

    func lists() throws -> [ReminderList] {
        guard hasFullAccess else { throw RemindersError.noAccess }
        return store.calendars(for: .reminder).map { ReminderList(id: $0.calendarIdentifier, title: $0.title) }
    }

    /// The default list for new reminders, as the user set it in the Reminders app.
    func defaultListID() throws -> String {
        guard hasFullAccess else { throw RemindersError.noAccess }
        guard let calendar = store.defaultCalendarForNewReminders() else { throw RemindersError.listNotFound }
        return calendar.calendarIdentifier
    }

    /// Reminders that are not completed, from all lists.
    func openReminders() async throws -> [ReminderItem] {
        guard hasFullAccess else { throw RemindersError.noAccess }
        guard let items = await Self.fetchIncomplete(store, calendars: store.calendars(for: .reminder)) else {
            Log.store.error("reminders fetch returned nil")
            throw RemindersError.fetchFailed
        }
        Log.store.info("reminders loaded open=\(items.count)")
        return items
    }

    /// Saves a draft: a new reminder when `id` is nil, otherwise the reminder with that id. Returns the id.
    @discardableResult
    func save(_ draft: ReminderDraft, id: String?) throws -> String {
        guard hasFullAccess else { throw RemindersError.noAccess }
        let reminder: EKReminder
        if let id {
            guard let existing = store.calendarItem(withIdentifier: id) as? EKReminder else { throw RemindersError.notFound }
            reminder = existing
        } else {
            reminder = EKReminder(eventStore: store)
        }
        guard let listID = draft.listID, let calendar = store.calendar(withIdentifier: listID) else {
            throw RemindersError.listNotFound
        }
        reminder.title = draft.trimmedTitle
        reminder.notes = draft.storedNotes
        reminder.calendar = calendar
        reminder.isCompleted = draft.isCompleted
        if let due = draft.dueDate {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            reminder.alarms = [EKAlarm(absoluteDate: due)]
        } else {
            reminder.dueDateComponents = nil
            reminder.alarms = nil
        }
        try commit { try store.save(reminder, commit: true) }
        Log.store.info("reminder saved id=\(reminder.calendarItemIdentifier, privacy: .public) new=\(id == nil)")
        return reminder.calendarItemIdentifier
    }

    func delete(_ id: String) throws {
        guard hasFullAccess else { throw RemindersError.noAccess }
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else { throw RemindersError.notFound }
        try commit { try store.remove(reminder, commit: true) }
        Log.store.info("reminder deleted id=\(id, privacy: .public)")
    }

    private func commit(_ work: () throws -> Void) throws {
        do {
            try work()
        } catch {
            let code = (error as NSError).code
            Log.store.error("eventkit write failed code=\(code)")
            throw RemindersError.eventKit(code: code)
        }
    }

    private nonisolated static func fetchIncomplete(_ store: EKEventStore, calendars: [EKCalendar]) async -> [ReminderItem]? {
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
        return await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                let items = reminders?.map { reminder in
                    ReminderItem(
                        id: reminder.calendarItemIdentifier,
                        title: reminder.title ?? "",
                        notes: reminder.notes,
                        dueDate: reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) },
                        listID: reminder.calendar.calendarIdentifier,
                        isCompleted: reminder.isCompleted
                    )
                }
                continuation.resume(returning: items)
            }
        }
    }
}
