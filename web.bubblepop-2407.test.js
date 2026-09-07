'use strict';
/**
 * #2407: the per-project new-message "bubble pop" sound. Josh chose it from the
 * audition page; a new message on a project you are not looking at plays a soft pop.
 *
 * These assert the CLIENT logic a node --test can see by running the page's actual
 * #2407 block for real (pulled out of web/index.html, not a copy), with stubbed
 * window/localStorage so the decision code runs unchanged:
 *   - the once-per-burst decision (one pop no matter how many projects/messages rose),
 *   - no pop on the first load (only a rise AFTER a baseline rings),
 *   - a muted project does not ring, and the mute is per-project,
 *   - Do-Not-Disturb suppresses the pop,
 *   - the pop is built from the documented recipe (sine, 400->900 Hz glide, ~0.13s).
 * The end-to-end play in a real page is covered by docs/browser-checks/render-bubblepop-2407.js.
 *
 *   node --test web.bubblepop-2407.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

// Pull the whole #2407 block (BUBBLE_CTX through ringNewMessages) and run it with
// injected globals, so the module-scoped state (PJ_UNREAD_SEEN, SOUND_QUIET, the audio
// context) behaves exactly as it does in the page.
function loadSound(opts) {
  opts = opts || {};
  const start = SCRIPT.indexOf('let BUBBLE_CTX = null;');
  assert.ok(start >= 0, 'the #2407 block is missing from the page');
  const endMarker = '\n}\n';
  const ringIdx = SCRIPT.indexOf('function ringNewMessages', start);
  assert.ok(ringIdx > start, 'ringNewMessages is missing');
  const end = SCRIPT.indexOf(endMarker, ringIdx);
  assert.ok(end > ringIdx, 'could not bound ringNewMessages');
  const src = SCRIPT.slice(start, end + endMarker.length);

  // A minimal Web Audio stub that records how many pops (oscillators) started, and
  // the frequency ramp of the last one, so the recipe can be asserted.
  const started = [];
  function makeCtx() {
    return {
      state: 'running',
      currentTime: 0,
      resume() { return Promise.resolve(); },
      destination: {},
      createOscillator() {
        const o = { type: '', freq: [], connect() {}, disconnect() {},
          frequency: { setValueAtTime: (v) => o.freq.push(['set', v]), linearRampToValueAtTime: (v, t) => o.freq.push(['ramp', v, t]) },
          start() { started.push(o); }, stop() {}, onended: null };
        return o;
      },
      createGain() {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}, disconnect() {} };
      },
    };
  }
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const win = opts.noAudio ? {} : { AudioContext: makeCtx };
  // PJ_CURRENT is a page global the extracted block reads (to never ring the open
  // project); declare it in the wrapper and expose a setter so the tests can drive it.
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', 'localStorage',
    'var PJ_CURRENT = null;\n' + src + '\nreturn { ringNewMessages, projectSoundOn, setProjectSoundOn, soundMasterOn, setSoundMasterOn, playBubblePop, setQuiet: (v) => { SOUND_QUIET = v; }, setCurrent: (v) => { PJ_CURRENT = v; } };');
  const api = factory(win, localStorage);
  api.started = started;
  return api;
}

test('#2407: the first load baselines and does NOT ring', () => {
  const s = loadSound();
  s.ringNewMessages([{ id: 'a', unread: 3 }, { id: 'b', unread: 0 }]);
  assert.equal(s.started.length, 0, 'a pop rang on the first (baseline) load');
});

test('#2407: a rise on a later load rings once', () => {
  const s = loadSound();
  s.ringNewMessages([{ id: 'a', unread: 0 }]);          // baseline
  s.ringNewMessages([{ id: 'a', unread: 1 }]);          // a new message
  assert.equal(s.started.length, 1, 'a single new message did not ring exactly once');
});

test('#2407: several messages/projects rising at once make ONE pop (per burst)', () => {
  const s = loadSound();
  s.ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]);      // baseline
  s.ringNewMessages([{ id: 'a', unread: 4 }, { id: 'b', unread: 2 }]);      // both jump
  assert.equal(s.started.length, 1, 'a burst rang more than once');
});

test('#2407: no rise means no pop', () => {
  const s = loadSound();
  s.ringNewMessages([{ id: 'a', unread: 2 }]);          // baseline
  s.ringNewMessages([{ id: 'a', unread: 2 }]);          // unchanged
  s.ringNewMessages([{ id: 'a', unread: 1 }]);          // fell (read elsewhere)
  assert.equal(s.started.length, 0, 'a pop rang without a rise');
});

test('#2407: a muted project does not ring, and the mute is per-project', () => {
  const s = loadSound();
  s.setProjectSoundOn('a', false);                      // mute a
  assert.equal(s.projectSoundOn('a'), false);
  assert.equal(s.projectSoundOn('b'), true, 'default is ON for an unset project');
  s.ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]);   // baseline
  s.ringNewMessages([{ id: 'a', unread: 5 }, { id: 'b', unread: 0 }]);   // only the muted one rose
  assert.equal(s.started.length, 0, 'a muted project rang');
  s.ringNewMessages([{ id: 'a', unread: 6 }, { id: 'b', unread: 1 }]);   // b (unmuted) rose
  assert.equal(s.started.length, 1, 'an unmuted project failed to ring');
});

test('#2436: the master defaults ON, and turning it OFF silences even an unmuted project', () => {
  const s = loadSound();
  assert.equal(s.soundMasterOn(), true, 'the master default is not ON');
  s.setSoundMasterOn(false);                            // master off
  assert.equal(s.soundMasterOn(), false);
  s.ringNewMessages([{ id: 'a', unread: 0 }]);          // baseline
  s.ringNewMessages([{ id: 'a', unread: 3 }]);          // an unmuted project rose
  assert.equal(s.started.length, 0, 'the master was off but a pop still rang');
});

test('#2436: the master gate is the discriminator (same rise, only the master differs)', () => {
  // Off: silent.
  const off = loadSound();
  off.setSoundMasterOn(false);
  off.ringNewMessages([{ id: 'a', unread: 0 }]);
  off.ringNewMessages([{ id: 'a', unread: 2 }]);
  assert.equal(off.started.length, 0, 'master OFF rang');
  // On (default): the identical rise rings, proving the OFF result is the master, not the setup.
  const on = loadSound();
  on.ringNewMessages([{ id: 'a', unread: 0 }]);
  on.ringNewMessages([{ id: 'a', unread: 2 }]);
  assert.equal(on.started.length, 1, 'master ON failed to ring the identical rise');
});

test('#2436: turning the master OFF SILENCES rather than DEFERS -- flipping back on rings no backlog', () => {
  const s = loadSound();
  s.setSoundMasterOn(false);                            // master off
  s.ringNewMessages([{ id: 'a', unread: 0 }]);          // baseline
  s.ringNewMessages([{ id: 'a', unread: 5 }]);          // messages arrived while muted (silent)
  assert.equal(s.started.length, 0, 'muted master rang');
  s.setSoundMasterOn(true);                             // master back on
  s.ringNewMessages([{ id: 'a', unread: 5 }]);          // unchanged since the muted read: no NEW rise
  assert.equal(s.started.length, 0, 'flipping the master back on rang a backlog for messages that arrived while muted');
  s.ringNewMessages([{ id: 'a', unread: 6 }]);          // a genuine new message after re-enabling
  assert.equal(s.started.length, 1, 'a real new message after re-enabling did not ring');
});

test('#2407: an UNKNOWN count (null unread) never rings and never rebaselines to zero', () => {
  const s = loadSound();
  s.ringNewMessages([{ id: 'a', unread: 2 }]);          // baseline: a has 2 unread
  s.ringNewMessages([{ id: 'a', unread: null }]);       // a transient count-read failure
  assert.equal(s.started.length, 0, 'an unknown count rang');
  // The prior baseline (2) must have carried forward, so a normal read of the SAME 2
  // is not a 0->2 rise. This is the spurious-burst bug the null-handling prevents.
  s.ringNewMessages([{ id: 'a', unread: 2 }]);
  assert.equal(s.started.length, 0, 'a stale null rebaselined to 0 and then false-rang');
  s.ringNewMessages([{ id: 'a', unread: 3 }]);          // a genuine new message
  assert.equal(s.started.length, 1, 'a real rise after an unknown blip did not ring');
});

test('#2407: the currently-open project never rings (badge zeroes it after the poll)', () => {
  const s = loadSound();
  s.setCurrent('a');                                    // a is open
  s.ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]);   // baseline
  s.ringNewMessages([{ id: 'a', unread: 1 }]);          // a message in the OPEN room, /seen not yet in
  assert.equal(s.started.length, 0, 'the open project rang');
  s.setCurrent('b');                                    // switch to b; a is no longer open
  s.ringNewMessages([{ id: 'a', unread: 2 }]);          // a further message on the now-background a
  assert.equal(s.started.length, 1, 'a background project failed to ring after switching away');
});

test('#2407: a project seen for the first time WITH unread does not ring (it is appearing)', () => {
  const s = loadSound();
  s.ringNewMessages([{ id: 'a', unread: 0 }]);          // baseline knows only a
  s.ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 4 }]);   // b appears already-unread
  assert.equal(s.started.length, 0, 'a newly-appeared project rang on first sighting');
});

test('#2407: Do-Not-Disturb suppresses the pop', () => {
  const s = loadSound();
  s.setQuiet(true);
  s.ringNewMessages([{ id: 'a', unread: 0 }]);          // baseline
  s.ringNewMessages([{ id: 'a', unread: 3 }]);          // a rise, but quiet
  assert.equal(s.started.length, 0, 'a pop rang during DND');
  s.setQuiet(false);
  s.ringNewMessages([{ id: 'a', unread: 4 }]);          // rise, DND cleared
  assert.equal(s.started.length, 1, 'no pop after DND cleared');
});

test('#2407: the pop is the documented recipe (sine, 400->900 Hz glide)', () => {
  const s = loadSound();
  s.playBubblePop();
  assert.equal(s.started.length, 1);
  const o = s.started[0];
  assert.equal(o.type, 'sine', 'the pop is not a sine');
  assert.deepEqual(o.freq[0], ['set', 400], 'the pop does not start at 400 Hz');
  const ramp = o.freq.find((f) => f[0] === 'ramp');
  assert.ok(ramp && ramp[1] === 900, 'the pop does not glide to 900 Hz');
});

test('#2407: a browser with no Web Audio is silent, not a crash', () => {
  const s = loadSound({ noAudio: true });
  s.ringNewMessages([{ id: 'a', unread: 0 }]);
  assert.doesNotThrow(() => s.ringNewMessages([{ id: 'a', unread: 9 }]));
  assert.equal(s.started.length, 0);
});
