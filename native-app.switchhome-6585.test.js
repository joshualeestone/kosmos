'use strict';
/**
 * kosmos#6585: in the Mac app, choosing THIS computer in another computer's switcher goes back to this computer's own
 * board, as View > Back to This Computer does, instead of opening its Kosmos+ address, which is a sign-in there (Josh
 * 2026-10-19 09:25: "when I tried to flip back to mine, I got the blue login screen again"). The rule
 * (switchGoesHome) is proved by its rows in --kosmos-app-mode-selftest; this file pins the wiring the selftest cannot
 * reach: the main-frame navigation policy asks it, before the link rules, cancels the navigation and calls
 * backToThisComputer, whose own checks (an update running, a start in flight) still apply.
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

test('#6585: the navigation policy sends a click to this computer\'s own address home, before the link rules', () => {
  const policy = body('func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,');
  const ask = policy.indexOf('if navigationAction.navigationType == .linkActivated,\n           switchGoesHome(url, onAnotherComputer: isOnAnotherComputer(), clicked: true, ownPlusHost: ownKosmosPlusHost()) {');
  assert.ok(ask > 0, 'the policy no longer asks switchGoesHome');
  const links = policy.indexOf('switch connectLinkDecision(');
  assert.ok(links > ask, 'switchGoesHome must be asked before the link rules, which would load the address');
  const guardAt = policy.indexOf('let frame = navigationAction.targetFrame, frame.isMainFrame');
  assert.ok(guardAt > 0 && guardAt < ask, 'only a main-frame navigation may go home');
  const arm = policy.slice(ask, policy.indexOf('return\n', ask));
  // No boardStartInFlight check here: backToThisComputer beeps during a start, where a sign-in page would load.
  assert.doesNotMatch(arm, /boardStartInFlight/, 'a start in flight must reach backToThisComputer (it beeps), not fall through to the sign-in page');
  assert.match(arm, /decisionHandler\(\.cancel\)\n\s+backToThisComputer\(nil\)/, 'cancels the sign-in page and goes home through the menu item\'s own checks');
});

test('#6585: switchGoesHome is pure and keyed on this computer\'s own Kosmos+ address only', () => {
  const fn = SRC.slice(SRC.indexOf('func switchGoesHome('), SRC.indexOf('\n}\n', SRC.indexOf('func switchGoesHome(')));
  assert.match(fn, /guard onAnotherComputer, clicked, let target = target, let own = ownPlusHost\?\.lowercased\(\),\n\s+isKosmosPlusURL\(target\)/);
  assert.match(fn, /return host == own/);
  assert.doesNotMatch(fn, /ownKosmosPlusHost\(\)|ProcessInfo|FileManager/, 'pure: the caller reads the address file');
});
