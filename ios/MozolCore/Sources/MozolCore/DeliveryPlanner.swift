import Foundation

/// One reminder as the planner sees it, copied out of EventKit.
public struct ReminderSnapshot: Equatable, Sendable {
    public let id: String
    public let title: String
    public let notes: String
    public let isCompleted: Bool
    public let lastModified: Date?

    public init(id: String, title: String, notes: String, isCompleted: Bool, lastModified: Date?) {
        self.id = id
        self.title = title
        self.notes = notes
        self.isCompleted = isCompleted
        self.lastModified = lastModified
    }
}

/// Due date components, alarm and repeat rule of a schedule.
public struct ResolvedSchedule: Equatable, Sendable {
    public let dueDate: Date
    public let dueComponents: DateComponents
    /// Every `interval` days, `count` times; nil for no repeat.
    public let repeatRule: (interval: Int, count: Int)?

    public static func == (a: ResolvedSchedule, b: ResolvedSchedule) -> Bool {
        a.dueDate == b.dueDate && a.dueComponents == b.dueComponents
            && a.repeatRule?.interval == b.repeatRule?.interval && a.repeatRule?.count == b.repeatRule?.count
    }

    /// The due time is earliestAt in `timeZone`; a time outside activeFrom..activeTo moves to the next activeFrom.
    public static func resolve(_ schedule: DeliverySchedule, timeZone: TimeZone) throws(DeliveryPlanner.Failure) -> ResolvedSchedule {
        guard let earliest = parseTime(schedule.earliestAt),
              let from = parseClock(schedule.activeFrom),
              let to = parseClock(schedule.activeTo),
              from < to
        else { throw .badSchedule }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        // Steps: whole minute at or after earliestAt, then the active window, then the components.
        var due = calendar.dateInterval(of: .minute, for: earliest)!.start
        if due < earliest { due = calendar.date(byAdding: .minute, value: 1, to: due)! }
        let clock = calendar.dateComponents([.hour, .minute], from: due)
        let minuteOfDay = clock.hour! * 60 + clock.minute!
        if minuteOfDay < from || minuteOfDay > to {
            let day = minuteOfDay < from ? due : calendar.date(byAdding: .day, value: 1, to: due)!
            guard let moved = calendar.date(bySettingHour: from / 60, minute: from % 60, second: 0, of: day) else { throw .badSchedule }
            due = moved
        }
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: due)
        components.timeZone = timeZone

        var repeatRule: (Int, Int)?
        if let rule = schedule.repeat {
            guard rule.frequency == "daily", rule.interval >= 1, rule.count >= 1 else { throw .badSchedule }
            repeatRule = (rule.interval, rule.count)
        }
        return ResolvedSchedule(dueDate: due, dueComponents: components, repeatRule: repeatRule)
    }

    /// ISO 8601 with an offset, with or without milliseconds.
    static func parseTime(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }

    /// "HH:MM" as minutes since midnight.
    static func parseClock(_ text: String) -> Int? {
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let hour = Int(parts[0]), let minute = Int(parts[1]), hour < 24, minute < 60
        else { return nil }
        return hour * 60 + minute
    }
}

/// What a new or updated MOZOL reminder gets.
public struct ReminderContent: Equatable, Sendable {
    public let title: String
    /// The recommendation notes with the hidden tag as the last line.
    public let notes: String
    public let url: URL?
    public let priority: Int
    public let schedule: ResolvedSchedule
}

public struct NotesChange: Equatable, Sendable {
    public let reminderID: String
    public let notes: String
}

public enum DeliveryPlan: Equatable, Sendable {
    case embedUpdate([NotesChange])
    case reminderUpdate(reminderID: String, content: ReminderContent)
    case embed(NotesChange)
    case create(ReminderContent)

    public var outcome: DeliveryOutcome {
        switch self {
        case .embedUpdate: .embedUpdated
        case .reminderUpdate: .reminderUpdated
        case .embed: .embedded
        case .create: .created
        }
    }
}

/// Picks the first step of "How the app applies a delivery" (shared/CONTRACT.md) that fits.
public enum DeliveryPlanner {
    public enum Failure: Error, Equatable {
        case badMarker
        case badSchedule
        case badMatchTerm

        /// The errorCode reported with a failed result.
        public var code: String {
            switch self {
            case .badMarker: "bad_marker"
            case .badSchedule: "bad_schedule"
            case .badMatchTerm: "bad_match_term"
            }
        }
    }

    public static func plan(
        _ item: DeliveryItem,
        embedInMyReminders: Bool,
        reminders: [ReminderSnapshot],
        timeZone: TimeZone
    ) throws(Failure) -> DeliveryPlan {
        let rec = item.recommendation
        let tag: String
        do {
            tag = try HiddenTag.make(marker: rec.marker)
        } catch {
            throw .badMarker
        }
        let schedule = try ResolvedSchedule.resolve(item.schedule, timeZone: timeZone)
        let parsed = reminders.map { Parsed(reminder: $0, lines: HiddenTag.lines($0.notes)) }
        let taggedLine = rec.embedLine + tag

        if embedInMyReminders {
            let changes = parsed
                .filter { !$0.reminder.isCompleted && !$0.isOwn && $0.lines.contains { $0.isAddedLine && $0.marker == rec.marker } }
                .map { entry in
                    let lines = HiddenTag.splitLines(entry.reminder.notes).enumerated().map { index, raw in
                        let line = entry.lines[index]
                        return line.isAddedLine && line.marker == rec.marker ? taggedLine : raw
                    }
                    return NotesChange(reminderID: entry.reminder.id, notes: lines.joined(separator: "\n"))
                }
            if !changes.isEmpty { return .embedUpdate(changes) }
        }

        let content = ReminderContent(
            title: rec.title,
            notes: rec.notes.isEmpty ? tag : rec.notes + "\n" + tag,
            url: URL(string: rec.url),
            priority: rec.priority,
            schedule: schedule
        )

        let own = parsed.filter { $0.lines.contains { $0.isOwnTag && $0.marker == rec.marker } }.map(\.reminder)
        if let newest = own.sorted(by: newestFirst).first {
            return .reminderUpdate(reminderID: newest.id, content: content)
        }

        if embedInMyReminders {
            var scored: [(reminder: ReminderSnapshot, score: Int)] = []
            for entry in parsed where !entry.reminder.isCompleted && !entry.isOwn {
                let visible = entry.lines.filter { $0.marker == nil }.map(\.text)
                let text = ([entry.reminder.title] + visible).joined(separator: "\n")
                let score: Int
                do {
                    score = try TextMatching.score(rec.matchTerms, text: text)
                } catch {
                    throw .badMatchTerm
                }
                if score >= 1 { scored.append((entry.reminder, score)) }
            }
            let best = scored.sorted { a, b in a.score != b.score ? a.score > b.score : newestFirst(a.reminder, b.reminder) }.first
            if let best {
                var notes = best.reminder.notes
                while let last = notes.unicodeScalars.last, last == "\n" || last == "\r" {
                    notes.unicodeScalars.removeLast()
                }
                notes = notes.isEmpty ? taggedLine : notes + "\n" + taggedLine
                return .embed(NotesChange(reminderID: best.reminder.id, notes: notes))
            }
        }

        return .create(content)
    }

    private struct Parsed {
        let reminder: ReminderSnapshot
        let lines: [HiddenTag.Line]

        /// The app created this reminder.
        var isOwn: Bool { lines.contains(where: \.isOwnTag) }
    }

    /// Most recently modified first, then the smaller identifier.
    private static func newestFirst(_ a: ReminderSnapshot, _ b: ReminderSnapshot) -> Bool {
        let left = a.lastModified ?? .distantPast
        let right = b.lastModified ?? .distantPast
        return left != right ? left > right : a.id < b.id
    }
}
