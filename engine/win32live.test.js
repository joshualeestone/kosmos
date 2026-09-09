'use strict';
/**
 * #570: the one ownership join, and the guard that keeps it equal to the roster's.
 *
 * 🛑 THE TEST THIS FILE EXISTS FOR IS THE PARITY ONE. `win32capture` used to
 * carry a hand-written second copy of `win32roster`'s name resolution under a
 * comment promising it stayed "BYTE-IDENTICAL" -- a promise no test held, in the
 * code that decides which sessions on the machine are Kosmos's to touch. The copy
 * is gone; `win32live` is the single join and this asserts that its key set is
 * exactly the set of names the roster emits, off the same input. If the two ever
 * disagree, the board would show a row that nothing can read the state of, or --
 * far worse, now that `win32stop` uses the same join -- a name that resolves to a
 * session the roster never vouched for.
 *
 *   node --test engine/win32live.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const win32live = require('./win32live');
const win32roster = require('./win32roster');

/** A record store standing in for win32sessions: sessionId -> { name, runner }. */
function store(rec) { return { read: () => rec }; }
/** A `claude agents --json` reply. */
function agents(list) { return () => list; }

const OURS = '11111111-2222-3333-4444-555555555555';
const THEIRS = '99999999-8888-7777-6666-555555555555';

test('#570 it joins on the sessionId and carries the pid, because the pid is what a stop acts on', () => {
  const map = win32live.byName({
    // The LIVE name differs from the recorded one -- which is the normal case,
    // since Claude derives its own name from the cwd.
    run: agents([{ sessionId: OURS, pid: 4242, status: 'busy', name: 'pigeonpete-50', kind: 'interactive' }]),
    record: store({ [OURS]: { name: 'pigeonpete', runner: 'claude' } }),
  });

  assert.deepEqual([...map.keys()], ['pigeonpete'], 'keyed by the RECORDED name, the one the board holds');
  assert.equal(map.get('pigeonpete').pid, 4242);
  assert.equal(map.get('pigeonpete').sessionId, OURS);
  assert.equal(map.get('pigeonpete').status, 'busy');
});

test('#570 FAIL CLOSED: a session Kosmos did not record is not in the map at all', () => {
  const map = win32live.byName({
    run: agents([{ sessionId: THEIRS, pid: 7, status: 'idle', name: 'joshu-4c', kind: 'interactive' }]),
    record: store({}),
  });
  /* The operator's own Claude session. `claude agents --json` lists it; the
     ownership record does not. It must not be reachable by ANY caller -- and the
     caller that matters now is the one that kills a process by pid. */
  assert.equal(map.size, 0, "an unrecorded session is not ours, so it is not in the map");
});

test('#570 a FAILED look is null, NEVER an empty map -- the false-zero rule', () => {
  assert.equal(win32live.byName({ run: () => null, record: store({}) }), null,
    'null means we could not see; an empty map would claim no agents are running');
  assert.equal(win32live.byName({ run: () => 'not json', record: store({}) }), null);
  // And the successful-but-empty look is genuinely distinguishable from it.
  const empty = win32live.byName({ run: agents([]), record: store({}) });
  assert.ok(empty instanceof Map, 'a real look at an idle machine is a Map, not null');
  assert.equal(empty.size, 0);
});

test('#570 recorded but NOT running is absent -- the record outlives the session', () => {
  const map = win32live.byName({
    run: agents([]),
    record: store({ [OURS]: { name: 'pigeonpete', runner: 'claude' } }),
  });
  assert.equal(map.size, 0, 'a dead session stops appearing in agents --json; the record entry stays behind');
});

test('#570 a corrupt store cannot smuggle a row in: __proto__ key and zero-width name', () => {
  // An OWN "__proto__" key, which is what JSON.parse of `{"__proto__":...}` yields.
  const corrupt = JSON.parse('{"__proto__": {"name": "sneaky"}}');
  corrupt[OURS] = { name: '​​' }; // zero-width: no VISIBLE character
  const map = win32live.byName({
    run: agents([
      { sessionId: '__proto__', pid: 1, status: 'idle', name: 'sneaky' },
      { sessionId: OURS, pid: 2, status: 'idle', name: 'invisible' },
    ]),
    record: store(corrupt),
  });
  assert.equal(map.size, 0, 'validId rejects the reserved key; validName rejects the invisible name');
});

test('#570 THE PARITY GUARD: the join keys EXACTLY the names the roster emits', () => {
  /* This is the assertion that replaces a comment. Every shape that has ever
     mattered to the resolution is in one input: a normal agent, one whose
     recorded name is empty so the LIVE name is the fallback, an unrecorded
     stranger, a recorded-but-dead session, and two corrupt entries. */
  const sids = {
    normal: '11111111-1111-1111-1111-111111111111',
    fellBack: '22222222-2222-2222-2222-222222222222',
    dead: '33333333-3333-3333-3333-333333333333',
    blank: '44444444-4444-4444-4444-444444444444',
  };
  const list = [
    { sessionId: sids.normal, pid: 11, status: 'busy', name: 'live-name-differs' },
    { sessionId: sids.fellBack, pid: 12, status: 'idle', name: 'from-the-live-name' },
    { sessionId: sids.blank, pid: 13, status: 'idle', name: 'also-invisible' },
    { sessionId: THEIRS, pid: 14, status: 'idle', name: 'the-operators-own' },
  ];
  const rec = {
    [sids.normal]: { name: 'recorded-name', runner: 'claude' },
    [sids.fellBack]: { name: '', runner: 'claude' },       // -> falls back to the live name
    [sids.dead]: { name: 'not-running', runner: 'claude' }, // recorded, absent from the list
    [sids.blank]: { name: '   ', runner: '' },              // no visible character
  };

  const emitted = win32roster.make({ run: agents(list), record: store(rec) })();
  const emittedNames = emitted.split('\n').filter(Boolean).map((line) => line.split('\t')[0]);
  const joined = [...win32live.byName({ run: agents(list), record: store(rec) }).keys()];

  assert.deepEqual(joined.sort(), emittedNames.sort(),
    'the join and the roster must agree on exactly which names exist, and on their spelling');
  assert.deepEqual(emittedNames.sort(), ['from-the-live-name', 'recorded-name'],
    'and the agreed set is the right one, so parity is not two copies of the same mistake');
});
