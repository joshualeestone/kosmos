'use strict';

/*
 * kosmos#1921 -- the Settings account badge renders VERIFIED liveness from the
 * server-computed connection.badge (engine/observed), not the stored-login state
 * alone. Source-text pins for the render mapping (this file's convention for
 * web/index.html paint functions, matching web.accounts-badge.test.js), PLUS a real
 * execution of the agoWords age formatter.
 *
 *   node --test web.badge-observed-1921.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

// Extract and execute the standalone agoWords formatter (no DOM deps).
const agoSrc = PAGE.match(/function agoWords\(ms\) \{[\s\S]*?\n\}/);
assert.ok(agoSrc, 'agoWords() moved or was renamed');
// eslint-disable-next-line no-eval
const agoWords = eval('(' + agoSrc[0] + ')');

test('agoWords: a missing / negative / non-number age is the empty string, never a fabricated "just now"', () => {
  assert.equal(agoWords(null), '');
  assert.equal(agoWords(undefined), '');
  assert.equal(agoWords(NaN), '');
  assert.equal(agoWords(-5), '', 'a negative (clock-skew) age must not read as fresh');
  assert.equal(agoWords('12000'), '', 'a string is not a number');
});

test('agoWords: rounds DOWN at every step', () => {
  assert.equal(agoWords(0), 'just now');
  assert.equal(agoWords(4999), 'just now');
  assert.equal(agoWords(5000), '5 seconds ago');
  assert.equal(agoWords(89000), '89 seconds ago');
  assert.equal(agoWords(90000), '1 minute ago');
  assert.equal(agoWords(119000), '1 minute ago');
  assert.equal(agoWords(120000), '2 minutes ago');
  // minutes run to 89 before the hour band opens (mins < 90), mirroring freshWords.
  assert.equal(agoWords(3600000), '60 minutes ago');
  assert.equal(agoWords(5400000), '1 hour ago');
});

test('paintAccounts keys the badge on connection.badge and reads observedAgeMs', () => {
  const start = PAGE.indexOf('async function paintAccounts');
  assert.ok(start >= 0, 'paintAccounts moved or was renamed');
  const end = PAGE.indexOf('\nasync function', start + 1);
  const fn = PAGE.slice(start, end > start ? end : PAGE.length);

  assert.match(fn, /const badge = a\.connection && a\.connection\.badge;/, 'the badge is not read from connection.badge');
  assert.match(fn, /a\.connection && a\.connection\.observedAgeMs/, 'the observed age is not read');
  assert.match(fn, /agoWords\(/, 'the age is not formatted with agoWords');
});

test('the five badge states each render, and only "working" is green', () => {
  const start = PAGE.indexOf('async function paintAccounts');
  const end = PAGE.indexOf('\nasync function', start + 1);
  const fn = PAGE.slice(start, end > start ? end : PAGE.length);

  // working -> the green (pulsing) class.
  const working = fn.match(/badge === 'working'\)\s*\{([\s\S]*?)\}\s*else if/);
  assert.ok(working, "the 'working' branch is missing");
  assert.match(working[1], /acct-connected/, "working is not rendered with the green acct-connected class");

  // rejected -> the negative class.
  const rejected = fn.match(/badge === 'rejected'\)\s*\{([\s\S]*?)\}\s*else if/);
  assert.ok(rejected, "the 'rejected' branch is missing");
  assert.match(rejected[1], /acct-none/, 'rejected is not the negative class');
  assert.match(rejected[1], /Not connected/, 'rejected does not say Not connected');

  // 🔑 THE HONESTY PIN: signed_in_unverified (a credential exists but was never
  // observed working) must NOT be green -- this is the exact false-green #874/#1921
  // remove. It renders the muted class and says it was not recently checked.
  const unver = fn.match(/badge === 'signed_in_unverified'\)\s*\{([\s\S]*?)\}\s*else if/);
  assert.ok(unver, "the 'signed_in_unverified' branch is missing");
  assert.doesNotMatch(unver[1], /acct-connected/, 'a merely-existing credential is rendered GREEN -- the #874 false green is back');
  assert.match(unver[1], /acct-unknown/, 'signed_in_unverified is not the muted class');
  assert.match(unver[1], /not recently checked/, 'signed_in_unverified does not tell the person it was not recently checked');

  assert.match(fn, /badge === 'signed_out'/, "the 'signed_out' branch is missing");
  assert.match(fn, /badge === 'unchecked'/, "the 'unchecked' branch is missing");
});

test('back-compat: a payload without connection.badge still renders the legacy state ternary', () => {
  const start = PAGE.indexOf('async function paintAccounts');
  const end = PAGE.indexOf('\nasync function', start + 1);
  const fn = PAGE.slice(start, end > start ? end : PAGE.length);
  // The legacy connected/none/unknown ternary must survive as the else fallback so a
  // version skew (new page, old server) never blanks the badge.
  assert.match(fn, /a\.connection\.state === 'connected'/, 'the legacy connected fallback is gone');
  assert.match(fn, /a\.connection\.state === 'none'/, 'the legacy none fallback is gone');
});
