import MozolCore
import SwiftUI
import WebKit

/// A page of the MOZOL website in a sheet, for example /app/signin.
struct WebPageSheet: View {
    let title: LocalizedStringKey
    let url: URL
    var closeTitle: LocalizedStringKey = "Done"
    var onAppURL: ((URL) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var state: WebView.LoadState = .loading

    var body: some View {
        NavigationStack {
            ZStack {
                WebView(url: url, state: $state, onAppURL: onAppURL)
                    .opacity(state == .failed ? 0 : 1)
                    .accessibilityHidden(state == .failed)
                switch state {
                case .loading:
                    PlusLoadingRow()
                case .failed:
                    VStack(alignment: .leading, spacing: Space.s2) {
                        Text("Couldn't open the page")
                            .font(.sans(18, weight: .bold, relativeTo: .title3))
                            .foregroundStyle(Color.ink)
                        Text("Check your connection and try again.")
                            .font(.bodyText)
                            .foregroundStyle(Color.ink2)
                    }
                    .padding(Space.s4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                case .loaded:
                    EmptyView()
                }
            }
            .paperBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(closeTitle) { dismiss() }
                        .accessibilityIdentifier("webPage.close")
                        .tint(Color.ink)
                }
            }
        }
    }
}

struct WebView: UIViewRepresentable {
    enum LoadState { case loading, loaded, failed }

    let url: URL
    @Binding var state: LoadState
    /// Receives a navigation to a mozol:// address; the web view cancels it. Such a view keeps no cookies.
    var onAppURL: ((URL) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(state: $state, onAppURL: onAppURL) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        if onAppURL != nil { configuration.websiteDataStore = .nonPersistent() }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        Log.ui.info("web page open path=\(url.path(), privacy: .public)")
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let state: Binding<LoadState>
        private let onAppURL: ((URL) -> Void)?

        init(state: Binding<LoadState>, onAppURL: ((URL) -> Void)?) {
            self.state = state
            self.onAppURL = onAppURL
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url, url.scheme == "mozol" else { return .allow }
            Log.ui.info("web page handed over host=\(url.host() ?? "", privacy: .public)")
            onAppURL?(url)
            return .cancel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            state.wrappedValue = .loaded
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
            if let http = navigationResponse.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                Log.ui.error("web page status=\(http.statusCode)")
                state.wrappedValue = .failed
                return .cancel
            }
            return .allow
        }

        private func fail(_ error: Error) {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
            if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }
            Log.ui.error("web page failed domain=\(nsError.domain, privacy: .public) code=\(nsError.code)")
            state.wrappedValue = .failed
        }
    }
}
