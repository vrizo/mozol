import MozolCore

enum AuthError: Error, Equatable {
    case incompleteCredentials
}

/// Turns an email and a password into a session token.
protocol AuthService {
    func signIn(_ credentials: Credentials) async throws -> String
}

/// Local stand-in until the server has sign-in: docs/product/accounts.md.
struct PlaceholderAuthService: AuthService {
    static let token = "placeholder"

    func signIn(_ credentials: Credentials) async throws -> String {
        guard credentials.isComplete else { throw AuthError.incompleteCredentials }
        Log.store.info("placeholder sign-in accepted")
        return Self.token
    }
}
