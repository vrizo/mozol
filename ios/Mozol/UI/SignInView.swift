import MozolCore
import SwiftUI

/// Sign-in on the website page /app/signin in a web view inside the app: docs/product/accounts.md.
struct SignInView: View {
    @Environment(AppEventHandler.self) private var events
    @Environment(\.appConfig) private var config

    @State private var isShowingPage = false
    @State private var isFinishing = false
    @State private var failure: Failure?

    enum Failure: Equatable {
        case codeRefused
        case server(Int)
        case unreachable
        case unreadable
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s8) {
                VStack(alignment: .leading, spacing: Space.s3) {
                    SectionLabel(text: "Get Started")
                    Image("Wordmark")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 36)
                        .foregroundStyle(Color.ink)
                        .accessibilityLabel(Text(verbatim: "MOZOL"))
                    Text("Learn a language with small reminders.")
                        .font(.sans(18, relativeTo: .title3))
                        .foregroundStyle(Color.ink2)
                }
                .padding(.top, Space.s12)

                VStack(alignment: .leading, spacing: Space.s3) {
                    Button {
                        failure = nil
                        isShowingPage = true
                    } label: {
                        Text("Sign In ->")
                    }
                    .buttonStyle(.primary)
                    .accessibilityLabel("Sign In")
                    .disabled(isFinishing)
                    .accessibilityIdentifier("signin.start")

                    if isFinishing {
                        PlusLoadingRow()
                            .accessibilityValue(Text("Finishing sign-in"))
                    }
                    if let failure {
                        failureText(failure)
                            .font(.secondaryText)
                            .foregroundStyle(Color.danger)
                            .accessibilityIdentifier("signin.failure")
                    }
                    Text("Sign in or create an account on the MOZOL website. The page opens here, in the app.")
                        .font(.secondaryText)
                        .foregroundStyle(Color.ink2)
                }
            }
            .padding(.horizontal, Space.s6)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .paperBackground()
        .sheet(isPresented: $isShowingPage) {
            WebPageSheet(title: "Sign In", url: config.appSignInURL, closeTitle: "Cancel", onAppURL: handOver)
        }
    }

    private func failureText(_ failure: Failure) -> Text {
        switch failure {
        case .codeRefused: Text("The sign-in code did not work. It may have expired or been used. Tap Sign In to try again.")
        case let .server(status): Text("Couldn't sign in: error \(status)")
        case .unreachable: Text("Couldn't reach the server. Check your connection and try again.")
        case .unreadable: Text("Couldn't read the server answer")
        }
    }

    private func handOver(_ url: URL) {
        isShowingPage = false
        guard let code = Config.signInCode(from: url) else {
            Log.ui.error("sign-in page handed over an address without a code")
            failure = .codeRefused
            return
        }
        isFinishing = true
        Task {
            defer { isFinishing = false }
            do throws(APIError) {
                try await events.completeSignIn(code: code)
            } catch {
                Log.ui.error("sign-in failed: \(String(describing: error), privacy: .public)")
                failure = switch error {
                case .http(400, "code_invalid"): .codeRefused
                case let .http(status, _): .server(status)
                case .unreachable: .unreachable
                case .unreadable: .unreadable
                }
            }
        }
    }
}
