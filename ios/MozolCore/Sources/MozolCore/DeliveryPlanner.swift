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

/// What a new or updated MOZOL reminder gets.
public struct ReminderContent: Equatable, Sendable {
    public let title: String
    /// The recommendation notes with the hidden tag as the last line.
    public let notes: String
    public let url: URL?
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
        case badMatchTerm

        /// The errorCode reported with a failed result.
        public var code: String {
            switch self {
            case .badMarker: "bad_marker"
            case .badMatchTerm: "bad_match_term"
            }
        }
    }

    public static func plan(
        _ item: DeliveryItem,
        embedInMyReminders: Bool,
        reminders: [ReminderSnapshot]
    ) throws(Failure) -> DeliveryPlan {
        let rec = item.recommendation
        let tag: String
        do {
            tag = try HiddenTag.make(marker: rec.marker)
        } catch {
            throw .badMarker
        }
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
            url: URL(string: rec.url)
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
