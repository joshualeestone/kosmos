'use strict';
/**
 * #3312 Federation UI: the Add-Project mode toggle, the invite mint, and the join/verify flow,
 * run from the page's real functions (lifted out of web/index.html, not a copy) against a small
 * document + fetch stub. These pin the CLIENT behaviour a node --test can see:
 *   - the mode toggle (native radios) swaps create <-> join,
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
  // Lift the join picker (pjJoinPickOptions/pjPaintJoinAgents) + addAgentsHtml it delegates to, so
  // the join-mode own-agent picker is covered like the create-mode one.
  const src = [lift('pjFederationRef'), lift('pjSpin'), lift('pjSetAddMode'), lift('pjFedMessage'),
    lift('pjMintInvite'), lift('pjVerifyCode'), lift('pjJoinSubmit'), lift('pjResetFederation'), lift('pjCopyInvite'),
    lift('addAgentsHtml'), lift('pjJoinPickOptions'), lift('pjPaintJoinAgents')].join('\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function('document', 'fetch', 'navigator', 'crypto', 'esc', 'LAST', 'pjFieldBad', 'loadProjects', 'openProject', 'pjView', 'roleLine', 'ROLE_TITLES', 'discTint', 'discInk', 'initials', 'PJ_ADD_AGENTS',
    'var PJ_FEDERATION_REF = null; var PJ_JOIN_VERIFIED = null; var PJ_JOIN_ADD_AGENTS = []; var PJ_COPY_TIMER = null;\n' + src +
    '\nreturn { pjSetAddMode, pjFedMessage, pjMintInvite, pjVerifyCode, pjJoinSubmit, pjResetFederation, pjCopyInvite, pjJoinPickOptions, pjPaintJoinAgents, get verified() { return PJ_JOIN_VERIFIED; }, get joinAgents() { return PJ_JOIN_ADD_AGENTS; }, get copyTimer() { return PJ_COPY_TIMER; }, setVerified: (v) => { PJ_JOIN_VERIFIED = v; }, setJoinAgents: (a) => { PJ_JOIN_ADD_AGENTS = a; }, ref: pjFederationRef };');
  const doc = makeDoc();
  const fieldBadCalls = [];
  const opened = [];
  const nav = { loadedProjects: 0, listShown: 0 };
  const api = factory(doc, opts.fetch || (() => Promise.reject(new Error('no fetch'))), opts.navigator || {}, { randomUUID: () => 'ref-123' }, (x) => String(x == null ? '' : x), opts.LAST || [],
    (id, errId, msg) => fieldBadCalls.push({ id, errId, msg }),
    () => { nav.loadedProjects += 1; return Promise.resolve(); },
    (id) => opened.push(id),
    (which) => { if (which === 'list') nav.listShown += 1; },
    () => '', {}, () => '#000', () => '#fff', (n) => String(n || '').slice(0, 2), []);
  api.fieldBadCalls = fieldBadCalls;
  api.opened = opened;
  api.nav = nav;
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
  assert.match(s.pjFedMessage({ reason: 'not-owner' }), /Only the owner of this project can invite people to it\./, 'kosmos#4649: the invite sheet\'s 409 not-owner');
  // kosmos#4649 slice B: Withdraw's two 409s. `joined` is the board's sentence; `unsupported` is shown as the
  // board wrote it, with the lapse date the screen adds (Kitty's Q-K2), and as given when there is no date.
  assert.equal(s.pjFedMessage({ reason: 'joined', error: 'The board said so.' }, 'fb', { change: true }), 'The board said so.', 'kosmos#4649: Withdraw\'s 409 joined shows the board\'s sentence as given');
  assert.equal(s.pjFedMessage({ reason: 'joined' }, 'fb', { change: true }), 'Someone already joined with this code. Remove them instead.', 'kosmos#4649: Withdraw\'s 409 joined with no sentence falls back to the page\'s');
  assert.equal(s.pjFedMessage({ reason: 'unsupported', error: 'Withdraw is not available on this coordinator.' }, 'fb', { lapses: 'Oct 11', change: true }),
    'Withdraw is not available on this coordinator.', 'kosmos#4649: an unsupported sentence that does not end "lapses." is shown as given, with no date glued on');
  const unsupported = { reason: 'unsupported', error: 'Kosmos cannot withdraw a code yet. This one stops working on its own when it lapses.' };
  assert.equal(s.pjFedMessage(unsupported, 'FALLBACK', { lapses: 'Oct 11', change: true }), 'Kosmos cannot withdraw a code yet. This one stops working on its own when it lapses on Oct 11.', 'kosmos#4649: Withdraw\'s 409 unsupported carries the lapse date');
  assert.equal(s.pjFedMessage(unsupported, 'FALLBACK', { change: true }), unsupported.error, 'kosmos#4649: with no date the board\'s sentence is shown as given');
  // Control: any other caller (no opts.change) keeps the contract, an unknown reason gets its own fallback.
  assert.equal(s.pjFedMessage(unsupported, 'FALLBACK'), 'FALLBACK', 'kosmos#4649: outside Remove/Withdraw, unsupported is not shown raw');
  assert.equal(s.pjFedMessage({ reason: 'joined', error: 'The board said so.' }, 'FALLBACK'), 'FALLBACK', 'kosmos#4649: outside Remove/Withdraw, joined gets the caller\'s own fallback');
  assert.equal(s.pjFedMessage({ reason: 'joined' }, 'FALLBACK'), 'FALLBACK', 'kosmos#4649: a joiner never reads the owner\'s "Remove them instead."');
  assert.equal(s.pjFedMessage({ reason: 'weird-internal-thing' }, 'FALLBACK'), 'FALLBACK', 'an unknown reason leaks through instead of the safe fallback');
  assert.equal(s.pjFedMessage(null, 'FALLBACK'), 'FALLBACK');
});

test('#3312: the mode toggle swaps create <-> join and sets the native radio checked state', () => {
  const s = build();
  s.pjSetAddMode('join');
  assert.equal(s.doc.getElementById('pj-create-mode').hidden, true);
  assert.equal(s.doc.getElementById('pj-join-mode').hidden, false);
  assert.equal(s.doc.getElementById('pj-mode-join').checked, true);
  assert.equal(s.doc.getElementById('pj-mode-create').checked, false);
  s.pjSetAddMode('create');
  assert.equal(s.doc.getElementById('pj-create-mode').hidden, false);
  assert.equal(s.doc.getElementById('pj-join-mode').hidden, true);
  assert.equal(s.doc.getElementById('pj-mode-create').checked, true);
  assert.equal(s.doc.getElementById('pj-mode-join').checked, false);
});

test('#3312: minting with an empty project name shows the inline name error and never calls the coordinator', async () => {
  let called = false;
  const s = build({ fetch: () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'x' }) }); } });
  s.doc.getElementById('pj-name').value = '   ';
  await s.pjMintInvite('person');
  assert.equal(called, false, 'an unnamed project still hit the coordinator');
  assert.ok(s.fieldBadCalls.some((c) => c.id === 'pj-name' && c.msg === 'Give this project a name.'),
    'the mint empty-name error is missing or not the exact Create-path copy');
  assert.equal(s.doc.getElementById('pj-invite-code').value, '', 'a code slot was populated for an unnamed project');
});

test('#3312: pjResetFederation clears every federation surface (no stale state leaks across opens)', async () => {
  const s = build({ navigator: { clipboard: { writeText: () => Promise.resolve() } } });
  // dirty every surface a prior open could leave behind
  s.doc.getElementById('pj-invite-code').value = 'OLD-CODE';
  s.doc.getElementById('pj-invite-status').textContent = 'old status';
  s.doc.getElementById('pj-invite-panel').hidden = false;
  s.doc.getElementById('pj-join-code').value = 'old-join';
  s.doc.getElementById('pj-join-result').hidden = false;
  s.setVerified({ edge_id: 'stale' });
  s.pjResetFederation();
  assert.equal(s.doc.getElementById('pj-invite-code').value, '', 'a stale invite code survived reset');
  assert.equal(s.doc.getElementById('pj-invite-status').textContent, '', 'a stale invite status survived reset');
  assert.equal(s.doc.getElementById('pj-invite-panel').hidden, true, 'the invite panel stayed open after reset');
  assert.equal(s.doc.getElementById('pj-join-code').value, '', 'a stale join code survived reset');
  assert.equal(s.doc.getElementById('pj-join-result').hidden, true, 'a stale verified result survived reset');
  assert.equal(s.verified, null, 'a stale verified edge survived reset');
  assert.equal(s.doc.getElementById('pj-create-mode').hidden, false, 'reset did not return to create mode');
});

test('#3312: pjCopyInvite copies the code and swaps the button to "Copied"', async () => {
  let copiedText = null;
  const s = build({ navigator: { clipboard: { writeText: (t) => { copiedText = t; return Promise.resolve(); } } } });
  s.doc.getElementById('pj-invite-code').value = 'THE-CODE-9';
  await s.pjCopyInvite();
  assert.equal(copiedText, 'THE-CODE-9', 'the code was not written to the clipboard');
  assert.equal(s.doc.getElementById('pj-invite-copy').textContent, 'Copied', 'the button did not confirm the copy');
  assert.match(s.doc.getElementById('pj-invite-status').textContent, /copied/i, 'the copy was not announced in the aria-live status region');
});

test('#3312: pjCopyInvite with no code does nothing', async () => {
  let called = false;
  const s = build({ navigator: { clipboard: { writeText: () => { called = true; return Promise.resolve(); } } } });
  s.doc.getElementById('pj-invite-code').value = '';
  await s.pjCopyInvite();
  assert.equal(called, false, 'an empty code was still copied');
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

test('#3312: join submit on success loads projects and opens the joined project', async () => {
  const s = build({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ project: { id: 'p9' } }) }) });
  s.setVerified({ edge_id: 'e1', project_name: 'X' });
  await s.pjJoinSubmit();
  assert.equal(s.nav.loadedProjects, 1, 'projects were not reloaded after joining');
  assert.deepEqual(s.opened, ['p9'], 'the joined project was not opened');
});

test('#3312: join submit with no verified edge does nothing and never calls the coordinator', async () => {
  let called = false;
  const s = build({ fetch: () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'x' }) }); } });
  // PJ_JOIN_VERIFIED is null (no verify happened)
  await s.pjJoinSubmit();
  assert.equal(called, false, 'join hit the network with no verified edge');
  assert.deepEqual(s.opened, [], 'a project was opened with no verified edge');
});

test('#3312: a coordinator error on join is surfaced and NEVER navigates (no fake success)', async () => {
  const s = build({ fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({ reason: 'revoked' }) }) });
  s.setVerified({ edge_id: 'e1' });
  await s.pjJoinSubmit();
  assert.match(s.doc.getElementById('pj-join-msg').textContent, /withdrawn/i);
  assert.deepEqual(s.opened, [], 'a failed join still navigated into a project');
  assert.equal(s.nav.loadedProjects, 0, 'a failed join still reloaded projects');
});

test('#3312: an unreachable coordinator on join degrades honestly and NEVER navigates', async () => {
  const s = build({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  s.setVerified({ edge_id: 'e1' });
  await s.pjJoinSubmit();
  assert.match(s.doc.getElementById('pj-join-msg').textContent, /could not reach/i);
  assert.deepEqual(s.opened, [], 'a network failure on join still navigated');
  assert.equal(s.nav.loadedProjects, 0);
});

// LAST agents built via property assignment: fixture-discipline forbids a `sessionName`-key literal.
const mkAgent = (sessionName, name) => { const a = {}; a.sessionName = sessionName; a.name = name; return a; };

test('#3312: reset cancels a pending copy-revert timer and restores the copy button (no cross-open clobber)', async () => {
  const s = build({ navigator: { clipboard: { writeText: () => Promise.resolve() } } });
  s.doc.getElementById('pj-invite-code').value = 'C1';
  await s.pjCopyInvite();
  assert.notEqual(s.copyTimer, null, 'copy did not arm a revert timer');
  s.pjResetFederation();
  assert.equal(s.copyTimer, null, 'reset did not cancel the copy revert timer');
  assert.equal(s.doc.getElementById('pj-invite-copy').textContent, 'Copy', 'reset did not restore the copy button label');
});

test('#3312: the join agent picker lists only unpicked agents and disables the button (with a title) when none are free', () => {
  const s = build({ LAST: [mkAgent('a', 'Ava'), mkAgent('b', 'Bo')] });
  s.setJoinAgents(['a']);
  s.pjJoinPickOptions();
  const html = s.doc.getElementById('pj-join-pick').innerHTML;
  assert.match(html, /value="b"/, 'an unpicked agent is missing from the join picker');
  assert.doesNotMatch(html, /value="a"/, 'a picked agent is offered again in the join picker');
  assert.equal(s.doc.getElementById('pj-join-add-agent').disabled, false, 'the button is disabled while an agent is free');
  s.setJoinAgents(['a', 'b']);
  s.pjJoinPickOptions();
  assert.equal(s.doc.getElementById('pj-join-add-agent').disabled, true, 'the button is not disabled when nobody is left to add');
  assert.match(s.doc.getElementById('pj-join-add-agent').title || '', /already on it/i, 'no disabled title, unlike the create-mode picker');
});

test('#3312: the join picked-agents list renders the empty state when nobody is added', () => {
  const s = build({ LAST: [mkAgent('a', 'Ava')] });
  s.setJoinAgents([]);
  s.pjPaintJoinAgents();
  assert.match(s.doc.getElementById('pj-join-agents').innerHTML, /No agents on it yet\./);
});

// kosmos#4649 slice C: every "copy it yourself" line names this computer's keys through copyKeysWord/copyKeysGlyph.
// Outside those two helpers the page holds no hard-coded copy keys, Mac or Windows, in these spellings: Command C,
// Command+C, Command-C, Cmd C/+C/-C, Control C/+C/-C, the Command glyph (literal, its \u2318 escape, &#8984; or
// &#x2318; entity, with or without a + or -), and Ctrl C/+C/-C. So pjCopyInvite, pjsOwnCopy and the sheet cannot go
// back to one platform's keys without this failing (no browser arm renders the two older refusals). A spelling not
// listed here is not caught.
test('#4649 copy keys: no hard-coded copy keys outside copyKeysWord/copyKeysGlyph', () => {
  const KEYS = /(?:Command[ +-]?C|Cmd[ +-]?C|Control[ +-]?C|⌘\s?[+-]?C|\\u2318\s?[+-]?C|Ctrl[ +-]?C)(?![a-z])|&#8984;|&#x2318;/gi;   // (?![a-z]): not ctrl-click
  const helpers = PAGE.match(/^function copyKeysWord\(\)[^\n]*\n^function copyKeysGlyph\(\)[^\n]*$/m);
  assert.ok(helpers, 'the two helpers sit together as one-liners');
  // Control: the pattern does find the helpers' own four keys, so a zero below is a real zero.
  assert.equal((helpers[0].match(KEYS) || []).length, 4, 'the pattern finds the helpers’ own four keys');
  const rest = PAGE.replace(helpers[0], '');
  // Comments that NAME the keys are allowed; any string literal or text holding them is not.
  const ONE = new RegExp(KEYS.source, 'i');
  const lines = rest.split('\n').filter((l) => ONE.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l));
  assert.deepEqual(lines, [], 'hard-coded copy keys outside the helpers');
});

// kosmos#4649 slice B: the From outside rows, from the page's own functions (no browser). Which rows show, their
// keys, and what each offers (none of Withdraw or Make a new code when the board could not check who joined).
function buildRows() {
  const src = [lift('esc'), lift('fedRowKey'), lift('fedOutsideRows'), lift('fedShortDate'), lift('fedDiscLetters'), lift('fedOutsideRowHtml')].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('FED_BUSY', 'FED_MSGS', src + '\nreturn { fedRowKey, fedOutsideRows, fedOutsideRowHtml };')(new Set(), {});
}
test('#4649 slice B: which outside rows show, and their keys', () => {
  const { fedOutsideRows, fedRowKey } = buildRows();
  const rows = fedOutsideRows({ invites: [
    { invite_id: 'a', label: 'Dana', state: 'joined', edge_id: 'e1' },
    { invite_id: 'b', label: 'Lee', state: 'pending' },
    { invite_id: 'c', label: 'Lee', state: 'expired' },     // a newer code for Lee is pending: the expired one goes
    { invite_id: 'd', label: 'Old', state: 'expired' },     // nothing newer: it stays, to be made again
    { invite_id: 'e', label: 'Gone', state: 'withdrawn' },
    { invite_id: 'f', label: 'Out', state: 'removed', edge_id: 'e2' },
    null, 'junk',
  ] });
  assert.deepEqual(rows.map(fedRowKey), ['e:e1', 'i:b', 'i:d']);
  // "Newer": an older joined Dana does not hide a later Dana code that lapsed; a newer pending one does.
  const dana = (extra) => fedOutsideRows({ invites: [
    { invite_id: 'j', label: 'Dana', state: 'joined', edge_id: 'e9', made_at: 100 },
    { invite_id: 'x', label: 'Dana', state: 'expired', made_at: 300 }].concat(extra || []) }).map(fedRowKey);
  assert.deepEqual(dana(), ['e:e9', 'i:x']);
  assert.deepEqual(dana([{ invite_id: 'p', label: 'Dana', state: 'pending', made_at: 400 }]), ['e:e9', 'i:p']);
  // The boundary: a code made in the SAME second as the expired one counts as newer ("made at or after it").
  assert.deepEqual(dana([{ invite_id: 'q', label: 'Dana', state: 'pending', made_at: 300 }]), ['e:e9', 'i:q']);
  assert.deepEqual(fedOutsideRows({}), []);
  assert.deepEqual(fedOutsideRows(null), []);
});
test('#4649 slice B: each row offers its action, and none of Withdraw or Make a new code when unchecked', () => {
  const { fedOutsideRowHtml } = buildRows();
  const joined = { invite_id: 'a', label: 'Dana Ruiz', state: 'joined', edge_id: 'e1', kind: 'person' };
  const pending = { invite_id: 'b', label: 'Lee <b>Park</b>', state: 'pending', kind: 'person' };
  const expired = { invite_id: 'c', label: 'Old Friend', state: 'expired', kind: 'agent' };
  assert.match(fedOutsideRowHtml(joined, false), /data-fed-act="remove"[^>]*aria-label="Remove Dana Ruiz"/);
  assert.match(fedOutsideRowHtml(pending, false), /data-fed-act="withdraw"[^>]*aria-label="Withdraw the code for Lee &lt;b&gt;Park&lt;\/b&gt;"/);
  assert.match(fedOutsideRowHtml(expired, false), /data-fed-act="renew"[^>]*aria-label="Make a new code for Old Friend"/);
  assert.ok(!/<b>Park<\/b>/.test(fedOutsideRowHtml(pending, false)), 'a label is escaped');
  // Unchecked: Remove stays (the person did join); Withdraw and Make a new code go.
  assert.match(fedOutsideRowHtml(joined, true), /data-fed-act="remove"/);
  assert.ok(!/fedout-act/.test(fedOutsideRowHtml(pending, true)) && !/fedout-act/.test(fedOutsideRowHtml(expired, true)));
});
test('#4649 slice B: Remove and Withdraw get the owner-list sentences, not the invite sheet\'s or the joiner\'s', () => {
  const s = build();
  assert.equal(s.pjFedMessage({ reason: 'not-owner' }, 'x', { change: true }), 'Only the owner of this project can change who is in it.');
  // Control: without the flag, the invite sheet and the joiner keep their own sentences.
  assert.equal(s.pjFedMessage({ reason: 'not-owner' }, 'x'), 'Only the owner of this project can invite people to it.');
  assert.equal(s.pjFedMessage({ reason: 'self-shared' }, 'x', { change: true }), 'This project is shared with your other computers, so its outside members cannot be changed here.');
  assert.match(s.pjFedMessage({ reason: 'self-shared' }, 'x'), /cannot be shared with other people yet/);
});
