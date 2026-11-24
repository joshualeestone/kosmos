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
    // What the sheet shows, made once when it opens (.task), never while drawing.
    private enum Shown { case reading, page(Data, Board.WebFileKind), text(String, cut: Bool), unreadable, tooLarge }
    @State private var shown = Shown.reading

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(file.lastPathComponent)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done", action: close) }
                    // A fixed preview, so the share sheet never draws the page itself as its thumbnail.
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: file, preview: SharePreview(file.lastPathComponent, image: Image(systemName: "doc.richtext")))
                    }
                }
        }
        .task(id: file) { shown = await Self.read(file) }
    }

    @ViewBuilder private var content: some View {
        switch shown {
        case .reading:
            SweepDots(size: 16, scales: false, framesPerSecond: 15, stillWhenReduced: true)   // kosmos#8058: the simple dots, as a file card waits
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .page(let data, let kind):
            VStack(spacing: 0) {
                LockedWebView(page: data, failed: { shown = .unreadable })
                Text(kind == .svg ? "Pictures this drawing loads from elsewhere are not shown."
                                  : "Pictures and styles this page loads from elsewhere are not shown, and its links do not open.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(10)
            }
        case .text(let text, let cut):
            ScrollView {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                if cut {
                    Text("Only the beginning is shown. Share it to see all of it.")
                        .font(.footnote).foregroundStyle(.secondary).padding([.horizontal, .bottom])
                }
            }
        case .unreadable:
            notShown("This file can't be shown on iPhone")
        case .tooLarge:
            notShown("This file is too large to show on iPhone")
        }
    }

    private func notShown(_ title: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.richtext").font(.largeTitle).foregroundStyle(.secondary)
            Text(title).font(.headline).multilineTextAlignment(.center)
            Text("Share it, or save it to Files, to open it on another device.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // Read off the main thread. Text is the first 256 KB (one Text that size still lays out quickly); a page that cannot
    // be made inert (a damaged web archive) is unreadable.
    private static func read(_ file: URL) async -> Shown {
        await Task.detached(priority: .userInitiated) { () -> Shown in
            let kind = Board.webFileKind(name: file.lastPathComponent)
            switch kind {
            case .unreadable: return .unreadable
            case .text:
                guard let h = try? FileHandle(forReadingFrom: file) else { return .unreadable }
                defer { try? h.close() }
                let shown = 256 * 1024
                let data = (try? h.read(upToCount: shown + 1)) ?? Data()
                guard let text = Board.shownText(data, limit: shown) else { return .unreadable }
                return .text(text.text, cut: text.cut)
            case .page, .svg, .archive:
                // The size first, so a file over the cap is never read into memory.
                let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? Int.max
                guard size <= Board.webFileMaxBytes else { return .tooLarge }
                guard let data = try? Data(contentsOf: file), let page = Board.inertPage(data, kind: kind) else { return .unreadable }
                return .page(page, kind)
            }
        }.value
    }
}

// A web view that draws a page's bytes (Board.inertPage) and loads nothing else: no JavaScript, a data store that is not
// kept, a content rule that blocks every load, and every navigation after the first cancelled (a refresh, a frame). If the
// rule cannot be compiled the page is not drawn, and `failed` says so.
struct LockedWebView: UIViewRepresentable {
    let page: Data
    let failed: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsLinkPreview = false
        view.navigationDelegate = context.coordinator
        view.accessibilityIdentifier = "webfile.page"
        Coordinator.untappable(view)
        context.coordinator.load(into: view, page: page, failed: failed)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var started = false
        private var failed: () -> Void = {}
        static let blockAll = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}}]"#
        static let ruleID = "kosmos-webfile-block-all"

        func load(into view: WKWebView, page: Data, failed: @escaping () -> Void) {
            self.failed = failed
            // Compiled on every open, never looked up: a kept rule from an older blockAll would outlive a change to it.
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: Self.ruleID,
                                                                     encodedContentRuleList: Self.blockAll) { [weak view] list, _ in
                guard let view else { return }
                guard let list else { failed(); return }
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

        // kosmos#8966: the page itself failing to draw shows the can't-show card, not a blank page. A navigation this
        // delegate cancelled also ends here (NSURLErrorCancelled, or WebKit's 102 "frame load interrupted"), and is not one.
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failIfReal(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failIfReal(error) }
        private func failIfReal(_ error: Error) {
            let e = error as NSError
            if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
            failed()
        }

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
        // By the saved name alone: that is what Quick Look picks its viewer by (fetchFile saves through Board.fileName).
        let web = { (u: URL?) in u.map { Board.isWebDocument(name: $0.lastPathComponent, type: "") } ?? false }
        return self
            .quickLookPreview(Binding(get: { web(url.wrappedValue) ? nil : url.wrappedValue }, set: { url.wrappedValue = $0 }))
            .sheet(item: Binding(get: { web(url.wrappedValue) ? url.wrappedValue.map(WebFileSheetItem.init) : nil },
                                 set: { if $0 == nil { url.wrappedValue = nil } })) { item in
                WebFileView(file: item.url, close: { url.wrappedValue = nil })
            }
    }
}
