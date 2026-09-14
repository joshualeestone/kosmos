'use strict';
/**
 * #3013 round-2 must-fix: the ENABLED gate must be win32-correct, fresh, and
 * spawn-lean. This is the RUNTIME proof (the unit arms in win32trustcard.test.js
 * stub the job; the server wiring test greps source). It drives diagnose() through
 * the REAL win32job task-XML parse (fed a crafted schtasks answer via setRunner),
 * the REAL trust.folderTrusted, and the REAL win32trustwait.dirWaiting over a
 * sandbox sessions dir -- so a disabled task is exercised through the actual
 * `<Settings><Enabled>` parse, not a boolean a test typed.
 *
 *   node --test engine/win32trustcard.enabled-3013.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Sandbox roots before requiring engine modules (store/launchidentity freeze at
   require). */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-trust-en-3013-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const win32job = require('./win32job');
const card = require('./win32trustcard');

const NAME = 'stucky';

/* A real, on-disk agent account whose folder is NOT trusted and whose sessions dir
   holds a started-but-unregistered .key older than the 90s grace -- the shape a
   trust-hung agent leaves. */
function arrangeAccount() {
  const cwd = path.join(SANDBOX, 'work', NAME);
  const configDir = path.join(SANDBOX, 'acct', NAME);
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.join(configDir, 'sessions'), { recursive: true });
  // readable config that vouches for nothing -> folderTrusted === false
  fs.writeFileSync(path.join(configDir, '.claude.json'), JSON.stringify({ projects: {} }));
  // a lone <pid>.<hash>.key, back-dated well past the 90s grace, no <pid>.json
  const key = path.join(configDir, 'sessions', '4242.' + 'a'.repeat(64) + '.key');
  fs.writeFileSync(key, 'x');
  const past = Date.now() - 5 * 60 * 1000;
  fs.utimesSync(key, new Date(past), new Date(past));
  return { cwd: fs.realpathSync(cwd), configDir };
}

/* The schtasks answer for `/Query /XML`: the real task XML win32job.taskXml writes,
   with the given enabled state -- so diagnose reads enabled through the REAL
   `<Settings><Enabled>` parse. Any other schtasks call (a /Change) answers ok. */
function runnerFor(cwd, configDir, enabledRef) {
  return (args) => {
    if (args.includes('/XML') && args.includes('/Query')) {
      const xml = win32job.taskXml({ name: NAME, cwd, configDir, enabled: enabledRef.value }, {});
      return { ok: true, out: xml };
    }
    return { ok: true, out: '' };
  };
}

test('#3013 an ENABLED, untrusted, stuck agent IS diagnosed as waiting at the trust prompt', () => {
  const { cwd, configDir } = arrangeAccount();
  const enabledRef = { value: true };
  win32job.setRunner(runnerFor(cwd, configDir, enabledRef));
  try {
    const d = card.diagnose(NAME);
    assert.ok(d, 'an enabled, genuinely-stuck agent should be diagnosed');
    assert.match(d.because, /workspace-trust prompt no one can see/);
    assert.match(d.because, /not recorded as trusted/);
  } finally {
    win32job.setRunner(null);
  }
});

test('#3013 a SWITCHED-OFF agent (same untrusted folder + stuck .key) is NOT diagnosed', () => {
  /* 🛑 THE ROUND-2 REGRESSION. Everything else identical to the arm above; only the
     task's <Settings><Enabled> is false. The operator turned it off (perhaps because
     it kept hitting the prompt) -- saying "waiting at a trust prompt" would be the
     false positive the module refuses. Revert control: dropping the `enabled !== true`
     gate in diagnose reds this. */
  const { cwd, configDir } = arrangeAccount();
  const enabledRef = { value: false };
  win32job.setRunner(runnerFor(cwd, configDir, enabledRef));
  try {
    assert.equal(card.diagnose(NAME), null,
      'a disabled task must not render needs_trust, however untrusted its folder');
  } finally {
    win32job.setRunner(null);
  }
});

test('#3013 the enabled flag is FRESH: disable() busts the cache, so a flip is seen', () => {
  /* Proves (ii) freshness: a naive process-lifetime cache would keep serving the
     stale enabled:true after the operator disabled the task. disable() forgets the
     spec, so the next diagnose re-reads and answers null. */
  const { cwd, configDir } = arrangeAccount();
  const enabledRef = { value: true };
  win32job.setRunner(runnerFor(cwd, configDir, enabledRef));
  try {
    assert.ok(card.diagnose(NAME), 'starts enabled + stuck -> diagnosed (and now cached)');
    // The operator disables the task; the runner would now report it off.
    enabledRef.value = false;
    // CONTROL: without a bust the cached enabled:true would persist.
    assert.ok(card.diagnose(NAME), 'CONTROL: the cached enabled:true persists until something busts it');
    // disable() must bust the spec cache so the flip is seen.
    win32job.disable(NAME);
    assert.equal(card.diagnose(NAME), null,
      'disable() did not bust the task-spec cache, so the switched-off state was not seen');
  } finally {
    win32job.setRunner(null);
  }
});
