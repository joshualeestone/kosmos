'use strict';

/**
 * #5167: the macOS app saves a download the page asks for. Without this, an `<a download>` click (#4930's
 * attachments, #5165's Files lists over Kosmos+) did nothing in the app's window: WebKit saves nothing
 * without a download delegate.
 *
 * Which downloads are saved, and the file name they get, are pure Swift functions driven by
 * --kosmos-app-mode-selftest at bundle build (its #5167 rows). What no selftest reaches is the WebKit
 * wiring, read here from source: a wrong optional-method signature compiles and is never called, so the
 * selectors are pinned and checked.
 *
 *   node --test native-app.download-5167.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#5167: the instrument is reading the app', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#5167: the app delegate is the download delegate', () => {
  assert.match(SRC, /\nfinal class AppDelegate: NSObject, [^{]*\bWKDownloadDelegate\b[^{]*\{/,
    'AppDelegate does not adopt WKDownloadDelegate, so no download has anywhere to go');
});

test('#5167: a same-origin <a download> becomes a download, BEFORE the connect-only link policy', () => {
  const b = body('@objc(webView:decidePolicyForNavigationAction:decisionHandler:)');
  const dl = b.indexOf('navigationAction.shouldPerformDownload');
  const guardAt = b.indexOf('guard computerMode == .connect');
  assert.notEqual(dl, -1, 'the action policy never looks at shouldPerformDownload');
  assert.notEqual(guardAt, -1, 'the connect policy guard moved; re-read this test');
  assert.ok(dl < guardAt, 'the download check sits after the connect guard, so a computer that runs agents never saves one');
  assert.match(b, /if navigationAction\.shouldPerformDownload, let url = navigationAction\.request\.url,\n\s+isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\) \{\n\s+decisionHandler\(\.download\)\n\s+return\n\s+\}/,
    'a download is saved without the board-page and same-origin checks, or they no longer decide it');
});

test('#5167: only a same-origin attachment response is saved; every other response keeps WebKit\'s default', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.match(b, /func webView\(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,\n\s+decisionHandler: @escaping \(WKNavigationResponsePolicy\) -> Void\)/);
  assert.match(b, /\.trimmingCharacters\(in: \.whitespaces\)\.lowercased\(\) == "attachment" \{\n\s+if isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\) \{\n\s+decisionHandler\(\.download\)\n\s+\} else \{[^}]*tellDownloadFailed\([^}]*decisionHandler\(\.cancel\)\n\s+\}\n\s+return/,
    'an attachment is saved without the exact-token, board-page and same-origin checks, or a refused one loads in the window');
  assert.equal((b.match(/decisionHandler\(/g) || []).length, 5, 'the response policy has a path that never answers, or a new one');
  // With no such method WebKit shows what it can and cancels what it cannot; .allow for everything
  // would fail a provisional load (a "cannot show" error reaching handleNavigationFailure) instead.
  assert.match(b, /decisionHandler\(navigationResponse\.canShowMIMEType \? \.allow : \.cancel\)\n\s+\}$/,
    'the default is no longer WebKit\'s own (show what it can, cancel what it cannot)');
});

test('#5167: the origin a download must share is the COMMITTED page, set on every main-frame commit', () => {
  assert.match(SRC, /\n    private var committedPageURL: URL\?\n/);
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)'), /committedPageURL = webView\.url/,
    'nothing records the committed page, so every download is refused (or a stale origin is trusted)');
  assert.equal((SRC.match(/committedPageURL = (?!nil)/g) || []).length, 1, 'something other than a main-frame commit sets the committed page');
  assert.match(body('private func switchToConnect(home: String)'), /committedPageURL = nil/, 'a computer switched to connect keeps judging downloads against its old board page');
  assert.match(body('func webViewWebContentProcessDidTerminate(_ webView: WKWebView)'), /committedPageURL = nil/, 'a crashed page is still treated as on screen');
});

test('#5167: a download\'s redirect to another origin is refused (pinned selector)', () => {
  const b = body('@objc(download:willPerformHTTPRedirection:newRequest:decisionHandler:)');
  assert.match(b, /if let to = request\.url, isSameOriginDownload\(to, page: download\.originalRequest\?\.url\) \{\n\s+decisionHandler\(\.allow\)\n\s+\} else \{[^}]*decisionHandler\(\.cancel\)/);
});

test('#5167: a saved file is marked as downloaded, so Gatekeeper checks it when opened', () => {
  const b = body('@objc(downloadDidFinish:)');
  assert.match(b, /values\.quarantineProperties = props/);
  assert.match(b, /kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload/);
  assert.match(b, /try marked\.setResourceValues\(values\)/);
});

test('#5167: a download that does not save is said to the person, once', () => {
  const fail = body('@objc(download:didFailWithError:resumeData:)');
  const unsaid = fail.slice(fail.indexOf('if downloadsTold.remove(ObjectIdentifier(download)) == nil {'));
  assert.ok(unsaid.length < fail.length, 'a failed download is said whether or not it was already said');
  assert.equal((unsaid.match(/tellDownloadFailed\(/g) || []).length, 2, 'a branch of an unsaid failure is only logged');
  assert.equal((fail.match(/tellDownloadFailed\(/g) || []).length, 2, 'a failure already said is said again');
  assert.match(body('@objc(download:willPerformHTTPRedirection:newRequest:decisionHandler:)'),
    /downloadsTold\.insert\(ObjectIdentifier\(download\)\)\n\s+tellDownloadFailed\(/);
  assert.match(body('private func tellDownloadFailed(_ detail: String, title: String'), /if let present = AppDelegate\.downloadAlertPresenter \{ present\(detail\); return \}/);
});

test('#5167: an error page is not saved as the file, and every refusal before a destination is said once', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /!\(200\.\.<300\)\.contains\(http\.statusCode\)/, 'a 404 or 500 is saved under the file\'s name');
  assert.equal((b.match(/downloadsTold\.insert\(ObjectIdentifier\(download\)\)/g) || []).length, 2,
    'a refusal before a destination is not marked as said, so its cancel says it a second time');
});

test('#5167: two downloads of the same name at once never get the same destination', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /let taken = Set\(downloadsInFlight\.values\.map/);
  assert.match(b, /FileManager\.default\.fileExists\(atPath: \$0\.path\) \|\| taken\.contains\(/);
});

test('#5167: both ways a navigation becomes a download hand it to this delegate (pinned selectors)', () => {
  for (const sel of ['webView:navigationAction:didBecomeDownload:', 'webView:navigationResponse:didBecomeDownload:']) {
    assert.match(body('@objc(' + sel + ')'), /download\.delegate = self/, sel + ' does not take the download');
  }
});

test('#5167: the destination is Downloads through downloadDestination, never replacing a file', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /FileManager\.default\.urls\(for: \.downloadsDirectory, in: \.userDomainMask\)/);
  assert.equal((b.match(/completionHandler\(/g) || []).length, 3, 'a destination path that never answers WebKit leaves the download hanging');
  assert.doesNotMatch(b, /logLine\([^\n]*dest\.path/, 'the log line carries the full path, home folder and user name included');
});

test('#5167: the end of a download is pinned and told to the Dock', () => {
  assert.match(body('@objc(downloadDidFinish:)'), /com\.apple\.DownloadFileFinished/);
  assert.match(SRC, /@objc\(download:didFailWithError:resumeData:\)\n\s+func download\(_ download: WKDownload, didFailWithError error: Error, resumeData: Data\?\)/);
});

test('#5167: the selftest runs the download rows and counts them', () => {
  const st = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'));
  assert.match(st, /isSameOriginDownload\(/, 'the mode selftest no longer drives isSameOriginDownload');
  assert.match(st, /downloadDestination\(dir: dir, suggested: suggested\)/, 'the mode selftest no longer drives downloadDestination');
  const dl = (st.slice(0, st.indexOf('let expected')).match(/\n    dl\(/g) || []).length;
  const dest = (st.slice(0, st.indexOf('let expected')).match(/\n    dest\(/g) || []).length;
  assert.equal(dl + dest, 26, 'the #5167 rows changed; update the expected count with them');
  assert.match(st, /let expected = 77\b/);
});

const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');

test('#5167: the live download selftest exists, measures the dangerous answers, and the bundle build runs it', () => {
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'),
    SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-filepanel-selftest")'));
  assert.ok(hatch.length > 1000, 'the --kosmos-app-download-selftest hatch is gone');
  assert.match(hatch, /AppDelegate\.downloadsDirOverride = dl/, 'the selftest would write into the real Downloads');
  assert.match(hatch, /d\.webView = web/, 'the hatch does not wire webView as the app does; a provisional failure would crash it');
  for (const row of ['A REDIRECT TO ANOTHER ORIGIN SAVES NOTHING', 'a download link to another origin saves nothing',
    'AN ATTACHMENT FROM ANOTHER ORIGIN SAVES NOTHING', 'a saved file carries THIS APP', 'a same-origin <a download> is saved']) {
    assert.ok(hatch.includes('"' + row), 'the selftest no longer checks: ' + row);
  }
  assert.match(hatch, /let expected = 15\n\s+if ran != expected \{/, 'the live selftest no longer counts its rows, so a dropped row still prints all good');
  assert.match(hatch, /d\.badgeOrigin = \("127\.0\.0\.1", Int\(p\)\)/, 'the selftest page is not the board, so every download would be refused');
  assert.match(hatch, /AppDelegate\.downloadAlertPresenter = \{ told\.append\(\$0\) \}/, 'the selftest would put up a real alert nobody can press');
  assert.match(SRC, /static var downloadsDirOverride: URL\?/);
  assert.equal((SRC.match(/downloadsDirOverride = /g) || []).length, 1, 'something outside the selftest redirects downloads');
  assert.match(BUILD, /"\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-download-selftest/, 'the bundle build does not run the download selftest');
  const gate = BUILD.slice(BUILD.indexOf('--kosmos-app-download-selftest'));
  assert.ok(gate.indexOf('*"download selftest TIMED OUT"*') < gate.indexOf('*"download-check: all good"*'),
    'a timeout must be read before any verdict, or a hang is judged on partial output');
});

test('#5167 review 5: refused downloads stay out of the window, quarantine records hold no token, connect forgets the board', () => {
  const act = body('@objc(webView:decidePolicyForNavigationAction:decisionHandler:)');
  assert.match(act, /if navigationAction\.shouldPerformDownload \{\n[\s\S]*?tellDownloadFailed\([\s\S]*?\n\s+\}\n\s+decisionHandler\(\.cancel\)\n\s+return\n\s+\}/,
    'a download this app will not save falls through to .allow and loads in the window');
  const fin = body('@objc(downloadDidFinish:)');
  assert.match(fin, /c\.query = nil; c\.fragment = nil/, 'the quarantine record keeps the page\'s query or fragment, which carry the board token');
  assert.match(fin, /if let page = originOnly\(committedPageURL\)/);
  assert.match(fin, /if let from = originOnly\(download\.originalRequest\?\.url\)/);
  assert.match(body('private func switchToConnect(home: String)'), /badgeOrigin = nil/, 'a computer switched to connect still treats its old board as one');
  assert.match(BUILD.slice(BUILD.indexOf('--kosmos-app-download-selftest')),
    /\*"rows ran, so this proved nothing"\*\)[\s\S]*?\*"download-check: all good"\*\)[\s\S]*?\*"download-check:"\*\)/,
    'a short run is read as a product verdict');
});

test('#5167 review 6: a board file the window cannot show is saved; an unmarkable one is kept and said', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.match(b, /if !navigationResponse\.canShowMIMEType, let url = navigationResponse\.response\.url,\n\s+isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\) \{\n\s+decisionHandler\(\.download\)/,
    'a board file the window cannot show is cancelled with nothing said');
  assert.match(b, /String\(disposition\[\.\.<\(disposition\.firstIndex\(of: ";"\) \?\? disposition\.endIndex\)\]\)/, 'the attachment token is not read up to the first ;');
  const fin = body('@objc(downloadDidFinish:)');
  assert.doesNotMatch(fin, /removeItem/, 'a finished download is deleted when it cannot be marked');
  assert.match(fin, /could not be marked as downloaded, so macOS will not check it/);
});

test('#5167 review 7: Kosmos+ service sites are not boards; the unmarked-file message has its own title', () => {
  assert.match(body('func isBoardPage(_ page: URL?, board: (host: String, port: Int)?) -> Bool {'),
    /return !\["login", "community", "www"\]\.contains\(label\)/, 'Kosmos+ sign-in or the public feed can save files');
  assert.match(SRC, /private func tellDownloadFailed\(_ detail: String, title: String = "Kosmos could not save that file", quiet: Bool = false\)/);
  assert.match(body('@objc(downloadDidFinish:)'), /title: "Kosmos saved that file without its download mark"/,
    'a kept file is reported under a title saying it was not saved');
});

test('#5167 review 9: a frame cannot save by loading; refusals are said at most once in a quiet window; the unmarked alert needs no mark at all', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  const guardAt = b.indexOf('guard navigationResponse.isForMainFrame else {');
  assert.ok(guardAt !== -1 && guardAt < b.indexOf('"attachment"'), 'a subframe response can be saved, or refused with an alert, just by loading');
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String');
  assert.match(tell, /if let last = lastDownloadTold, Date\(\)\.timeIntervalSince\(last\) < AppDelegate\.downloadQuietSeconds \{/, 'a page clicking in a loop can stack sheets');
  assert.ok(tell.indexOf('lastDownloadTold = Date()') < tell.indexOf('downloadAlertPresenter'), 'the quiet window does not cover the selftest\'s presenter, so the burst row proves nothing');
  assert.match(SRC, /static var downloadQuietSeconds: TimeInterval = 5\n/);
  assert.match(body('@objc(downloadDidFinish:)'), /if getxattr\(dest\.path, "com\.apple\.quarantine", nil, 0, 0, 0\) <= 0 \{\n\s+tellDownloadFailed\(/,
    'the person is told a file is unmarked when WebKit\'s own mark is on it');
});

test('#5167 review 10: only policy refusals are quieted; a frame cannot put up a sheet; the refusal names its cause', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String');
  assert.match(tell, /quiet: Bool = false\) \{\n\s+if quiet \{/, 'a real save failure can be swallowed by the quiet window');
  assert.equal((SRC.match(/, quiet: true\)/g) || []).length, 2, 'the quiet window covers something other than the two policy refusals');
  const act = body('@objc(webView:decidePolicyForNavigationAction:decisionHandler:)');
  assert.match(act, /if navigationAction\.targetFrame\?\.isMainFrame == true \{\n\s+tellDownloadFailed\(isBoardPage\(committedPageURL, board: badgeOrigin\)\n\s+\? "That file is not from this board/,
    'a frame inside the page can put up the app\'s sheet, or the refusal blames the page when the file is the cause');
});

test('#5167 review 11: a run where nothing saves is judged, not timed out (the watchdog sits above the worst case, the gate above the watchdog)', () => {
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  const watchdog = Number((hatch.match(/asyncAfter\(deadline: \.now\(\) \+ (\d+)\) \{ print\("download selftest TIMED OUT"\)/) || [])[1]);
  const alarm = Number((BUILD.match(/alarm (\d+); exec @ARGV; exit 127' "\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-download-selftest/) || [])[1]);
  assert.ok(watchdog >= 150, 'the watchdog (' + watchdog + 's) is under a nothing-saves run (measured 81s), so a total break reads as a timeout');
  assert.ok(alarm >= watchdog + 20, 'the gate\'s alarm (' + alarm + 's) does not sit above the hatch\'s own watchdog (' + watchdog + 's)');
  assert.match(hatch, /wait\(expect == nil \? 20 : 50\)/);
});
