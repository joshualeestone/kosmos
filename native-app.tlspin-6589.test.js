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

test('#6589: the challenge handler judges only computers\' addresses, after ordinary checking, and a refusal cancels', () => {
  const h = body('func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,');
  assert.match(h, /space\.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space\.serverTrust/);
  assert.match(h, /isKosmosPlusURL\(target\), !isKosmosPlusSiteURL\(target\)/, 'computers only, never the Kosmos+ site');
  assert.match(h, /else \{ completionHandler\(\.performDefaultHandling, nil\); return \}/, 'anything else is ordinary');
  // Review 1: the selector is pinned (a near-miss signature would compile and never be called), and ordinary checking
  // runs off the main thread, then the pin half on it.
  assert.match(SRC, /@objc\(webView:didReceiveAuthenticationChallenge:completionHandler:\)[^\n]*\n\s+func webView\(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,/);
  // Review 9: the pin is judged whatever ordinary trust said (no early return on it).
  assert.match(h, /evaluateTrustOffMain\(trust\) \{ \[weak self\] _ in\n\s+DispatchQueue\.main\.async \{/);
  assert.doesNotMatch(h, /guard trusted else/, 'the pin is never skipped because ordinary trust said no');
  assert.match(h, /let host = named\.hasSuffix\("\."\) \? String\(named\.dropLast\(\)\) : named/, 'a trailing-dot spelling is judged too');
  // Review 3: the async API is CALLED FROM the queue it is given (SecTrust.h); from main with a global queue it traps.
  // The self-test drives this helper with a real certificate, so a misuse fails the bundle build.
  const ev = SRC.slice(SRC.indexOf('func evaluateTrustOffMain('), SRC.indexOf('\n}\n', SRC.indexOf('func evaluateTrustOffMain(')));
  assert.match(ev, /let q = DispatchQueue\.global\(qos: \.userInitiated\)\n\s+q\.async \{/);
  assert.match(ev, /let started = SecTrustEvaluateAsyncWithError\(trust, q\) \{ _, trusted, _ in done\(trusted\) \}\n\s+if started != errSecSuccess \{ done\(false\) \}/, 'a call that does not start still answers (review 5)');
  assert.match(SRC, /evaluateTrustOffMain\(trust\) \{ trusted in said = trusted; sem\.signal\(\) \}/, 'the self-test calls the real helper');
  assert.match(h, /guard let self else \{ completionHandler\(\.cancelAuthenticationChallenge, nil\); return \}[^\n]*\n\s+self\.judgePin\(host: host, trust: trust, completionHandler: completionHandler\)/);
  assert.doesNotMatch(h, /SecTrustEvaluateWithError\(/, 'never the blocking form on the main thread');
  const hj = body('private func judgePin(host: String, trust: SecTrust,');
  assert.ok(hj.indexOf('askTlsPin(host: host, fresh: false)') > 0, 'the pin half asks the board');
  assert.match(hj, /case \.allow: completionHandler\(\.performDefaultHandling, nil\)/, 'an allow hands back to WebKit, never useCredential (review 9)');
  assert.doesNotMatch(hj, /useCredential/);
  assert.match(hj, /case \.refuse, \.askFresh:\n\s+self\?\.tlsPinRefused\(host, mismatch: state == "pinned"\)\n\s+completionHandler\(\.cancelAuthenticationChallenge, nil\)/);
  assert.match(hj, /guard first == \.askFresh, let self else \{ finish\(first, state\); return \}\n\s+self\.askTlsPin\(host: host, fresh: true\)/, 'one fresh retry, then the decision with fresh: true');
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
  assert.match(a, /guard Thread\.isMainThread else \{ DispatchQueue\.main\.async \{ self\.askTlsPin\(host: host, fresh: fresh, done: done\) \}; return \}/);
});

test('#6589: the leaf\'s key is hashed as the computer hashes it, and a refusal is said once a minute per computer', () => {
  const k = SRC.slice(SRC.indexOf('func tlsLeafKeyHash(_ trust: SecTrust) -> String? {'), SRC.indexOf('\n}\n', SRC.indexOf('func tlsLeafKeyHash(')));
  assert.match(k, /SecTrustCopyCertificateChain\(trust\) as\? \[SecCertificate\], let cert = chain\.first/);
  assert.match(k, /return p256SpkiSha256Hex\(point: point\)/);
  const r = body('private func tlsPinRefused(_ host: String, mismatch: Bool) {');
  // Review 3: a check that could not run is not "the computer is wrong": two wordings.
  assert.match(r, /alert\.informativeText = mismatch\n\s+\? "That computer did not present the certificate it vouches for/);
  assert.match(r, /: "Kosmos could not check that computer's certificate just now/);
  assert.match(r, /if let at = tlsPinToldAt\[host\], now - at < 60 \{ return \}/);
  assert.match(r, /logLine\(/, 'the refusal is logged even when the person is not told again');
});
