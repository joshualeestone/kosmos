'use strict';
/**
 * #570 keep-alive: the Windows analog of launchd's KeepAlive + ThrottleInterval.
 *
 * Every arm runs on any platform: the runner reader and the launcher are both
 * seams, and the loop's clock is injected, so a test drives hours of supervision
 * in milliseconds without spawning anything.
 *
 * The semantics being mirrored are the Mac's, not invented here (Splinter's
 * 2026-09-07 lifecycle write-up): respawn on any exit, a crash-loop bounded by a
 * throttle, adopt an existing healthy session rather than replacing it, and
 * never kill a session we do not own.
 *
 *   node --test engine/win32supervisor.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32sup-570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));

const sup = require('./win32supervisor');
const launcher = require('./win32launch');
const win32sessions = require('./win32sessions');

test.after(() => {
  sup.setLiveReader(null);
  launcher.setSpawn(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function workdir(name) {
  const d = path.join(SANDBOX, 'work', name);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}

/** A launcher that records and never spawns, and a matching ownership record. */
function fakeLauncher() {
  const started = [];
  launcher.setSpawn(() => ({ pid: 1, unref() {} }));
  return started;
}

test('#570 an UNREADABLE runner is not a dead agent -- it waits, it does not launch', () => {
  /* 🛑 THE ARM THAT MATTERS MOST. `claude agents --json` failing is a transient
     condition, not evidence of absence. Treating null as death respawns a healthy
     agent, and then there are two under one name -- the exact collision
     adopt-not-replace exists to prevent, arriving through the back door. */
  fakeLauncher();
  sup.setLiveReader(() => null);
  const r = sup.ensureRunning({ name: 'unreadable', cwd: workdir('unreadable') });
  assert.equal(r.action, 'waiting');
  assert.match(r.because, /could not ask/);
});

test('#570 it ADOPTS a live agent of ours instead of starting a second one', () => {
  fakeLauncher();
  const cwd = workdir('adoptme');
  // Start one for real (through the seamed launcher), then let the supervisor see it.
  const first = launcher.launch({ name: 'adoptme', runner: 'claude', cwd, platform: 'win32' });
  assert.equal(first.ok, true, first.because || '');
  sup.setLiveReader(() => [{ sessionId: first.sessionId, kind: 'interactive', name: 'cwd-derived' }]);

  const r = sup.ensureRunning({ name: 'adoptme', cwd, platform: 'win32' });
  assert.equal(r.action, 'adopted', 'a healthy agent must not be replaced');
  assert.equal(r.sessionId, first.sessionId);
});

test('#570 a live session that is NOT ours is not adopted and not killed', () => {
  /* A same-named foreign session makes the Mac supervisor WAIT rather than kill.
     Here the record is what decides ownership: an unrecorded session is somebody
     else's, so it is neither adopted nor removed -- we simply start our own. */
  fakeLauncher();
  const cwd = workdir('foreign');
  sup.setLiveReader(() => [{ sessionId: '11111111-2222-4333-8444-555555555555', kind: 'interactive', name: 'foreign' }]);
  const before = Object.keys(win32sessions.read()).length;
  const r = sup.ensureRunning({ name: 'foreign', cwd, platform: 'win32' });
  assert.equal(r.action, 'started', 'an unrecorded session is not ours to adopt');
  assert.equal(Object.keys(win32sessions.read()).length, before + 1,
    'and the foreign row was not touched -- exactly one new record');
});

test('#570 with nothing live, it STARTS one', () => {
  fakeLauncher();
  sup.setLiveReader(() => []);
  const r = sup.ensureRunning({ name: 'starter', cwd: workdir('starter'), platform: 'win32' });
  assert.equal(r.action, 'started');
  assert.ok(r.sessionId);
});

test('#570 a refused launch is reported as refused, not retried into a spin', () => {
  launcher.setSpawn(() => { const e = new Error('no'); e.code = 'ENOENT'; throw e; });
  sup.setLiveReader(() => []);
  const r = sup.ensureRunning({ name: 'refuser', cwd: workdir('refuser'), platform: 'win32' });
  assert.equal(r.action, 'refused');
  assert.match(String(r.because), /could not start it/);
});

test('#570 isAlive answers THREE things, and null is not false', () => {
  sup.setLiveReader(() => null);
  assert.equal(sup.isAlive('abc'), null, 'unreadable is null, never false');
  sup.setLiveReader(() => []);
  assert.equal(sup.isAlive('abc'), false, 'provably absent is false');
  sup.setLiveReader(() => [{ sessionId: 'abc' }]);
  assert.equal(sup.isAlive('abc'), true);
});

test('#570 THE RESTART CHAIN: an agent that dies is replaced, and the loop keeps watching', async () => {
  fakeLauncher();
  const cwd = workdir('restart');
  let live = [];
  sup.setLiveReader(() => live);

  const events = [];
  let ticks = 0;
  const handle = sup.supervise(
    { name: 'restart', cwd, platform: 'win32' },
    {
      throttleMs: 0, pollMs: 0,
      sleep: async () => { if (++ticks > 6) handle.stop(); },
      onEvent: (e) => {
        events.push(e.action);
        // The agent "dies" right after it is first started.
        if (e.action === 'started' && live.length === 0) live = [{ sessionId: e.sessionId }];
        else if (e.action === 'adopted') live = [];   // it dies
      },
    }
  );
  await handle.done;

  assert.ok(events.includes('started'), 'it started one');
  assert.ok(events.filter((a) => a === 'started').length >= 2,
    'and after the death it started another -- the KeepAlive chain, in code');
});

test('#570 THE THROTTLE bounds a crash loop instead of spinning', async () => {
  /* launchd caps a respawn at ThrottleInterval=30s so a crashing job limps rather
     than pegging the machine. Without this, an agent that dies instantly is
     restarted as fast as the loop runs. */
  fakeLauncher();
  const cwd = workdir('crashloop');
  sup.setLiveReader(() => []);            // nothing ever stays alive
  const events = [];
  let now = 0;
  let ticks = 0;
  const handle = sup.supervise(
    { name: 'crashloop', cwd, platform: 'win32' },
    {
      throttleMs: 30000, pollMs: 1000,
      now: () => now,
      sleep: async (ms) => { now += ms; if (++ticks > 12) handle.stop(); },
      onEvent: (e) => events.push(e.action),
    }
  );
  await handle.done;

  const starts = events.filter((a) => a === 'started').length;
  assert.ok(starts <= 2, 'a crash loop must LIMP: at most one start per throttle window, got ' + starts);
  assert.ok(events.includes('throttled'), 'and it says so rather than silently idling');
});

/* ── the streaming supervisor (7c-1) ───────────────────────────────────────── */

const { EventEmitter } = require('node:events');

/** A stand-in for a piped agent: records what was written, can be made to die. */
function fakeChild() {
  const c = new EventEmitter();
  c.written = [];
  c.stdin = { destroyed: false, write: (s) => c.written.push(s), end() { this.destroyed = true; } };
  c.die = (code) => c.emit('exit', code === undefined ? 0 : code);
  return c;
}

test('#570 7c it starts once, and every LATER start is a resume of the same id', () => {
  /* 🔑 The property the whole design rests on. A start that minted a fresh id per
     restart would file a second ownership row for one agent -- the duplicate-name
     hazard win32live documents, arriving through the routine restart path. */
  const asked = [];
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => fn(),
    launch: (spec) => {
      asked.push(spec.resumeSessionId || null);
      const c = fakeChild(); kids.push(c);
      return { ok: true, sessionId: 'session-1', resumed: Boolean(spec.resumeSessionId), child: c };
    },
  });

  assert.deepEqual(asked, [null], 'the first start is a birth');
  kids[0].die(1);
  assert.deepEqual(asked, [null, 'session-1'], 'and the death brings it back as a RESUME');
  h.stop();
});

test('#570 7c a death is known from the child, not from a poll', () => {
  /* `supervise()` must ask `claude agents --json` because a detached agent's
     death is invisible otherwise. This child is OURS: exit fires at once, so the
     runner is never asked on the happy path. */
  const events = [];
  let launches = 0;
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    onEvent: (e) => events.push(e.action),
    launch: () => { launches += 1; const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', resumed: launches > 1, child: c }; },
  });
  kids[0].die(0);
  assert.deepEqual(events, ['started', 'died', 'resumed']);
  assert.equal(launches, 2);
  h.stop();
});

test('#570 7c exit and close cannot both count as one death', () => {
  /* Both events arrive for one exit. Acting on both would double-count the death
     and burn the throttle budget twice as fast as the crash is happening. */
  let launches = 0;
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    launch: () => { launches += 1; const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  kids[0].emit('exit', 1);
  kids[0].emit('exit', 1);        // a second signal for the SAME death
  assert.equal(launches, 2, 'one death, one restart');
  h.stop();
});

test('#570 7c THE THROTTLE bounds a crash loop instead of spinning', () => {
  const waits = [];
  let t = 0;
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    throttleMs: 30000,
    now: () => t,
    setTimer: (fn, ms) => { waits.push(ms); t += ms; fn(); },
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  kids[0].die(1);                       // dies instantly
  assert.deepEqual(waits, [30000], 'the restart waits the throttle out rather than spinning');
  kids[1].die(1);
  assert.deepEqual(waits, [30000, 30000], 'and keeps limping, once per death');
  h.stop();
});

test('#570 7c send() writes ONE json line, and refuses honestly when nothing is up', () => {
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0, setTimer: () => {},   // no restart, so the death sticks
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });

  assert.deepEqual(h.send('hello'), { ok: true });
  assert.equal(kids[0].written.length, 1);
  assert.deepEqual(JSON.parse(kids[0].written[0]), {
    type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  });

  kids[0].die(0);
  const r = h.send('anyone there?');
  assert.equal(r.ok, false, 'a delivery with nothing to deliver to must not read as sent');
  assert.match(r.because, /not running/);
  h.stop();
});

test('#570 7c a REFUSED launch is reported and retried, not swallowed into a started agent', () => {
  const events = [];
  let n = 0;
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0, setTimer: (fn) => { if (n < 2) fn(); },
    onEvent: (e) => events.push(e.action),
    launch: () => {
      n += 1;
      if (n === 1) return { ok: false, because: 'we could not vouch for its folder first' };
      const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c };
    },
  });
  assert.deepEqual(events, ['refused', 'started']);
  h.stop();
});
