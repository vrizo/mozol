import Foundation

/// Raw payloads as the Inbox stores and shows them.
public enum RawJSON {
    public enum Failure: Error, Equatable {
        case notUTF8
        case notSerializable
    }

    /// Pretty-printed JSON with sorted keys, or the text as it is when it is not JSON.
    public static func display(_ data: Data) throws -> String {
        if let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) {
            return try text(from: object)
        }
        guard let text = String(data: data, encoding: .utf8) else { throw Failure.notUTF8 }
        return text
    }

    /// A JSON value (for example a push userInfo dictionary) as pretty-printed text.
    public static func text(from object: Any) throws -> String {
        guard JSONSerialization.isValidJSONObject(object) || object is String || object is NSNumber else {
            throw Failure.notSerializable
        }
        let data = try JSONSerialization.data(
            withJSONObject: object,
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]
        )
        guard let text = String(data: data, encoding: .utf8) else { throw Failure.notUTF8 }
        return text
    }

    /// The first non-empty line, for list rows.
    public static func preview(_ text: String, limit: Int = 80) -> String {
        let line = text
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty && $0 != "{" && $0 != "[" } ?? ""
        return line.count > limit ? String(line.prefix(limit)) + "…" : line
    }
}
