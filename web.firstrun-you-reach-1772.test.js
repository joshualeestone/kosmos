'use strict';

/**
 * kosmos#1772: the first-run About-you step writes into EVERY agent instruction
 * file on the machine (via you.syncEveryone), but its reach was invisible at the
 * moment of the action -- no confirmation, no indication. A QA walk that typed
 * "QA walk" into the fields silently reconfigured the whole fleet for minutes.
 *
 * This pins the cheapest fix from the card: say what it will do, before it does
 * it. A reach statement sits next to Continue (the control that triggers the
 * write) and names the reach. It also pins that the statement is TRUE -- the
 * /api/you PUT really does reach every agent -- so the copy cannot drift into a
 * false claim if the write is ever narrowed.
 *
 *   node --test web.firstrun-you-reach-1772.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { scriptOf } = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

const at = SCRIPT.indexOf('id="fr-you-reach"');
const REACH = at > -1 ? SCRIPT.slice(at, at + 200) : '';

test('kosmos#1772: the About-you step states its fleet-wide reach next to Continue', () => {
  assert.ok(at > -1, 'the reach statement element (#fr-you-reach) is present in the About-you markup');
  assert.match(REACH, /every agent already set up on this computer/i,
    'it names the reach: every agent on this computer, not just the current install');
  assert.match(REACH, /\bContinue\b/,
    'it ties the reach to Continue, the control that triggers the write');
});

test('kosmos#1772: the reach claim is TRUE -- saving About-you writes every agent', () => {
  // The copy claims "every agent"; the /api/you PUT calls syncEveryone, which
  // writes every tied agent in the roster. Pin that so a future narrowing of the
  // write would surface the copy as newly false rather than silently.
  const anchor = "pathname === '/api/you' && req.method === 'PUT'";
  const putAt = SERVER.indexOf(anchor);
  assert.ok(putAt > -1, 'the /api/you PUT handler exists');
  const put = SERVER.slice(putAt, putAt + 1600);
  assert.match(put, /you\.syncEveryone\(/,
    'the About-you save reaches every agent via syncEveryone, so "every agent" is a true claim, not decoration');
});

test('kosmos#1772: no em dash in the reach copy (house rule)', () => {
  for (const s of ['—', '&mdash;', '&#8212;', '&#x2014;', '\\u{2014}']) {
    assert.ok(!REACH.includes(s), 'an em dash (' + s + ') reached the reach copy');
  }
});
