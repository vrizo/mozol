import Foundation

/// Where the app talks to. The base URL can be overridden with the UserDefaults key
/// `mozol.apiBaseURL` (launch argument `-mozol.apiBaseURL <url>`): docs/ios/app-rules.md.
struct Config {
    static let defaultBaseURL = URL(string: "https://mozol.vrizo.net")!
    static let baseURLKey = "mozol.apiBaseURL"

    let baseURL: URL

    var signUpURL: URL { baseURL.appending(path: "signup") }

    /// The APNs environment the build is signed for.
    var apnsEnvironment: String {
        #if DEBUG
        "development"
        #else
        "production"
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
