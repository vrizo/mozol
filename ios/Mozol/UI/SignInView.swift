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
            VStack(alignment: .leading, spacing: Space.s8) {
                VStack(alignment: .leading, spacing: Space.s3) {
                    SectionLabel(text: "Sign in")
                    Text(verbatim: "MOZOL")
                        .font(.sans(48, weight: .bold, relativeTo: .largeTitle))
                        .tracking(6)
                        .foregroundStyle(Color.ink)
                    Text("Learn a language with small reminders.")
                        .font(.sans(18, relativeTo: .title3))
                        .foregroundStyle(Color.ink2)
                }
                .padding(.top, Space.s12)

                VStack(alignment: .leading, spacing: Space.s4) {
                    SectionLabel(text: "Email", plus: false)
                        .accessibilityHidden(true)
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .accessibilityIdentifier("signin.email")
                        .padding(.trailing, email.isEmpty ? 0 : Space.s8)
                        .overlay(alignment: .trailing) {
                            if !email.isEmpty {
                                Button {
                                    email = ""
                                    focus = .email
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(.footnote, weight: .bold))
                                        .foregroundStyle(Color.ink)
                                        .frame(width: Outline.touch, height: Outline.touch)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Clear Email")
                                .accessibilityIdentifier("signin.email.clear")
                            }
                        }
                    if showsEmailHint {
                        Text("Enter an email address, for example name@example.com.")
                            .font(.secondaryText)
                            .foregroundStyle(Color.danger)
                    }
                    SectionLabel(text: "Password", plus: false)
                        .accessibilityHidden(true)
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                        .accessibilityIdentifier("signin.password")
                }
                .textFieldStyle(InkFieldStyle(isError: showsEmailHint))

                VStack(alignment: .leading, spacing: Space.s3) {
                    Button(action: signIn) {
                        Text("Sign In ->")
                    }
                    .buttonStyle(.primary)
                    .accessibilityLabel("Sign In")
                    .disabled(!credentials.isComplete || isSigningIn)
                    .accessibilityIdentifier("signin.submit")

                    if isSigningIn {
                        PlusLoadingRow()
                    }
                    Text("Sign-in is not connected to the server yet. Any email and password work.")
                        .font(.secondaryText)
                        .foregroundStyle(Color.ink2)
                }

                DottedRule()

                HStack(spacing: Space.s2) {
                    Text("No account yet?")
                        .font(.bodyText)
                        .foregroundStyle(Color.ink2)
                    Button("Create Account") { isShowingSignUp = true }
                        .buttonStyle(.textLink)
                        .accessibilityIdentifier("signin.createAccount")
                }
            }
            .padding(.horizontal, Space.s6)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .paperBackground()
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
