import Foundation
import MozolCore
import Observation
import SwiftData

enum SyncOutcome: Equatable {
    case newData(count: Int)
    case noData
    case failed
    case skipped
}

/// Fetches GET /api/messages and stores raw payloads in the Inbox: docs/ios/messages.md.
@Observable
final class MessageSync {
    enum Status: Equatable {
        case idle
        case checking
        case failed(APIError)
    }

    static let cursorKey = "mozol.messagesCursor"
    static let lastSuccessKey = "mozol.messagesLastSuccess"
    static let lastBackgroundKey = "mozol.lastBackgroundRefresh"

    private(set) var status: Status = .idle
    private(set) var lastSuccess: Date?
    private(set) var lastBackgroundRun: Date?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let defaults: UserDefaults

    init(api: APIClient, context: ModelContext, defaults: UserDefaults) {
        self.api = api
        self.context = context
        self.defaults = defaults
        lastSuccess = defaults.object(forKey: Self.lastSuccessKey) as? Date
        lastBackgroundRun = defaults.object(forKey: Self.lastBackgroundKey) as? Date
    }

    func storePush(raw: String, at date: Date = .now) throws {
        context.insert(InboxEntry(key: "push:\(UUID().uuidString)", source: .push, receivedAt: date, body: raw))
        try context.save()
        Log.store.info("inbox: push stored")
    }

    func run(trigger: String) async -> SyncOutcome {
        guard status != .checking else {
            Log.sync.info("fetch skipped trigger=\(trigger, privacy: .public): a fetch is running")
            return .skipped
        }
        status = .checking
        let cursor = defaults.string(forKey: Self.cursorKey)
        Log.sync.info("fetch start trigger=\(trigger, privacy: .public) hasCursor=\(cursor != nil)")

        let data: Data
        do {
            data = try await api.get("api/messages", query: cursor.map { [URLQueryItem(name: "after", value: $0)] } ?? [])
        } catch {
            status = .failed(error)
            Log.sync.error("fetch failed trigger=\(trigger, privacy: .public) error=\(String(describing: error), privacy: .public)")
            return .failed
        }

        let page: MessagesPage
        do {
            page = try MessagesPage.decode(data)
        } catch {
            status = .failed(.unreadable)
            Log.sync.error("fetch answer unreadable: \(String(describing: error), privacy: .public)")
            return .failed
        }

        let inserted: Int
        do {
            inserted = try store(page.messages)
        } catch {
            status = .failed(.unreadable)
            Log.store.error("inbox save failed: \(String(describing: error), privacy: .public)")
            return .failed
        }
        if let next = page.cursor { defaults.set(next, forKey: Self.cursorKey) }
        let now = Date.now
        lastSuccess = now
        defaults.set(now, forKey: Self.lastSuccessKey)
        status = .idle
        Log.sync.info("fetch done trigger=\(trigger, privacy: .public) received=\(page.messages.count) inserted=\(inserted)")
        return inserted > 0 ? .newData(count: inserted) : .noData
    }

    func recordBackgroundRun(at date: Date = .now) {
        lastBackgroundRun = date
        defaults.set(date, forKey: Self.lastBackgroundKey)
    }

    /// Sign-out: deletes the Inbox and the cursor.
    func reset() throws {
        try context.delete(model: InboxEntry.self)
        try context.save()
        Self.clearDefaults(defaults)
        lastSuccess = nil
        lastBackgroundRun = nil
        status = .idle
        Log.store.info("inbox cleared")
    }

    static func clearDefaults(_ defaults: UserDefaults) {
        for key in [cursorKey, lastSuccessKey, lastBackgroundKey] { defaults.removeObject(forKey: key) }
    }

    private func store(_ messages: [MessagesPage.Message]) throws -> Int {
        let now = Date.now
        var inserted = 0
        for message in messages {
            let key = "message:\(message.id)"
            let existing = FetchDescriptor<InboxEntry>(predicate: #Predicate { $0.key == key })
            guard try context.fetchCount(existing) == 0 else { continue }
            context.insert(InboxEntry(key: key, source: .server, receivedAt: now, body: message.raw))
            inserted += 1
        }
        if inserted > 0 { try context.save() }
        return inserted
    }
}
