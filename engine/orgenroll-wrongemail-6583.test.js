'use strict';
/**
 * kosmos#6583 (S-11): an org invite bound to one address, tried from an account with another, is refused by the
 * coordinator as `org_wrong_email`. Seen live 2026-11-06 (Testville, a bound invite tried from a test board): the board
 * had no sentence for that code and told the person "could not be checked through Kosmos+ just now ... try again in a
 * minute", which never works. The refusal line below is the one that board logged, word for word.
 *
 *   node --test engine/orgenroll-wrongemail-6583.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const org = require('./orgenroll');

const LIVE = 'Error: Kosmos+ refused this Mac: this invite was made for a different email address; sign in with the address it was sent to, or ask your company for a new link (HTTP 403 on /v1/mac/org/redeem, code org_wrong_email)';
const said = (because) => ({ macRequest: async () => ({ ok: false, because }) });
function root(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orgwrongemail-6583-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }

test('kosmos#6583: a bound invite refused as org_wrong_email is said as that, on preview and on enroll, naming no address', async (t) => {
  const a = root(t);
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote: said(LIVE) });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'org_wrong_email', 'the live refusal was not recognised');
  assert.equal(p.because, org.SAY.org_wrong_email);
  assert.doesNotMatch(p.because, /try again in a minute|could not be checked/, 'a refusal that never changes was said as a passing failure');
  const e = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: said(LIVE) });
  assert.equal(e.code, 'org_wrong_email');
  assert.equal(e.because, org.SAY.org_wrong_email);
});

test('kosmos#6583 CONTROL: org_wrong_domain keeps its own sentence, and an unknown refusal is still the fixed fallback', async (t) => {
  const a = root(t);
  const d = await org.preview('ACME-JOIN-1234', { root: a, remote: said('403 org_wrong_domain') });
  assert.deepEqual([d.code, d.because], ['org_wrong_domain', org.SAY.org_wrong_domain]);
  assert.notEqual(org.SAY.org_wrong_email, org.SAY.org_wrong_domain);
  const odd = await org.preview('ACME-JOIN-1234', { root: a, remote: said('the tunnel program did not answer in time') });
  assert.equal(odd.code, null);
  assert.match(odd.because, /could not be checked through Kosmos\+/);
});

test('kosmos#6583 review 1: a company pilot with no free seat is said as that, on preview and on enroll', async (t) => {
  const a = root(t);
  const line = "Error: Kosmos+ refused this Mac: your company's Kosmos+ pilot has no free seat; ask the people who run your company's accounts to free one or add seats (HTTP 403 on /v1/mac/org/redeem, code org_pilot_full)";
  const p = await org.preview('ACME-JOIN-1234', { root: a, remote: said(line) });
  assert.deepEqual([p.code, p.because], ['org_pilot_full', org.SAY.org_pilot_full]);
  assert.doesNotMatch(p.because, /try again in a minute/);
  const e = await org.enroll('ACME-JOIN-1234', true, { root: a, remote: said(line) });
  assert.deepEqual([e.code, e.because], ['org_pilot_full', org.SAY.org_pilot_full]);
});

test('kosmos#6583: the wrong-address sentence names no company, so a family hears it as it is', () => {
  assert.doesNotMatch(org.SAY.org_wrong_email, /company|family/i);
});
