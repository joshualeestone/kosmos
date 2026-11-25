'use strict';
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
  assert.match(SHELL, /static let onGold = Color\(red: 0x14 \/ 255\.0, green: 0x16 \/ 255\.0, blue: 0x1A \/ 255\.0\)/, 'onGold changed');
});
