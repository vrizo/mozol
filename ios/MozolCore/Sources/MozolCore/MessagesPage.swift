import Foundation

/// The answer of GET /api/messages (placeholder shape, shared/CONTRACT.md).
/// Every message is kept as raw JSON text, because its fields are not decided yet.
public struct MessagesPage: Equatable, Sendable {
    public struct Message: Equatable, Sendable {
        public let id: String
        public let raw: String
    }

    public enum Failure: Error, Equatable {
        case notAnObject
        case missingMessages
        case messageWithoutID(index: Int)
        case invalidCursor
    }

    public let messages: [Message]
    public let cursor: String?

    public static func decode(_ data: Data) throws -> MessagesPage {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Failure.notAnObject
        }
        guard let items = root["messages"] as? [Any] else { throw Failure.missingMessages }
        let messages = try items.enumerated().map { index, item in
            guard let object = item as? [String: Any], let id = object["id"] as? String, !id.isEmpty else {
                throw Failure.messageWithoutID(index: index)
            }
            return Message(id: id, raw: try RawJSON.text(from: object))
        }
        let cursor: String?
        switch root["cursor"] {
        case nil, is NSNull: cursor = nil
        case let value as String: cursor = value
        default: throw Failure.invalidCursor
        }
        return MessagesPage(messages: messages, cursor: cursor)
    }
}
