import Foundation
import MozolCore
import Observation

/// The signed-in account (app session token and email) and the installation id in the Keychain,
/// the onboarding flag in UserDefaults: docs/product/accounts.md.
@Observable
final class SessionStore {
    static let permissionsShownKey = "mozol.permissionsShown"
    private static let tokenAccount = "session.token"
    private static let emailAccount = "session.email"
    private static let installationAccount = "installation.id"

    private(set) var email: String?
    private(set) var token: String?
    private(set) var hasSeenPermissions: Bool

    /// Made once per install and kept after sign-out: shared/CONTRACT.md, POST /api/auth/app-token.
    @ObservationIgnored let installationID: String

    var isSignedIn: Bool { token != nil }

    @ObservationIgnored private let keychain: Keychain
    @ObservationIgnored private let defaults: UserDefaults

    init(keychain: Keychain, defaults: UserDefaults) {
        self.keychain = keychain
        self.defaults = defaults
        do {
            token = try keychain.read(Self.tokenAccount)
            email = try keychain.read(Self.emailAccount)
            if let stored = try keychain.read(Self.installationAccount) {
                guard InstallationID.isValid(stored) else { fatalError("stored installation id does not fit the contract") }
                installationID = stored
            } else {
                installationID = InstallationID.make()
                try keychain.write(installationID, for: Self.installationAccount)
                Log.store.info("installation id created")
            }
        } catch {
            fatalError("\(error)")
        }
        hasSeenPermissions = defaults.bool(forKey: Self.permissionsShownKey)
        Log.store.info("session loaded signedIn=\(self.token != nil)")
    }

    func signIn(token: String, email: String) {
        Self.write(email: email, token: token, keychain: keychain)
        self.email = email
        self.token = token
        Log.store.info("signed in")
    }

    func markPermissionsShown() {
        defaults.set(true, forKey: Self.permissionsShownKey)
        hasSeenPermissions = true
    }

    func signOut() {
        Self.clear(keychain: keychain)
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

    /// The session only; the installation id stays.
    static func clear(keychain: Keychain) {
        do {
            try keychain.delete(tokenAccount)
            try keychain.delete(emailAccount)
        } catch {
            fatalError("\(error)")
        }
    }

    static func clearInstallation(keychain: Keychain) {
        do {
            try keychain.delete(installationAccount)
        } catch {
            fatalError("\(error)")
        }
    }
}
