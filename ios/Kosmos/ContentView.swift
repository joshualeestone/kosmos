import SwiftUI
import WebKit

// The board, rendered full-screen in a WKWebView.
struct ContentView: View {
    var body: some View {
        WebView(url: KosmosConfig.boardURL)
            .ignoresSafeArea()
    }
}

enum KosmosConfig {
    // The single fixed front-door origin the store app targets. This is the
    // blocking dependency #2854: a TWA and an iOS shell both need ONE fixed public
    // origin that routes to the user's own Mac, because the relay hands each user a
    // per-user hostname. It is a PLACEHOLDER until that origin is decided; this is
    // the one place to repoint, mirroring the Android skeleton's strings.xml. The
    // build does not depend on the URL resolving.
    static let boardURL = URL(string: "https://app.kosmos.io/")!
}

// A minimal WKWebView wrapper. The native surface that earns App Store approval
// (native navigation, APNs, biometric unlock) is later work; this shell just loads
// the board.
struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
