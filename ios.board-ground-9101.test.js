'use strict';
/**
 * kosmos#9101 (Josh, 11-25 16:49: no blue background anywhere in the app): the iPhone painted Kosmos navy (#17233D)
 * behind the web board, under the tab bar and on the Close bar over a board page, to match a page colour the board does
 * not have (its ground is #faf9f7, and #1c1c1e in the dark scheme; navy is only its Kosmos Plus section). It now paints
 * UIColor.boardGround, whose two values must be the board's own --bg in each scheme, read here from web/index.html so a
 * change to either side goes red. Source only; the screens themselves are in the card's screenshots.
 *
 *   node --test ios.board-ground-9101.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IOS = path.join(__dirname, 'ios', 'Kosmos');
const SWIFT = fs.readdirSync(IOS).filter((f) => f.endsWith('.swift')).map((f) => [f, fs.readFileSync(path.join(IOS, f), 'utf8')]);
const SHELL = fs.readFileSync(path.join(IOS, 'ShellViews.swift'), 'utf8');
const CONTENT = fs.readFileSync(path.join(IOS, 'ContentView.swift'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* The board's --bg in its light :root and in its dark-scheme :root, as the first declaration in each block. */
function pageGround() {
  const light = /:root\s*\{[^}]*?--bg:\s*(#[0-9a-f]{6})/i.exec(PAGE);
  const darkAt = PAGE.indexOf('@media (prefers-color-scheme: dark) {');
  assert.ok(light, 'the board\'s light --bg was not found');
  assert.ok(darkAt > -1, 'the board\'s dark-scheme block was not found');
  const dark = /--bg:\s*(#[0-9a-f]{6})/i.exec(PAGE.slice(darkAt, darkAt + 4000));
  assert.ok(dark, 'the board\'s dark --bg was not found');
  return { light: light[1].toLowerCase(), dark: dark[1].toLowerCase() };
}
function hexOf(block) {
  const m = /red: 0x([0-9A-F]{2}) \/ 255\.0, green: 0x([0-9A-F]{2}) \/ 255\.0, blue: 0x([0-9A-F]{2}) \/ 255\.0/i.exec(block);
  return m ? ('#' + m[1] + m[2] + m[3]).toLowerCase() : null;
}

test('#9101 no Swift file paints Kosmos navy', () => {
  for (const [f, src] of SWIFT) {
    assert.doesNotMatch(src, /kosmosNavy/, f + ' still uses kosmosNavy');
    assert.doesNotMatch(src, /red: 0x17 \/ 255\.0, green: 0x23 \/ 255\.0, blue: 0x3D/i, f + ' spells out the navy #17233D');
  }
});

test('#9101 boardGround is the board\'s own --bg, light and dark', () => {
  const at = SHELL.indexOf('static let boardGround = UIColor { trait in');
  assert.ok(at > -1, 'boardGround moved or was renamed');
  const body = SHELL.slice(at, SHELL.indexOf('\n    }\n', at));
  assert.match(body, /trait\.userInterfaceStyle == \.dark\s*\?\s*UIColor\(red:[^)]*\)\s*:\s*UIColor\(red:/, 'boardGround is no longer "dark ? one : the other"');
  const [darkArm, lightArm] = body.split(/\)\s*:\s*UIColor\(/);   // the ternary's two colours, dark first
  const page = pageGround();
  assert.equal(hexOf(darkArm), page.dark, 'boardGround\'s dark value is not the board\'s dark --bg');
  assert.equal(hexOf('red:' + lightArm.slice(lightArm.indexOf(' '))), page.light, 'boardGround\'s light value is not the board\'s --bg');
});

test('#9101 the five places behind the board use it, and the Close bar\'s words read on it', () => {
  assert.equal((CONTENT.match(/UIColor\.boardGround|= \.boardGround/g) || []).length, 5, 'a place behind the web board does not use boardGround');
  const bar = CONTENT.slice(CONTENT.indexOf('private var boardPage: some View {'), CONTENT.indexOf('.accessibilityLabel("Close this page")'));
  assert.ok(bar.length > 0, 'the Close bar moved');
  assert.match(bar, /\.foregroundColor\(Palette\.primary\)/, 'the Close bar\'s words are not the app\'s primary text colour');
  assert.doesNotMatch(bar, /\.foregroundColor\(\.white\)/, 'white words on a ground that is cream in light');
});
