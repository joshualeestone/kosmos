'use strict';
/* kosmos#5536 (#5529): the board tells a member their own backup was opened to someone. One notice while any row in the
   last 30 days is one this browser has not seen; its x and the list in view count as seen, See who only goes there. It
   names nobody, and says nothing to a family. It rides on the reviewer notice's read of /api/org/grants. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SEEN = 'kosmos.recoveriesSeen';

const DAY = 86400;
const NOW = 1_790_000_000;

function board({ onAgents = true, seen = null, storageThrows = false, listShown = false, plusShown = false, listInView = true } = {}) {
  const store = new Map(seen === null ? [] : [[SEEN, JSON.stringify(seen)]]);
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, v); },
  };
  const slot = { innerHTML: '', dataset: {} };
  const box = { hidden: !listShown, getBoundingClientRect: () => (listInView === 'zero' ? { top: 0, bottom: 0, height: 0 } : listInView === 'past-top' ? { top: -500, bottom: 700, height: 1200 } : listInView ? { top: 100, bottom: 300, height: 200 } : { top: 2000, bottom: 2200, height: 200 }) };
  const document = { getElementById: (id) => (id === 'recovery-slot' ? slot : id === 'plus-org-recoveries' ? box : null) };
  const from = PAGE.indexOf('const RECOVERY_NOTE_KEY = ');
  assert.ok(from > 0, 'the notice moved; re-anchor this test');
  const src = 'const PLUS_ORG_RECOVERY_DAYS = 30;\n' + PAGE.slice(from, PAGE.indexOf('function reviewerNoteMaybe()', from));
  const api = new Function('document', 'localStorage', 'Date', 'onAgentsTab', 'plusOnScreen', 'innerHeight',
    src + '\nreturn { RECOVERY_NOTE, recoveryNoteFresh, recoveryNoteUnseen, recoveryNoteSeen, recoveryNoteSeenList, paintRecoveryNote, recoveryNoteKey };')(
    document, localStorage, { now: () => NOW * 1000 }, () => onAgents, () => plusShown, 800);
  const seenKeys = () => JSON.parse(store.get(SEEN) || '[]');
  return { api, slot, store, seenKeys };
}
const given = (ago, who = 'rev') => ({ what: 'key_released', at: NOW - ago, who, epoch: 3 });
const opened = (ago, count = 7, who = 'rev') => ({ what: 'files_opened', at: NOW - ago, who, epoch: 3, count });

test('#5536: a row is news inside the 30 days; malformed rows count for nothing', () => {
  const { api } = board();
  assert.equal(api.recoveryNoteFresh([given(DAY), opened(DAY), given(40 * DAY)], NOW).length, 2);
  assert.deepEqual(api.recoveryNoteFresh([null, { at: 'x' }, {}], NOW), []);
  assert.deepEqual(api.recoveryNoteFresh(undefined, NOW), []);
});

test('#5536: a key given and files opened in the same second are two rows, and so are two reads with different counts', () => {
  const { api } = board();
  const keys = new Set([given(DAY), opened(DAY, 7), opened(DAY, 8), opened(DAY, 7, 'sam')].map(api.recoveryNoteKey));
  assert.equal(keys.size, 4, 'two different rows shared a key, so seeing one would hide the other');
});

test('#5536: unseen rows show one notice with See who and a close, and it names nobody', () => {
  const b = board({ seen: [] });
  b.api.RECOVERY_NOTE.recoveries = [given(2 * DAY, 'Pat Lee'), opened(DAY, 7, 'Pat Lee')];
  b.api.paintRecoveryNote();
  assert.equal((b.slot.innerHTML.match(/class="utoast reviewer-note recovery-note"/g) || []).length, 1, 'not exactly one notice for two rows');
  assert.match(b.slot.innerHTML, /<b>Someone was given access to your backup\.<\/b>/);
  assert.match(b.slot.innerHTML, /<button type="button" class="uprime" data-recovery-see>See who<\/button>/);
  assert.match(b.slot.innerHTML, /class="ux" data-recovery-hide aria-label="Close this notice"/);
  assert.match(b.slot.innerHTML, /<div class="utxt" role="status" tabindex="-1">/);
  assert.doesNotMatch(b.slot.innerHTML, /Pat Lee/, 'the board named the person, for anyone in the room to read');
});

test('#5536: nothing shows once every row is seen, before any read, or off the agents tab (CONTROL: the same rows show on it)', () => {
  const rows = [given(DAY)];
  const key = board().api.recoveryNoteKey(given(DAY));
  const seenAll = board({ seen: [key] }); seenAll.api.RECOVERY_NOTE.recoveries = rows; seenAll.api.paintRecoveryNote();
  assert.equal(seenAll.slot.innerHTML, '', 'a row already seen showed again');
  const unread = board(); unread.api.paintRecoveryNote();
  assert.equal(unread.slot.innerHTML, '', 'a notice showed before the board read anything');
  const off = board({ onAgents: false }); off.api.RECOVERY_NOTE.recoveries = rows; off.api.paintRecoveryNote();
  assert.equal(off.slot.innerHTML, '', 'the notice showed off the agents tab');
  const on = board(); on.api.RECOVERY_NOTE.recoveries = rows; on.api.paintRecoveryNote();
  assert.notEqual(on.slot.innerHTML, '', 'the control did not show the notice, so the three blanks above prove nothing');
});

test('#5536: closing stays closed, and a new row brings the notice back (CONTROL)', () => {
  const b = board();
  b.api.RECOVERY_NOTE.recoveries = [given(DAY)];
  b.api.paintRecoveryNote(); assert.notEqual(b.slot.innerHTML, '');
  b.api.recoveryNoteSeen(b.api.RECOVERY_NOTE.recoveries, NOW);
  assert.equal(b.slot.innerHTML, '', 'closing left the notice up');
  b.api.paintRecoveryNote();
  assert.equal(b.slot.innerHTML, '', 'a closed notice came back on a repaint');
  b.api.RECOVERY_NOTE.recoveries = [opened(60), given(DAY)];
  b.api.paintRecoveryNote();
  assert.notEqual(b.slot.innerHTML, '', 'files opened after the x did not bring the notice back');
});

test('#5536: with storage refused, a closed notice stays closed for the visit (CONTROL: never closed, it shows)', () => {
  const blocked = board({ storageThrows: true });
  blocked.api.RECOVERY_NOTE.recoveries = [given(DAY)];
  assert.doesNotThrow(() => blocked.api.recoveryNoteSeen(blocked.api.RECOVERY_NOTE.recoveries, NOW));
  blocked.api.paintRecoveryNote();
  assert.equal(blocked.slot.innerHTML, '');
  const control = board({ storageThrows: true }); control.api.RECOVERY_NOTE.recoveries = [given(DAY)]; control.api.paintRecoveryNote();
  assert.notEqual(control.slot.innerHTML, '');
});

test('#5536: seen keeps only rows still inside the 30 days', () => {
  const k = board().api.recoveryNoteKey;
  const b = board({ seen: [k(given(40 * DAY)), k(given(10 * DAY))] });
  b.api.recoveryNoteSeen([given(DAY)], NOW);
  assert.deepEqual(b.seenKeys().sort(), [k(given(10 * DAY)), k(given(DAY))].sort());
});

test('#5536: the list counts as seen only while it is in view (CONTROL: in view, it does)', () => {
  const st = { recoveries: [given(DAY)] };
  for (const [opts, why] of [[{ listShown: false, plusShown: true }, 'a hidden list'], [{ listShown: true, plusShown: false }, 'Settings not on screen'],
    [{ listShown: true, plusShown: true, listInView: false }, 'a list scrolled out of view'],
    [{ listShown: true, plusShown: true, listInView: 'zero' }, 'a list under a hidden ancestor'],
    [{ listShown: true, plusShown: true, listInView: 'past-top' }, 'a long list scrolled past its newest row']]) {
    const b = board(opts); b.api.recoveryNoteSeenList(st);
    assert.equal(b.store.size, 0, why + ' counted as seen');
  }
  const b = board({ listShown: true, plusShown: true }); b.api.recoveryNoteSeenList(st);
  assert.equal(b.seenKeys().length, 1);
});

test('#5536: seen on one notice does not touch the other (their keys differ)', () => {
  assert.match(PAGE, /const RECOVERY_NOTE_KEY = 'kosmos\.recoveriesSeen';/);
  assert.match(PAGE, /const REVIEWER_NOTE_KEY = 'kosmos\.reviewerGrantsSeen';/);
});

test('#5536: the read gives a family nothing whatever the answer holds, and a failed read keeps the notice', async () => {
  const b = board();
  const at = PAGE.indexOf('function reviewerNoteMaybe()');
  const src = PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
  const run = async (answer) => {
    const maybe = new Function('REVIEWER_NOTE', 'paintReviewerNote', 'RECOVERY_NOTE', 'paintRecoveryNote', 'onAgentsTab', 'fetch', 'Date', src + '\nreturn reviewerNoteMaybe;')(
      { at: 0 }, () => {}, b.api.RECOVERY_NOTE, b.api.paintRecoveryNote, () => true, () => Promise.resolve(answer), { now: () => NOW * 1000 });
    maybe();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  };
  const ok = (j) => ({ ok: true, json: () => Promise.resolve(j) });
  await run(ok({ enrolled: true, kind: 'family', reviewerGrants: [], recoveries: [given(DAY)] }));
  assert.equal(b.slot.innerHTML, '', 'a family was told about a backup');
  await run(ok({ enrolled: true, kind: 'company', reviewerGrants: [], recoveries: [given(DAY)] }));
  assert.notEqual(b.slot.innerHTML, '', 'a company read showed nothing');
  await run({ ok: false, json: () => Promise.resolve(null) });
  assert.notEqual(b.slot.innerHTML, '', 'a failed read cleared the notice');
  await run(ok({ enrolled: true, kind: 'company', reviewerGrants: [] }));
  assert.equal(b.slot.innerHTML, '', 'a read with no rows left the notice up');
  await run(ok({ enrolled: true, kind: 'company', reviewerGrants: [], recoveries: [given(DAY)] }));
  await run(ok({ enrolled: false, kind: null, reviewerGrants: [] }));
  assert.equal(b.slot.innerHTML, '', 'a computer no longer in a company kept the notice');
});

test('#5536: See who goes to a freshly read list and leaves seen to the list; the x hands focus on, never to the page', () => {
  const at = PAGE.indexOf("document.addEventListener('click', (e) => {\n  const see = e.target.closest && e.target.closest('[data-recovery-see]')");
  assert.ok(at > 0, 'the notice\'s click handler moved; re-anchor this test');
  const h = PAGE.slice(at, PAGE.indexOf('\n});\n', at));
  const seeArm = h.slice(h.indexOf('if (!see) return;'));
  assert.doesNotMatch(seeArm, /recoveryNoteSeen\(/, 'See who marks the notice seen before the list has shown the row');
  assert.match(seeArm, /PLUS_ORG\.at = 0;[\s\S]*settingsGo\('plus'\)/);
  assert.match(seeArm, /getElementById\('plus-org-recoveries'\)/, 'See who lands somewhere other than the recoveries list');
  assert.match(seeArm, /if \(!plusOnScreen\(\)\) return;/);
  const hideArm = h.slice(h.indexOf('if (hide) {'), h.indexOf('if (!see) return;'));
  assert.match(hideArm, /\.focus\(\)[\s\S]*focusBoardHome\(\)/);
});

test('#5536: the notice has its own slot in the stack, and its handler sits above the Kosmos+ panel script as the reviewer one does', () => {
  assert.match(PAGE, /<div id="reviewer-slot"><\/div>[\s\S]{0,300}<div id="recovery-slot"><\/div>/);
  assert.match(PAGE, /#recovery-slot:empty/);
  assert.ok(PAGE.indexOf('[data-recovery-see]') < PAGE.indexOf('const RECOVERY_NOTE_KEY = '), 'the handler moved below the block it reads');
});
