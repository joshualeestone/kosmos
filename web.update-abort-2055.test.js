'use strict';
/* #2055: the update-abort board notice. `paintUpdateAbort` renders #uabort-slot
   from /api/status's `updateAbort` marker ONLY when count >= 1; null / absent /
   count 0 / a garbage count all clear it, and it is called only from tick()'s
   success path so a failed read never paints a false "healthy" (that screen is
   #2023's). The browser check (docs/browser-checks/render-update-abort-2055.js)
   drives the REAL tick end-to-end with the card's dangerous-answer control; this
   pins the painter directly and fast. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

// A fresh slot per call, driving the REAL paintUpdateAbort source (not a copy).
function paint(ab) {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'uabort-slot' ? slot : null) };
  // eslint-disable-next-line no-new-func
  new Function('document', 'ab', page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'paintUpdateAbort']) + '\npaintUpdateAbort(ab);')(doc, ab);
  return slot;
}

test('a present marker (count >= 1) renders the notice: title, N, agents-kept-working, and the quit-and-reopen action', () => {
  const s = paint({ count: 3, reason: 'board-would-not-pause', port: 16180, ts: '' });
  assert.match(s.innerHTML, /new version of Kosmos is ready/i, 'the notice did not render its title for a stuck machine');
  assert.match(s.innerHTML, /tried to install it 3 times/i, 'the count N is the sentence that makes someone act, and it is missing');
  assert.match(s.innerHTML, /agents keep working/i, 'the reassurance that agents keep working is missing');
  // The action is quit-and-reopen (measured: "Update now" re-enters setup.sh's
  // pause block and aborts identically -- a dead button), never a type instruction.
  assert.match(s.innerHTML, /quit and reopen Kosmos/i, 'the actionable, user-doable step is missing');
  assert.ok(!/update now|paste|install line|kosmos stop|in a terminal/i.test(s.innerHTML), 'the notice offered a dead button or a type instruction');
});

test('count 1 reads "install it once", not "1 times"', () => {
  const s = paint({ count: 1 });
  assert.match(s.innerHTML, /install it once/i);
  assert.ok(!/1 times/.test(s.innerHTML), 'count 1 rendered the plural form');
});

test('null / absent / count 0 / a garbage count all clear the slot (no false notice, never NaN)', () => {
  assert.equal(paint(null).innerHTML, '', 'an explicit null painted a notice');
  assert.equal(paint(undefined).innerHTML, '', 'an absent field painted a notice');
  assert.equal(paint({ count: 0 }).innerHTML, '', 'count 0 (healthy) painted a notice');
  const g = paint({ count: 'lots' });
  assert.equal(g.innerHTML, '', 'a non-numeric count painted a notice');
  assert.ok(!/NaN/.test(g.innerHTML), 'a garbage count leaked NaN into the copy');
});

test('a recovered machine (count -> null on the SAME slot) clears the notice it was showing', () => {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: () => slot };
  const run = (ab) => new Function('document', 'ab', page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'paintUpdateAbort']) + '\npaintUpdateAbort(ab);')(doc, ab);
  run({ count: 2 });
  assert.match(slot.innerHTML, /2 times/, 'the notice did not show first');
  run(null);
  assert.equal(slot.innerHTML, '', 'a later null left a stale abort notice standing over a recovered machine');
});

// #4675: the sentence is chosen by the stop's reason, and says only what the installer saw.
const BUSY = /Kosmos was busy each time\. Quit and reopen Kosmos: reopening usually clears whatever was holding the update, so the next one can finish\. Your agents keep working, they do not live in this window\./;
const REOPEN = /Quit and reopen Kosmos: reopening usually clears whatever was holding the update, so the next one can finish\. Your agents keep working, they do not live in this window\./;
const TYPED = /update now|paste|install line|kosmos stop|in a terminal/i;
const body = (h) => h.replace(/^.*and could not, because /, '').replace(/<\/small>.*$/, '');

test('#4675 control: board-would-not-pause keeps the #2055 sentence, word for word, with or without a same count', () => {
  const old = paint({ count: 2, reason: 'board-would-not-pause' }).innerHTML;   // a marker from before `same` existed
  assert.match(old, BUSY, 'the #2055 sentence changed');
  assert.equal(paint({ count: 2, reason: 'board-would-not-pause', same: 2 }).innerHTML, old);
  assert.equal(paint({ count: 2, reason: 'board-would-not-pause', same: null }).innerHTML, old);
});

test('#4675: a failed port check says the update could not check, and the step is a restart, not a reopen', () => {
  const h = paint({ count: 4, reason: 'port-check-failed', same: 4 }).innerHTML;
  assert.match(h, /tried to install it 4 times and could not, because this computer could not check whether Kosmos had stopped, so the update replaced nothing\./);
  assert.match(h, /Restarting this computer is the step to try\./, 'no step a person can take');
  assert.match(h, /agents keep working/i);
  assert.ok(h.indexOf('agents keep working') < h.indexOf('Restarting this computer'), 'the reassurance about agents follows the restart, which would stop them');
  assert.ok(!/was busy|quit and reopen/i.test(h), 'it blamed a busy Kosmos, or offered a reopen that cannot fix a failing check');
  assert.ok(!TYPED.test(h), 'the notice offered a dead button or a type instruction');
});

test('#4675: both stops with something on the port say so in the same words, with the #2055 remedy', () => {
  const h = paint({ count: 3, reason: 'port-unreachable', same: 3 }).innerHTML;
  assert.match(h, /tried to install it 3 times and could not, because each time, something was still using the connection Kosmos runs on, so the update replaced nothing\./);
  assert.match(h, REOPEN);
  assert.ok(!/was busy/i.test(h), 'it still blamed a busy Kosmos');
  assert.ok(!TYPED.test(h), 'the notice offered a dead button or a type instruction');
  assert.equal(paint({ count: 3, reason: 'port-still-held', same: 3 }).innerHTML, h, 'the two held-port stops read differently');
});

test('#4675: a reason this page does not know gets the plain sentence, never a cause it cannot know', () => {
  const plain = paint({ count: 2, reason: 'something-new', same: 2 }).innerHTML;
  assert.match(plain, /tried to install it 2 times and could not, because the update stopped each time before replacing anything\./);
  assert.match(plain, REOPEN);
  assert.ok(!/was busy|could not check|still using/i.test(plain), 'an unknown reason was given a known cause');
  assert.ok(!TYPED.test(plain));
  // no reason, a non-string, and names an object already has (a lookup that reached the prototype would paint a function)
  for (const reason of ['', undefined, 7, 'unknown', 'constructor', '__proto__', 'hasOwnProperty', 'toString']) {
    assert.equal(body(paint({ count: 2, reason, same: 2 }).innerHTML), body(plain), 'reason ' + JSON.stringify(reason) + ' did not get the plain sentence');
  }
});

test('#4675: a streak of mixed reasons names no single cause, and its count is the whole streak', () => {
  const plain = body(paint({ count: 5, reason: 'something-new', same: 5 }).innerHTML);
  for (const reason of ['board-would-not-pause', 'port-check-failed', 'port-unreachable', 'port-still-held']) {
    const mixed = paint({ count: 5, reason, same: 2 }).innerHTML;
    assert.match(mixed, /tried to install it 5 times and could not, because the update stopped each time/, reason + ': the count is not the whole streak');
    assert.equal(body(mixed), plain, reason + ' spoke for stops that had another cause');
    // control: the same marker with every stop sharing the reason does name it
    assert.notEqual(body(paint({ count: 5, reason, same: 5 }).innerHTML), plain, reason + ' lost its own sentence');
    assert.notEqual(body(paint({ count: 5, reason, same: 9 }).innerHTML), plain, reason + ': a same above the count is still "all of them"');
  }
});

test('#4675: the notice repaints when its words change, and not otherwise (a screen reader hears each repaint)', () => {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: () => slot };
  const run = (ab) => new Function('document', 'ab', page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'paintUpdateAbort']) + '\npaintUpdateAbort(ab);')(doc, ab);
  run({ count: 1, reason: 'board-would-not-pause', same: 1 });
  assert.match(slot.innerHTML, /was busy/);
  run({ count: 1, reason: 'port-check-failed', same: 1 });
  assert.match(slot.innerHTML, /could not check/, 'the same count with a new reason kept the old words');
  slot.innerHTML = 'UNTOUCHED';
  run({ count: 1, reason: 'port-check-failed', same: 1 });
  assert.equal(slot.innerHTML, 'UNTOUCHED', 'an unchanged notice was repainted');
  run({ count: 1, reason: 'port-unreachable', same: 1 });
  assert.match(slot.innerHTML, /still using the connection/);
  slot.innerHTML = 'UNTOUCHED';
  run({ count: 1, reason: 'port-still-held', same: 1 });
  assert.equal(slot.innerHTML, 'UNTOUCHED', 'a reason change that changes no words was repainted');
  run({ count: 2, reason: 'port-still-held', same: 2 });
  assert.match(slot.innerHTML, /2 times/, 'a changed count did not repaint');
});

test('#4675: the board marks its own installer run, and setup.sh records the port stops only for that run', () => {
  const upd = fs.readFileSync(nodePath.join(__dirname, 'engine', 'update.js'), 'utf8');
  assert.match(upd, /KOSMOS_SOURCE_CHANNEL: updateChannel\(\), KOSMOS_UPDATE_BY_BOARD: '1' \}/, 'the installer the board spawns no longer carries KOSMOS_UPDATE_BY_BOARD');
  const setup = fs.readFileSync(nodePath.join(__dirname, 'install', 'setup.sh'), 'utf8');
  for (const reason of ['port-check-failed', 'port-unreachable', 'port-still-held']) {
    assert.ok(setup.includes('if [ "$_kosmos_by_board" = yes ]; then _kosmos_note_pause_abort ' + reason + '; fi'), 'setup.sh does not record ' + reason + ' for the board\'s run only');
  }
  // every reason setup.sh can write has its own entry in the page's table (none falls to the plain sentence by accident)
  // calls only: a reason is hyphenated and ends the command, so prose that names the function is not counted
  const written = [...setup.matchAll(/^[^#\n]*_kosmos_note_pause_abort ([a-z]+(?:-[a-z]+)+)(?:;|$)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(written, ['board-would-not-pause', 'port-check-failed', 'port-still-held', 'port-unreachable']);
  const fn = page.liftAll(SCRIPT, ['paintUpdateAbort']);
  for (const reason of written) assert.ok(fn.includes("'" + reason + "': "), 'the page has no words for ' + reason);
  // install/kosmos starts the board in two places and strips the marker in both, so a board never hands it to its agents
  const cli = fs.readFileSync(nodePath.join(__dirname, 'install', 'kosmos'), 'utf8');
  const starts = cli.split('\n').filter((l) => /^\s*(exec )?env -u KOSMOS_AGENT_SESSION .*"\$NODE" "\$APP"/.test(l));
  assert.equal(starts.length, 2, 'expected the two lines in install/kosmos that start the board');
  for (const l of starts) assert.ok(l.includes(' -u KOSMOS_UPDATE_BY_BOARD '), 'a board start in install/kosmos does not strip KOSMOS_UPDATE_BY_BOARD');
});
