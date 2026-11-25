'use strict';
/* kosmos#8959 slice D1d3b: the iPhone's community post and comment words are the page's.
 *
 * The phone ports web/index.html's communityMineWord, communityMineCommentWord and communityMineLabel to Swift
 * (ios/Kosmos/MineLogic.swift). Its logic suite checks the port against ios/LogicTests/mine/expected.json; this test checks
 * that the PAGE still produces exactly that file, by running the page's own functions (lifted out between
 * `function communityMineWord` and `let COMMUNITY_MINE_EPOCH`) on ios/LogicTests/mine/fixture.json, one record per branch.
 * If the page changes on purpose: run this test, copy the "actual" it prints into expected.json, then make the phone match.
 *   node --test web.mine-ios-parity-8959.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const dir = path.join(__dirname, 'ios', 'LogicTests', 'mine');

function pageFunctions() {
  const a = page.indexOf('function communityMineWord(r) {');
  const b = page.indexOf('let COMMUNITY_MINE_EPOCH = 0;');
  assert.ok(a > 0 && b > a, 'the community mine functions moved: re-anchor this test');
  // eslint-disable-next-line no-new-func
  return new Function(page.slice(a, b) + '; return { communityMineWord, communityMineLabel };')();
}
function actual(f, fx) {
  return { rows: fx.rows.map((r) => [r.id, f.communityMineWord(r), f.communityMineLabel(r)]) };
}

test('#8959 the page words every fixture record exactly as expected.json says', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
  const got = actual(pageFunctions(), fx);
  const want = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  assert.deepEqual(got, want, 'the page now says:\n' + JSON.stringify(got));
});

test('#8959 control: a record with another state words differently', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
  fx.rows[0].state = 'pending';
  const want = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  assert.notDeepEqual(actual(pageFunctions(), fx), want);
});
