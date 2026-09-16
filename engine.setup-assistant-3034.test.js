'use strict';

/**
 * #3034: the default Kosmos setup-assistant seed.
 *
 * These pin the LOGIC of the once-ever, best-effort seed directly, with an
 * injected `createAgent` (so no real agent is launched) and an injected
 * `hasConnectedAccount` (so the account gate is exercised without real config).
 * The load-bearing controls are the DANGEROUS answers: it must NOT seed when
 * there is no connected account (a live agent would churn under KeepAlive), no
 * saved user name, the runner refuses, or it was already seeded -- and it must
 * NOT throw or double-create. The positive case proves it DOES create, names the
 * agent after the user, uses the `setup` role, and copies the avatar.
 *
 *   node --test engine.setup-assistant-3034.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// A dedicated data sandbox, set before the modules resolve store.ROOT.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-setup-3034-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');

const setupAssistant = require('./engine/setup-assistant');
const roles = require('./engine/roles');
const you = require('./engine/you');
const store = require('./engine/store');
const create = require('./engine/create');

// A valid 1x1 PNG (so you.savePicture's byte-sniff accepts it).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64');

const CONNECTED = () => true;   // inject when the test wants to reach createAgent

function reset() {
  try { fs.rmSync(setupAssistant.flagPath(), { force: true }); } catch { /* ok */ }
  try { fs.rmSync(you.FILE, { force: true }); } catch { /* ok */ }
  try { fs.rmSync(path.join(store.ROOT, store.AVATARS_DIRNAME), { recursive: true, force: true }); } catch { /* ok */ }
  try { const p = you.picturePath(); if (p) fs.rmSync(p, { force: true }); } catch { /* ok */ }
}

const createdOk = (calls) => (opts) => { calls.push(opts); return { outcome: create.OUTCOME.CREATED, name: opts.name }; };
const refused = (calls, because) => (opts) => { calls.push(opts); return { outcome: create.OUTCOME.REFUSED, because }; };

test.beforeEach(reset);

test('the setup role exists, is menu:false, and is NOT offered in the normal create menu', () => {
  const role = roles.byKey('setup');
  assert.ok(role, 'the setup role is missing');
  assert.equal(role.menu, false, 'the setup role must be menu:false so it is never in the create flow');
  const inMenu = roles.ROLES.filter((r) => r.menu !== false).some((r) => r.key === 'setup');
  assert.equal(inMenu, false, 'the setup role leaked into the create menu');
  const brief = roles.instructionsFor('setup', 'Dana');
  assert.match(brief, /You are \*\*Dana\*\*, the Kosmos setup guide\./);
});

test('POSITIVE: saved user name + connected account -> seeds, named after the user, role setup', () => {
  you.save({ name: 'Testuser', does: 'runs things' });
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(res.name, 'Testuser');
  assert.equal(calls.length, 1, 'createAgent was not called exactly once');
  assert.equal(calls[0].name, 'Testuser', 'the assistant was not named after the user');
  assert.equal(calls[0].role, 'setup', 'the assistant was not created in the setup role');
});

test('CONTROL: no connected account -> does NOT seed and does NOT call createAgent (no churning dead agent)', () => {
  you.save({ name: 'Testuser', does: 'runs things' });
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: () => false });
  assert.equal(res.seeded, false);
  assert.match(res.reason, /no connected account/);
  assert.equal(calls.length, 0, 'createAgent must not run when no account is connected to run the agent on');
  assert.equal(setupAssistant.setupAssistantSeeded(), false, 'a skipped seed must leave NO flag');
});

test('CONTROL: no saved user name -> does NOT seed and does NOT call createAgent', () => {
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, false);
  assert.match(res.reason, /user name/);
  assert.equal(calls.length, 0, 'createAgent must not be called with no name to give the assistant');
});

test('CONTROL: the runner refuses (Claude Code absent) -> does NOT seed and writes NO flag', () => {
  you.save({ name: 'Testuser', does: 'runs things' });
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({
    createAgent: refused(calls, 'we could not find Claude Code on this computer'),
    hasConnectedAccount: CONNECTED,
  });
  assert.equal(res.seeded, false);
  assert.match(res.reason, /could not find Claude Code/, 'the refusal reason should be surfaced');
  assert.equal(calls.length, 1, 'it should have attempted the create');
  assert.equal(setupAssistant.setupAssistantSeeded(), false, 'a refused create must leave NO once-ever flag');
});

test('CONTROL: createAgent throwing is swallowed -- never propagates to break onboarding', () => {
  you.save({ name: 'Testuser', does: 'runs things' });
  let res;
  assert.doesNotThrow(() => {
    res = setupAssistant.seedSetupAssistant({ createAgent: () => { throw new Error('boom'); }, hasConnectedAccount: CONNECTED });
  });
  assert.equal(res.seeded, false);
  assert.match(res.reason, /create threw/);
});

test('ONCE-EVER: once the flag is written, a second seed is a no-op (createAgent not called again)', () => {
  you.save({ name: 'Testuser', does: 'runs things' });
  const calls = [];
  const first = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(first.seeded, true);
  setupAssistant.markSetupAssistantSeeded({ name: first.name, via: 'test' });
  assert.equal(setupAssistant.setupAssistantSeeded(), true);

  const second = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(second.seeded, false);
  assert.match(second.reason, /already seeded/);
  assert.equal(calls.length, 1, 'the second seed must not attempt another create');
});

test('AVATAR: the user picture is copied onto the created agent (best-effort)', () => {
  you.save({ name: 'Picuser', does: 'has a photo' });
  const saved = you.savePicture('image/png', PNG_1x1);
  assert.ok(saved.ok, 'the test fixture picture was not accepted: ' + (saved.because || ''));
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(res.avatarCopied, true, 'the user avatar should have been copied');
  assert.ok(store.avatarPath('Picuser'), 'the created agent has no avatar on disk after the copy');
});

test('AVATAR: no user picture -> still seeds, avatarCopied is false (not fatal)', () => {
  you.save({ name: 'Nopicuser', does: 'no photo' });
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(res.avatarCopied, false, 'there was no picture, so nothing should have been copied');
});

test('GATE (#3034, Josh 2026-09-16): first-run auto-create is OFF pending Josh direction', () => {
  // Josh flagged the assistant as prematurely indicated-complete and undirected.
  // server.js only wires the seed into first-run completion when this flag is true,
  // so it MUST default false: a flip to true ships the undirected behavior on the
  // next cut. The seed LOGIC above stays fully tested (design intact); this guards
  // only the shipping switch. Flip deliberately when Josh directs the design.
  assert.equal(setupAssistant.FIRSTRUN_AUTOCREATE_ENABLED, false,
    'the setup-assistant first-run auto-create must stay OFF until Josh directs it (#3034)');
});

test('WIRING GUARD (#3034): server.js seeds the assistant ONLY behind the flag', () => {
  // The GATE test above guards the flag's DEFAULT value. This guards the WIRING:
  // the real gate is server.js wrapping the seed call in the flag check, and if
  // someone removed/inverted that wrapper (restoring the old unconditional seed)
  // while the constant stayed false, the value test would still pass but the
  // undirected behavior would return. This reds on exactly that regression.
  // Structural rather than behavioral because seedSetupAssistant's real createAgent
  // dependency makes a server-level "no seed on first-run" test vacuous in a bare
  // sandbox (the seed skips for want of an account/runner regardless of the gate).
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const calls = src.match(/seedSetupAssistant\s*\(/g) || [];
  assert.equal(calls.length, 1,
    'expected exactly one seedSetupAssistant() call site in server.js, found ' + calls.length);
  assert.match(src, /if\s*\(\s*setupAssistant\.FIRSTRUN_AUTOCREATE_ENABLED\s*\)[\s\S]{0,600}?seedSetupAssistant\s*\(/,
    'the seedSetupAssistant() call in server.js is not guarded by FIRSTRUN_AUTOCREATE_ENABLED -- the gate wiring was removed or bypassed');
});
