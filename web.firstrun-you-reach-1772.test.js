'use strict';

/**
 * kosmos#1772 (REVERSED by Josh, live, 2026-09-04): the first-run About-you step
 * used to carry a reach statement next to Continue -- "Continue saves this into
 * every agent already set up on this computer, so they all address you the same
 * way." #1772 added it so the fleet-wide write was not invisible. Josh watched
 * it in a live test and ruled it out: "that is nonsense copy... take that out."
 *
 * So this file now pins the REMOVAL (the copy must not come back), and keeps the
 * one part of #1772 that is still true and worth guarding independently of the
 * copy: the /api/you PUT really does reach every agent, so if the reach is ever
 * surfaced again it cannot be a false claim.
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

test('kosmos#1772 reversed: the About-you reach copy is gone (Josh, 2026-09-04)', () => {
  assert.equal(SCRIPT.indexOf('id="fr-you-reach"'), -1,
    'the #fr-you-reach statement is present again; Josh removed it as "nonsense copy"');
  assert.doesNotMatch(SCRIPT, /Continue saves this into every agent already set up on this computer/,
    'the removed reach copy is back in the About-you step');
});

test('kosmos#1772: the About-you save still reaches every agent (syncEveryone)', () => {
  // The reach is still TRUE even though the copy is gone: the /api/you PUT calls
  // syncEveryone, which writes every tied agent in the roster. Kept so that if
  // the write is ever narrowed, or the copy re-surfaced, the claim can be
  // checked against reality rather than assumed.
  const anchor = "pathname === '/api/you' && req.method === 'PUT'";
  const putAt = SERVER.indexOf(anchor);
  assert.ok(putAt > -1, 'the /api/you PUT handler exists');
  const put = SERVER.slice(putAt, putAt + 1600);
  assert.match(put, /you\.syncEveryone\(/,
    'the About-you save reaches every agent via syncEveryone');
});
