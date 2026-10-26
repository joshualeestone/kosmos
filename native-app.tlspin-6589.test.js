'use strict';
/**
 * kosmos#6589 (S-7c): in the Mac app, another of the person's computers must present a certificate whose key is the
 * one it vouches for. The rules (p256SpkiSha256Hex against an openssl vector, and tlsPinDecision's table) are proved
 * by their rows in --kosmos-app-mode-selftest; this file pins the wiring the selftest cannot reach: which connections
 * the challenge handler judges, that ordinary checking comes first, that a refusal cancels, and what it asks the board.
 * What no file here can prove is that WebKit calls the handler for every connection (a resumed TLS session, a
 * coalesced one): that is measured on the real app, with a deliberately wrong pin, on a second navigation too.
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

test('#6589: the challenge handler judges only computers\' addresses, hands an allow back to WebKit, and a refusal cancels', () => {
  const h = body('func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,');
  assert.match(h, /space\.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space\.serverTrust/);
  assert.match(h, /isKosmosPlusURL\(target\), !isKosmosPlusSiteURL\(target\)/, 'computers only, never the Kosmos+ site');
  assert.match(h, /else \{ completionHandler\(\.performDefaultHandling, nil\); return \}/, 'anything else is ordinary');
  // Review 1: the selector is pinned (a near-miss signature would compile and never be called), and ordinary checking
  // runs off the main thread, then the pin half on it.
  assert.match(SRC, /@objc\(webView:didReceiveAuthenticationChallenge:completionHandler:\)[^\n]*\n\s+func webView\(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,/);
  // Reviews 9 and 10: no trust evaluation of its own; the pin is judged straight away, and every other decision is
  // WebKit's own (an allow is .performDefaultHandling).
  assert.match(h, /\n\s+judgePin\(host: host, trust: trust, completionHandler: completionHandler\)\n\s+\}$/);
  assert.doesNotMatch(h, /SecTrustEvaluate/, 'no trust evaluation of its own to wait on');
  assert.match(h, /let host = named\.hasSuffix\("\."\) \? String\(named\.dropLast\(\)\) : named/, 'a trailing-dot spelling is judged too');
  assert.match(h, /space\.port == 443 \|\| space\.port == 0,/, 'the port guard (review 10)');
  assert.match(SRC, /pin\(tlsLeafKeyHash\(trust\), "d161c11e/, 'the self-test reads the leaf from a real certificate');
  assert.doesNotMatch(h, /SecTrustEvaluateWithError\(/, 'never the blocking form on the main thread');
  const hj = body('private func judgePin(host: String, trust: SecTrust,');
  assert.ok(hj.indexOf('askTlsPin(host: host, fresh: false)') > 0, 'the pin half asks the board');
  assert.match(hj, /case \.allow: completionHandler\(\.performDefaultHandling, nil\)/, 'an allow hands back to WebKit, never useCredential (review 9)');
  assert.doesNotMatch(hj, /useCredential/);
  assert.match(hj, /case \.refuse, \.askFresh:\n\s+self\?\.tlsPinRefused\(host, mismatch: state == "pinned"\)\n\s+completionHandler\(\.cancelAuthenticationChallenge, nil\)/);
  // kosmos#7193: the one fresh retry waits 3 s when the check could not run (the relay's hourly tunnel retire is about
  // 2 s), and goes at once for a key that does not match.
  const hjCode = hj.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(hjCode, /guard first == \.askFresh, let self else \{ finish\(first, state\); return \}\n\s+let wait: Double = state == "pinned" \? 0 : 3\n\s+DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ wait\) \{\n\s+self\.askTlsPin\(host: host, fresh: true\)/, 'one fresh retry (after a wait unless a key did not match), then the decision with fresh: true');
  assert.match(hj, /fresh: true\), state2\)\n/, 'the retry is judged as fresh, so a second mismatch refuses');
});

test('#6589: it asks this computer\'s own board, with the board token, for that address', () => {
  const a = body('private func askTlsPin(host: String, fresh: Bool, done: @escaping (String?, [String]) -> Void) {');
  assert.match(a, /parts\.scheme = "http"; parts\.host = "127\.0\.0\.1"; parts\.port = resolvedPort; parts\.path = "\/api\/remote\/tls-pin"/);
  assert.match(a, /URLQueryItem\(name: "address", value: host\)/);
  assert.match(a, /\(fresh \? \[URLQueryItem\(name: "fresh", value: "1"\)\] : \[\]\)/);
  assert.match(a, /req\.setValue\(tok, forHTTPHeaderField: "x-kosmos-board-token"\)/);
  // Review 1: only NO board (no port: a connect-only Mac) is (nil, []), ordinary; a board that does not answer properly
  // is required, and logged.
  assert.match(a, /guard resolvedPort != nil, let url = parts\.url else \{ done\(nil, \[\]\); return \}/);
  assert.match(a, /logLine\("tls-pin: the board did not answer[^\n]*\n\s+done\("required", \[\]\); return/);
  // pinlog-6589: the same event reaches a person's Mac's unified log (logLine alone writes only the harness file).
  assert.match(a, /logToSystem\("tls-pin: the board did not answer \(status [^\n]*\n\s+logLine\("tls-pin: the board did not answer for/);
  assert.match(a, /guard Thread\.isMainThread else \{ DispatchQueue\.main\.async \{ self\.askTlsPin\(host: host, fresh: fresh, done: done\) \}; return \}/);
});

test('#6589: the leaf\'s key is hashed as the computer hashes it, and a refusal is said once a minute per computer', () => {
  const k = SRC.slice(SRC.indexOf('func tlsLeafKeyHash(_ trust: SecTrust) -> String? {'), SRC.indexOf('\n}\n', SRC.indexOf('func tlsLeafKeyHash(')));
  // Review 11: never the chain call, which evaluates the trust (and can wait on the network) on the main thread.
  assert.match(k, /SecTrustGetCertificateAtIndex\(trust, 0\)/);
  const code = k.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');   // the comment names the call it avoids
  assert.doesNotMatch(code, /SecTrustCopyCertificateChain|SecTrustEvaluate/);
  assert.match(k, /return p256SpkiSha256Hex\(point: point\)/);
  const r = body('private func tlsPinRefused(_ host: String, mismatch: Bool) {');
  // Review 3: a check that could not run is not "the computer is wrong": two wordings.
  assert.match(r, /alert\.informativeText = mismatch\n\s+\? "That computer did not present the certificate it vouches for/);
  assert.match(r, /: "Kosmos could not check that computer's certificate just now/);
  assert.match(r, /if let at = tlsPinToldAt\[host\], now - at < 60 \{ return \}/);
  assert.match(r, /logLine\(/, 'the refusal is logged even when the person is not told again');
  // pinlog-6589: every refusal reaches the unified log, so the call must come BEFORE the once-a-minute return.
  const sys = r.indexOf('logToSystem(mismatch ? "tls-pin: refused a computer: ');
  const quiet = r.indexOf('if let at = tlsPinToldAt[host], now - at < 60 { return }');
  assert.ok(sys >= 0 && quiet >= 0 && sys < quiet, 'the unified-log refusal line is missing or comes after the once-a-minute return');
});

test('kosmos#7193: one refusal alert on screen at a time, and the minute counts from when the person dismissed it', () => {
  const r = body('private func tlsPinRefused(_ host: String, mismatch: Bool) {');
  // Review 1: block comments out too, so a commented-out guard cannot satisfy the test.
  const code = r.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // A second alert begun while one is up waits behind it (macOS queues sheets): Josh pressed OK seven times on 0.7.63.
  // Review 1: held back only while the window really has a sheet (a dropped sheet must not leave the mark set), and said.
  const showing = code.indexOf('if tlsPinAlertShowing, window == nil || window?.attachedSheet != nil {');
  assert.match(code, /attachedSheet != nil \{\n\s+logToSystem\("tls-pin: an alert is already on screen/);
  assert.match(code, /if now - tlsPinDismissedAt < 60 \{ return \}/, 'one minute after the last dismissal, whichever computer');
  const quiet = code.indexOf('if let at = tlsPinToldAt[host], now - at < 60 { return }');
  const set = code.indexOf('tlsPinAlertShowing = true');
  const alert = code.indexOf('let alert = NSAlert()');
  assert.ok(showing >= 0 && showing < quiet, 'no "an alert is already showing" return, or it comes after the once-a-minute return');
  assert.ok(set > quiet && set < alert, 'the showing mark is not set before the alert is shown');
  // Both ways the alert is shown clear the mark and restart the minute when it is dismissed.
  assert.match(code, /let dismissed: \(\) -> Void = \{ \[weak self\] in\n\s+self\?\.tlsPinAlertShowing = false\n\s+self\?\.tlsPinToldAt\[host\] = ProcessInfo\.processInfo\.systemUptime\n\s+self\?\.tlsPinDismissedAt = ProcessInfo\.processInfo\.systemUptime/);
  assert.match(code, /alert\.beginSheetModal\(for: window\) \{ _ in dismissed\(\) \}/);
  assert.match(code, /alert\.runModal\(\); dismissed\(\)/);
  assert.doesNotMatch(code, /completionHandler: nil/, 'a sheet with no completion would never clear the mark');
  // It says what to do if it keeps happening.
  assert.match(r, /Try again in a moment\. If this keeps happening, check that both computers are on and connected to the internet\."/);
  // The mark is one Bool for every computer: any refusal alert on screen holds the next.
  assert.match(SRC, /private var tlsPinAlertShowing = false/);
});
