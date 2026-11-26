'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9095 (Josh, 11-25 16:49: "we are not going to have the blue background anywhere in the app"): the iPhone's
 * four failure screens (LoadFailureView: offline, Kosmos+ not answering, a Mac not answering, a page that did not load)
 * stand on the native screens' own ground, cream in light and near-black in dark, with a gold Try again. They were
 * Kosmos navy (#17233D) with a blue (#2F57C4) Try again. This reads the Swift source, so it runs on every validation;
 * the screens themselves are shown in the card's screenshots.
 *
 *   node --test ios.failure-screens-9095.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHELL = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'ShellViews.swift'), 'utf8');
const PALETTE = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'AgentsView.swift'), 'utf8');

function view() {
  const at = SHELL.indexOf('struct LoadFailureView: View {');
  assert.ok(at > -1, 'LoadFailureView moved or was renamed');
  const end = SHELL.indexOf('\n}\n', at);
  assert.ok(end > at, 'LoadFailureView has no closing brace at the start of a line');
  return SHELL.slice(at, end + 2);
}

test('#9095 the failure screens use no navy and no blue', () => {
  const v = view();
  assert.doesNotMatch(v, /kosmosNavy/, 'a failure screen is drawn on Kosmos navy');
  assert.doesNotMatch(v, /KosmosColor\./, 'a failure screen uses the old dark-ground tokens (accent is blue)');
  assert.doesNotMatch(v, /0x2F\s*\/\s*255\.0,\s*green:\s*0x57/i, 'the blue #2F57C4 is spelled out in the view');
  assert.doesNotMatch(v, /\.(foregroundColor|background)\(\.(blue|white)\)/, 'a blue fill, or white text that needs a dark fill under it');
});

test('#9095 they stand on the native ground, with the app\'s text colours and a gold Try again', () => {
  const v = view();
  assert.match(v, /Palette\.ground\.ignoresSafeArea\(\)/, 'the ground is not Palette.ground');
  assert.match(v, /\.foregroundColor\(Palette\.primary\)/, 'the title is not the app\'s primary text colour');
  assert.match(v, /\.foregroundColor\(Palette\.secondary\)/, 'the message is not the app\'s secondary text colour');
  assert.match(v, /\.foregroundColor\(Self\.onGold\)\s*\.background\(Palette\.starFill\)/, 'Try again is not gold with dark words');
  assert.match(v, /SweepDots\(colour: Self\.onGold/, 'the Trying dots are not the gold button\'s word colour');
});

test('#9095 the palette it leans on is cream and gold, not blue (a change to Palette shows up here)', () => {
  assert.match(PALETTE, /static let ground = pair\(0xfaf9f7, 0x0c0d0f\)/, 'Palette.ground changed: re-check the failure screens');
  assert.match(PALETTE, /static let starFill = pair\(0xe3b341, 0xe3b341\)/, 'Palette.starFill changed: re-check Try again');
  assert.match(PALETTE, /static let starGold = pair\(0x9c741b, 0xe3b341\)/, 'Palette.starGold changed: re-check the icon and the deep-gold edge on cream');
  assert.match(SHELL, /static let onGold = Color\(red: 0x14 \/ 255\.0, green: 0x16 \/ 255\.0, blue: 0x1A \/ 255\.0\)/, 'onGold changed');
});

test('#9095 nothing laid over a failure screen forces the dark appearance (it was light text for the navy ground)', () => {
  const agents = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'AgentsView.swift'), 'utf8');
  const content = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'ContentView.swift'), 'utf8');
  for (const [name, src] of [['AgentsView.swift', agents], ['ContentView.swift', content]]) {
    // The whole file, not each use: an ancestor view in the same file could force the appearance too. A forced
    // appearance set in some other file (the window, a parent view elsewhere) is outside what this test can see.
    assert.ok(src.includes('LoadFailureView('), name + ' no longer shows LoadFailureView; re-aim this test');
    assert.doesNotMatch(src, /colorScheme,\s*\.dark|preferredColorScheme\(\.dark\)|overrideUserInterfaceStyle/, name + ': the file forces a dark appearance somewhere a failure screen can sit under');
  }
  assert.match(agents, /MacSwitcher\(client: client\)\.frame\(minHeight: 44\)\.padding\(16\)/, 'the switcher over the Mac-not-answering screen changed; re-check it on cream');
});

test('#9095 the two buttons keep a visible edge: the gold one in deep gold, the outlined one in the secondary colour', () => {
  const v = view();
  assert.match(v, /\.background\(Palette\.starFill\)\s*\.clipShape\(RoundedRectangle\(cornerRadius: 12\)\)\s*(\/\/[^\n]*\n\s*)*\.overlay\(RoundedRectangle\(cornerRadius: 12\)\.stroke\(Palette\.starGold, lineWidth: 1\)\)/, 'Try again lost its deep-gold edge (the bright gold is under 3:1 on cream)');
  assert.match(v, /\.stroke\(Palette\.secondary, lineWidth: 1\)/, 'Choose another computer lost its secondary-colour outline (separator is about 1.3:1)');
});

// The screenshot hook: KOSMOS_SAMPLE_FAILURE holds Today on a failure screen, and only a Debug build can read it.
test('#9095 the failure screenshot hook names all four screens and is Debug only', () => {
  const content = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'ContentView.swift'), 'utf8');
  const at = content.indexOf('static let sampleFailure');
  assert.ok(at > -1, 'ContentView has no sampleFailure hook');
  const body = content.slice(at, content.indexOf('}()', at));
  const debug = body.indexOf('#if DEBUG'), read = body.indexOf('KOSMOS_SAMPLE_FAILURE'), other = body.indexOf('#else');
  assert.ok(debug > -1 && read > debug && other > read, 'KOSMOS_SAMPLE_FAILURE is read outside #if DEBUG');
  assert.match(body.slice(other), /#else\s*return nil\s*#endif/, 'a Release build must answer nil');
  for (const [word, kase] of [['offline', 'offline'], ['unreachable', 'unreachable'], ['mac', 'macUnreachable'], ['other', 'other']]) {
    assert.match(body, new RegExp(`case "${word}": failure = \\.${kase}\\b`), `KOSMOS_SAMPLE_FAILURE=${word} does not reach .${kase}`);
  }
  assert.match(content, /if let failure = Self\.sampleFailure\?\.failure \?\? shell\.failure \{/, 'Today does not show the sampled failure');
  assert.match(body, /raw\.lowercased\(\)/, 'the value is matched case-sensitively');
  assert.match(body, /parts\.dropFirst\(\)\.contains\("trying"\)/, 'the ",trying" form is not read');
  const shown = content.slice(content.indexOf('if let failure = Self.sampleFailure'), content.indexOf('lastHeard:', content.indexOf('if let failure = Self.sampleFailure')));
  assert.match(shown, /retrying: Self\.sampleFailure\?\.trying \?\? shell\.retrying/, 'the sampled Trying is not shown');
  assert.match(shown, /detail: Self\.sampleFailure\.map \{ _ in "The request timed out\." \}/, 'the "other" screen has no sampled detail');
  assert.match(shown, /macName: Self\.sampleFailure\.map \{ _ in "Studio Mac" \}/, 'the Mac screen has no sampled name');
  for (const action of ['retry', 'back', 'otherComputer']) {
    assert.match(shown, new RegExp(`Self\\.sampleFailure == nil \\? shell\\.${action} : \\{\\}`), `a sampled screen's ${action} acts on the real page`);
  }
});
