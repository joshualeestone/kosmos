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

test('#5167: a download that does not save is said to the person, once', () => {
  const fail = body('@objc(download:didFailWithError:resumeData:)');
  const unsaid = fail.slice(fail.indexOf('if !alreadySaid {'));
  assert.ok(unsaid.length < fail.length, 'a failed download is said whether or not it was already said');
  assert.equal((unsaid.match(/tellDownloadFailed\(/g) || []).length, 2, 'a branch of an unsaid failure is only logged');
  assert.equal((fail.match(/tellDownloadFailed\(/g) || []).length, 2, 'a failure already said is said again');
  assert.match(body('@objc(download:willPerformHTTPRedirection:newRequest:decisionHandler:)'),
    /downloadsTold\.add\(download\)\n\s+tellDownloadFailed\(/);
  assert.match(body('private func tellDownloadFailed(_ detail: String, title: String? = nil'), /if let present = AppDelegate\.downloadAlertPresenter \{[\s\S]*?\n\s+present\(title \+ ": " \+ detail\)\n\s+return\n\s+\}/);
});

test('#5167: an error page is not saved as the file, and every refusal before a destination is said once', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /!\(200\.\.<300\)\.contains\(http\.statusCode\)/, 'a 404 or 500 is saved under the file\'s name');
  assert.equal((b.match(/downloadsTold\.add\(download\)/g) || []).length, 5,
    'a refusal before a destination is not marked as said, so its cancel says it a second time');
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
  assert.equal((b.match(/completionHandler\(/g) || []).length, 8, 'a destination path that never answers WebKit leaves the download hanging');
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
  assert.match(hatch, /let expected = 24\n\s+if ran != expected \{/, 'the live selftest no longer counts its rows, so a dropped row still prints all good');
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
  assert.match(SRC, /private func tellDownloadFailed\(_ detail: String, title: String\? = nil, quiet: Bool = false\)/);
  assert.match(body('@objc(downloadDidFinish:)'), /title: "Kosmos saved that file without its download mark"/,
    'a kept file is reported under a title saying it was not saved');
});

test('#5167 review 9: a frame cannot save by loading; refusals are said at most once in a quiet window; the unmarked alert needs no mark at all', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  const guardAt = b.indexOf('guard navigationResponse.isForMainFrame else {');
  assert.ok(guardAt !== -1 && guardAt < b.indexOf('"attachment"'), 'a subframe response can be saved, or refused with an alert, just by loading');
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.match(tell, /if sheetUp \|\| \(lastDownloadTold\.map \{ Date\(\)\.timeIntervalSince\(\$0\) < AppDelegate\.downloadQuietSeconds \} \?\? false\) \{/, 'a page clicking in a loop can stack sheets');
  assert.match(tell, /if let present = AppDelegate\.downloadAlertPresenter \{[^\n]*\n\s+lastDownloadTold = Date\(\)/, 'the quiet window does not cover the selftest\'s presenter, so the burst row proves nothing');
  assert.match(tell, /self\.downloadAlertsUp -= 1\n\s+self\.lastDownloadTold = Date\(\)/, 'the quiet window starts when the sheet appears, so a quick dismiss leaves the next click silent');
  assert.match(SRC, /static var downloadQuietSeconds: TimeInterval = 5\n/);
  assert.match(body('@objc(downloadDidFinish:)'), /if getxattr\(dest\.path, "com\.apple\.quarantine", nil, 0, 0, 0\) <= 0 \{\n\s+tellDownloadFailed\(/,
    'the person is told a file is unmarked when WebKit\'s own mark is on it');
});

test('#5167 review 10: only policy refusals are quieted; a frame cannot put up a sheet; the refusal names its cause', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.match(tell, /quiet: Bool = false\) \{\n[\s\S]*?\n\s+if quiet \{\n\s+let sheetUp/, 'a real save failure can be swallowed by the quiet window');
  assert.equal((SRC.match(/, quiet: true\)/g) || []).length, 7, 'the quiet window covers something other than the seven refusals (not-the-board or foreign download, foreign attachment, foreign file the window cannot show, a download WebKit stopped, a computer already refused, the page changed during the question, the per-page cap)');
  const act = body('@objc(webView:decidePolicyForNavigationAction:decisionHandler:)');
  assert.match(act, /if navigationAction\.targetFrame\?\.isMainFrame != false \{\n\s+tellDownloadFailed\(boardPage\n\s+\? "That file is not from this board/,
    'a frame inside the page can put up the app\'s sheet, or the refusal blames the page when the file is the cause');
});

test('#5167 review 11: a run where nothing saves is judged, not timed out (the watchdog sits above the worst case, the gate above the watchdog)', () => {
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  const watchdog = Number((hatch.match(/asyncAfter\(deadline: \.now\(\) \+ (\d+)\) \{\n[^\n]*\n\s+print\("download selftest TIMED OUT"\)/) || [])[1]);
  const alarm = Number((BUILD.match(/alarm (\d+); exec @ARGV; exit 127' "\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-download-selftest/) || [])[1]);
  assert.ok(watchdog >= 300, 'the watchdog (' + watchdog + 's) is too close to a nothing-saves run (measured 146s), so a total break can read as a timeout');
  assert.ok(alarm >= watchdog + 20, 'the gate\'s alarm (' + alarm + 's) does not sit above the hatch\'s own watchdog (' + watchdog + 's)');
  assert.match(hatch, /wait\(expect == nil \? 20 : 50\)/);
});

test('#5167 review 12: a foreign file the window cannot show is said; an early stop is not blamed on a cause', () => {
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

test('#5167 review 17: a Kosmos+ computer is asked about before it can save (its holder runs its tunnel); no file is blamed before a page exists', () => {
  assert.equal((SRC.match(/mayDownload\(file: .*?\) \{ decisionHandler\(\$0 \? \.download : \.cancel\) \}/g) || []).length, 3,
    'a place that saves a download does not ask first');
  assert.equal((SRC.match(/decisionHandler\(\.download\)/g) || []).length, 0, 'a download is saved without going through mayDownload');
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /guard let page = committedPageURL, let host = page\.host\?\.lowercased\(\),\n\s+isKosmosPlusURL\(page\) \|\| host == AppDelegate\.askAboutHostForSelftest\n\s+else \{ then\(true\); return \}/);
  assert.doesNotMatch(may, /UserDefaults|downloadDefaults/, 'an Allow is kept past this run, so a later holder of the same name inherits it');
  assert.match(may, /if yes \{ self\.allowedDownloadHosts\.insert\(host\) \} else \{ self\.refusedDownloadHosts\.insert\(host\) \}/);
  assert.match(may, /if refusedDownloadHosts\.contains\(host\) \{/, 'a refused computer can ask again and again');
  assert.match(may, /let allow = alert\.addButton\(withTitle: "Allow"\)\n\s+let refuse = alert\.addButton\(withTitle: "Don't Allow"\)/);
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.match(hatch, /"THROUGH A REAL CLICK: a computer that must be asked saves nothing on Don't Allow, and saves on Allow/,
    'the question is only driven directly, so a policy path that skips it still passes');
  const hatchAt = SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")');
  const seamSets = [...SRC.matchAll(/askAboutHostForSelftest = /g)].map((m) => m.index);
  assert.equal(seamSets.length, 4);
  assert.ok(seamSets.every((i) => i > hatchAt), 'something outside the selftest sets the ask-about seam');
  assert.match(body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)'), /if committedPageURL != nil \{ tellDownloadFailed\(/,
    'a start-up load the window cannot show is reported as a refused file');
});

test('#5167 review 19: a computer already refused is said (quietly), refusals carry a refusal title, a dangling symlink is taken', () => {
  assert.match(body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {'),
    /if refusedDownloadHosts\.contains\(host\) \{\n[^\n]*\n\s+tellDownloadFailed\("Downloads from \\\(host\) were not allowed\. Reload the page \(View > Reload\) to be asked again\.", quiet: true\)/,
    'after Don\'t Allow, every later click on that computer does nothing at all');
  assert.match(body('private func tellDownloadFailed(_ detail: String, title: String? = nil, quiet: Bool = false) {'),
    /let title = title \?\? \(quiet \? "Kosmos did not save that file" : "Kosmos could not save that file"\)/);
  assert.match(body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,'),
    /\(try\? FileManager\.default\.attributesOfItem\(atPath: \$0\.path\)\) != nil \|\| taken\.contains/,
    'a dangling symlink in Downloads reads as free');
});

test('#5167 review 20: a 204 or 205 says nothing; an alert on screen holds back the quiet ones', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.ok(b.indexOf('http.statusCode == 204 || http.statusCode == 205') !== -1
    && b.indexOf('http.statusCode == 204 || http.statusCode == 205') < b.indexOf('if !navigationResponse.canShowMIMEType'),
    'a 204 is reported as a file the window cannot show');
  assert.match(body('private func tellDownloadFailed(_ detail: String, title: String? = nil'),
    /let sheetUp = downloadAlertsUp > 0/,
    'an alert opened inside another\'s modal loop clears the mark while the outer one is still up');
});

test('#5167 review 21: the per-computer question is modal (a dropped sheet would leave downloads waiting for good); every download sheet holds back the quiet ones', () => {
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /let asked = alert\.runModal\(\) == \.alertFirstButtonReturn/);
  assert.doesNotMatch(may, /beginSheetModal/, 'the question is a sheet, whose completion may never come');
  assert.match(body('private func tellDownloadFailed(_ detail: String, title: String? = nil'), /downloadAlertsUp \+= 1   \/\/ any download alert/,
    'only quiet sheets hold back the quiet ones, so two can stack');
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.ok(b.indexOf('http.statusCode == 204') < b.indexOf('"attachment"'), 'a 204 sent as an attachment is saved as an empty file');
});

test('#5167 review 22: every download alert is modal (a sheet over a sheet can be dropped, #2807)', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.doesNotMatch(tell, /beginSheetModal/, 'a download failure is a sheet, which another sheet can drop');
  assert.match(tell, /DispatchQueue\.main\.async \{\n\s+alert\.runModal\(\)\n\s+dismissed\(\)\n\s+\}/, 'the alert is shown before the caller answers WebKit, holding its decision under a modal');
});

test('#5167 review 23: Return never grants downloads; the question holds back quiet alerts; the committed page moves only at a commit', () => {
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /allow\.keyEquivalent = ""\n\s+refuse\.keyEquivalent = "\\r"/, 'Return (a keypress meant for the composer) answers Allow');
  assert.match(may, /downloadAlertsUp \+= 1[^\n]*\n[^\n]*\n\s+let asked = alert\.runModal\(\) == \.alertFirstButtonReturn\n\s+wake\.invalidate\(\)\n\s+downloadAlertsUp -= 1/,
    'a quiet refusal can open over the question');
  assert.match(body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,'), /\.path\.lowercased\(\)/,
    'Report.pdf and report.pdf at once collide on a case-insensitive Downloads');
});

test('#5167 review 25: Allow cannot be clicked in the first second (the page times the question)', () => {
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /if alert\.window\.isKeyWindow \{[\s\S]*?allow\.isEnabled = Date\(\)\.timeIntervalSince\(since\) >= 1\n\s+\} else \{\n\s+frontSince = nil\n\s+allow\.isEnabled = false/,
    'a timed click lands on Allow the moment the question appears');
  assert.match(may, /wake\.invalidate\(\)/);
});

test('#5167 review 26: the "already said" record is weak, so a later download at a reused address never inherits it', () => {
  assert.match(SRC, /private let downloadsTold = NSHashTable<WKDownload>\.weakObjects\(\)/);
  assert.doesNotMatch(SRC, /downloadsTold[^\n]*ObjectIdentifier/);
});

test('#5167 review 27: failures during an alert are counted and said together later, never stacked; the answer is only for the page that asked', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.match(tell, /if !quiet && \(downloadAlertsUp > 0 \|\| soSoon\) \{\n[\s\S]*?pendingDownloadFailures \+= 1\n[\s\S]*?\n\s+return\n\s+\}/,
    'a failure that arrives while an alert is up opens another, so a looping page can stack them');
  assert.match(tell, /schedulePendingSay\(\)/,
    'counted failures are never said, or are said the instant the alert closes');
  assert.match(body('private func sayPendingDownloadFailures() {'), /guard pendingDownloadFailures > 0, downloadAlertsUp == 0 else \{ return \}/);
  assert.match(body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {'),
    /guard committedPageURL\?\.host\?\.lowercased\(\) == host else \{\n[^\n]*\n[^\n]*\n\s+for waiting in downloadAsks\.removeValue\(forKey: host\) \?\? \[\] \{ waiting\(false\) \}\n\s+return\n\s+\}\n\s+answer\(asked\)/, 'an answer outlives a switch to another page, or a changed page is recorded as the person refusing');
  const gate = BUILD.slice(BUILD.indexOf('--kosmos-app-download-selftest'));
  assert.ok(gate.indexOf('*"download selftest PAGE NEVER LOADED"*') < gate.indexOf('*"download selftest TIMED OUT"*'),
    'a page that never loads (possibly the response policy itself) is read as the gate timing out');
});

test('#5167 review 28: failures counted while the question was up are said after it', () => {
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /downloadAlertsUp -= 1\n\s+if pendingDownloadFailures > 0 \{[^\n]*\n\s+schedulePendingSay\(\)/,
    'a failure that arrived while the question was up is never said');
});

test('#5167 review 29: a sign-in page is not saved as the file; a 4xx over Kosmos+ is said once (by the page); Reload asks again', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /if response\.mimeType\?\.lowercased\(\) == "text\/html", !wantsPage \{/, 'an expired sign-in\'s page is saved under the file\'s name');
  assert.match(b, /if pageSaysDownloadRefusal\(http\.url \?\? download\.originalRequest\?\.url\) \{\n\s+completionHandler\(nil\)/,
    'a Files-list refusal is said twice (the page says it), or an attachment\'s by nobody');
  assert.match(body('@objc func reloadBoard(_ sender: Any?) {'), /refusedDownloadHosts = \[\]/, 'a mistaken Don\'t Allow can only be undone by quitting');
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.ok(hatch.includes('nor a sign-in page answered for a .pptx'));
});

test('#5167 review 30: a quiet refusal in the window is counted into the summary, never dropped; the presenter keeps the real bookkeeping', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.doesNotMatch(tell, /not said again so soon/, 'a quiet refusal inside the window is dropped');
  assert.match(tell, /if let present = AppDelegate\.downloadAlertPresenter \{[^\n]*\n\s+lastDownloadTold = Date\(\)\n/,
    'the selftest presenter skips the window bookkeeping a real dismissal does, so the summary path is never measured');
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.ok(hatch.includes('"TWO FAILURES AT ONCE: the first is said, the second is counted and said as a summary, never dropped"'));
});

test('#5167 review 31: the board\'s 204 refusal of a download is not saved as an empty file; a page that is not a board is told once per load', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  const at204 = b.indexOf('http.statusCode == 204 || http.statusCode == 205');
  assert.ok(at204 !== -1 && at204 < b.indexOf('!(200..<300).contains(http.statusCode)'), 'a 204 download (the board\'s refusal) is saved as an empty file under the real name');
  assert.match(b, /if pageSaysDownloadRefusal\(response\.url \?\? download\.originalRequest\?\.url\) \{\n\s+completionHandler\(nil\)/,
    'a signed-out Files-list download is said twice (the page says it too)');
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)'), /quietToldThisPage = \[\][^\n]*\n\s+summaryToldForPage = nil/);
  assert.match(body('private func sayPendingDownloadFailures() {'), /title: "Some downloads were not saved"/);
});

test('#5167 review 32: the live rows are read only once the messages have arrived (or 10s)', () => {
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.match(hatch, /askArm \{ settled \{/, 'the verdict is read before late messages arrive, so a busy build box fails a good product');
  assert.match(hatch, /if told\.count >= 10 \|\| tries == 0 \{ go\(\); return \}/);
});

test('#5167 review 33: one refusal and one summary per page load, on every path; one summary waiting at a time', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.match(tell, /if quiet, quietToldThisPage\.contains\(detail\) \{\n[\s\S]*?pendingDownloadFailures \+= 1/,
    'a repeated refusal opens another alert (a looping page), or is dropped instead of summarised');
  assert.match(body('private func sayPendingDownloadFailures() {'), /if !anyFailure, let page = committedPageURL, summaryToldForPage == page \{/,
    'a page looping failures brings the summary back every few seconds');
  assert.match(body('private func schedulePendingSay() {'), /guard !pendingSayScheduled else \{ return \}/, 'every refusal starts its own timer chain');
  assert.equal((SRC.match(/asyncAfter\(deadline: \.now\(\) \+ AppDelegate\.downloadQuietSeconds\)/g) || []).length, 1, 'a summary is scheduled somewhere other than schedulePendingSay');
  assert.match(body('@objc func reloadBoard(_ sender: Any?) {'), /quietToldThisPage = \[\]\n\s+savesByHost = \[:\]/);
});

test('#5167 review 34: a Kosmos+ computer saves at most savesPerComputerCap files a run; the question names the file; a .html over Kosmos+ needs an attachment header', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /if n >= AppDelegate\.savesPerComputerCap \{/, 'an allowed Kosmos+ computer can fill the disk');
  assert.doesNotMatch(SRC, /savesThisPage/, 'the cap resets on a commit, which a page can cause itself');
  assert.match(SRC, /static var savesPerComputerCap = 50\n/);
  assert.match(b, /let wantsPage = sentAsAttachment \|\| \(namedPage && !\(committedPageURL\.map\(isKosmosPlusURL\) \?\? false\)\)/,
    'a signed-out computer\'s sign-in page is saved under an agent\'s report.html');
  assert.match(body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {'), /wants to save \\\(what\) to your Downloads folder/);
  const hatch = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-download-selftest")'));
  assert.ok(hatch.includes('"PAST THE CAP A KOSMOS+ COMPUTER SAVES NOTHING MORE THIS RUN, and says so"'));
  assert.match(hatch, /web\.evaluateJavaScript\("window\.__probeReady = 0"\)/, 'the selftest can click the old page before the new one commits');
});

test('#5167 review 35: the question names the file the page asked for, cleaned; a real failure is always summarised; the cap is per Kosmos+ computer for the run', () => {
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /let clean = file\.map \{ downloadDestination\(dir: URL\(fileURLWithPath: "\/"\), suggested: \$0\) \{ _ in false \}\.lastPathComponent \}/,
    'the question shows the page\'s text uncleaned (direction controls can spoof it)');
  assert.doesNotMatch(SRC, /mayDownload\(file: url\.lastPathComponent\)/, 'the question names the route ("download", an attachment id), not the file');
  assert.match(body('private func sayPendingDownloadFailures() {'), /if !anyFailure, let page = committedPageURL, summaryToldForPage == page \{/,
    'a real failure is dropped once a page has had its summary');
  assert.match(SRC, /private var savesByHost: \[String: Int\] = \[:\]/);
  assert.match(body('@objc func reloadBoard(_ sender: Any?) {'), /savesByHost = \[:\]/);
});

test('#5167 review 36/37: alerts wait a turn; the question shows only a real name, with quotes stripped; Allow sleeps while covered', () => {
  const tell = body('private func tellDownloadFailed(_ detail: String, title: String? = nil');
  assert.match(tell, /DispatchQueue\.main\.async \{\n\s+alert\.runModal\(\)\n\s+dismissed\(\)\n\s+\}/, 'a refusal holds WebKit\'s decision under a modal');
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /let shown = clean\.map \{ \$0\.filter \{ !"/, 'a name with a quote can close the quotation in the question');
  assert.match(may, /RunLoop\.main\.add\(wake, forMode: \.modalPanel\)/);
  const act = body('@objc(webView:decidePolicyForNavigationAction:decisionHandler:)');
  assert.match(act, /mayDownload\(file: nil\)/, 'the question shows a link\'s name, which the answer can make differ from what is saved');
});

test('#5167 review 38: the question brings the app forward; a failed save gives its cap place back', () => {
  const may = body('fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {');
  assert.match(may, /NSApp\.activate\(ignoringOtherApps: true\)[^\n]*\n\s+let asked = alert\.runModal\(\)/, 'a question asked in the background leaves Allow asleep with no reason given');
  assert.match(may, /Allow can be pressed a second after this appears\./);
  assert.match(body('@objc(download:didFailWithError:resumeData:)'), /if let host = downloadHosts\.removeValue\(forKey: ObjectIdentifier\(download\)\) \{\n\s+savesByHost\[host\] = max\(0, savesByHost\[host, default: 1\] - 1\)/,
    'failed downloads use up the per-computer cap');
});
