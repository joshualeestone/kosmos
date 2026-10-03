'use strict';

/**
 * #5167: the Mac app saves a download the page asks for. Without this, an `<a download>` click (#4930's
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
  assert.match(b, /if navigationAction\.shouldPerformDownload, let url = navigationAction\.request\.url,\n\s+isSameOriginDownload\(url, page: webView\.url\) \{\n\s+decisionHandler\(\.download\)\n\s+return\n\s+\}/,
    'a download is saved without the same-origin check, or the check no longer decides it');
});

test('#5167: an attachment response is saved, and every other response is allowed as before', () => {
  const b = body('@objc(webView:decidePolicyForNavigationResponse:decisionHandler:)');
  assert.match(b, /func webView\(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,\n\s+decisionHandler: @escaping \(WKNavigationResponsePolicy\) -> Void\)/);
  assert.match(b, /\.lowercased\(\)\.hasPrefix\("attachment"\)/, 'the attachment check is gone or case sensitive');
  assert.equal((b.match(/decisionHandler\(/g) || []).length, 2, 'the response policy has a path that never answers, or a new one');
  assert.match(b, /decisionHandler\(\.allow\)\n\s+\}$/, 'the default is no longer .allow, which changes every page load');
});

test('#5167: both ways a navigation becomes a download hand it to this delegate (pinned selectors)', () => {
  for (const sel of ['webView:navigationAction:didBecomeDownload:', 'webView:navigationResponse:didBecomeDownload:']) {
    assert.match(body('@objc(' + sel + ')'), /download\.delegate = self/, sel + ' does not take the download');
  }
});

test('#5167: the destination is Downloads through downloadDestination, never replacing a file', () => {
  const b = body('func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,');
  assert.match(b, /FileManager\.default\.urls\(for: \.downloadsDirectory, in: \.userDomainMask\)/);
  assert.match(b, /downloadDestination\(dir: dir, suggested: suggestedFilename\) \{\n\s+FileManager\.default\.fileExists\(atPath: \$0\.path\)\n\s+\}/);
  assert.equal((b.match(/completionHandler\(/g) || []).length, 2, 'a destination path that never answers WebKit leaves the download hanging');
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
  assert.equal(dl + dest, 22, 'the #5167 rows changed; update the expected count with them');
  assert.match(st, /let expected = 62\b/);
});
