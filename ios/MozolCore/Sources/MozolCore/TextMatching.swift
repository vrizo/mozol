import Foundation

/// Text normalization and match terms, the same as shared/src/matching.ts ("Text normalization" in shared/CONTRACT.md).
public enum TextMatching {
    public enum TermProblem: Error, Equatable {
        case empty
        case hasSpace
        case prefixTooShort
        case phraseTooShort
    }

    /// Lowercase, NFKD, drop nonspacing marks, every run of non-letters and non-numbers becomes one space, trim.
    public static func normalize(_ text: String) -> String {
        var result = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in text.lowercased().decomposedStringWithCompatibilityMapping.unicodeScalars {
            let category = scalar.properties.generalCategory
            if category == .nonspacingMark { continue }
            if isLetterOrNumber(category) {
                if pendingSpace, !result.isEmpty { result.append(" ") }
                pendingSpace = false
                result.append(scalar)
            } else {
                pendingSpace = true
            }
        }
        return String(result)
    }

    public static func tokens(_ normalized: String) -> [Substring] {
        normalized.isEmpty ? [] : normalized.split(separator: " ", omittingEmptySubsequences: false)
    }

    /// The term with its text normalized. A term that breaks the mode rules throws.
    public static func normalizeTerm(_ term: MatchTerm) throws(TermProblem) -> MatchTerm {
        let text = normalize(term.text)
        if text.isEmpty { throw .empty }
        if term.mode == .word || term.mode == .prefix, text.contains(" ") { throw .hasSpace }
        if term.mode == .prefix, text.unicodeScalars.count < 4 { throw .prefixTooShort }
        if term.mode == .phrase, tokens(text).count < 2 { throw .phraseTooShort }
        return MatchTerm(text: text, lang: term.lang, mode: term.mode)
    }

    public static func matches(_ term: MatchTerm, normalizedText: String) throws(TermProblem) -> Bool {
        let term = try normalizeTerm(term)
        let textTokens = tokens(normalizedText)
        switch term.mode {
        case .word:
            return textTokens.contains(Substring(term.text))
        case .prefix:
            return textTokens.contains { $0.unicodeScalars.starts(with: term.text.unicodeScalars) }
        case .phrase:
            return containsSequence(textTokens, tokens(term.text))
        case .substring:
            return normalizedText.unicodeScalars.firstRange(of: term.text.unicodeScalars) != nil
        }
    }

    /// The number of terms that match the text. The caller leaves out the lines MOZOL added.
    public static func score(_ terms: [MatchTerm], text: String) throws(TermProblem) -> Int {
        let normalized = normalize(text)
        var count = 0
        for term in terms where try matches(term, normalizedText: normalized) {
            count += 1
        }
        return count
    }

    private static func isLetterOrNumber(_ category: Unicode.GeneralCategory) -> Bool {
        switch category {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            true
        default:
            false
        }
    }

    private static func containsSequence(_ haystack: [Substring], _ needle: [Substring]) -> Bool {
        guard !needle.isEmpty, needle.count <= haystack.count else { return needle.isEmpty }
        for start in 0...(haystack.count - needle.count) where haystack[start..<(start + needle.count)].elementsEqual(needle) {
            return true
        }
        return false
    }
}
