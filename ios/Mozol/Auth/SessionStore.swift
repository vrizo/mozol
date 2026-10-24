import Foundation
import MozolCore
import Observation

/// The signed-in account: email and token in the Keychain, the onboarding flag in UserDefaults.
@Observable
final class SessionStore {
    static let permissionsShownKey = "mozol.permissionsShown"
    static let lastEmailKey = "mozol.lastEmail"
    private static let tokenAccount = "session.token"
    private static let emailAccount = "session.email"

    private(set) var email: String?
    private(set) var token: String?
    private(set) var hasSeenPermissions: Bool
    /// The email of the last sign-in. It stays after sign-out, so the sign-in form starts with it.
    private(set) var lastEmail: String?

    var isSignedIn: Bool { token != nil }

    @ObservationIgnored private let keychain: Keychain
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let auth: AuthService

    init(keychain: Keychain, defaults: UserDefaults, auth: AuthService) {
        self.keychain = keychain
        self.defaults = defaults
        self.auth = auth
        do {
            token = try keychain.read(Self.tokenAccount)
            email = try keychain.read(Self.emailAccount)
        } catch {
            fatalError("\(error)")
        }
        hasSeenPermissions = defaults.bool(forKey: Self.permissionsShownKey)
        lastEmail = defaults.string(forKey: Self.lastEmailKey)
        Log.store.info("session loaded signedIn=\(self.token != nil)")
    }

    func signIn(_ credentials: Credentials) async throws {
        let token = try await auth.signIn(credentials)
        Self.write(email: credentials.email, token: token, keychain: keychain)
        self.email = credentials.email
        self.token = token
        defaults.set(credentials.email, forKey: Self.lastEmailKey)
        lastEmail = credentials.email
        Log.store.info("signed in")
    }

    func markPermissionsShown() {
        defaults.set(true, forKey: Self.permissionsShownKey)
        hasSeenPermissions = true
    }

    func signOut() {
        Self.clear(keychain: keychain, defaults: defaults)
        email = nil
        token = nil
        Log.store.info("signed out")
    }

    static func write(email: String, token: String, keychain: Keychain) {
        do {
            try keychain.write(token, for: tokenAccount)
            try keychain.write(email, for: emailAccount)
        } catch {
            fatalError("\(error)")
        }
    }

    static func clear(keychain: Keychain, defaults: UserDefaults) {
        do {
            try keychain.delete(tokenAccount)
            try keychain.delete(emailAccount)
        } catch {
            fatalError("\(error)")
        }
    }
}
