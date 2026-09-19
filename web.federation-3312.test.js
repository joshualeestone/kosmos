'use strict';
/**
 * #3312 Federation UI: the Add-Project mode toggle, the invite mint, and the join/verify flow,
 * run from the page's real functions (lifted out of web/index.html, not a copy) against a small
 * document + fetch stub. These pin the CLIENT behaviour a node --test can see:
 *   - the mode toggle swaps create <-> join and tracks aria-checked,
 *   - a coordinator error reason maps to a person-facing sentence (never a leaked internal),
 *   - a successful verify shows the owner's read-only name/desc and records the edge,
 *   - an unreachable coordinator degrades to an honest "could not reach", never a fake success.
 * The end-to-end flow against the live /api/federation/* proxy is a browser-check follow-up once
 * those routes land (backend: ICK #3313 + Baron #3314).
 *
 *   node --test web.federation-3312.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

// Lift a run of the federation functions by name, with the module-scope state they share, into
// one Function scope (so PJ_JOIN_VERIFIED / PJ_FEDERATION_REF behave as they do on the page).
function lift(name) {
  // Include the `async ` keyword when present, or a lifted async function loses it and its
  // `await` becomes a SyntaxError.
  let start = SCRIPT.indexOf('async function ' + name);
  if (start < 0) start = SCRIPT.indexOf('function ' + name);
  assert.ok(start >= 0, name + ' is missing from the page');
  // bound at the next top-level "\n}" that closes the function
  const end = SCRIPT.indexOf('\n}', start);
  assert.ok(end > start, 'could not bound ' + name);
  return SCRIPT.slice(start, end + 2);
}

// A tiny element stub: records value/textContent/hidden/disabled/innerHTML and attributes.
function makeDoc(overrides) {
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      const o = els[id] = { id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
        _attr: {}, setAttribute(k, v) { this._attr[k] = String(v); }, getAttribute(k) { return this._attr[k]; },
        select() {}, focus() {} };
    }
    return els[id];
  };
  Object.assign(els, overrides || {});
  return { getElementById: el, _els: els };
}

function build(opts) {
  opts = opts || {};
  const src = [lift('pjFederationRef'), lift('pjSetAddMode'), lift('pjFedMessage'), lift('pjMintInvite'), lift('pjVerifyCode')].join('\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function('document', 'fetch', 'navigator', 'crypto', 'esc', 'LAST',
    'var PJ_FEDERATION_REF = null; var PJ_JOIN_VERIFIED = null; var PJ_JOIN_ADD_AGENTS = [];\n' + src +
    '\nreturn { pjSetAddMode, pjFedMessage, pjMintInvite, pjVerifyCode, get verified() { return PJ_JOIN_VERIFIED; }, ref: pjFederationRef };');
  const doc = makeDoc();
  const api = factory(doc, opts.fetch || (() => Promise.reject(new Error('no fetch'))), {}, { randomUUID: () => 'ref-123' }, (x) => String(x == null ? '' : x), opts.LAST || []);
  api.doc = doc;
  return api;
}

test('#3312: pjFedMessage maps every coordinator reason to a person-facing sentence, unknown -> fallback', () => {
  const s = build();
  assert.match(s.pjFedMessage({ reason: 'already-used' }), /already been used/i);
  assert.match(s.pjFedMessage({ reason: 'expired' }), /expired/i);
  assert.match(s.pjFedMessage({ reason: 'revoked' }), /withdrawn/i);
  assert.match(s.pjFedMessage({ reason: 'not-found' }), /not recognised/i);
  assert.match(s.pjFedMessage({ reason: 'self-join' }), /your own project/i);
  assert.match(s.pjFedMessage({ reason: 'double-join' }), /already on that project/i);
  assert.equal(s.pjFedMessage({ reason: 'weird-internal-thing' }, 'FALLBACK'), 'FALLBACK', 'an unknown reason leaks through instead of the safe fallback');
  assert.equal(s.pjFedMessage(null, 'FALLBACK'), 'FALLBACK');
});

test('#3312: the mode toggle swaps create <-> join and tracks aria-checked', () => {
  const s = build();
  s.pjSetAddMode('join');
  assert.equal(s.doc.getElementById('pj-create-mode').hidden, true);
  assert.equal(s.doc.getElementById('pj-join-mode').hidden, false);
  assert.equal(s.doc.getElementById('pj-mode-join').getAttribute('aria-checked'), 'true');
  assert.equal(s.doc.getElementById('pj-mode-create').getAttribute('aria-checked'), 'false');
  s.pjSetAddMode('create');
  assert.equal(s.doc.getElementById('pj-create-mode').hidden, false);
  assert.equal(s.doc.getElementById('pj-join-mode').hidden, true);
  assert.equal(s.doc.getElementById('pj-mode-create').getAttribute('aria-checked'), 'true');
});

test('#3312: a successful verify shows the read-only name/desc and records the edge', async () => {
  const s = build({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ edge_id: 'e1', project_name: 'Henderson Lease', project_desc: 'Renewing before October.', owner_handle: 'josh' }) }) });
  s.doc.getElementById('pj-join-code').value = 'a-code';
  await s.pjVerifyCode();
  assert.equal(s.doc.getElementById('pj-join-name').textContent, 'Henderson Lease');
  assert.equal(s.doc.getElementById('pj-join-desc').textContent, 'Renewing before October.');
  assert.equal(s.doc.getElementById('pj-join-result').hidden, false, 'the verified result stayed hidden');
  assert.equal(s.doc.getElementById('pj-join-err').textContent, '', 'an error was shown on a good verify');
  assert.ok(s.verified && s.verified.edge_id === 'e1', 'the edge was not recorded for the join step');
});

test('#3312: a verify with no code asks for one and never calls the coordinator', async () => {
  let called = false;
  const s = build({ fetch: () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({ edge_id: 'x' }) }); } });
  s.doc.getElementById('pj-join-code').value = '   ';
  await s.pjVerifyCode();
  assert.equal(called, false, 'an empty code still hit the network');
  assert.match(s.doc.getElementById('pj-join-err').textContent, /paste the code/i);
  assert.equal(s.doc.getElementById('pj-join-result').hidden, true);
});

test('#3312: a coordinator error reason is surfaced on verify; the result stays hidden', async () => {
  const s = build({ fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({ reason: 'expired' }) }) });
  s.doc.getElementById('pj-join-code').value = 'stale';
  await s.pjVerifyCode();
  assert.match(s.doc.getElementById('pj-join-err').textContent, /expired/i);
  assert.equal(s.doc.getElementById('pj-join-result').hidden, true);
  assert.equal(s.verified, null, 'a failed verify still recorded an edge');
});

test('#3312: an unreachable coordinator degrades to an honest message, never a fake success', async () => {
  const s = build({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  s.doc.getElementById('pj-join-code').value = 'anything';
  await s.pjVerifyCode();
  assert.match(s.doc.getElementById('pj-join-err').textContent, /could not reach/i);
  assert.equal(s.doc.getElementById('pj-join-result').hidden, true);
  assert.equal(s.verified, null);
});

test('#3312: mint shows the returned code, and an unreachable coordinator shows no fake code', async () => {
  const ok = build({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'THE-CODE-123', expires_at: 1 }) }) });
  ok.doc.getElementById('pj-name').value = 'Henderson lease';
  await ok.pjMintInvite('person');
  assert.equal(ok.doc.getElementById('pj-invite-code').value, 'THE-CODE-123');
  assert.equal(ok.doc.getElementById('pj-invite-panel').hidden, false, 'the invite panel stayed hidden');

  const down = build({ fetch: () => Promise.reject(new Error('down')) });
  down.doc.getElementById('pj-name').value = 'Henderson lease';
  await down.pjMintInvite('agent');
  assert.equal(down.doc.getElementById('pj-invite-code').value, '', 'a code appeared while the coordinator was unreachable');
  assert.match(down.doc.getElementById('pj-invite-status').textContent, /could not reach/i);
});
