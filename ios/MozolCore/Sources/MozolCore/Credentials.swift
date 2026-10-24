/// Email and password from the sign-in form.
public struct Credentials: Equatable, Sendable {
    public let email: String
    public let password: String

    public init(email: String, password: String) {
        self.email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        self.password = password
    }

    /// The shape name@domain.tld, no spaces.
    public var isEmailValid: Bool {
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !email.contains(where: \.isWhitespace) else { return false }
        let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        return domain.count >= 2 && domain.allSatisfy { !$0.isEmpty }
    }

    public var isComplete: Bool { isEmailValid && !password.isEmpty }
}
