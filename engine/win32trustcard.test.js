'use strict';
/**
 * #3013: the board-card engine path -- which known-owned Windows agents are stuck
 * at Claude Code's invisible workspace-trust prompt. Every arm drives waiting()
 * over INJECTED seams (no schtasks, no real sessions dir, no `claude agents
 * --json`), so it is green on any host: the win32-specific facts (the job list,
 * the account config, the sessions dir) arrive through the seams as data.
 *
 *   node --test engine/win32trustcard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const card = require('./win32trustcard');

/* A sessions stub with the two methods waiting() reads: the ownership record and
   the id gate. validId mirrors win32sessions' charset gate closely enough for the
   test's synthetic ids. */
function sessionsStub(record) {
  return {
    read: () => record || {},
    validId: (id) => typeof id === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(id),
  };
}

/* A job stub: a known fleet, plus per-name enabled/spec answers. Anything not in
   the maps answers "not registered", which waiting() must skip. */
function jobStub(names, enabled, specs) {
  return {
    list: () => ({ known: true, names: new Set(names) }),
    taskEnabled: (name) => enabled[name] || { known: true, registered: false },
    taskSpec: (name) => specs[name] || { known: true, registered: false },
  };
}
const EN = (enabled) => ({ known: true, registered: true, enabled });
const SPEC = (cwd, configDir) => ({ known: true, registered: true, spec: { cwd, configDir: configDir || null } });

test('#3013 a known-owned, enabled, not-registered agent with an untrusted folder + a stuck .key is needs_trust', () => {
  const out = card.waiting({
    job: jobStub(['alice'], { alice: EN(true) }, { alice: SPEC('C:\\work\\alice', 'C:\\cfg\\alice') }),
    sessions: sessionsStub({}),
    live: [],                                   // nothing registered
    trustCheck: () => false,                    // folder explicitly NOT trusted
    detect: () => true,                         // a lone unregistered .key sits there
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'alice');
  assert.equal(out[0].needsTrust, true, 'an explicit untrusted folder gets the strong claim');
  assert.match(out[0].because, /workspace-trust prompt no one can see/);
  assert.match(out[0].because, /not recorded as trusted/, 'the strong wording names the untrusted folder');
});

test('#3013 folderTrusted null (config unreadable) + a stuck .key is still surfaced, but HEDGED', () => {
  const out = card.waiting({
    job: jobStub(['alice'], { alice: EN(true) }, { alice: SPEC('C:\\work\\alice', 'C:\\cfg\\alice') }),
    sessions: sessionsStub({}),
    live: [],
    trustCheck: () => null,                     // we could not read the config
    detect: () => true,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].needsTrust, false, 'a null trust read must not make the strong untrusted claim');
  assert.match(out[0].because, /most likely waiting at a workspace-trust prompt/);
  assert.doesNotMatch(out[0].because, /not recorded as trusted/, 'null falls back to the hedged wording');
});

test('#3013 a TRUSTED folder is a slow start, not a trust hang -- excluded', () => {
  const out = card.waiting({
    job: jobStub(['alice'], { alice: EN(true) }, { alice: SPEC('C:\\work\\alice', 'C:\\cfg\\alice') }),
    sessions: sessionsStub({}),
    live: [],
    trustCheck: () => true,                     // folder is recorded trusted
    detect: () => true,
  });
  assert.deepEqual(out, []);
});

test('#3013 no stuck .key (detector false) -> no claim, however untrusted', () => {
  const out = card.waiting({
    job: jobStub(['alice'], { alice: EN(true) }, { alice: SPEC('C:\\work\\alice', 'C:\\cfg\\alice') }),
    sessions: sessionsStub({}),
    live: [],
    trustCheck: () => false,
    detect: () => false,                        // nothing started-but-unregistered in the dir
  });
  assert.deepEqual(out, []);
});

test('#3013 a live/registered owned agent is excluded even if its folder reads untrusted', () => {
  const out = card.waiting({
    job: jobStub(['alice'], { alice: EN(true) }, { alice: SPEC('C:\\work\\alice', 'C:\\cfg\\alice') }),
    // the record maps a live sessionId to alice; the live list carries that id
    sessions: sessionsStub({ 'sess-1': { name: 'alice' } }),
    live: [{ sessionId: 'sess-1' }],
    trustCheck: () => false,
    detect: () => true,
  });
  assert.deepEqual(out, [], 'an agent registered under a recorded session is not stuck');
});

test('#3013 a DISABLED (or unregistered) task is intentionally off, not stuck', () => {
  const out = card.waiting({
    job: jobStub(
      ['off', 'gone'],
      { off: EN(false), gone: { known: true, registered: false } },
      { off: SPEC('C:\\work\\off', 'C:\\cfg\\off'), gone: SPEC('C:\\work\\gone', null) },
    ),
    sessions: sessionsStub({}),
    live: [],
    trustCheck: () => false,
    detect: () => true,
  });
  assert.deepEqual(out, [], 'a switched-off or unregistered task never reads as trust-waiting');
});

test('#3013 fails closed: a job list we could not enumerate claims nothing', () => {
  const out = card.waiting({
    job: { list: () => ({ known: false }), taskEnabled: () => EN(true), taskSpec: () => SPEC('C:\\w', 'C:\\c') },
    sessions: sessionsStub({}),
    live: [],
    trustCheck: () => false,
    detect: () => true,
  });
  assert.deepEqual(out, []);
});

test('#3013 fails closed: a null live look claims nothing (an agent we cannot confirm live might be live)', () => {
  const out = card.waiting({
    job: jobStub(['alice'], { alice: EN(true) }, { alice: SPEC('C:\\work\\alice', 'C:\\cfg\\alice') }),
    sessions: sessionsStub({}),
    live: null,                                 // `claude agents --json` could not be read
    trustCheck: () => false,
    detect: () => true,
  });
  assert.deepEqual(out, []);
});

test('#3013 the default account (no configDir) is classified as a default-account agent', () => {
  let sawDefault = null;
  const out = card.waiting({
    job: jobStub(['deffy'], { deffy: EN(true) }, { deffy: SPEC('C:\\work\\deffy', null) }),
    sessions: sessionsStub({}),
    live: [],
    trustCheck: (cwd, configDir) => { sawDefault = { cwd, configDir }; return false; },
    detect: () => true,
  });
  assert.equal(out.length, 1);
  assert.equal(sawDefault.cwd, 'C:\\work\\deffy');
  assert.equal(sawDefault.configDir, null, 'a default-account agent passes configDir null to the trust check');
});

test('#3013 several agents: only the stuck, untrusted, not-registered, enabled ones come back, in list order', () => {
  const out = card.waiting({
    job: jobStub(
      ['live1', 'trusted1', 'stuck1', 'young1', 'stuck2'],
      {
        live1: EN(true), trusted1: EN(true), stuck1: EN(true), young1: EN(true), stuck2: EN(true),
      },
      {
        live1: SPEC('C:\\w\\live1', 'C:\\c'), trusted1: SPEC('C:\\w\\trusted1', 'C:\\c'),
        stuck1: SPEC('C:\\w\\stuck1', 'C:\\c'), young1: SPEC('C:\\w\\young1', 'C:\\c'),
        stuck2: SPEC('C:\\w\\stuck2', null),
      },
    ),
    sessions: sessionsStub({ 'id-live1': { name: 'live1' } }),
    live: [{ sessionId: 'id-live1' }],
    trustCheck: (cwd) => (cwd.endsWith('trusted1') ? true : false),
    detect: (configDir) => true,                // pretend every account has a stuck .key
  });
  // live1 registered; trusted1 trusted; young1 would need detect=false to exclude
  // -- here detect is always true, so young1 IS included (it is untrusted+not-registered).
  assert.deepEqual(out.map((o) => o.name), ['stuck1', 'young1', 'stuck2']);
});
