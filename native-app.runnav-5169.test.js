'use strict';

/**
 * #5169: On a computer that runs agents, the Mac app's main-frame navigation
 * policy ensures that links or redirects to another origin never replace the
 * board in the window.
 *
 *   node --test native-app.runnav-5169.test.js
 */
process.env.AGENT_WORKFORCE_DATA = require('node:path').join(__dirname, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#5169: the test reads main.swift', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#5169: isBoardURL is defined, pure, and enforces host, port, scheme, and user credentials', () => {
  assert.match(SRC, /\/\/\/ #5169: PURE, for --kosmos-app-mode-selftest\. Whether a URL is this computer's board page\.\nfunc isBoardURL\(_ url: URL, board: \(host: String, port: Int\)\?\) -> Bool/);
  const fn = SRC.slice(SRC.indexOf('func isBoardURL('), SRC.indexOf('\n}\n', SRC.indexOf('func isBoardURL(')));
  assert.match(fn, /guard let board = board, url\.user == nil, url\.password == nil/);
  assert.match(fn, /scheme == "http" \|\| scheme == "https"/);
  assert.match(fn, /host == board\.host\.lowercased\(\)/);
  assert.match(fn, /\(url\.port \?\? \(scheme == "https" \? 443 : 80\)\) == board\.port/);
});

test('#5169: boardLinkDecision keeps the board and about:blank in-app, routes foreign links to browser or block', () => {
  assert.match(SRC, /\/\/\/ #5169: PURE, for --kosmos-app-mode-selftest\. A run computer's main-frame navigations/);
  const fn = SRC.slice(SRC.indexOf('func boardLinkDecision('), SRC.indexOf('\n}\n', SRC.indexOf('func boardLinkDecision(')));
  assert.match(fn, /if isBoardURL\(url, board: board\) \{ return \.inApp \}/);
  assert.match(fn, /case "https":\n\s+guard let host = url\.host, !host\.isEmpty else \{ return \.block \}\n\s+return \.browser/);
  assert.match(fn, /case "http":\n\s+guard let host = url\.host, !host\.isEmpty else \{ return \.block \}\n\s+return clicked \? \.browser : \.block/);
  assert.match(fn, /case "mailto", "tel", "sms":\n\s+return clicked \? \.browser : \.block/);
  assert.match(fn, /case "about":\n\s+return url\.absoluteString == "about:blank" \? \.inApp : \.block/);
  assert.match(fn, /default:\n\s+return \.block/);
});

test('#5169: webView decidePolicy applies boardLinkDecision on run computers and preserves connectLinkDecision on connect', () => {
  assert.match(SRC, /@objc\(webView:decidePolicyForNavigationAction:decisionHandler:\)\n\s+func webView\(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,/);
  const policy = body('func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,');
  assert.match(policy, /guard let url = navigationAction\.request\.url,\n\s+let frame = navigationAction\.targetFrame, frame\.isMainFrame\n\s+else \{ decisionHandler\(\.allow\); return \}/,
    'subframes or requests without a frame are left to the page');
  assert.match(policy, /let clicked = navigationAction\.navigationType == \.linkActivated/);
  assert.match(policy, /if computerMode == \.connect \{\n\s+decision = connectLinkDecision\(for: url, clicked: clicked\)\n\s+\} else \{\n\s+let board = badgeOrigin \?\? \(resolvedPort \?\? modePort\)\.map \{ \("127\.0\.0\.1", \$0\) \}\n\s+decision = boardLinkDecision\(for: url, board: board, clicked: clicked\)\n\s+\}/);
  assert.match(policy, /case \.inApp:\n\s+decisionHandler\(\.allow\)/);
  assert.match(policy, /case \.browser:\n\s+logLine\("#\\\(computerMode == \.connect \? "4356" : "5169"\): opening in the browser: \\\(url\.absoluteString\)"\)\n\s+NSWorkspace\.shared\.open\(url\)\n\s+decisionHandler\(\.cancel\)/);
  assert.match(policy, /case \.block:\n\s+logLine\("#\\\(computerMode == \.connect \? "4356" : "5169"\): refused a navigation: \\\(url\.absoluteString\)"\)\n\s+decisionHandler\(\.cancel\)/);
});

test('#5169: mode selftest contains boardNav checks and expects 59 rows', () => {
  const selftest = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'), SRC.indexOf('/* #3996: the Dock badge\'s number'));
  assert.match(selftest, /\/\/ #5169: a run computer's main-frame navigations \(boardLinkDecision\)\./);
  assert.match(selftest, /boardNav\("http:\/\/127\.0\.0\.1:16180\/", true, \.inApp, "this computer's own board stays in the window"\)/);
  assert.match(selftest, /boardNav\("http:\/\/127\.0\.0\.1:16180\/api\/attachment\/1", false, \.inApp, "a same-origin download stays in the window"\)/);
  assert.match(selftest, /boardNav\("http:\/\/127\.0\.0\.1:3000\/", false, \.block, "ANOTHER LOCAL SERVER IS NEVER LOADED by a script or redirect"\)/);
  assert.match(selftest, /boardNav\("http:\/\/localhost:16180\/", false, \.block, "the board is the host it was loaded as"\)/);
  assert.match(selftest, /boardNav\("https:\/\/evil\.example\/", false, \.browser, "any other site goes to the browser, even from a redirect"\)/);
  assert.match(selftest, /boardNav\("http:\/\/example\.com\/", false, \.block, "plain http, scripted, is refused"\)/);
  assert.match(selftest, /let expected = 59/);
});

test('#5169: reference logic matches all 19 board navigation rules', () => {
  function isBoardURL(urlStr, board) {
    if (!board) return false;
    try {
      const u = new URL(urlStr);
      if (u.username || u.password) return false;
      const scheme = u.protocol.replace(':', '').toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') return false;
      const host = u.hostname.toLowerCase();
      const port = u.port ? parseInt(u.port, 10) : (scheme === 'https' ? 443 : 80);
      return host === board.host.toLowerCase() && port === board.port;
    } catch {
      return false;
    }
  }

  function boardLinkDecision(urlStr, board, clicked) {
    if (isBoardURL(urlStr, board)) return 'inApp';
    try {
      const u = new URL(urlStr);
      const scheme = u.protocol.replace(':', '').toLowerCase();
      switch (scheme) {
        case 'https':
          return u.hostname ? 'browser' : 'block';
        case 'http':
          return (u.hostname && clicked) ? 'browser' : 'block';
        case 'mailto':
        case 'tel':
        case 'sms':
          return clicked ? 'browser' : 'block';
        case 'about':
          return urlStr === 'about:blank' ? 'inApp' : 'block';
        default:
          return 'block';
      }
    } catch {
      return 'block';
    }
  }

  const board = { host: '127.0.0.1', port: 16180 };
  assert.equal(boardLinkDecision('http://127.0.0.1:16180/', board, true), 'inApp');
  assert.equal(boardLinkDecision('http://127.0.0.1:16180/api/attachment/1', board, false), 'inApp');
  assert.equal(boardLinkDecision('http://127.0.0.1:16180/#settings', board, true), 'inApp');
  assert.equal(boardLinkDecision('http://127.0.0.1:3000/', board, true), 'browser');
  assert.equal(boardLinkDecision('http://127.0.0.1:3000/', board, false), 'block');
  assert.equal(boardLinkDecision('http://127.0.0.1:80/', board, false), 'block');
  assert.equal(boardLinkDecision('http://localhost:16180/', board, false), 'block');
  assert.equal(boardLinkDecision('https://evil.example/', board, true), 'browser');
  assert.equal(boardLinkDecision('https://evil.example/', board, false), 'browser');
  assert.equal(boardLinkDecision('http://example.com/', board, true), 'browser');
  assert.equal(boardLinkDecision('http://example.com/', board, false), 'block');
  assert.equal(boardLinkDecision('https://login.kosmosplus.com/', board, true), 'browser');
  assert.equal(boardLinkDecision('http://user@127.0.0.1:16180/', board, true), 'browser');
  assert.equal(boardLinkDecision('mailto:help@kosmosplus.com', board, true), 'browser');
  assert.equal(boardLinkDecision('mailto:help@kosmosplus.com', board, false), 'block');
  assert.equal(boardLinkDecision('javascript:alert(1)', board, true), 'block');
  assert.equal(boardLinkDecision('file:///etc/passwd', board, true), 'block');
  assert.equal(boardLinkDecision('about:blank', board, false), 'inApp');
  assert.equal(boardLinkDecision('http://127.0.0.1:16180/', null, false), 'block');
});

test('#5169: if a compiled app binary is available, mode selftest runs all 59 rows and passes exit 0', () => {
  const bin = process.env.KOSMOS_APP_BIN;
  if (!bin || !fs.existsSync(bin)) return;
  const res = spawnSync(bin, ['--kosmos-app-mode-selftest'], { encoding: 'utf8' });
  assert.equal(typeof res.status, 'number', 'status must be numeric');
  assert.equal(res.status, 0, 'mode selftest failed: ' + res.stderr + '\n' + res.stdout);
  assert.match(res.stdout, /mode-check: all good \(59 rows\)/);
});
