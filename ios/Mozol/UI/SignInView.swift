import MozolCore
import SwiftUI

/// Email and password: docs/product/accounts.md.
struct SignInView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppEventHandler.self) private var events
    @Environment(\.appConfig) private var config

    @State private var email = ""
    @State private var password = ""
    @State private var isSigningIn = false
    @State private var isShowingSignUp = false
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var credentials: Credentials { Credentials(email: email, password: password) }
    private var showsEmailHint: Bool { !email.isEmpty && !credentials.isEmailValid && focus != .email }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("MOZOL")
                        .font(.largeTitle.bold())
                    Text("Learn a language with small reminders.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding(.top, 48)

                VStack(alignment: .leading, spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .accessibilityIdentifier("signin.email")
                        .padding(.trailing, email.isEmpty ? 0 : 28)
                        .overlay(alignment: .trailing) {
                            if !email.isEmpty {
                                Button {
                                    email = ""
                                    focus = .email
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.borderless)
                                .padding(.trailing, 8)
                                .accessibilityLabel("Clear Email")
                                .accessibilityIdentifier("signin.email.clear")
                            }
                        }
                    if showsEmailHint {
                        Text("Enter an email address, for example name@example.com.")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                        .accessibilityIdentifier("signin.password")
                }
                .textFieldStyle(.roundedBorder)

                VStack(spacing: 12) {
                    Button(action: signIn) {
                        Text("Sign In")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!credentials.isComplete || isSigningIn)
                    .accessibilityIdentifier("signin.submit")

                    Text("Sign-in is not connected to the server yet. Any email and password work.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 4) {
                    Text("No account yet?")
                        .foregroundStyle(.secondary)
                    Button("Create Account") { isShowingSignUp = true }
                        .accessibilityIdentifier("signin.createAccount")
                }
                .font(.subheadline)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            guard email.isEmpty, let last = session.lastEmail else { return }
            email = last
        }
        .sheet(isPresented: $isShowingSignUp) {
            WebPageSheet(title: "Create Account", url: config.signUpURL)
        }
    }

    private func signIn() {
        guard credentials.isComplete, !isSigningIn else { return }
        isSigningIn = true
        Task {
            defer { isSigningIn = false }
            do {
                try await events.signIn(credentials)
            } catch {
                Log.ui.error("sign-in failed: \(String(describing: error), privacy: .public)")
            }
        }
    }
}
