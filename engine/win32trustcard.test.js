'use strict';
/**
 * #3013: the board-card diagnosis engine path -- is a known-owned, enabled,
 * not-live Windows agent waiting at Claude Code's invisible workspace-trust prompt?
 * Every arm drives diagnose() over INJECTED seams (no schtasks, no real sessions
 * dir, no trust config), so it is green on any host: the win32-specific facts arrive
 * through the seams as data.
 *
 *   node --test engine/win32trustcard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const card = require('./win32trustcard');

/* A job stub exposing ONLY cachedTaskSpec (the #2717 cache diagnose is allowed to
   use) plus counting shims for the uncached calls it must NOT make. */
function jobStub(spec, counters) {
  const c = counters || {};
  return {
    cachedTaskSpec: (name) => { c.cachedTaskSpec = (c.cachedTaskSpec || 0) + 1; return spec; },
    taskEnabled: () => { c.taskEnabled = (c.taskEnabled || 0) + 1; return { known: true, registered: true, enabled: true }; },
    taskSpec: () => { c.taskSpec = (c.taskSpec || 0) + 1; return spec; },
    list: () => { c.list = (c.list || 0) + 1; return { known: true, names: new Set() }; },
  };
}
/* cachedTaskSpec now carries the enabled flag (#3013); default it true, pass false
   for a switched-off task. */
const SPEC = (cwd, configDir, enabled) => ({ known: true, registered: true, enabled: enabled !== false, spec: { cwd, configDir: configDir || null } });

test('#3013 an untrusted folder + a stuck .key is the strong workspace-trust diagnosis', () => {
  const d = card.diagnose('alice', {
    job: jobStub(SPEC('C:\\work\\alice', 'C:\\cfg\\alice')),
    trustCheck: () => false,      // folder explicitly NOT trusted
    detect: () => true,           // a lone unregistered .key sits there
  });
  assert.ok(d, 'a stuck, untrusted agent should be diagnosed');
  assert.match(d.because, /workspace-trust prompt no one can see/);
  assert.match(d.because, /not recorded as trusted/, 'the strong wording names the untrusted folder');
});

test('#3013 folderTrusted null (config unreadable) + a stuck .key is diagnosed, but HEDGED', () => {
  const d = card.diagnose('alice', {
    job: jobStub(SPEC('C:\\work\\alice', 'C:\\cfg\\alice')),
    trustCheck: () => null,       // we could not read the config
    detect: () => true,
  });
  assert.ok(d);
  assert.match(d.because, /most likely waiting at a workspace-trust prompt/);
  assert.doesNotMatch(d.because, /not recorded as trusted/, 'null falls back to the hedged wording');
});

test('#3013 a TRUSTED folder is a slow start, not a trust hang -- no diagnosis', () => {
  const d = card.diagnose('alice', {
    job: jobStub(SPEC('C:\\work\\alice', 'C:\\cfg\\alice')),
    trustCheck: () => true,
    detect: () => true,
  });
  assert.equal(d, null);
});

test('#3013 no stuck .key (detector false) -> no claim, however untrusted', () => {
  const d = card.diagnose('alice', {
    job: jobStub(SPEC('C:\\work\\alice', 'C:\\cfg\\alice')),
    trustCheck: () => false,
    detect: () => false,
  });
  assert.equal(d, null);
});

test('#3013 a SWITCHED-OFF task is intentionally off, not stuck -- no diagnosis', () => {
  /* The round-2 must-fix: a disabled Windows agent (untrusted folder, aged lone
     .key) must NOT read as "waiting at a trust prompt" -- the person turned it off.
     The enabled flag rides cachedTaskSpec (win32-correct, not the darwin-only
     create.disabledJobs). */
  const d = card.diagnose('offy', {
    job: jobStub(SPEC('C:\\work\\offy', 'C:\\cfg\\offy', false)),   // enabled:false
    trustCheck: () => false,
    detect: () => true,
  });
  assert.equal(d, null, 'a switched-off task must never be diagnosed as trust-waiting');
});

test('#3013 fails closed: an UNREADABLE enabled flag is no diagnosis', () => {
  /* If the task XML did not yield an enabled setting, cachedTaskSpec carries
     enabled:undefined -- never claim a trust hang about a task we cannot confirm is on. */
  const d = card.diagnose('mystery', {
    job: jobStub({ known: true, registered: true, enabled: undefined, spec: { cwd: 'C:\\w', configDir: 'C:\\c' } }),
    trustCheck: () => false,
    detect: () => true,
  });
  assert.equal(d, null);
});

test('#3013 fails closed: an unreadable/unregistered task spec is no diagnosis', () => {
  assert.equal(card.diagnose('alice', {
    job: jobStub({ known: false }), trustCheck: () => false, detect: () => true,
  }), null, 'a task we could not read makes no claim');
  assert.equal(card.diagnose('alice', {
    job: jobStub({ known: true, registered: false }), trustCheck: () => false, detect: () => true,
  }), null, 'a task with no registration makes no claim');
});

test('#3013 the default account (no configDir) is classified as a default-account agent', () => {
  let saw = null;
  card.diagnose('deffy', {
    job: jobStub(SPEC('C:\\work\\deffy', null)),
    trustCheck: (cwd, configDir) => { saw = { cwd, configDir }; return false; },
    detect: () => true,
  });
  assert.equal(saw.cwd, 'C:\\work\\deffy');
  assert.equal(saw.configDir, null, 'a default-account agent passes configDir null to the trust check');
});

test('#3013 (SPAWN SHAPE) diagnose reads config ONLY through the #2717 cache, never the uncached calls', () => {
  /* 🛑 THE PERF GUARD (#2717 / round-1 must-fix). The board calls this per offline
     agent on the 5s poll. The regression it must never re-introduce is calling the
     UNCACHED win32job.taskEnabled + raw win32job.taskSpec (two schtasks /Query /XML
     spawns of identical XML, per agent, per poll). diagnose must read cwd/configDir
     ONLY through cachedTaskSpec (the cache the poll path was built around). Revert
     control: switching diagnose back to taskEnabled/taskSpec makes taskEnabled/
     taskSpec non-zero here and reds. */
  const counters = {};
  const job = jobStub(SPEC('C:\\w', 'C:\\c'), counters);
  for (const name of ['a', 'b', 'c']) {
    card.diagnose(name, { job, trustCheck: () => false, detect: () => true });
  }
  assert.equal(counters.taskEnabled || 0, 0, 'diagnose called the UNCACHED taskEnabled -- a per-poll schtasks spawn');
  assert.equal(counters.taskSpec || 0, 0, 'diagnose called the UNCACHED raw taskSpec -- a second per-poll schtasks spawn');
  assert.equal(counters.list || 0, 0, 'diagnose enumerated the fleet itself -- the caller already did that');
  assert.equal(counters.cachedTaskSpec, 3, 'diagnose should read each agent exactly once, through the cache');
});

test('#3013 (SPAWN SHAPE) diagnose runs NO live query of its own (liveness is the caller\u2019s)', () => {
  /* The old fleet-level shape ran win32roster.defaultRun() -> a second
     `claude agents --json` spawn per poll. diagnose has no live seam at all: it is
     handed an already-not-live agent. Proven by giving it a job stub with no live
     reader and asserting it still answers -- if diagnose reached for a live query it
     would throw or need a seam this test never provides. */
  const d = card.diagnose('alice', {
    job: { cachedTaskSpec: () => SPEC('C:\\w', 'C:\\c') },   // no list / no live reader
    trustCheck: () => false,
    detect: () => true,
  });
  assert.ok(d, 'diagnose needed no live query to reach a diagnosis');
});
