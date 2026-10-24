import Foundation

/// The invisible tag that carries a delivery marker in the user's reminders: docs/ios/reminders.md.
/// It works on Unicode scalars: U+200C and U+200D join the character before them into one Swift Character.
public enum HiddenTag {
    public static let mark = "\u{2063}\u{200B}\u{2063}"
    /// Base-4 digits 0, 1, 2, 3.
    static let digits: [Unicode.Scalar] = ["\u{200C}", "\u{200D}", "\u{2060}", "\u{2064}"]
    static let hex: [Unicode.Scalar] = Array("0123456789abcdef".unicodeScalars)
    static let markScalars = Array(mark.unicodeScalars)

    public enum Failure: Error, Equatable {
        case invalidMarker(String)
    }

    /// The 19-scalar tag for an 8-character lowercase hex marker.
    public static func make(marker: String) throws(Failure) -> String {
        let scalars = Array(marker.unicodeScalars)
        guard scalars.count == 8 else { throw .invalidMarker(marker) }
        var tag = String.UnicodeScalarView(markScalars)
        for scalar in scalars {
            guard let value = hex.firstIndex(of: scalar) else { throw .invalidMarker(marker) }
            tag.append(digits[value / 4])
            tag.append(digits[value % 4])
        }
        return String(tag)
    }

    /// One line of a title or notes, split into the visible text and the marker of its tag.
    public struct Line: Equatable, Sendable {
        public let text: String
        public let marker: String?
        /// A mark that is not followed by a valid marker.
        public let hasBrokenTag: Bool

        /// The line holds a tag and nothing else: the app created this reminder.
        public var isOwnTag: Bool { marker != nil && text.trimmingCharacters(in: .whitespaces).isEmpty }
        /// Text followed by a tag: a line the app added.
        public var isAddedLine: Bool { marker != nil && !isOwnTag }
    }

    public static func parse(line: String) -> Line {
        let scalars = Array(line.unicodeScalars)
        guard let start = firstIndex(of: markScalars, in: scalars) else {
            return Line(text: line, marker: nil, hasBrokenTag: false)
        }
        let bodyStart = start + markScalars.count
        guard scalars.count >= bodyStart + 16 else { return Line(text: line, marker: nil, hasBrokenTag: true) }
        var marker = String.UnicodeScalarView()
        for offset in stride(from: bodyStart, to: bodyStart + 16, by: 2) {
            guard let high = digits.firstIndex(of: scalars[offset]), let low = digits.firstIndex(of: scalars[offset + 1]) else {
                return Line(text: line, marker: nil, hasBrokenTag: true)
            }
            marker.append(hex[high * 4 + low])
        }
        var text = String.UnicodeScalarView(scalars[..<start])
        text.append(contentsOf: scalars[(bodyStart + 16)...])
        return Line(text: String(text), marker: String(marker), hasBrokenTag: false)
    }

    /// Lines split at "\n".
    public static func lines(_ text: String) -> [Line] {
        splitLines(text).map(parse(line:))
    }

    public static func splitLines(_ text: String) -> [String] {
        text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { String(String.UnicodeScalarView($0)) }
    }

    private static func firstIndex(of needle: [Unicode.Scalar], in haystack: [Unicode.Scalar]) -> Int? {
        guard haystack.count >= needle.count else { return nil }
        return (0...(haystack.count - needle.count)).first { haystack[$0..<($0 + needle.count)].elementsEqual(needle) }
    }
}
