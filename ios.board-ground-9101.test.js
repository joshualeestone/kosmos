'use strict';
/**
 * kosmos#9101 (Josh, 11-25 16:49: no blue background anywhere in the app): the iPhone painted Kosmos navy (#17233D)
 * behind the web board, under the tab bar and on the Close bar over a board page. The board's page ground is whatever
 * its `body` background names (var(--k-bg): #faf9f7, and #0c0d0f in the dark scheme). UIColor.boardGround's two values
 * must be that token's, read here from web/index.html, so a change to either side goes red. Inside the app the board's
 * own header bar (html.kremote.kapptabs .kplus-bar) stands on that ground too. Source only; the screens themselves are
 * in the card's screenshots and render-apptabs-6846.
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

/* The token the board's body background names, and its value in the light :root and in the dark-scheme :root. */
function blockAt(src, open) {   // from an opening brace to its match
  let d = 0;
  for (let k = open; k < src.length; k += 1) { if (src[k] === '{') d += 1; else if (src[k] === '}') { d -= 1; if (d === 0) return src.slice(open, k + 1); } }
  return '';
}
function pageGround() {
  const body = /\nbody \{[^}]*?background: var\((--[a-z0-9-]+)\)/.exec(PAGE);
  assert.ok(body, 'the board\'s body background is no longer a var(); re-aim this test');
  const token = body[1];
  const value = (src) => { const m = new RegExp(token + ':\\s*(#[0-9a-f]{6})', 'i').exec(src); return m ? m[1].toLowerCase() : null; };
  const root = PAGE.indexOf(':root {');
  assert.ok(root > -1, 'the board\'s :root was not found');
  const darkAt = PAGE.indexOf('@media (prefers-color-scheme: dark) {');
  assert.ok(darkAt > -1, 'the board\'s dark-scheme block was not found');
  const light = value(blockAt(PAGE, PAGE.indexOf('{', root)));
  const dark = value(blockAt(PAGE, PAGE.indexOf('{', darkAt)));
  assert.ok(light && dark, token + ' was not found in both blocks');
  return { token, light, dark };
}

test('#9101 no Swift file paints Kosmos navy', () => {
  for (const [f, src] of SWIFT) {
    assert.doesNotMatch(src, /kosmosNavy/, f + ' still uses kosmosNavy');
    assert.doesNotMatch(src, /red: 0x17 \/ 255\.0, green: 0x23 \/ 255\.0, blue: 0x3D/i, f + ' spells out the navy #17233D');
  }
});

test('#9101 boardGround is the colour the board\'s body paints, light and dark', () => {
  const at = SHELL.indexOf('static let boardGround = UIColor { trait in');
  assert.ok(at > -1, 'boardGround moved or was renamed');
  const body = SHELL.slice(at, SHELL.indexOf('\n    }\n', at));
  assert.match(body, /trait\.userInterfaceStyle == \.dark\s*\?\s*UIColor\(red:[^)]*\)\s*:\s*UIColor\(red:/, 'boardGround is no longer "dark ? one : the other"');
  const lits = [...body.matchAll(/red: 0x([0-9A-F]{2}) \/ 255\.0, green: 0x([0-9A-F]{2}) \/ 255\.0, blue: 0x([0-9A-F]{2}) \/ 255\.0/gi)]
    .map((m) => ('#' + m[1] + m[2] + m[3]).toLowerCase());
  assert.equal(lits.length, 2, 'boardGround should spell exactly two colours, dark then light');
  const page = pageGround();
  assert.equal(lits[0], page.dark, 'boardGround\'s dark value is not the board\'s dark ' + page.token);
  assert.equal(lits[1], page.light, 'boardGround\'s light value is not the board\'s ' + page.token);
});

test('#9101 the five places behind the board use it, and the Close bar\'s words read on it', () => {
  assert.equal((CONTENT.match(/UIColor\.boardGround|= \.boardGround/g) || []).length, 5, 'a place behind the web board does not use boardGround');
  const from = CONTENT.indexOf('private var boardPage: some View {');
  const to = CONTENT.indexOf('.accessibilityLabel("Close this page")');
  assert.ok(from > -1 && to > from, 'the Close bar moved');
  const bar = CONTENT.slice(from, to);
  assert.match(bar, /\.foregroundColor\(Palette\.primary\)/, 'the Close bar\'s words are not the app\'s primary text colour');
  assert.doesNotMatch(bar, /\.foregroundColor\(\.white\)/, 'white words on a ground that is cream in light');
});

test('#9101 inside the app, the board\'s own header bar stands on the page\'s ground, not navy', () => {
  const rule = /html\.kremote\.kapptabs \.kplus-bar \{([^}]*)\}/.exec(PAGE);
  assert.ok(rule, 'the in-app header rule moved');
  assert.match(rule[1], /background: var\(--k-bg\)/, 'the in-app header is not on the page\'s ground');
  assert.match(rule[1], /color: var\(--k-ink\)/, 'the in-app header\'s words are not the page\'s ink');
  const block = PAGE.slice(PAGE.indexOf('html.kremote.kapptabs .kplus-bar {'), PAGE.indexOf('.kapp-comp, .kapp-me { display: none; }'));
  assert.ok(block.length > 0);
  assert.doesNotMatch(block, /#17233d|#fff\b|rgba\(255,\s*255,\s*255/i, 'navy or white left in the in-app header (written for the navy bar)');
});
