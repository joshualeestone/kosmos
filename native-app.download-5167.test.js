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
  assert.match(b, /if navigationAction\.shouldPerformDownload, let url = navigationAction\.request\.url,\n\s+isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\) \{\n[\s\S]*?mayDownload\(file: .*?\) \{ decisionHandler\(\$0 \? \.download : \.cancel\) \}\n\s+return\n\s+\}/,
    'a download is saved without the board-page and same-origin checks, or they no longer decide it');
});

test('#5167: the response policy saves only board files from a board page, refuses foreign attachments, and otherwise keeps WebKit\'s default', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.match(b, /func webView\(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,\n\s+decisionHandler: @escaping \(WKNavigationResponsePolicy\) -> Void\)/);
  assert.match(b, /\.trimmingCharacters\(in: \.whitespaces\)\.lowercased\(\) == "attachment" \{\n\s+if isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\) \{\n[\s\S]*?mayDownload\(file: .*?\) \{ decisionHandler\(\$0 \? \.download : \.cancel\) \}\n\s+\} else \{[\s\S]*?tellDownloadFailed\([\s\S]*?decisionHandler\(\.cancel\)\n\s+\}\n\s+return/,
    'an attachment is saved without the exact-token, board-page and same-origin checks, or a refused one loads in the window');
  assert.equal((b.match(/decisionHandler\(/g) || []).length, 6, 'the response policy has a path that never answers, or a new one');
  // With no such method WebKit shows what it can and cancels what it cannot; .allow for everything
  // would fail a provisional load (a "cannot show" error reaching handleNavigationFailure) instead.
  assert.match(b, /decisionHandler\(navigationResponse\.canShowMIMEType \? \.allow : \.cancel\)\n\s+\}$/,
    'the default is no longer WebKit\'s own (show what it can, cancel what it cannot)');
});

test('#5167: the origin a download must share is the COMMITTED page, set on every main-frame commit', () => {
  assert.match(SRC, /\n    fileprivate var committedPageURL: URL\?\n/);
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)'), /committedPageURL = webView\.backForwardList\.currentItem\?\.url/,
    'nothing records the committed page, so every download is refused (or a stale origin is trusted)');
  assert.equal((SRC.match(/(?<!d\.)committedPageURL = (?!nil)/g) || []).length, 1, 'something other than a main-frame commit sets the committed page');
  assert.match(body('private func switchToConnect(home: String)'), /committedPageURL = nil/, 'a computer switched to connect keeps judging downloads against its old board page');
  assert.match(body('func webViewWebContentProcessDidTerminate(_ webView: WKWebView)'), /committedPageURL = nil/, 'a crashed page is still treated as on screen');
});

test('#5167: a download\'s redirect to another origin is refused (pinned selector)', () => {
  const b = body('@objc(download:willPerformHTTPRedirection:newRequest:decisionHandler:)');
  assert.match(b, /if let to = request\.url, isSameOriginDownload\(to, page: download\.originalRequest\?\.url\) \{\n\s+decisionHandler\(\.allow\)\n\s+\} else \{[^}]*decisionHandler\(\.cancel\)/);
});

test('#5167: a saved file is marked as downloaded, so Gatekeeper checks it when opened', () => {
  const b = body('@objc(downloadDidFinish:)');
  assert.match(b, /values\.quarantineProperties = \[kLSQuarantineAgentNameKey as String: "Kosmos",\n\s+kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String\]/);
  assert.match(b, /try marked\.setResourceValues\(values\)/);
});

test('#5167: two downloads of the same name at once never get the same destination', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /let taken = Set\(downloadsInFlight\.values\.map/);
  assert.match(b, /attributesOfItem\(atPath: \$0\.path\)\) != nil \|\| taken\.contains\(/);
});

test('#5167: both ways a navigation becomes a download hand it to this delegate (pinned selectors)', () => {
  for (const sel of ['webView:navigationAction:didBecomeDownload:', 'webView:navigationResponse:didBecomeDownload:']) {
    assert.match(body('@objc(' + sel + ')'), /download\.delegate = self/, sel + ' does not take the download');
  }
});

test('#5167: the destination is Downloads through downloadDestination, never replacing a file', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /FileManager\.default\.urls\(for: \.downloadsDirectory, in: \.userDomainMask\)/);
  assert.equal((b.match(/completionHandler\(/g) || []).length, 7, 'a destination path that never answers WebKit leaves the download hanging');
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
  assert.equal(dl + dest, 29, 'the #5167 rows changed; update the expected count with them');
  assert.match(st, /let expected = 86\b/);
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
  assert.match(hatch, /let expected = 23\n\s+if ran != expected \{/, 'the live selftest no longer counts its rows, so a dropped row still prints all good');
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
  assert.doesNotMatch(fin, /kLSQuarantine(Data|Origin)URLKey/, 'the quarantine mark carries an address, which can carry the board token');
  assert.match(body('private func switchToConnect(home: String)'), /badgeOrigin = nil/, 'a computer switched to connect still treats its old board as one');
  assert.match(BUILD.slice(BUILD.indexOf('--kosmos-app-download-selftest')),
    /\*"rows ran, so this proved nothing"\*\)[\s\S]*?\*"download-check: all good"\*\)[\s\S]*?\*"download-check:"\*\)/,
    'a short run is read as a product verdict');
});

test('#5167 review 6: a board file the window cannot show is saved; an unmarkable one is kept and said', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.match(b, /if !navigationResponse\.canShowMIMEType, let url = navigationResponse\.response\.url,\n\s+isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\) \{\n[\s\S]*?mayDownload\(file: .*?\) \{ decisionHandler\(\$0 \? \.download : \.cancel\) \}/,
    'a board file the window cannot show is cancelled with nothing said');
  assert.match(b, /String\(disposition\[\.\.<\(disposition\.firstIndex\(of: ";"\) \?\? disposition\.endIndex\)\]\)/, 'the attachment token is not read up to the first ;');
  const fin = body('@objc(downloadDidFinish:)');
  assert.doesNotMatch(fin, /removeItem/, 'a finished download is deleted when it cannot be marked');
  assert.match(fin, /could not be marked as downloaded, so macOS will not check it/);
});

test('#5167 review 7: Kosmos+ service sites are not boards; the unmarked-file message has its own title', () => {
  assert.match(body('func isBoardPage(_ page: URL?, board: (host: String, port: Int)?) -> Bool {'),
    /return !kosmosPlusReservedLabels\.contains\(label\)/, 'a Kosmos+ service site can save files');
  const reserved = (SRC.match(/\nlet kosmosPlusReservedLabels: Set<String> = \[([\s\S]*?)\n\]/) || [])[1] || '';
  for (const n of ['login', 'community', 'www', 'coordinator', 'api', 'status', 'docs', 'relay']) {
    assert.ok(reserved.includes('"' + n + '"'), n + ' is missing from the copy of the coordinator\'s RESERVED_NAMES');
  }
  assert.equal((reserved.match(/"[a-z0-9-]+"/g) || []).length, 45, 'the copy of RESERVED_NAMES changed size (this checks the count and eight names, not every name); re-copy it from kosmos-relay coordinator/src/signin.rs and re-diff');
  assert.match(SRC, /private func tellDownloadFailed\(_ detail: String, title: String\? = nil, quiet: Bool = false, always: Bool = false\)/);
  assert.match(body('@objc(downloadDidFinish:)'), /title: "Kosmos saved that file without its download mark"/,
    'a kept file is reported under a title saying it was not saved');
});

test('#5167 review 11: a run where nothing saves is judged, not timed out (the watchdog sits above the worst case, the gate above the watchdog)', () => {
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  const watchdog = Number((hatch.match(/asyncAfter\(deadline: \.now\(\) \+ (\d+)\) \{\n[^\n]*\n\s+print\("download selftest TIMED OUT"\)/) || [])[1]);
  const alarm = Number((BUILD.match(/alarm (\d+); exec @ARGV; exit 127' "\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-download-selftest/) || [])[1]);
  assert.ok(watchdog >= 300, 'the watchdog (' + watchdog + 's) is too close to a nothing-saves run (measured 146s), so a total break can read as a timeout');
  assert.ok(alarm >= watchdog + 20, 'the gate\'s alarm (' + alarm + 's) does not sit above the hatch\'s own watchdog (' + watchdog + 's)');
  assert.match(hatch, /wait\(expect == nil \? 20 : 50\)/);
});

test('#5167 review 12: a foreign file the window cannot show is refused and logged; an early stop is not blamed on a cause', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.match(b, /if !navigationResponse\.canShowMIMEType \{\n[^\n]*\n[^\n]*\n\s+if committedPageURL != nil \{ tellDownloadFailed\(isBoardPage[^\n]*\n[^\n]*not opened or saved\."\n[^\n]*not opened or saved\.", quiet: true\)/,
    'a foreign file the window cannot show is cancelled with nothing said');
  assert.match(body('@objc(download:didFailWithError:resumeData:)'), /tellDownloadFailed\("It stopped before it began\.", quiet: true\)/,
    'an early stop is said with a cause it may not have, or can stack a second sheet');
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.ok(hatch.includes('"A FRAME LOADING AN ATTACHMENT SAVES NOTHING') && hatch.includes('"A FILE FROM ANOTHER ORIGIN THE WINDOW CANNOT SHOW IS NOT SAVED'));
});

test('#5167 review 13: response refusals name their cause', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.equal((b.match(/tellDownloadFailed\(isBoardPage\(committedPageURL, board: badgeOrigin\)\n\s+\? /g) || []).length, 2,
    'a response refusal blames the file when the page is the cause');
});

test('#5167 review 14: the board downloads are saved from is set only where the board is chosen, cleared on connect', () => {
  const sets = SRC.match(/\n[^\n]*\bbadgeOrigin = [^\n]*/g) || [];
  assert.equal(sets.length, 4, 'badgeOrigin (the board downloads are saved from) is now set somewhere else: ' + sets.join(' | '));
  assert.match(SRC, /badgeOrigin = \("127\.0\.0\.1", resolved\.port\)/);
  assert.match(SRC, /d\.badgeOrigin = \("127\.0\.0\.1", Int\(p\)\)/);
  assert.match(SRC, /\/\/\/ #5167: PURE, for --kosmos-app-mode-selftest\. Whether the page on screen is a board[^\n]*\n(\/\/\/[^\n]*\n)*func isBoardPage\(/,
    'isBoardPage lost its doc comment');
});

test('#5167 review 16: every early exit of the live selftest cleans up', () => {
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'),
    SRC.indexOf('// kosmos#1032: the + button opens a file picker'));
  const exits = hatch.split('exit(1)').length - 1;
  const cleaned = (hatch.match(/try\? FileManager\.default\.removeItem\(at: dl\)\n\s+print\([^\n]*\); exit\(1\)/g) || []).length;
  assert.equal(cleaned, 4, 'an early exit of the live selftest leaves its temporary folder behind');
  assert.ok(exits >= 4);
});

test('#5167 review 26: the "already said" record is weak, so a later download at a reused address never inherits it', () => {
  assert.match(SRC, /private let downloadsTold = NSHashTable<WKDownload>\.weakObjects\(\)/);
  assert.doesNotMatch(SRC, /downloadsTold[^\n]*ObjectIdentifier/);
});

test('#5167 review 29: a sign-in page is not saved as the file; a 4xx over Kosmos+ is said by the page, not twice; Reload asks again', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /if response\.mimeType\?\.lowercased\(\) == "text\/html", !wantsPage \{/, 'an expired sign-in\'s page is saved under the file\'s name');
  assert.match(b, /if pageSaysDownloadRefusal\(http\.url \?\? download\.originalRequest\?\.url\) \{\n\s+completionHandler\(nil\)/,
    'a Files-list refusal is said twice (the page says it), or an attachment\'s by nobody');
  assert.match(body('@objc func reloadBoard(_ sender: Any?) {'), /refusedDownloadHosts = \[\]/, 'a mistaken Don\'t Allow can only be undone by quitting');
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.ok(hatch.includes('nor a sign-in page answered for a .pptx'));
});

/* #5167, cut to the core (Baron's review on PR #5263): what the four real defects need, and nothing the loop added on
   top of it. Each test reads the shipped Swift. */
test('#5167 core: a Kosmos+ computer is asked once per run before it saves (round 17), modally, and Return never grants it (round 23)', () => {
  const b = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(b, /isKosmosPlusURL\(page\)/, 'only a Kosmos+ computer is asked; this computer\'s board is not');
  assert.match(b, /allowedDownloadHosts\.contains\(host\)/);
  assert.match(b, /refusedDownloadHosts\.contains\(host\)/);
  assert.match(b, /alert\.runModal\(\)/, 'the question must be modal: a dropped sheet would leave downloads waiting for good');
  assert.doesNotMatch(b, /beginSheetModal/);
  assert.match(b, /allow\.keyEquivalent = ""/, 'Return could answer Allow');
  assert.match(b, /refuse\.keyEquivalent = "\\r"/, 'Return does not answer Don\'t Allow');
  assert.doesNotMatch(SRC, /UserDefaults[^\n]*allowedDownloadHosts/, 'an Allow outlives the run: a later holder of the name would inherit it');
});

test('#5167 core: the board\'s 204/205 refusal is never saved as an empty file (round 31), and says nothing (the page says why)', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  const at = b.indexOf('http.statusCode == 204 || http.statusCode == 205');
  assert.notEqual(at, -1, 'the 204/205 rule is gone');
  const arm = b.slice(at, b.indexOf('return', at));
  assert.match(arm, /completionHandler\(nil\)/);
  assert.doesNotMatch(arm, /tellDownloadFailed/);
});

test('#5167 core: a policy refusal is logged only, a real failure is one modal alert, and the queueing machinery is gone', () => {
  const t = body('private func tellDownloadFailed(_ detail: String, title: String? = nil, quiet: Bool = false, always: Bool = false) {');
  assert.match(t, /if quiet \{ logLine\([^\n]*\); return \}/, 'a policy refusal puts up an alert: a repeating page could pile them up');
  assert.match(t, /alert\.runModal\(\)/);
  assert.doesNotMatch(t, /beginSheetModal/, 'a sheet over a sheet can be dropped (#2807)');
  for (const gone of ['savesByHost', 'downloadQuietSeconds', 'downloadAlertsUp', 'pendingDownloadFailures', 'quietToldThisPage',
    'summaryToldForPage', 'schedulePendingSay', 'frontSince']) {
    assert.doesNotMatch(SRC, new RegExp('\\b' + gone + '\\b'), gone + ' is back: the cut machinery generated findings by construction');
  }
});

test('#5167 core: a page that is not a board cannot save (round 3), and the refusal is logged, not an alert', () => {
  const nav = SRC.slice(SRC.indexOf('if navigationAction.shouldPerformDownload, let url = navigationAction.request.url,'));
  assert.match(nav.slice(0, 400), /isBoardPage\(committedPageURL, board: badgeOrigin\), isSameOriginDownload\(url, page: committedPageURL\)/);
  const refuse = nav.slice(nav.indexOf('if navigationAction.shouldPerformDownload {'), nav.indexOf('decisionHandler(.cancel)'));
  assert.match(refuse, /quiet: true/, 'a not-a-board refusal is an alert again');
});

test('#5167 core: a dangling symlink at the destination is taken, never written through', () => {
  assert.match(body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,'),
    /FileManager\.default\.attributesOfItem\(atPath: \$0\.path\)/);
});

test('#5167 core: an Allow counts only for the page that asked (a commit during the question voids an Allow, never a Don\'t Allow); the question waits a turn', () => {
  const b = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(b, /let commitsBefore = pageCommits\n\s+\/\/ On the next turn/, 'the commit count is not taken when the question is asked');
  assert.match(b, /DispatchQueue\.main\.async \{ \[self\] in/, 'the question runs inside WebKit\'s policy callback');
  assert.match(b, /if asked, committedPageURL\?\.host\?\.lowercased\(\) != host \|\| pageCommits != commitsBefore \{/,
    'a page change voids Don\'t Allow too (a reloading page could ask again and again), or no longer voids an Allow');
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {'), /pageCommits \+= 1/);
});
