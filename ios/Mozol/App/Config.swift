import Foundation
import MozolCore

/// Where the app talks to. The base URL can be overridden with the UserDefaults key
/// `mozol.apiBaseURL` (launch argument `-mozol.apiBaseURL <url>`): docs/ios/app-rules.md.
struct Config {
    static let defaultBaseURL = URL(string: "https://mozol.vrizo.net")!
    static let baseURLKey = "mozol.apiBaseURL"

    let baseURL: URL

    /// The sign-in page for the in-app web view: shared/CONTRACT.md, "Sign-in handoff".
    var appSignInURL: URL {
        baseURL.appending(path: "app/signin").appending(queryItems: [URLQueryItem(name: "return", value: Self.signInReturn)])
    }

    static let signInReturn = "mozol://auth"

    /// The code of mozol://auth?code=<code>, or nil for any other address.
    static func signInCode(from url: URL) -> String? {
        guard url.scheme == "mozol", url.host() == "auth",
              let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value,
              !code.isEmpty
        else { return nil }
        return code
    }

    /// The APNs environment the build is signed for.
    var apnsEnvironment: APNsEnvironment {
        #if DEBUG
        .sandbox
        #else
        .production
        #endif
    }

    static func load(from defaults: UserDefaults = .standard) -> Config {
        guard let override = defaults.string(forKey: baseURLKey) else {
            return Config(baseURL: defaultBaseURL)
        }
        guard let url = URL(string: override), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil else {
            fatalError("\(baseURLKey) is not an http(s) URL: \(override)")
        }
        return Config(baseURL: url)
    }
}
