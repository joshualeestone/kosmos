'use strict';

/**
 * #3034: the default Kosmos setup-assistant seed.
 *
 * These pin the LOGIC of the once-ever, best-effort seed directly, with an
 * injected `createAgent` (so no real agent is launched) and an injected
 * `hasConnectedAccount` (so the account gate is exercised without real config).
 * The load-bearing controls are the DANGEROUS answers: it must NOT seed when
 * there is no connected account (a live agent would churn under KeepAlive), no
 * the runner refuses, or it was already seeded -- and it must NOT throw or
 * double-create. The positive case proves it DOES create, as Josh (#3034, his
 * 2026-09-24 ruling: his name and picture, labelled as his AI), in the `setup`
 * role, with the bundled picture when one ships and never the user's.
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
  assert.match(brief, /You are \*\*Dana\*\*, the Kosmos setup guide: an AI version of Josh/);
});

test('POSITIVE: connected account -> seeds as Josh (not the user), role setup, labelled as his AI', () => {
  you.save({ name: 'Testuser', does: 'runs things' });
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(setupAssistant.GUIDE_NAME, 'Josh');
  assert.equal(res.name, 'Josh');
  assert.equal(calls.length, 1, 'createAgent was not called exactly once');
  assert.equal(calls[0].name, 'Josh', 'the guide was named after the user, not Josh (#3034, 2026-09-24)');
  assert.equal(calls[0].role, 'setup', 'the assistant was not created in the setup role');
  assert.match(calls[0].purpose, /Josh's AI/);
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

test('no saved user name no longer blocks the seed: the guide is Josh either way', () => {
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(calls[0].name, 'Josh');
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

function avatarDirWith(file, bytes) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'guide-avatar-'));
  if (file) fs.writeFileSync(path.join(dir, file), bytes);
  return dir;
}

test('AVATAR: the bundled picture of Josh is copied onto the guide (best-effort)', () => {
  const dir = avatarDirWith(setupAssistant.GUIDE_AVATAR_BASE + '.png', PNG_1x1);
  assert.equal(setupAssistant.guideAvatarPath(dir), path.join(dir, setupAssistant.GUIDE_AVATAR_BASE + '.png'));
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED, avatarDir: dir });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(res.avatarCopied, true, 'the bundled picture should have been copied');
  assert.ok(store.avatarPath('Josh'), 'the guide has no avatar on disk after the copy');
});

test('AVATAR: the USER\'s picture is never used, and no bundled picture -> initials (not fatal)', () => {
  you.save({ name: 'Picuser', does: 'has a photo' });
  assert.ok(you.savePicture('image/png', PNG_1x1).ok, 'CONTROL: the user has a picture to (wrongly) copy');
  const calls = [];
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk(calls), hasConnectedAccount: CONNECTED, avatarDir: avatarDirWith(null) });
  assert.equal(res.seeded, true, res.reason || '');
  assert.equal(res.avatarCopied, false, 'the user\'s picture was put on Josh\'s guide');
  assert.equal(store.avatarPath('Josh'), null);
});

test('AVATAR: a file that is not an image is refused by the byte sniff, and the seed still succeeds', () => {
  const dir = avatarDirWith(setupAssistant.GUIDE_AVATAR_BASE + '.png', Buffer.from('not a picture at all'));
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk([]), hasConnectedAccount: CONNECTED, avatarDir: dir });
  assert.equal(res.seeded, true);
  assert.equal(res.avatarCopied, false);
});

test('AVATAR: the SHIPPED picture of Josh is present and passes the avatar store\'s byte sniff', () => {
  const shipped = setupAssistant.guideAvatarPath();
  assert.ok(shipped, 'no web/icons/setup-guide-avatar.* ships with the app');
  const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk([]), hasConnectedAccount: CONNECTED });
  assert.equal(res.avatarCopied, true, 'the shipped picture was refused by store.saveAvatar');
});

test('NAME: when "Josh" is taken, the seed falls back to "Josh AI"; any other refusal is not retried', () => {
  const calls = [];
  const takenThenOk = (opts) => {
    calls.push(opts);
    return opts.name === 'Josh'
      ? { outcome: create.OUTCOME.REFUSED, because: 'there is already an agent called josh. If it never came up, it is half made rather than missing.' }
      : { outcome: create.OUTCOME.CREATED, name: opts.name };
  };
  const res = setupAssistant.seedSetupAssistant({ createAgent: takenThenOk, hasConnectedAccount: CONNECTED });
  assert.equal(res.seeded, true, res.reason || '');
  assert.deepEqual(calls.map((c) => c.name), ['Josh', setupAssistant.GUIDE_FALLBACK_NAME]);
  assert.equal(res.name, 'Josh AI');
  // CONTROL: a refusal that is not a taken name stops at the first try.
  reset();
  const other = [];
  const r2 = setupAssistant.seedSetupAssistant({ createAgent: refused(other, 'we could not find Claude Code on this computer'), hasConnectedAccount: CONNECTED });
  assert.equal(r2.seeded, false);
  assert.equal(other.length, 1, 'a non-name refusal was retried under the fallback name');
});

test('MARKER: the seed marks the guide\'s own folder, and only that folder counts as the guide', () => {
  const instructions = require('./engine/instructions');
  const dir = path.dirname(instructions.fileFor('Josh'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    assert.equal(setupAssistant.isGuideFolder('Josh'), false, 'CONTROL: an unmarked folder is not the guide');
    const res = setupAssistant.seedSetupAssistant({ createAgent: createdOk([]), hasConnectedAccount: CONNECTED });
    assert.equal(res.marked, true);
    assert.equal(setupAssistant.isGuideFolder('Josh'), true);
    assert.equal(setupAssistant.isGuideFolder('Someone'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('guideName: null until seeded, then the name the seed recorded', () => {
  assert.equal(setupAssistant.guideName(), null);
  setupAssistant.markSetupAssistantSeeded({ name: 'Josh', via: 'test' });
  assert.equal(setupAssistant.guideName(), 'Josh');
  fs.writeFileSync(setupAssistant.flagPath(), '{not json');
  assert.equal(setupAssistant.guideName(), null, 'an unreadable flag names no guide');
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

test('SETTING: defaults to on and not yet asked; anything malformed reads as the default', () => {
  assert.deepEqual(setupAssistant.settingFrom({}), { on: true, asked: false });
  assert.deepEqual(setupAssistant.settingFrom(null), { on: true, asked: false });
  assert.deepEqual(setupAssistant.settingFrom({ setupAssistant: { on: 'no', asked: 1 } }), { on: true, asked: false });
  assert.deepEqual(setupAssistant.settingFrom({ setupAssistant: { on: false, asked: true } }), { on: false, asked: true });
});

test('SETTING: a patch sets one or both keys as booleans, and the other key is kept', () => {
  for (const bad of [null, [], {}, { on: 'false' }, { asked: 0 }, { on: true, extra: true }, 'on']) {
    assert.ok(setupAssistant.settingPatchProblem(bad), `${JSON.stringify(bad)} was accepted`);
  }
  assert.equal(setupAssistant.settingPatchProblem({ on: false }), null);
  assert.equal(setupAssistant.settingPatchProblem({ asked: true, on: true }), null);
  const stored = { setupAssistant: { on: false, asked: false } };
  assert.deepEqual(setupAssistant.mergeSetting(stored, { asked: true }), { on: false, asked: true }, 'setting asked turned the bubble back on');
  assert.deepEqual(setupAssistant.mergeSetting({}, { on: false }), { on: false, asked: false });
});
