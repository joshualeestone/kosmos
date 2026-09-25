'use strict';

/**
 * #3034: the default Kosmos setup-assistant seed.
 *
 * These pin the LOGIC of the once-ever, best-effort seed directly, with an
 * injected `createAgent` (so no real agent is launched) and an injected
 * `hasConnectedAccount` (so the account gate is exercised without real config).
 * The load-bearing controls are the DANGEROUS answers: it must NOT seed when
 * there is no connected account (a live agent would churn under KeepAlive),
 * when the runner refuses, or when it was already seeded -- and it must NOT throw or
 * double-create. The positive case proves it DOES create, as Josh (#3034, his
 * 2026-09-24 ruling: his name and picture, labelled as his AI), in the `setup`
 * role, with the bundled picture when one ships and never the user's.
 *
 *   node --test engine.setup-assistant-3034.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// A dedicated sandbox for EVERY root, set before the modules resolve them. The
// workers root and HOME too: this file resolves instructions.fileFor('Josh') and
// deletes that folder in a finally, and an unset workers root falls back to the real
// ~/work/workers (review round 2 BLOCKER: it would have deleted a real agent "josh").
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-setup-3034-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
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
  assert.equal(other.length, 1, 'a non-name refusal must stop at the first try, not retry under the fallback name');
});

test('MARKER: the seed marks the guide\'s own folder, and only that folder counts as the guide', () => {
  const instructions = require('./engine/instructions');
  const dir = path.dirname(instructions.fileFor('Josh'));
  assert.ok(dir.startsWith(SANDBOX + path.sep), `the guide folder resolved OUTSIDE the sandbox: ${dir}`);
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

test('GATE (#3034/#3660): the automatic guide is ON, created when a model is connected (Splinter 19:06 on Josh\'s direction)', () => {
  // Gated off 2026-09-16 pending Josh; direction since (16:05, 18:07) and Splinter's call on
  // #3660 (19:06): create it the moment the first model connects, never at Giddy Up without one.
  // Pinned so a flip either way is a deliberate edit to this line and the comment it names.
  assert.equal(setupAssistant.FIRSTRUN_AUTOCREATE_ENABLED, true);
});

test('WIRING GUARD (#3034/#3660): server.js creates the guide only through ensureGuide, only behind the switch, and arms only at Giddy Up', () => {
  // Structural, because a real first-run in a bare sandbox skips for want of an account
  // regardless of the wiring. Reds if a direct seed call comes back, if any ensureGuide call
  // loses its switch, or if arming moves off first-run completion (which would arm existing
  // installs and put an agent on every board).
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.equal((src.match(/seedSetupAssistant\s*\(/g) || []).length, 0, 'server.js seeds directly, bypassing ensureGuide');
  const calls = [...src.matchAll(/setupAssistant\.ensureGuide\s*\(/g)];
  assert.equal(calls.length, 2, 'expected the Giddy Up call and the sweep, found ' + calls.length);
  for (const c of calls) {
    const before = src.slice(Math.max(0, c.index - 900), c.index);
    assert.match(before, /if\s*\(\s*setupAssistant\.FIRSTRUN_AUTOCREATE_ENABLED\s*\)/, 'an ensureGuide call is not behind FIRSTRUN_AUTOCREATE_ENABLED');
  }
  const arms = [...src.matchAll(/setupAssistant\.armSetupAssistant\s*\(/g)];
  assert.equal(arms.length, 1, 'arming must happen in exactly one place');
  const route = src.lastIndexOf("pathname === '/api/first-run/complete'", arms[0].index);
  assert.ok(route > 0 && arms[0].index - route < 4000, 'arming is not in the first-run completion route');
});

/* ---- #3660: created the moment the first model is connected ---------------- */

const MODELS = (rows) => ({ listFor: (mod) => rows[mod] || [], connectable: async () => ({ ok: true }), liveDefault: async () => true });

test('listedModels: every listed account in provider order, a named one by its dir, a default as null, with a fingerprint', () => {
  const none = setupAssistant.listedModels({ listFor: () => [] });
  assert.deepEqual(none, { rows: [], fingerprint: '' });
  const got = setupAssistant.listedModels({ listFor: (mod) => ({
    './grokaccounts': [{ dir: '/h/.grok', isDefault: true, authMode: 'subscription' }],
    './openaiaccounts': [{ dir: '/h/.codex-work', isDefault: false }],
  }[mod] || []) });
  assert.deepEqual(got.rows.map((r) => [r.provider, r.account, r.authMode]),
    [['openai', '/h/.codex-work', null], ['xai', null, 'subscription']], 'provider order is Claude, OpenAI, Gemini, Grok');
  assert.equal(got.fingerprint, 'openai:/h/.codex-work::/|xai:/h/.grok:subscription:/');
  // WHO is in it: a new key (keyTail) or a different sign-in (email) in the same folder changes it.
  const fp = (row) => setupAssistant.listedModels({ listFor: (mod) => (mod === './geminiaccounts' ? [row] : []) }).fingerprint;
  assert.notEqual(fp({ dir: '/h/.gemini', isDefault: true, keyTail: 'aaaa' }), fp({ dir: '/h/.gemini', isDefault: true, keyTail: 'bbbb' }));
  assert.notEqual(fp({ dir: '/h/.claude', isDefault: true, email: 'a@x' }), fp({ dir: '/h/.claude', isDefault: true, email: 'b@x' }));
});

test('usable: create\'s gate decides; a DEFAULT Gemini or Grok KEY is also live-checked, a subscription or a Claude default is not asked twice', async () => {
  const checked = [];
  const live = (alive) => async (mod, dir) => { checked.push([mod, dir]); return alive; };
  const row = (provider, mod, dir, isDefault, authMode) => ({ provider, mod, dir, account: isDefault ? null : dir, authMode: authMode || null });
  const open = async () => ({ ok: true });
  assert.equal(await setupAssistant.usable(row('anthropic', './accounts', '/h/.claude', true), { connectable: async () => ({ ok: false }), liveDefault: live(true) }), false, 'a dead sign-in (the gate) is not usable');
  assert.equal(await setupAssistant.usable(row('google', './geminiaccounts', '/h/.gemini', true), { connectable: open, liveDefault: live(false) }), false, 'a rejected default Gemini key was usable');
  assert.deepEqual(checked, [['./geminiaccounts', '/h/.gemini']]);
  assert.equal(await setupAssistant.usable(row('google', './geminiaccounts', '/h/.gemini', true), { connectable: open, liveDefault: live(true) }), true, 'CONTROL: a live default key is usable');
  checked.length = 0;
  assert.equal(await setupAssistant.usable(row('xai', './grokaccounts', '/h/.grok', true, 'subscription'), { connectable: open, liveDefault: live(false) }), true);
  assert.equal(await setupAssistant.usable(row('anthropic', './accounts', '/h/.claude', true), { connectable: open, liveDefault: live(false) }), true);
  assert.equal(await setupAssistant.usable(row('google', './geminiaccounts', '/h/.gemini-k', false), { connectable: open, liveDefault: live(false) }), true, 'a NAMED key is create\'s gate to check, not this one');
  assert.deepEqual(checked, [], 'a subscription, a Claude default or a named key was live-checked again');
});

test('ensureGuide: picks the first USABLE model in provider order, skipping a dead one ahead of it', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const calls = [];
    const deps = { listFor: (mod) => ({ './accounts': [{ dir: '/h/.claude', isDefault: true }], './geminiaccounts': [{ dir: '/h/.gemini-k', isDefault: false }], './grokaccounts': [{ dir: '/h/.grok', isDefault: true }] }[mod] || []),
      connectable: async ({ provider }) => ({ ok: provider !== 'anthropic' }), liveDefault: async () => true };
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps });
    assert.equal(r.seeded, true, r.reason || '');
    assert.deepEqual(calls.map((c) => [c.provider, c.account]), [['google', '/h/.gemini-k']]);
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

function armed(on) {
  if (on) setupAssistant.armSetupAssistant(); else fs.rmSync(setupAssistant.armPath(), { force: true });
}

test('ensureGuide: an UNARMED install (set up before this shipped) never gets a guide, even with a model connected', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(false);
  const calls = [];
  const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] }) });
  assert.equal(r.seeded, false);
  assert.match(r.reason, /not armed/);
  assert.equal(calls.length, 0, 'an agent was put on an existing board');
});

test('ensureGuide: armed but no model yet creates nothing; the first connected model creates it ON that model, once', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const calls = [];
    const none = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: MODELS({}) });
    assert.equal(none.seeded, false);
    assert.match(none.reason, /no model/);
    assert.equal(calls.length, 0, 'created without a model (it could not run)');
    const conn = MODELS({ './openaiaccounts': [{ dir: '/h/.codex-work', isDefault: false }] });
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), via: 'model-connected', deps: conn });
    assert.equal(r.seeded, true, r.reason || '');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, 'openai', 'the guide was not created on the model that was connected');
    assert.equal(calls[0].account, '/h/.codex-work');
    assert.equal(setupAssistant.setupAssistantSeeded(), true, 'the once-ever flag was not written');
    const again = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn });
    assert.match(again.reason, /already seeded/);
    assert.equal(calls.length, 1, 'a second guide was created');
  } finally { armed(false); }
});

test('ensureGuide: single-flight (Giddy Up and a sweep together make one guide) and a refusal backs off', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const calls = [];
    const conn = MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] });
    const [a, b] = await Promise.all([
      setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn }),
      setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn }),
    ]);
    assert.equal(calls.length, 1, 'two guides from two concurrent triggers');
    assert.equal(a.seeded && b.seeded, true, 'both callers see the one result');
    // A refusal: the next try waits RETRY_AFTER_MS, then tries again.
    reset(); armed(true); setupAssistant.resetEnsureGuideForTests();
    const tries = [];
    const t0 = 1_000_000;
    const r1 = await setupAssistant.ensureGuide({ createAgent: refused(tries, 'we could not find Claude Code on this computer'), now: t0, deps: conn });
    assert.equal(r1.seeded, false);
    const r2 = await setupAssistant.ensureGuide({ createAgent: refused(tries, 'x'), now: t0 + 60 * 1000, deps: conn });
    assert.match(r2.reason, /waiting/);
    assert.equal(tries.length, 1, 'retried inside the back-off');
    await setupAssistant.ensureGuide({ createAgent: refused(tries, 'x'), now: t0 + setupAssistant.RETRY_AFTER_MS + 1, deps: conn });
    assert.equal(tries.length, 2, 'CONTROL: it does try again after the back-off');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: a listed but DEAD sign-in backs off too (the live check is the cost), and the back-off grows', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    let checks = 0;
    const dead = { listFor: (mod) => (mod === './accounts' ? [{ dir: '/h/.claude', isDefault: true }] : []),
      connectable: async () => { checks += 1; return { ok: false }; } };
    const calls = [];
    const t0 = 5_000_000;
    const r1 = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0, deps: dead });
    assert.match(r1.reason, /listed but none could run/);
    assert.equal(checks, 1);
    const r2 = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + 60 * 1000, deps: dead });
    assert.match(r2.reason, /waiting/);
    assert.equal(checks, 1, 'a dead sign-in was checked live again inside the back-off');
    // Second failure after the first wait; the NEXT wait doubles.
    const t1 = t0 + setupAssistant.RETRY_AFTER_MS + 1;
    await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t1, deps: dead });
    assert.equal(checks, 2);
    await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t1 + setupAssistant.RETRY_AFTER_MS + 1, deps: dead });
    assert.equal(checks, 2, 'the back-off did not grow after a second failure');
    await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t1 + 2 * setupAssistant.RETRY_AFTER_MS + 1, deps: dead });
    assert.equal(checks, 3, 'CONTROL: it tries again once the doubled wait has passed');
    assert.equal(calls.length, 0, 'an agent was created on a dead sign-in');
    assert.ok(setupAssistant.RETRY_MAX_MS <= 24 * 60 * 60 * 1000, 'the back-off is capped at a day');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: connecting a NEW account skips the back-off (the guide comes the moment a model is connected)', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const rows = { './accounts': [{ dir: '/h/.claude', isDefault: true }] };
    const deps = { listFor: (mod) => rows[mod] || [], liveDefault: async () => true,
      connectable: async ({ provider }) => ({ ok: provider !== 'anthropic' }) };   // the Claude sign-in is dead
    const calls = [];
    const t0 = 9_000_000;
    await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0, deps });
    await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + setupAssistant.RETRY_AFTER_MS + 1, deps });
    const waiting = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + setupAssistant.RETRY_AFTER_MS + 120 * 1000, deps });
    assert.match(waiting.reason, /waiting/, 'CONTROL: with nothing new listed, the grown back-off holds');
    rows['./openaiaccounts'] = [{ dir: '/h/.codex-work', isDefault: false }];   // they add a working OpenAI key
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + setupAssistant.RETRY_AFTER_MS + 180 * 1000, deps });
    assert.equal(r.seeded, true, 'a newly connected model waited out an old back-off: ' + r.reason);
    assert.equal(calls[0].provider, 'openai');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: a NEW key in the SAME folder skips the back-off and resets it; Giddy Up never waits', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    let key = 'dead';
    const deps = { listFor: (mod) => (mod === './geminiaccounts' ? [{ dir: '/h/.gemini', isDefault: true, keyTail: key }] : []),
      connectable: async () => ({ ok: true }), liveDefault: async () => key !== 'dead' };
    const calls = [];
    const t0 = 20_000_000;
    await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0, deps });
    const held = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + 60 * 1000, deps });
    assert.match(held.reason, /waiting/, 'CONTROL: the same dead key waits');
    // Giddy Up during the wait still tries (still dead, so still no guide, but it did not wait).
    const giddy = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + 90 * 1000, via: 'first-run', deps });
    assert.doesNotMatch(giddy.reason, /waiting/, 'Giddy Up was made to wait');
    key = 'good';   // they paste a working key in the same place
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), now: t0 + 120 * 1000, deps });
    assert.equal(r.seeded, true, 'a new key in the same folder waited out the old back-off: ' + r.reason);
    assert.ok(setupAssistant.RETRY_MAX_MS <= 60 * 60 * 1000, 'the wait is capped at an hour');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: both names taken stops at the first model (no live check paid on the next)', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    let checks = 0;
    const deps = { listFor: (mod) => ({ './accounts': [{ dir: '/h/.claude', isDefault: true }], './openaiaccounts': [{ dir: '/h/.codex-work', isDefault: false }] }[mod] || []),
      connectable: async () => { checks += 1; return { ok: true }; }, liveDefault: async () => true };
    const taken = [];
    const r = await setupAssistant.ensureGuide({ createAgent: refused(taken, 'there is already an agent called josh-ai.'), deps });
    assert.equal(r.seeded, false);
    assert.equal(checks, 1, 'a name refusal went on to live-check the next model');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: a create refused on the first model tries the NEXT connected model', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const conn = MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }], './openaiaccounts': [{ dir: '/h/.codex-work', isDefault: false }] });
    const calls = [];
    const claudeMissing = (opts) => { calls.push(opts); return (opts.provider || 'anthropic') === 'anthropic'
      ? { outcome: create.OUTCOME.REFUSED, because: 'we could not find Claude Code on this computer' }
      : { outcome: create.OUTCOME.CREATED, name: opts.name }; };
    const r = await setupAssistant.ensureGuide({ createAgent: claudeMissing, deps: conn });
    assert.equal(r.seeded, true, r.reason || '');
    assert.deepEqual(calls.map((c) => c.provider || 'anthropic'), ['anthropic', 'openai'], 'a working second model was stranded');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: if the seeded flag cannot be written, the next tick still makes no second guide', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  const flag = setupAssistant.flagPath();
  const root = path.dirname(flag);
  try {
    fs.rmSync(flag, { force: true });
    fs.chmodSync(root, 0o555);   // the store folder is read-only: the flag write fails, nothing sits at its path
    const conn = MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] });
    const calls = [];
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn });
    assert.equal(r.seeded, true);
    assert.equal(setupAssistant.markSetupAssistantSeeded({ name: 'x' }), false, 'CONTROL: the flag write really fails');
    assert.equal(setupAssistant.setupAssistantSeeded(), false, 'CONTROL: nothing on disk says seeded, so only the latch can stop a second');
    const again = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn });
    assert.match(again.reason, /already seeded/);
    assert.equal(calls.length, 1, 'a failed flag write let a second guide be created');
  } finally { fs.chmodSync(root, 0o755); fs.rmSync(flag, { recursive: true, force: true }); armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: "Don\'t show this again" (setupAssistant.on false) also means no guide agent later', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const calls = [];
    const conn = MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] });
    const off = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: { ...conn, settings: { setupAssistant: { on: false, asked: true } } } });
    assert.match(off.reason, /turned setup assistance off/);
    assert.equal(calls.length, 0);
    const on = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: { ...conn, settings: { setupAssistant: { on: true, asked: true } } } });
    assert.equal(on.seeded, true, 'CONTROL: switched back on, it is created');
  } finally { armed(false); setupAssistant.resetEnsureGuideForTests(); }
});

test('ensureGuide: under dry run (test boards) it is off unless AGENT_WORKFORCE_SETUP_GUIDE=on', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  const had = { dry: process.env.AGENT_WORKFORCE_DRY_RUN, on: process.env.AGENT_WORKFORCE_SETUP_GUIDE };
  try {
    const conn = MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] });
    process.env.AGENT_WORKFORCE_DRY_RUN = '1';
    delete process.env.AGENT_WORKFORCE_SETUP_GUIDE;
    const calls = [];
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn });
    assert.match(r.reason, /switched off/);
    assert.equal(calls.length, 0);
    process.env.AGENT_WORKFORCE_SETUP_GUIDE = 'on';
    const r2 = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: conn });
    assert.equal(r2.seeded, true, 'CONTROL: the explicit test switch turns it back on');
  } finally {
    if (had.dry === undefined) delete process.env.AGENT_WORKFORCE_DRY_RUN; else process.env.AGENT_WORKFORCE_DRY_RUN = had.dry;
    if (had.on === undefined) delete process.env.AGENT_WORKFORCE_SETUP_GUIDE; else process.env.AGENT_WORKFORCE_SETUP_GUIDE = had.on;
    armed(false); setupAssistant.resetEnsureGuideForTests();
  }
});

test('ensureGuide: the switch off means nothing automatic at all', async () => {
  setupAssistant.resetEnsureGuideForTests();
  armed(true);
  try {
    const calls = [];
    const r = await setupAssistant.ensureGuide({ createAgent: createdOk(calls), deps: { ...MODELS({ './accounts': [{ dir: '/h/.claude', isDefault: true }] }), enabled: false } });
    assert.match(r.reason, /switched off/);
    assert.equal(calls.length, 0);
  } finally { armed(false); }
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
