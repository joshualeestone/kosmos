import SwiftUI
import QuickLook
import WebKit

// kosmos#8953: a web page or markup file an agent or a room made, opened on the phone instead of on the computer's board.
// Quick Look is not used for these (#7016 review 2): it draws them as web pages that can load from elsewhere. Here the
// file's own bytes are drawn by a web view that loads nothing (LockedWebView), XML is shown as text, and a kind the phone
// cannot read is offered to Share. Share and Done are on every one, as Quick Look gives other files.
struct WebFileView: View {
    let file: URL
    let close: () -> Void

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(file.lastPathComponent)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done", action: close) }
                    ToolbarItem(placement: .primaryAction) { ShareLink(item: file) }
                }
        }
    }

    @ViewBuilder private var content: some View {
        let kind = Board.webFileKind(name: file.lastPathComponent)
        switch kind {
        case .page, .svg, .archive:
            VStack(spacing: 0) {
                LockedWebView(file: file, kind: kind)
                Text("Pictures and styles this page loads from elsewhere are not shown.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(10)
            }
        case .text:
            ScrollView {
                Text(Self.text(of: file))
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
        case .unreadable:
            VStack(spacing: 12) {
                Image(systemName: "doc.richtext").font(.largeTitle).foregroundStyle(.secondary)
                Text("This kind of page can't be shown on iPhone").font(.headline).multilineTextAlignment(.center)
                Text("Share it, or save it to Files, to open it on another device.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // The first megabyte, read as UTF-8 (a stray byte is drawn as a replacement character, never a failure).
    private static func text(of file: URL) -> String {
        guard let h = try? FileHandle(forReadingFrom: file) else { return "" }
        defer { try? h.close() }
        let data = (try? h.read(upToCount: 1 << 20)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

// A web view that draws one file's bytes and loads nothing else: no JavaScript, a data store that is not kept, a content
// rule that blocks every load, and every navigation after the first cancelled (a link, a refresh, a frame). If the rule
// cannot be compiled the page is not drawn at all.
struct LockedWebView: UIViewRepresentable {
    let file: URL
    let kind: Board.WebFileKind

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.accessibilityIdentifier = "webfile.page"
        Coordinator.untappable(view)
        context.coordinator.load(into: view, file: file, kind: kind)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var started = false
        static let blockAll = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}}]"#

        func load(into view: WKWebView, file: URL, kind: Board.WebFileKind) {
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "kosmos-webfile-block-all",
                                                                     encodedContentRuleList: Self.blockAll) { [weak view] list, _ in
                guard let view, let list, let data = try? Data(contentsOf: file),
                      let page = Board.inertPage(data, kind: kind) else { return }
                view.configuration.userContentController.add(list)
                view.load(page, mimeType: "text/html", characterEncodingName: "utf-8", baseURL: URL(string: "about:blank")!)
            }
        }

        // Tapping a link had WebKit open a connection to its host before the navigation could be refused (WebFileUITests
        // measured one connection with no request), and a page can undo any style that makes its links inert. So no touch
        // reaches the page: everything inside the scroll view takes no touches, and the scroll view itself still scrolls
        // and zooms. Done again when the page has drawn, in case WebKit put new views there.
        static func untappable(_ view: WKWebView) {
            for v in view.scrollView.subviews { v.isUserInteractionEnabled = false }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { Self.untappable(webView) }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            if !started, action.targetFrame?.isMainFrame == true {
                started = true
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
        }
    }
}

// The file a screen fetched, shown by Quick Look or, for a web page or markup file, by WebFileView (kosmos#8953). Takes the
// place of .quickLookPreview on every screen that opens files, with the same binding: nil when nothing is shown, and set
// back to nil when the person closes it.
private struct WebFileSheetItem: Identifiable { let url: URL; var id: URL { url } }

extension View {
    func filePreview(_ url: Binding<URL?>) -> some View {
        let web = { (u: URL?) in u.map { Board.isWebDocument(name: $0.lastPathComponent, type: "") } ?? false }
        return self
            .quickLookPreview(Binding(get: { web(url.wrappedValue) ? nil : url.wrappedValue }, set: { url.wrappedValue = $0 }))
            .sheet(item: Binding(get: { web(url.wrappedValue) ? url.wrappedValue.map(WebFileSheetItem.init) : nil },
                                 set: { if $0 == nil { url.wrappedValue = nil } })) { item in
                WebFileView(file: item.url, close: { url.wrappedValue = nil })
            }
    }
}
