import MozolCore
import SwiftUI
import WebKit

/// A page of the MOZOL website in a sheet, for example /signup.
struct WebPageSheet: View {
    let title: LocalizedStringKey
    let url: URL

    @Environment(\.dismiss) private var dismiss
    @State private var state: WebView.LoadState = .loading

    var body: some View {
        NavigationStack {
            ZStack {
                WebView(url: url, state: $state)
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
                    Button("Done") { dismiss() }
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

    func makeCoordinator() -> Coordinator { Coordinator(state: $state) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.navigationDelegate = context.coordinator
        Log.ui.info("web page open path=\(url.path(), privacy: .public)")
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let state: Binding<LoadState>

        init(state: Binding<LoadState>) { self.state = state }

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
