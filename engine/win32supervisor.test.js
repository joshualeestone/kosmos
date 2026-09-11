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

/* ── the streaming supervisor (7c-1, live since 7c-2) ──────────────────────── */

const { EventEmitter } = require('node:events');

/**
 * 🛑 EVERY STREAMING ARM STATES WHO IS ALREADY RUNNING, and the ones that are not
 * about that question state NOBODY. Since 7c-2 `superviseStreaming` asks before it
 * starts anything -- it is the live path now, so an unguarded start is how a
 * second agent lands in one agent's folder. An arm that left this to the default
 * would either shell the real `claude agents --json` on whatever box runs the
 * suite, or inherit whatever the previous test happened to set on the module. Both
 * are a suite describing a machine nobody chose.
 */
const NOBODY_LIVE = () => [];

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
    liveReader: NOBODY_LIVE,
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
    liveReader: NOBODY_LIVE,
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
    liveReader: NOBODY_LIVE,
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
    liveReader: NOBODY_LIVE,
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
    liveReader: NOBODY_LIVE,
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

/** A piped agent with stdout and stderr, whose stdin answers the flush callback. */
function streamingChild(pid) {
  const c = fakeChild();
  c.pid = pid;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin.write = (s, cb) => { c.written.push(s); if (typeof cb === 'function') cb(null); };
  return c;
}

/** A stream sink that records every call in order. */
function streamSink() {
  const calls = [];
  return {
    calls,
    started: (pid, sid) => calls.push(['started', pid, sid]),
    event: (e) => calls.push(['event', e && e.type]),
    wrote: () => calls.push(['wrote']),
    stopped: () => calls.push(['stopped']),
    rekey: (sid) => calls.push(['rekey', sid]),
  };
}

/* #2669: a /clear rotates the session id; the supervisor must follow it. */
function clearingSupervisor(name, opts) {
  const kids = [];
  const events = [];
  const sink = streamSink();
  const oldId = require('node:crypto').randomUUID();
  win32sessions.record(oldId, { name, runner: 'claude' });
  const h = sup.superviseStreaming({ name, cwd: 'C:\w', runner: 'claude' }, Object.assign({
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    stream: sink,
    onEvent: (e) => events.push(e),
    launch: () => { const c = streamingChild(7000 + kids.length); kids.push(c); return { ok: true, sessionId: oldId, child: c }; },
  }, opts));
  const say = (i, obj) => kids[i].stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
  return { h, kids, events, sink, oldId, say };
}

test('#2669 an init with a NEW session id moves ownership, the resume id, and the state file', () => {
  const t = clearingSupervisor('clr-1');
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });
  const rec = win32sessions.read();
  assert.equal(rec[newId] && rec[newId].name, 'clr-1', 'the new id is recorded under the same name');
  assert.equal(rec[t.oldId], undefined, 'and the old one is forgotten');
  assert.equal(t.h.sessionId, newId, 'a crash relaunch now resumes the conversation AFTER the clear');
  assert.ok(t.sink.calls.some((c) => c[0] === 'rekey' && c[1] === newId), 'the state file follows');
  assert.ok(t.events.some((e) => e.action === 'rekeyed' && e.from === t.oldId && e.sessionId === newId
    && e.because.includes(t.oldId) && e.because.includes(newId)), 'the task log line names both ids');
  const iRekey = t.sink.calls.findIndex((c) => c[0] === 'rekey');
  const iInit = t.sink.calls.findIndex((c) => c[0] === 'event' && c[1] === 'system');
  assert.ok(iRekey >= 0 && iRekey < iInit, 'the state file follows BEFORE the turn\'s events are published');
  t.h.stop();
});

test('#2669 a failed record is RETRIED until it lands -- it cannot heal on its own', () => {
  let attempts = 0;
  const timers = [];
  const forgotten = [];
  const t = clearingSupervisor('clr-4', {
    setTimer: (fn) => timers.push(fn),
    sessions: {
      record: () => { attempts += 1; return attempts === 1 ? { ok: false, because: 'the record is busy' } : { ok: true }; },
      forget: (id) => { forgotten.push(id); return { ok: true }; },
      read: () => ({}),
    },
  });
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });
  assert.equal(t.h.sessionId, t.oldId, 'nothing moves on the failure');
  const failed = t.events.find((e) => e.action === 'rekey-failed');
  assert.ok(failed && failed.because.includes(newId) && /keep trying/.test(failed.because));
  assert.equal(timers.length, 1, 'a retry is armed');
  timers[0]();
  assert.equal(t.h.sessionId, newId, 'the retry lands the new id');
  assert.deepEqual(forgotten, [t.oldId], 'and only then is the old one forgotten');
  assert.ok(t.events.some((e) => e.action === 'rekeyed'));
  t.h.stop();
});

test('#2669 the retry stops when the child is replaced, and gives up after its attempts', () => {
  let attempts = 0;
  const timers = [];
  const failing = { record: () => { attempts += 1; return { ok: false, because: 'broken' }; }, forget: () => ({ ok: true }), read: () => ({}) };
  const t = clearingSupervisor('clr-5', { setTimer: (fn) => timers.push(fn), sessions: failing });
  t.say(0, { type: 'system', subtype: 'init', session_id: require('node:crypto').randomUUID() });
  t.kids[0].die(1);                         // replaced: the relaunch timer is armed after the retry
  const before = attempts;
  timers[0]();                              // the rekey retry, for a child that is gone
  assert.equal(attempts, before, 'a replaced child\'s rekey is not retried');
  t.h.stop();

  let n = 0;
  const q = [];
  const u = clearingSupervisor('clr-6', { setTimer: (fn) => q.push(fn), sessions: { record: () => { n += 1; return { ok: false, because: 'broken' }; }, forget: () => ({ ok: true }), read: () => ({}) } });
  u.say(0, { type: 'system', subtype: 'init', session_id: require('node:crypto').randomUUID() });
  while (q.length) q.shift()();
  assert.equal(n, 30, 'bounded: REKEY_ATTEMPTS tries, then it stops');
  const said = u.events.filter((e) => e.action === 'rekey-failed');
  assert.equal(said.length, 2, 'the log says it once when it starts trying and once when it stops, not thirty times');
  assert.match(said[1].because, /stopped trying/);
  u.h.stop();
});

test('#2669 a NEWER id supersedes a pending retry: the older one is never recorded after it', () => {
  /* Two /clears in a row: B's record fails, then C arrives before B's retry fires.
     Retrying B would record it after C and move the resume id back to the wrong
     conversation (review round 3: the `pendingRekey === id` guard was unpinned). */
  const recorded = [];
  const timers = [];
  const t = clearingSupervisor('clr-8', {
    setTimer: (fn) => timers.push(fn),
    sessions: { record: (id) => { recorded.push(id); return { ok: false, because: 'the record is busy' }; }, forget: () => ({ ok: true }), read: () => ({}) },
  });
  const B = require('node:crypto').randomUUID();
  const C = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: B });
  t.say(0, { type: 'system', subtype: 'init', session_id: C });
  const before = recorded.length;
  timers[0]();                              // B's retry fires after C took over
  assert.ok(!recorded.slice(before).includes(B), 'the superseded id is not retried');
  timers[1]();                              // C's own retry still runs
  assert.ok(recorded.slice(before).includes(C), 'the newest id keeps trying');
  t.h.stop();
});

test('#2669 a second init for an id already being retried starts no second chain, and never forgets the live row', () => {
  /* A message queued behind the /clear produces a second init for the same new id
     while its record is still failing (review round 5). */
  let attempts = 0;
  const timers = [];
  const forgotten = [];
  const t = clearingSupervisor('clr-10', {
    setTimer: (fn) => timers.push(fn),
    sessions: {
      record: () => { attempts += 1; return attempts <= 2 ? { ok: false, because: 'the record is busy' } : { ok: true }; },
      forget: (id) => { forgotten.push(id); return { ok: true }; },
      read: () => ({}),
    },
  });
  const B = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: B });
  t.say(0, { type: 'system', subtype: 'init', session_id: B });
  assert.equal(attempts, 1, 'the second init did not start an attempt of its own');
  assert.equal(t.events.filter((e) => e.action === 'rekey-failed').length, 1, 'and the log says it once');
  while (timers.length) timers.shift()();
  assert.equal(t.h.sessionId, B, 'the one chain lands the new id');
  assert.deepEqual(forgotten, [t.oldId], 'only the OLD id is forgotten, never the live one');
  t.h.stop();
});

test('#2669 after a retry chain gives up, a later init for the same id tries again', () => {
  let n = 0;
  const q = [];
  const t = clearingSupervisor('clr-11', {
    setTimer: (fn) => q.push(fn),
    sessions: { record: () => { n += 1; return { ok: false, because: 'broken' }; }, forget: () => ({ ok: true }), read: () => ({}) },
  });
  const B = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: B });
  while (q.length) q.shift()();
  assert.equal(n, 30, 'the chain used its attempts');
  t.say(0, { type: 'system', subtype: 'init', session_id: B });
  assert.equal(n, 31, 'a chain that gave up does not block a fresh try');
  t.h.stop();
});

test('#2669 once a NEWER id lands, the older pending retry never runs again', () => {
  /* B's record fails and a retry is armed; C then records at once. If the success
     did not clear the pending id, B's late retry would pass every guard, record B,
     move the resume id back, and forget C's live row (review round 7). */
  const B = require('node:crypto').randomUUID();
  const C = require('node:crypto').randomUUID();
  let bMayLand = false;
  const timers = [];
  const forgotten = [];
  const t = clearingSupervisor('clr-13', {
    setTimer: (fn) => timers.push(fn),
    sessions: {
      record: (id) => (id === B && !bMayLand ? { ok: false, because: 'the record is busy' } : { ok: true }),
      forget: (id) => { forgotten.push(id); return { ok: true }; },
      read: () => ({}),
    },
  });
  t.say(0, { type: 'system', subtype: 'init', session_id: B });   // fails: a retry is armed for B
  t.say(0, { type: 'system', subtype: 'init', session_id: C });   // lands at once
  bMayLand = true;                                                  // B would succeed now, if retried
  while (timers.length) timers.shift()();
  assert.equal(t.h.sessionId, C, 'the resume id stays on the newest session');
  assert.ok(!forgotten.includes(C), 'and the live row is never forgotten');
  t.h.stop();
});

test('#2669 a relaunched child is never blocked by a retry its dead predecessor left pending', () => {
  let attempts = 0;
  const timers = [];
  const t = clearingSupervisor('clr-12', {
    setTimer: (fn) => timers.push(fn),
    sessions: { record: () => { attempts += 1; return { ok: false, because: 'the record is busy' }; }, forget: () => ({ ok: true }), read: () => ({}) },
  });
  const B = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: B });   // fails: a chain for B, owned by child 0
  t.kids[0].die(1);                                                 // crash: a relaunch is scheduled
  while (t.kids.length < 2 && timers.length) timers.shift()();      // the dead child's retry no-ops; the relaunch runs
  assert.equal(t.kids.length, 2, 'the agent was relaunched');
  const before = attempts;
  t.say(1, { type: 'system', subtype: 'init', session_id: B });    // the new child announces B
  assert.equal(attempts, before + 1, 'the new child tries to record it; a stale pending flag does not swallow it');
  t.h.stop();
});

test('#2669 a pending rekey retry writes nothing once the loop is stopped', () => {
  let attempts = 0;
  const timers = [];
  const t = clearingSupervisor('clr-9', {
    setTimer: (fn) => timers.push(fn),
    sessions: { record: () => { attempts += 1; return { ok: false, because: 'the record is busy' }; }, forget: () => ({ ok: true }), read: () => ({}) },
  });
  t.say(0, { type: 'system', subtype: 'init', session_id: require('node:crypto').randomUUID() });
  const before = attempts;
  t.h.stop();
  timers[0]();                              // the retry armed before the stop fires late
  assert.equal(attempts, before, 'no ownership write after the supervisor was told to stop');
});

test('#2669 a record that THROWS is a failed record, not a dead supervisor', () => {
  /* The call runs inside the stdout handler, so a throw that escaped would take the
     agent's supervisor down with it (review round 10). */
  const timers = [];
  const t = clearingSupervisor('clr-14', {
    setTimer: (fn) => timers.push(fn),
    sessions: { record: () => { throw Object.assign(new Error('disk said no'), { code: 'EIO' }); }, forget: () => ({ ok: true }), read: () => ({}) },
  });
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });
  assert.equal(t.h.sessionId, t.oldId, 'nothing moves');
  const failed = t.events.find((e) => e.action === 'rekey-failed');
  assert.ok(failed && /EIO/.test(failed.because), 'the failure is said, with its code');
  assert.equal(timers.length, 1, 'and it is retried like any failed record');
  t.h.stop();
});

test('#2669 a forget that THROWS is said with its code, and the rekey still stands', () => {
  const t = clearingSupervisor('clr-15', {
    sessions: { record: () => ({ ok: true }), forget: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); }, read: () => ({}) },
  });
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });
  assert.equal(t.h.sessionId, newId, 'the rekey stands');
  const said = t.events.find((e) => e.action === 'forget-failed');
  assert.ok(said && said.sessionId === t.oldId && /EBUSY/.test(said.because));
  t.h.stop();
});

test('#2669 a forget that fails is SAID: the old id still answers to this name', () => {
  const t = clearingSupervisor('clr-7', {
    sessions: { record: () => ({ ok: true }), forget: () => ({ ok: false, because: 'the record is busy' }), read: () => ({}) },
  });
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });
  assert.equal(t.h.sessionId, newId, 'the rekey itself stands');
  const said = t.events.find((e) => e.action === 'forget-failed');
  assert.ok(said && said.sessionId === t.oldId && /record is busy/.test(said.because));
  t.h.stop();
});

test('#2669 the same id, a hook event carrying a new id, or a replaced child\'s line changes nothing', () => {
  const t = clearingSupervisor('clr-2', { setTimer: (fn) => fn() });
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: t.oldId });           // the normal first turn
  t.say(0, { type: 'system', subtype: 'hook_started', session_id: newId });     // config-dependent: not the gate
  assert.equal(t.h.sessionId, t.oldId);
  assert.ok(!t.sink.calls.some((c) => c[0] === 'rekey'));
  t.kids[0].die(1);                                                              // relaunch: kids[1] is current
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });             // a late line from the dead one
  assert.equal(t.h.sessionId, t.oldId, 'a replaced child cannot move the id');
  t.h.stop();
});

test('#2669 a record that FAILS leaves everything on the old id, and says so', () => {
  const forgotten = [];
  const t = clearingSupervisor('clr-3', {
    sessions: { record: () => ({ ok: false, because: 'the store is busy' }), forget: (id) => forgotten.push(id), read: () => ({}) },
  });
  const newId = require('node:crypto').randomUUID();
  t.say(0, { type: 'system', subtype: 'init', session_id: newId });
  assert.equal(t.h.sessionId, t.oldId, 'the resume id is not stranded on an unrecorded session');
  assert.deepEqual(forgotten, [], 'the old row is kept, so the agent stays visible');
  assert.ok(!t.sink.calls.some((c) => c[0] === 'rekey'));
  assert.ok(t.events.some((e) => e.action === 'rekey-failed' && /store is busy/.test(e.because)));
  t.h.stop();
});

test('#570 7c-5 the supervisor publishes its agent: the start, every stream event, a flushed write, the death', () => {
  const kids = [];
  const sink = streamSink();
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    stream: sink,
    launch: () => { const c = streamingChild(4100); kids.push(c); return { ok: true, sessionId: 'sid-s', child: c }; },
  });
  // A line split across two chunks is still one event.
  kids[0].stdout.emit('data', Buffer.from('{"type":"system","subtype":"init"}\n{"type":"assi'));
  kids[0].stdout.emit('data', Buffer.from('stant"}\n{"type":"result"}\n'));
  h.send('hello', () => {});
  kids[0].die(0);
  assert.deepEqual(sink.calls, [
    ['started', 4100, 'sid-s'],
    ['event', 'system'], ['event', 'assistant'], ['event', 'result'],
    ['wrote'],
    ['stopped'],
  ]);
  h.stop();
});

test('#570 7c-5 a REPLACED child\'s late output says nothing about the one that replaced it', () => {
  const kids = [];
  const sink = streamSink();
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    stream: sink,
    launch: () => { const c = streamingChild(5000 + kids.length); kids.push(c); return { ok: true, sessionId: 'sid-r', child: c }; },
  });
  kids[0].die(1);                        // restarts at once: kids[1] is the agent now
  assert.deepEqual(sink.calls.slice(-1), [['started', 5001, 'sid-r']]);
  sink.calls.length = 0;
  kids[0].stdout.emit('data', Buffer.from('{"type":"assistant"}\n'));   // a late line from the dead one
  assert.deepEqual(sink.calls, [], 'the old process said nothing about the new one');
  h.stop();
});

test('#570 7c-5 a clean STOP clears the state, and the agent\'s later exit does not clear it twice', () => {
  /* stop() drops `child` before the agent exits, so the death handler's
     current-child guard skips it; without the clear in stop() a turn cut off by
     the stop would stay WORKING on disk. */
  const kids = [];
  const sink = streamSink();
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    stream: sink,
    launch: () => { const c = streamingChild(7); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  h.send('hello', () => {});
  sink.calls.length = 0;
  h.stop();
  assert.deepEqual(sink.calls, [['stopped']], 'the stop clears');
  kids[0].stdout.emit('data', Buffer.from('{"type":"result"}\n'));   // its last line, during shutdown
  kids[0].die(0);                                                     // then its exit
  assert.deepEqual(sink.calls, [['stopped']], 'nothing after the stop publishes or clears again');
});

test('#570 7c-5 a flush that lands after its child was REPLACED does not mark the new agent busy', () => {
  /* Found in review round 2, reproduced: a write to C1 is still flushing when C1
     dies and the restart brings up C2 (idle). C1's late flush said "a message
     reached it" about a process that is gone, and published idle C2 as WORKING
     with nothing to correct it until C2's next event. */
  const kids = [];
  const sink = streamSink();
  let pendingFlush = null;
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    stream: sink,
    launch: () => { const c = streamingChild(6000 + kids.length); kids.push(c); return { ok: true, sessionId: 'sid-late', child: c }; },
  });
  kids[0].stdin.write = (s, cb) => { pendingFlush = cb; };   // the flush has not landed yet
  let answered = null;
  h.send('hello', (r) => { answered = r; });
  kids[0].die(1);                                            // C1 dies; C2 comes up at once
  assert.deepEqual(sink.calls.slice(-1), [['started', 6001, 'sid-late']]);
  sink.calls.length = 0;
  pendingFlush(null);                                        // C1's flush lands now
  assert.deepEqual(sink.calls, [], 'news about the dead process is not news about the new one');
  assert.deepEqual(answered, { ok: true }, 'the sender is still told its bytes left: delivery is a separate question');
  h.stop();
});

test('#570 headless: a supervisor whose task was ended never starts the agent again', () => {
  /* Remove runs /End (killing the host) and then kills the agent. The supervisor
     outlives its host by up to a second, sees its agent die, and used to relaunch
     it: a removed agent briefly back, owned by nobody. mayStart is asked right
     before every launch. */
  const kids = [];
  const events = [];
  let hostAlive = true;
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    mayStart: () => hostAlive,
    onEvent: (e) => events.push(e.action),
    launch: () => { const c = streamingChild(1); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  assert.equal(kids.length, 1, 'a live host starts its agent');
  hostAlive = false;                 // /End killed the host
  kids[0].die(1);                    // then the remove killed the agent
  assert.equal(kids.length, 1, 'no relaunch for a task that was ended');
  assert.ok(events.includes('not-starting'), 'and it says so on the task log');
  h.stop();
});

test('#570 every finished run retires ITS OWN token: a crash, a relaunch, then a stop', () => {
  /* Each launch mints a credential for that run (a resume included). Without
     retiring the dead run's, every crash-restart left one more live token behind
     for the agent. The death handler retires by the run's own instance, and a
     clean stop ends the child through that same path. */
  const kids = [];
  const retired = [];
  let n = 0;
  const h = sup.superviseStreaming({ name: 'tok', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    retireRun: (name, instance) => retired.push(name + '/' + instance),
    launch: () => { n += 1; const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c, instance: 'inst-' + n }; },
  });
  assert.deepEqual(retired, [], 'a live run keeps its token');
  kids[0].die(1);                                 // crash: relaunches as inst-2
  assert.deepEqual(retired, ['tok/inst-1'], 'the crashed run\'s token is retired');
  h.stop();
  kids[1].die(0);                                 // the stop's exit arrives
  assert.deepEqual(retired, ['tok/inst-1', 'tok/inst-2'], 'and the stopped run\'s too, exactly once each');
});

test('#570 a token that cannot be retired is SAID on the task log, not swallowed', () => {
  for (const retireRun of [
    () => ({ ok: false, because: 'the token store is busy' }),
    () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); },
  ]) {
    const kids = [];
    const events = [];
    const h = sup.superviseStreaming({ name: 'stuck', cwd: 'C:\w' }, {
      liveReader: NOBODY_LIVE,
      throttleMs: 0, now: () => 0, setTimer: () => {},
      onEvent: (e) => events.push(e),
      retireRun,
      launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c, instance: 'inst-1' }; },
    });
    kids[0].die(1);
    const said = events.find((e) => e.action === 'token-not-retired');
    assert.ok(said, 'the failure reaches the task log');
    assert.match(said.because, /store is busy|EBUSY/);
    h.stop();
  }
});

test('#570 a run that got NO token says so when it starts, since the board will refuse its reports', () => {
  const events = [];
  const h = sup.superviseStreaming({ name: 'tokenless', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    onEvent: (e) => events.push(e),
    launch: () => ({ ok: true, sessionId: 's', child: fakeChild(), tokenBecause: 'the token store is busy' }),
  });
  const started = events.find((e) => e.action === 'started');
  assert.match(started.because, /no reporting token: the token store is busy/);
  h.stop();
});

test('#570 a RESUMED run that got no token says so too -- the crash-restart is the case this branch fixes', () => {
  const events = [];
  const kids = [];
  let n = 0;
  const h = sup.superviseStreaming({ name: 'tokenless-2', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: (fn) => fn(),
    onEvent: (e) => events.push(e),
    launch: (spec) => {
      n += 1; const c = fakeChild(); kids.push(c);
      return { ok: true, sessionId: 's', child: c, resumed: Boolean(spec.resumeSessionId),
        tokenBecause: n === 1 ? null : 'the token store is busy' };
    },
  });
  assert.ok(!('because' in events.find((e) => e.action === 'started')), 'a run WITH a token says nothing extra');
  kids[0].die(1);                                   // crash: comes back as a resume, with no token
  const resumed = events.find((e) => e.action === 'resumed');
  assert.ok(resumed, 'the crash came back as a resume');
  assert.match(resumed.because, /no reporting token: the token store is busy/);
  h.stop();
});

test('#570 the supervisor\'s REAL retire (nothing injected) takes the dead run\'s token out of the store', () => {
  /* Every other test injects `retireRun`; `main()` injects nothing, so production
     runs the default. This pins that default against the real (sandboxed) token
     store (review round 5: replacing it with a no-op stayed green). */
  const sendertoken = require('./sendertoken');
  const minted = sendertoken.mint('realretire');
  assert.equal(minted.ok, true, minted.because);
  const kids = [];
  const h = sup.superviseStreaming({ name: 'realretire', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c, instance: minted.instance }; },
  });
  assert.ok(sendertoken.live('realretire').includes(minted.instance), 'the token is live while its run is');
  h.stop();
  kids[0].die(0);
  assert.ok(!sendertoken.live('realretire').includes(minted.instance), 'and gone from the store once the run ends');
});

test('#570 a run that was launched with no token retires nothing', () => {
  const kids = [];
  const retired = [];
  const h = sup.superviseStreaming({ name: 'bare', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    retireRun: (name, instance) => retired.push(instance),
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  kids[0].die(1);
  assert.deepEqual(retired, []);
  h.stop();
});

test('#570 7c-5 a failed write does not mark the agent busy', () => {
  const kids = [];
  const sink = streamSink();
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    stream: sink,
    launch: () => { const c = streamingChild(1); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  kids[0].stdin.write = (s, cb) => cb(Object.assign(new Error('pipe broke'), { code: 'EPIPE' }));
  h.send('hello', () => {});
  assert.ok(!sink.calls.some((c) => c[0] === 'wrote'), 'only a flushed write is a message the agent has');
  h.stop();
});

test('#570 7c-5 stderr is drained, and a death carries its tail to the task log', () => {
  const kids = [];
  const events = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    onEvent: (e) => events.push(e),
    launch: () => { const c = streamingChild(1); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  kids[0].stderr.emit('data', Buffer.from('boom:\n  the api key\n'));
  kids[0].stderr.emit('data', Buffer.from(' was rejected\n'));
  kids[0].die(1);
  const died = events.find((e) => e.action === 'died');
  assert.equal(died.because, 'it said: boom: the api key was rejected');

  kids.length = 0;
  events.length = 0;
  const quiet = sup.superviseStreaming({ name: 'b', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    onEvent: (e) => events.push(e),
    launch: () => { const c = streamingChild(2); kids.push(c); return { ok: true, sessionId: 's2', child: c }; },
  });
  kids[0].die(0);
  assert.equal(events.find((e) => e.action === 'died').because, undefined, 'a silent death invents no sentence');
  h.stop();
  quiet.stop();
});

test('#570 7c-4 a write that fails AFTER it was handed to the pipe is unsure, never a definite no', () => {
  /* Baron's bar (Mac delivery owner, 2026-09-10): a write that buffered and then
     errored may already have put bytes in front of the agent, so it must read as
     unconfirmed, not could_not. A write that THROWS never left this process, and
     only that one is a safe-to-resend no. */
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
    throttleMs: 0, now: () => 0, setTimer: () => {},
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });

  kids[0].stdin.write = (s, cb) => cb(Object.assign(new Error('pipe broke'), { code: 'EPIPE' }));
  let got = null;
  h.send('hello', (r) => { got = r; });
  assert.equal(got.ok, false);
  assert.equal(got.unsure, true, 'the bytes may be in front of the agent');
  assert.match(got.because, /EPIPE.*cannot tell whether it arrived/);

  kids[0].stdin.write = () => { throw Object.assign(new Error('bad argument'), { code: 'ERR_INVALID_ARG_TYPE' }); };
  got = null;
  h.send('again', (r) => { got = r; });
  assert.equal(got.ok, false);
  assert.ok(!got.unsure, 'a write that threw put nothing on the pipe, so re-sending is safe');
  h.stop();
});

test('#570 7c a REFUSED launch is reported and retried, not swallowed into a started agent', () => {
  const events = [];
  let n = 0;
  const kids = [];
  const h = sup.superviseStreaming({ name: 'a', cwd: 'C:\w' }, {
    liveReader: NOBODY_LIVE,
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

/* ── 7c-2: the streaming supervisor becomes the LIVE path ───────────────────── */

test('#570 7c-2 THE TASK SUPERVISES THE STREAMING AGENT -- the detached one cannot be talked to', () => {
  /* 🛑 THE WHOLE POINT OF THE SLICE, PINNED AT THE ENTRY POINT. `main()` is what
     the anchored boot shim calls, so whichever loop it names is the one every
     Windows agent on the fleet gets. It named `supervise()`, which watches a
     DETACHED agent -- nobody holds that agent's stdin, which is precisely why a
     Windows agent could not be messaged. Asserted behaviourally rather than by
     reading the source: this drives main() and checks that what came up is a child
     whose pipes we hold. */
  const spawned = [];
  launcher.setSpawn((bin, argv) => {
    const c = fakeChild();
    c.pid = 4242;
    c.spawnargs = argv;
    spawned.push({ bin, argv, child: c });
    return c;
  });
  sup.setLiveReader(() => []);
  const cwd = workdir('entry');
  /* The host watch is injected: the real one would watch this test runner's
     parent, and its exit would end the whole suite. */
  const watches = [];
  const exits = [];
  let hostChecks = 0;
  const handle = sup.main(['entry', cwd, '-', '-', 'claude'], {
    watchHost: (opts) => { const w = { opts, stopped: false, stop() { this.stopped = true; } }; watches.push(w); return w; },
    exitLater: (ms) => exits.push(ms),
    hostAlive: () => { hostChecks += 1; return true; },
  });
  /* 🛑 CLEANUP RUNS HOWEVER THE ASSERTIONS GO. main() opens the agent's pipe
     server, and a failed assertion that skipped handle.stop() left it listening,
     so the test process never exited: a hang where a red belonged. Found by this
     file's own control run for the 7c-5 assertion below. */
  try {
    /* 7c-5: main() is the ONE production wiring of the state publisher. Without it
       every Windows card reads UNKNOWN while every other test stays green, so the
       file main()'s agent gets is checked here, before the stop clears it. */
    assert.equal(require('./win32streamstate').stateFor('entry', { sessionId: handle.sessionId, pid: 4242 }), 'idle',
      'main() publishes its agent\'s state from the moment it starts');

    assert.equal(spawned.length, 1, 'main() started exactly one agent');
    assert.ok(spawned[0].argv.includes('--input-format'), 'and it is a STREAMING session');
    assert.ok(spawned[0].argv.includes('stream-json'));
    assert.equal(typeof handle.send, 'function', 'so the supervisor can be told things');
    /* ⚠️ THE LOAD-BEARING NEGATIVE. The detached launch goes through `cmd /c start`;
       if main() ever goes back to it, this is the line that says so. */
    assert.ok(!/cmd\.exe$/i.test(spawned[0].bin), 'a `cmd /c start` here is the detached launch coming back');

    /* #570 headless: main() watches its host, and when the host is gone (what
       `/End` does to a headless task) it stops its agent and leaves. */
    assert.equal(watches.length, 1, 'main() arms exactly one host watch');
    assert.ok(hostChecks >= 1, 'main() asks whether its host is alive before it starts an agent');
    assert.equal(spawned[0].child.stdin.destroyed, false);
    watches[0].opts.onGone(1234);
    assert.equal(spawned[0].child.stdin.destroyed, true, 'the host going stops the agent (its stdin is closed)');
    assert.equal(exits.length, 1, 'and the supervisor leaves after a grace period');
    assert.equal(watches[0].stopped, true, 'the watch is stopped with everything else');
  } finally {
    handle.stop();
    launcher.setSpawn(null);
    sup.setLiveReader(null);
  }
});

test('#570 7c-2 a session it does NOT hold, under its own name, is left alone', () => {
  /* 🛑 THE HOLE 7c-2 WOULD OTHERWISE HAVE OPENED. `supervise()` asks
     `ourLiveSession` before every launch, for the one reason that matters: two
     agents under one name, editing one folder. This loop had no such check while
     nothing in production started it -- and `win32job.start()` (Restore, and
     create's own start) runs the task NOW, so a detached agent still running from
     the old launch path would have got a second one put beside it. */
  win32sessions.record('foreign-1', { name: 'twinned', runner: 'claude' });
  const events = [];
  let launches = 0;
  const h = sup.superviseStreaming({ name: 'twinned', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0, setTimer: () => {},
    liveReader: () => [{ sessionId: 'foreign-1', pid: 9, kind: 'interactive' }],
    onEvent: (e) => events.push(e),
    launch: () => { launches += 1; return { ok: true, sessionId: 's', child: fakeChild() }; },
  });

  assert.equal(launches, 0, 'a second agent under one name is the collision this exists to prevent');
  assert.equal(events[0].action, 'waiting');
  assert.match(events[0].because, /already running under this name/);
  /* ⚠️ AND IT WAITS RATHER THAN KILLING -- `ourLiveSession`'s own ruling. Killing
     would let a stale supervisor take out a live agent. */
  assert.ok(!events.some((e) => e.action === 'refused'), 'waiting is not a refusal; it resolves itself');
  h.stop();
});

test('#570 7c-2 an UNREADABLE runner does not start a second agent either', () => {
  /* The same branch `ensureRunning` calls the most important one in the file: a
     runner we could not ask is not an agent that is absent. Starting here is how a
     transient failure becomes the duplicate the guard exists to prevent. */
  let launches = 0;
  const events = [];
  const h = sup.superviseStreaming({ name: 'unasked', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0, setTimer: () => {},
    liveReader: () => null,
    onEvent: (e) => events.push(e),
    launch: () => { launches += 1; return { ok: true, sessionId: 's', child: fakeChild() }; },
  });
  assert.equal(launches, 0);
  assert.match(events[0].because, /could not ask/);
  h.stop();
});

test('#570 7c-2 it does not RESUME a session that is still listed as running', () => {
  /* ⚠️ THE SUBTLER HALF. `--resume` on an id that still has a process on it is two
     processes on one conversation. After a death the roster can be a moment stale,
     so the honest answer is to wait a poll rather than resume on top of ourselves. */
  win32sessions.record('mine-1', { name: 'stale', runner: 'claude' });
  let live = [];
  const events = [];
  const kids = [];
  const timers = [];
  const h = sup.superviseStreaming({ name: 'stale', cwd: 'C:\w' }, {
    throttleMs: 0, now: () => 0,
    setTimer: (fn) => timers.push(fn),
    liveReader: () => live,
    onEvent: (e) => events.push(e),
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 'mine-1', child: c }; },
  });
  assert.equal(kids.length, 1, 'nothing was live, so it started');
  live = [{ sessionId: 'mine-1', pid: 5 }];       // the roster now lists our own id
  kids[0].die(1);
  timers.shift()();                                // the restart the death scheduled
  assert.equal(kids.length, 1, 'it must not resume an id the runner still calls running');
  assert.match(events[events.length - 1].because, /on top of itself/);

  /* THE CONTROL. A guard that never clears is a fleet that never comes back. */
  live = [];
  timers.shift()();
  assert.equal(kids.length, 2, 'and the moment the id is gone it resumes');
  h.stop();
});

test('#570 7c-2 waiting does not burn the throttle a crash never earned', () => {
  /* The throttle bounds RESTARTS. A name held by somebody else for an hour is not
     a crash loop, so the first start once it frees up must be immediate. */
  let live = [{ sessionId: 'other', pid: 1 }];
  win32sessions.record('other', { name: 'patient', runner: 'claude' });
  const waits = [];
  const kids = [];
  const timers = [];
  const h = sup.superviseStreaming({ name: 'patient', cwd: 'C:\w' }, {
    throttleMs: 30000, pollMs: 5000, now: () => 0,
    setTimer: (fn, ms) => { waits.push(ms); timers.push(fn); },
    liveReader: () => live,
    launch: () => { const c = fakeChild(); kids.push(c); return { ok: true, sessionId: 's', child: c }; },
  });
  assert.deepEqual(waits, [5000], 'it re-asks at the POLL interval, not the throttle');
  live = [];
  timers.shift()();
  assert.equal(kids.length, 1, 'and starts at once rather than serving a penalty');
  h.stop();
});
