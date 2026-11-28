'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8959 slice D2a: the iPhone's AI Models pill is the page's.
 *
 * The phone ports paintAccounts' connBadge chain to Swift (ios/Kosmos/ModelsLogic.swift). Its logic suite
 * (ios/LogicTests/run-models.sh) checks the port against ios/LogicTests/models/expected.json; this test checks that the
 * PAGE still produces exactly that file, by running the page's own chain (lifted out from `const noneWhy = ` to the
 * "#5407 (Josh): a Claude sign-in that needs signing in again soon" comment) on ios/LogicTests/models/fixture.json, with
 * the clock, locale and time zone pinned. So a change on either side fails one of the two.
 * If the page changes on purpose: run this test, copy the "actual" it prints into expected.json, then make the phone
 * match (run-models.sh).
 *   node --test web.models-ios-parity-8959.test.js */
process.env.TZ = 'America/Chicago'; // before any Date: the fixture's dates are Chicago days
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const dir = path.join(__dirname, 'ios', 'LogicTests', 'models');
const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));

function lift(startMark, endMark, what) {
  const a = page.indexOf(startMark);
  const b = page.indexOf(endMark, a);
  assert.ok(a > 0 && b > a, what + ' moved: re-anchor this test');
  return page.slice(a, b);
}

function pagePill() {
  const chain = lift('const noneWhy = ', '/* #5407 (Josh): a Claude sign-in that needs signing in again soon', 'the connBadge chain');
  // acctProvider reads the keyed providers' table, so it comes with it.
  const provider = lift('const ACCT_KEYED_ROUTE = ', '\n', 'ACCT_KEYED_ROUTE') + '\n'
    + lift('function acctProvider(', '\n}\n', 'acctProvider') + '\n}\n';
  const ago = lift('function agoWords(ms) {', '\n}\n', 'agoWords') + '\n}\n';
  const advWhen = lift('function loginAdvWhen(ms) {', '\n}\n', 'loginAdvWhen') + '\n}\n';
  // Every locale-dependent call must be one this pins, or the machine's locale leaks back in.
  const helpers = provider + ago + advWhen;
  const src = chain + helpers;
  const calls = (src.match(/toLocale[A-Za-z]*\(|Intl\.|localeCompare\(/g) || []).length;
  const pinnable = (src.match(/\.toLocale(?:Date|Time)String\((?:undefined|\[\])/g) || []).length;
  assert.equal(calls, pinnable, 'the chain calls something locale-dependent this test does not pin');
  const pin = (s) => s.replace(/\.toLocale(Date|Time)String\((?:undefined|\[\])/g, ".toLocale$1String('" + fixture.locale + "'");
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // isKeyed and canCheckSignIn only choose a tooltip's wording, which the phone does not show.
  // eslint-disable-next-line no-new-func
  // The helpers are declared once, then the per-row function runs the chain (a const used before its line would throw).
  return new Function('esc', pin(helpers) + '\nreturn function (a) { const isOpenai = acctProvider(a) === "openai"; const isKeyed = false; '
    + 'const canCheckSignIn = false; let connBadge; ' + pin(chain).replace(/^\s*let connBadge;\s*$/m, '') + '; return connBadge; };')(esc);
}

// The pill's visible words and its tone, read from the span the page builds.
function read(html) {
  const tone = (html.match(/class="acct-(connected|loginok|unverified|none|unknown)\b/) || [])[1] || '';
  const words = html.replace(/<span class="vh">[\s\S]*?<\/span>/g, '').replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return { words, tone };
}

function actual() {
  const realNow = Date.now;
  Date.now = () => fixture.nowMs;
  const RealDate = Date;
  // `new Date()` with no argument is the pinned clock too (loginAdvWhen's today, the chain's "this year").
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixture.nowMs])); } static now() { return fixture.nowMs; } };
  try {
    const pill = pagePill();
    return fixture.rows.map((r) => Object.assign({ name: r.name }, read(pill(r.account))));
  } finally {
    // eslint-disable-next-line no-global-assign
    Date = RealDate;
    Date.now = realNow;
  }
}

test('#8959 D2a: the page draws each fixture row\'s pill exactly as expected.json says (and the phone is checked against the same file)', () => {
  const got = actual();
  assert.equal(got.length, fixture.rows.length);
  assert.ok(got.length >= 20, 'the fixture covers every case of the chain');
  const file = path.join(dir, 'expected.json');
  if (!fs.existsSync(file)) { console.log('actual:\n' + JSON.stringify(got, null, 1)); assert.fail('no expected.json yet: the actual is printed above'); }
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (JSON.stringify(got) !== JSON.stringify(want)) console.log('actual:\n' + JSON.stringify(got, null, 1));
  assert.deepEqual(got, want);
});

test('#8959 D2a: every row draws a tone and some words (the lift is not silently empty)', () => {
  for (const r of actual()) {
    assert.ok(r.tone, r.name + ': no tone');
    assert.ok(r.words.length > 3, r.name + ': no words');
  }
});
