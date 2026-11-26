'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9091: Hop, the one-tap game under the iPhone's offline screen. Its rules are tested in Swift
 * (ios/LogicTests/run-hop.sh, on iOS CI); this reads the sources for what a Swift test cannot see:
 *   - the game is on the OFFLINE failure screen only, never on the other three;
 *   - its files hold no blue (Josh 11-25: no blue anywhere in the app);
 *   - Reduce Motion is honoured;
 *   - the best score never leaves the phone (no network or sharing API in the game's files);
 *   - KDots.swift is what tools/gen-kdots-9091.js writes from k-dots.json (nobody edited the generated file).
 * Each check has a control that runs the same rule on a copy made to break it, so a rule that cannot fail shows here.
 *
 *   node --test ios.hopgame-9091.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const GAME = ['ios/Kosmos/HopLogic.swift', 'ios/Kosmos/HopGameView.swift', 'ios/Kosmos/KDots.swift'];
// Swift comments are not code: a comment may say "no blue" or "nothing is sent" without tripping the rules below.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// Where HopGameView appears in ShellViews.swift, and the condition guarding it.
function gameGuard(src) {
  const at = src.indexOf('HopGameView(');
  if (at < 0) return null;
  const before = src.slice(Math.max(0, at - 300), at);
  const m = before.match(/if\s+([^{]+)\{\s*$/);
  return m ? m[1].trim() : '';
}

test('#9091: the game is shown only on the offline failure screen', () => {
  const src = read('ios/Kosmos/ShellViews.swift');
  assert.equal((code(src).match(/HopGameView\(/g) || []).length, 1, 'exactly one HopGameView on the failure screen');
  assert.equal(gameGuard(code(src)), 'failure == .offline');
  // Nowhere else in the app shows it.
  const others = fs.readdirSync(path.join(root, 'ios/Kosmos')).filter((f) => f.endsWith('.swift') && f !== 'ShellViews.swift' && f !== 'HopGameView.swift');
  for (const f of others) assert.ok(!code(read(`ios/Kosmos/${f}`)).includes('HopGameView('), `${f} does not show the game`);
});

test('#9091 CONTROL: an unguarded or wrongly guarded game is seen', () => {
  const src = code(read('ios/Kosmos/ShellViews.swift'));
  const wrong = src.replace(/if failure == \.offline \{(\s*HopGameView)/, 'if failure != .other {$1');
  assert.notEqual(wrong, src, 'the control edit applied');
  assert.equal(gameGuard(wrong), 'failure != .other');
  assert.equal(gameGuard(src.replace(/if failure == \.offline \{\s*HopGameView\(\)/, 'HopGameView()')), '');
});

// Blue, the way these files could say it: a named blue, or an RGB colour whose blue clearly leads.
function blues(src) {
  const hits = [];
  const c = code(src);
  for (const m of c.matchAll(/\.(blue|cyan|indigo|teal|mint|accentColor)\b|kosmosNavy|systemBlue/g)) hits.push(m[0]);
  for (const m of c.matchAll(/Color\(\s*red:\s*([\d.]+)[^,]*,\s*green:\s*([\d.]+)[^,]*,\s*blue:\s*([\d.]+)/g)) {
    const [r, g, b] = m.slice(1, 4).map(Number);
    if (b > r + 0.1 && b > g + 0.1) hits.push(m[0]);
  }
  for (const m of c.matchAll(/0x([0-9A-Fa-f]{6})\b/g)) {
    const v = parseInt(m[1], 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    if (b > r + 25 && b > g + 25) hits.push(m[0]);
  }
  return hits;
}

test('#9091: no blue in the game (Josh 11-25)', () => {
  for (const f of GAME) assert.deepEqual(blues(read(f)), [], `${f} holds no blue`);
});

test('#9091 CONTROL: a blue is seen in each spelling', () => {
  for (const s of ['let a = Color.blue', 'gc.fill(p, with: .color(.indigo))', 'Color(red: 0.1, green: 0.2, blue: 0.9)',
    'static let top: UInt32 = 0x17233D', 'UIColor.kosmosNavy']) assert.ok(blues(s).length > 0, s);
  assert.deepEqual(blues('// a comment about .blue\nlet gold: UInt32 = 0xECB115'), []);
});

test('#9091: Reduce Motion shows the still K and no game', () => {
  const src = code(read('ios/Kosmos/HopGameView.swift'));
  assert.match(src, /@Environment\(\\\.accessibilityReduceMotion\)\s+private var reduceMotion/);
  const m = src.match(/if reduceMotion \{([\s\S]*?)\} else \{\s*game\s*\}/);
  assert.ok(m, 'the game is the else of Reduce Motion');
  assert.ok(!/TimelineView|onTapGesture|model\./.test(m[1]), 'the Reduce Motion branch neither animates nor plays');
});

// Anything that could send the score off the phone.
const NETWORK = /\b(URLSession|URLRequest|NWConnection|WKWebView|evaluateJavaScript|UIPasteboard|ShareLink|UIActivityViewController|NSUbiquitousKeyValueStore|CKContainer|UserDefaults\(suiteName|Board\.|fetch\()/;

test('#9091: the best score never leaves the phone', () => {
  for (const f of GAME) assert.ok(!NETWORK.test(code(read(f))), `${f} uses no network, sharing or shared store`);
  assert.match(code(read('ios/Kosmos/HopLogic.swift')), /static func saveBest\(_ s: Int, _ d: UserDefaults\)/);
  assert.match(code(read('ios/Kosmos/HopGameView.swift')), /HopLogic\.(saveBest|loadBest)\([^)]*\.standard\)/);
});

test('#9091 CONTROL: a network call or an app-group store is seen', () => {
  for (const s of ['URLSession.shared.dataTask(with: u)', 'UserDefaults(suiteName: "group.io.kosmos")', 'UIPasteboard.general.string = "x"'])
    assert.ok(NETWORK.test(s), s);
  assert.ok(!NETWORK.test(code('// URLSession is never used here\nlet d = UserDefaults.standard')));
});

test('#9091: KDots.swift is exactly what the generator writes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kdots-9091-'));
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.mkdirSync(path.join(tmp, 'ios/Kosmos'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'ios/LogicTests/hop'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tools/gen-kdots-9091.js'), path.join(tmp, 'tools/gen-kdots-9091.js'));
  fs.copyFileSync(path.join(root, 'ios/LogicTests/hop/k-dots.json'), path.join(tmp, 'ios/LogicTests/hop/k-dots.json'));
  execFileSync(process.execPath, [path.join(tmp, 'tools/gen-kdots-9091.js')], { stdio: 'pipe' });
  const fresh = fs.readFileSync(path.join(tmp, 'ios/Kosmos/KDots.swift'), 'utf8');
  assert.equal(read('ios/Kosmos/KDots.swift'), fresh);
  // CONTROL: a hand edit to one dot no longer matches.
  assert.notEqual(fresh.replace('(300.7, 206, 15.5)', '(300.7, 206, 15.6)'), fresh, 'the control edit applied');
  assert.notEqual(read('ios/Kosmos/KDots.swift'), fresh.replace('(300.7, 206, 15.5)', '(300.7, 206, 15.6)'));
});

test('#9091: the hop logic suite is on iOS CI', () => {
  const wf = read('.github/workflows/ios.yml');
  assert.match(wf, /ios\/LogicTests\/run-hop\.sh \| tee "\$RUNNER_TEMP\/hop\.log"\n\s+grep -q '\^VERDICT: PASS' "\$RUNNER_TEMP\/hop\.log"/);
});
