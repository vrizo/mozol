import EventKit
import MozolCore
import Observation

enum RemindersError: Error, Equatable {
    case noAccess
    case fetchFailed
    case notFound
    case noDefaultList
    case eventKit(code: Int)

    /// The errorCode of a failed delivery result: docs/ios/reminders.md.
    var deliveryCode: String {
        switch self {
        case .noAccess: "reminders_access"
        case .fetchFailed: "eventkit_fetch"
        case .notFound: "reminder_not_found"
        case .noDefaultList: "no_default_list"
        case .eventKit: "eventkit_save"
        }
    }
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

    /// Every reminder of every list, completed or not.
    func allReminders() async throws(RemindersError) -> [ReminderSnapshot] {
        guard hasFullAccess else { throw .noAccess }
        guard let items = await Self.fetchAll(store) else {
            Log.store.error("reminders fetch returned nil")
            throw .fetchFailed
        }
        Log.store.info("reminders loaded count=\(items.count)")
        return items
    }

    /// Writes one delivery plan. Returns the reminders it changed or created, as they are now.
    func apply(_ plan: DeliveryPlan) throws(RemindersError) -> [ReminderSnapshot] {
        guard hasFullAccess else { throw .noAccess }
        switch plan {
        case let .embedUpdate(changes):
            return try changes.map { change throws(RemindersError) in try write(notes: change) }
        case let .embed(change):
            return [try write(notes: change)]
        case let .reminderUpdate(id, content):
            let reminder = try find(id)
            fill(reminder, with: content)
            reminder.isCompleted = false
            try save(reminder)
            return [Self.snapshot(reminder)]
        case let .create(content):
            guard let calendar = store.defaultCalendarForNewReminders() else { throw .noDefaultList }
            let reminder = EKReminder(eventStore: store)
            reminder.calendar = calendar
            fill(reminder, with: content)
            try save(reminder)
            return [Self.snapshot(reminder)]
        }
    }

    private func write(notes change: NotesChange) throws(RemindersError) -> ReminderSnapshot {
        let reminder = try find(change.reminderID)
        reminder.notes = change.notes
        try save(reminder)
        return Self.snapshot(reminder)
    }

    private func find(_ id: String) throws(RemindersError) -> EKReminder {
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else { throw .notFound }
        return reminder
    }

    /// Title, notes, URL, priority and the schedule: due date, one alarm, the repeat rule.
    private func fill(_ reminder: EKReminder, with content: ReminderContent) {
        reminder.title = content.title
        reminder.notes = content.notes
        reminder.url = content.url
        reminder.priority = content.priority
        reminder.dueDateComponents = content.schedule.dueComponents
        reminder.alarms = [EKAlarm(absoluteDate: content.schedule.dueDate)]
        reminder.recurrenceRules = content.schedule.repeatRule.map { rule in
            [EKRecurrenceRule(recurrenceWith: .daily, interval: rule.interval, end: EKRecurrenceEnd(occurrenceCount: rule.count))]
        }
    }

    private func save(_ reminder: EKReminder) throws(RemindersError) {
        do {
            try store.save(reminder, commit: true)
        } catch {
            let code = (error as NSError).code
            Log.store.error("eventkit write failed code=\(code)")
            throw .eventKit(code: code)
        }
        Log.store.info("reminder saved id=\(reminder.calendarItemIdentifier, privacy: .public)")
    }

    private nonisolated static func snapshot(_ reminder: EKReminder) -> ReminderSnapshot {
        ReminderSnapshot(
            id: reminder.calendarItemIdentifier,
            title: reminder.title ?? "",
            notes: reminder.notes ?? "",
            isCompleted: reminder.isCompleted,
            lastModified: reminder.lastModifiedDate
        )
    }

    private nonisolated static func fetchAll(_ store: EKEventStore) async -> [ReminderSnapshot]? {
        let predicate = store.predicateForReminders(in: nil)
        return await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders?.map(snapshot))
            }
        }
    }
}
