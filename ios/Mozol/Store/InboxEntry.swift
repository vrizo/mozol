import Foundation
import SwiftData

enum InboxSource: String {
    case push
    case server
}

/// One raw payload: a silent push or one message from GET /api/messages.
@Model
final class InboxEntry {
    /// "push:<uuid>" or "message:<server id>", so a server message is stored once.
    @Attribute(.unique) var key: String
    var sourceRaw: String
    var receivedAt: Date
    var body: String

    init(key: String, source: InboxSource, receivedAt: Date, body: String) {
        self.key = key
        self.sourceRaw = source.rawValue
        self.receivedAt = receivedAt
        self.body = body
    }

    var source: InboxSource {
        guard let source = InboxSource(rawValue: sourceRaw) else {
            fatalError("unknown inbox source \(sourceRaw)")
        }
        return source
    }
}
