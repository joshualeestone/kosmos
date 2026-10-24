'use strict';
/* kosmos#6817 item 1: the board tells a member that someone in their company (or family) was made a reviewer. One notice
   in the floating stack while any grant from the last 30 days, not removed, is one this browser has not seen (a set of
   seen grants, no clock comparison); its x and the reviewers list in view count as seen, See who only goes there. The board reads /api/org/grants, which spends none of the
   one-time notes a GET of /api/org does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); assert.ok(at >= 0, name + ' is not in the page'); return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };

const DAY = 86400;
const NOW = 1_790_000_000;

/* The notice's functions with a stub document, storage, clock and viewport; nothing else of the page. */
function board({ onAgents = true, seen = null, storageThrows = false, listShown = false, plusShown = false, listInView = true, now = NOW } = {}) {
  const store = new Map(seen === null ? [] : [['kosmos.reviewerGrantsSeen', JSON.stringify(seen)]]);
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, v); },
  };
  const slot = { innerHTML: '', dataset: {} };
  Object.defineProperty(slot, 'html', { get: () => slot.innerHTML });
  const box = { hidden: !listShown, getBoundingClientRect: () => (listInView === 'zero' ? { top: 0, bottom: 0, height: 0 } : listInView ? { top: 100, bottom: 300, height: 200 } : { top: 2000, bottom: 2200, height: 200 }) };
  const document = { getElementById: (id) => (id === 'reviewer-slot' ? slot : id === 'plus-org-reviewers' ? box : null), addEventListener: () => {} };
  const clock = { t: now };
  const src = 'const PLUS_ORG_REVIEWER_DAYS = 30;\n' + fn('function plusOrgIn(org, text)') + '\n'
    // From the key to the end of reviewerNoteMaybe, the block's last function (its click handler sits above the Kosmos+
    // panel script; see the comment there).
    + PAGE.slice(PAGE.indexOf("const REVIEWER_NOTE_KEY = "), PAGE.indexOf('\n}\n', PAGE.indexOf('function reviewerNoteMaybe()')) + 2);
  const api = new Function('document', 'localStorage', 'Date', 'esc', 'onAgentsTab', 'plusOnScreen', 'fetch', 'innerHeight',
    src + '\nreturn { REVIEWER_NOTE, reviewerNoteFresh, reviewerNoteUnseen, reviewerNoteSeen, reviewerNoteSeenList, paintReviewerNote };')(
    document, localStorage, { now: () => clock.t * 1000 }, (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    () => onAgents, () => plusShown, null, 800);
  const seenKeys = () => JSON.parse(store.get('kosmos.reviewerGrantsSeen') || '[]');
  return { api, slot, store, box, clock, seenKeys };
}
const grant = (ago, who = 'pat') => ({ who, grantedAt: NOW - ago, effectiveAt: NOW - ago + DAY });
const key = (g) => g.grantedAt + '|' + g.who;

test('#6817: a grant is news inside the list\'s 30 days and not removed; malformed grants count for nothing', () => {
  const { api } = board();
  assert.deepEqual(api.reviewerNoteFresh([grant(5 * DAY), grant(DAY, 'sam'), grant(40 * DAY)], NOW), [key(grant(5 * DAY)), key(grant(DAY, 'sam'))]);
  assert.deepEqual(api.reviewerNoteFresh([{ ...grant(DAY), removedAt: NOW - DAY + 60 }], NOW), [], 'a grant undone a minute later is news');
  assert.deepEqual(api.reviewerNoteFresh([null, { grantedAt: 'x' }, {}], NOW), []);
  assert.deepEqual(api.reviewerNoteFresh(undefined, NOW), []);
});

test('#6817: an unseen grant shows one notice, with See who and a close, in the company\'s or the family\'s words', () => {
  const b = board({ seen: [key(grant(5 * DAY))] });
  b.api.REVIEWER_NOTE.grants = [grant(5 * DAY), grant(2 * DAY), grant(DAY, 'sam')];
  b.api.REVIEWER_NOTE.kind = 'company';
  b.api.paintReviewerNote();
  assert.equal((b.slot.html.match(/class="utoast reviewer-note"/g) || []).length, 1, 'not exactly one notice for two unseen grants');
  assert.match(b.slot.html, /<b>Someone was made a reviewer for your company\.<\/b>/);
  assert.match(b.slot.html, /<button type="button" class="uprime" data-reviewer-see>See who<\/button>/);
  assert.match(b.slot.html, /class="ux" data-reviewer-hide aria-label="Close this notice"/);
  assert.match(b.slot.html, /<div class="utxt" role="status" tabindex="-1">/, 'the notice text cannot take focus, as its siblings can');
  b.api.REVIEWER_NOTE.kind = 'family';
  b.api.paintReviewerNote();
  assert.match(b.slot.html, /<b>Someone was made a reviewer for your family\.<\/b>/);
});

test('#6817: nothing shows once every grant is seen, before any read, or off the agents tab (CONTROL: the same grants show on it)', () => {
  const g = [grant(DAY)];
  const seenAll = board({ seen: [key(grant(DAY))] }); seenAll.api.REVIEWER_NOTE.grants = g; seenAll.api.paintReviewerNote();
  assert.equal(seenAll.slot.html, '', 'a grant already seen showed again');
  const unread = board(); unread.api.paintReviewerNote();
  assert.equal(unread.slot.html, '', 'a notice showed before the board read any grants');
  const off = board({ onAgents: false }); off.api.REVIEWER_NOTE.grants = g; off.api.paintReviewerNote();
  assert.equal(off.slot.html, '', 'the notice showed off the agents tab');
  const on = board(); on.api.REVIEWER_NOTE.grants = g; on.api.paintReviewerNote();
  assert.notEqual(on.slot.html, '', 'the control did not show the notice, so the three blanks above prove nothing');
});

test('#6817: closing stays closed on later repaints, and a new grant brings the notice back (CONTROL)', () => {
  const b = board();
  b.api.REVIEWER_NOTE.grants = [grant(DAY)];
  b.api.paintReviewerNote(); assert.notEqual(b.slot.html, '');
  b.api.reviewerNoteSeen(b.api.REVIEWER_NOTE.grants, NOW);
  assert.equal(b.slot.html, '', 'closing left the notice up');
  b.clock.t = NOW + 5; b.api.paintReviewerNote();
  b.clock.t = NOW + 3600; b.api.paintReviewerNote();
  assert.equal(b.slot.html, '', 'a closed notice came back on a later repaint');
  b.api.REVIEWER_NOTE.grants = [grant(DAY), grant(60, 'sam')];
  b.api.paintReviewerNote();
  assert.notEqual(b.slot.html, '', 'a new grant did not bring the notice back');
});

test('#6817: a grant stamped ahead of this clock closes like any other, and does not hide a later grant', () => {
  const future = { who: 'x', grantedAt: NOW + 3600, effectiveAt: NOW + DAY };
  const b = board();
  b.api.REVIEWER_NOTE.grants = [future];
  b.api.paintReviewerNote(); assert.notEqual(b.slot.html, '', 'a future-stamped grant did not show');
  b.api.reviewerNoteSeen(b.api.REVIEWER_NOTE.grants, NOW);
  for (const t of [NOW + 5, NOW + 600, NOW + 7200]) { b.clock.t = t; b.api.paintReviewerNote(); }
  assert.equal(b.slot.html, '', 'a future-stamped grant came back after its x');
  b.api.REVIEWER_NOTE.grants = [future, grant(-100, 'sam')];   // a real grant, made after it was seen
  b.clock.t = NOW + 200; b.api.paintReviewerNote();
  assert.notEqual(b.slot.html, '', 'a later grant was hidden by the future-stamped one');
});

test('#6817: with storage refused, a closed notice stays closed for the visit (CONTROL: never closed, it shows)', () => {
  const blocked = board({ storageThrows: true });
  blocked.api.REVIEWER_NOTE.grants = [grant(DAY)];
  assert.doesNotThrow(() => blocked.api.reviewerNoteSeen(blocked.api.REVIEWER_NOTE.grants, NOW));
  blocked.api.paintReviewerNote();
  assert.equal(blocked.slot.html, '', 'with storage refused, the closed notice came back');
  const control = board({ storageThrows: true }); control.api.REVIEWER_NOTE.grants = [grant(DAY)]; control.api.paintReviewerNote();
  assert.notEqual(control.slot.html, '');
});

test('#6817: seen keeps only grants still inside the 30 days', () => {
  const b = board({ seen: [key(grant(40 * DAY)), key(grant(10 * DAY))] });
  b.api.reviewerNoteSeen([grant(DAY)], NOW);
  assert.deepEqual(b.seenKeys().sort(), [key(grant(10 * DAY)), key(grant(DAY))].sort());
});

test('#6817: the reviewers list counts as seen only while it is in view (CONTROL: in view, it does)', () => {
  const st = { reviewerGrants: [grant(DAY)] };
  for (const [opts, why] of [[{ listShown: false, plusShown: true }, 'a hidden list'], [{ listShown: true, plusShown: false }, 'Settings not on screen'],
    [{ listShown: true, plusShown: true, listInView: false }, 'a list scrolled out of view'],
    [{ listShown: true, plusShown: true, listInView: 'zero' }, 'a list under a hidden ancestor (zero size)']]) {
    const b = board(opts); b.api.reviewerNoteSeenList(st);
    assert.equal(b.store.size, 0, why + ' counted as seen');
  }
  const b = board({ listShown: true, plusShown: true }); b.api.reviewerNoteSeenList(st);
  assert.deepEqual(b.seenKeys(), [key(grant(DAY))]);
});

test('#6817: the board reads /api/org/grants, never /api/org, and the route spends nothing and gives grants to the screen only', () => {
  const maybe = fn('function reviewerNoteMaybe()');
  assert.match(maybe, /fetch\('\/api\/org\/grants'/);
  assert.doesNotMatch(maybe, /fetch\('\/api\/org'[,)]/, 'the notice reads /api/org, whose GET spends the one-time notes');
  const at = SERVER.indexOf("pathname === '/api/org/grants'");
  assert.ok(at > 0, 'no /api/org/grants route');
  const route = SERVER.slice(at, SERVER.indexOf('\n    return;\n  }\n', at));
  assert.doesNotMatch(route, /clear[A-Z]\w*\(/, 'the grants route spends a one-time note');
  assert.match(route, /isViaScreen\(req, \{\}\) \? oe\.readEnrollment\(\) : null/, 'grants reach a caller that is not the screen');
  assert.match(route, /req\.method === 'GET'/);
});

test('#6817: a failed read keeps what is on screen; a read that says not enrolled clears it', async () => {
  const b = board();
  const src = PAGE.slice(PAGE.indexOf('function reviewerNoteMaybe()'), PAGE.indexOf('\n}\n', PAGE.indexOf('function reviewerNoteMaybe()')) + 2);
  const run = async (answer) => {
    const maybe = new Function('REVIEWER_NOTE', 'paintReviewerNote', 'onAgentsTab', 'fetch', 'Date', src + '\nreturn reviewerNoteMaybe;')(
      b.api.REVIEWER_NOTE, b.api.paintReviewerNote, () => true, () => Promise.resolve(answer), { now: () => NOW * 1000 });
    b.api.REVIEWER_NOTE.at = 0;
    maybe();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  };
  await run({ ok: true, json: () => Promise.resolve({ enrolled: true, kind: 'company', reviewerGrants: [grant(DAY)] }) });
  assert.notEqual(b.slot.html, '', 'a read with a new grant showed nothing');
  await run({ ok: false, json: () => Promise.resolve(null) });
  assert.notEqual(b.slot.html, '', 'a failed read cleared the notice');
  await run({ ok: true, json: () => Promise.resolve({ enrolled: false, kind: null, reviewerGrants: [] }) });
  assert.equal(b.slot.html, '', 'a computer no longer in a company kept the notice');
});

test('#6817: the notice has its own slot in the floating stack, a neutral tone, and 44 px taps on a phone', () => {
  assert.match(PAGE, /<div id="survival-slot"><\/div>[\s\S]{0,300}<div id="reviewer-slot"><\/div>/);
  assert.match(PAGE, /\n\.utoast\.reviewer-note \{ --utone: var\(--label-2\); \}/);
  assert.match(PAGE, /\.utoast\.reviewer-note \.uacts button, \.utoast\.reviewer-note \.ux \{ min-height: 44px; \}/);
});

test('#6817: See who takes the person to a freshly read list and leaves seen to the list; the x hands focus on, never to the page', () => {
  const at = PAGE.indexOf("document.addEventListener('click', (e) => {\n  const see = e.target.closest && e.target.closest('[data-reviewer-see]')");
  assert.ok(at > 0, 'the notice\'s click handler moved; re-anchor this test');
  const h = PAGE.slice(at, PAGE.indexOf('\n});\n', at));
  const seeArm = h.slice(h.indexOf('if (!see) return;'));
  assert.doesNotMatch(seeArm, /reviewerNoteSeen\(/, 'See who marks the notice seen before the list has shown the grant');
  assert.match(seeArm, /PLUS_ORG\.at = 0;[\s\S]*settingsGo\('plus'\)/, 'See who does not force a fresh read before Settings paints');
  assert.match(seeArm, /if \(!plusOnScreen\(\)\) return;/, 'the scroll keeps trying after the person moved on');
  const hideArm = h.slice(h.indexOf('if (hide) {'), h.indexOf('if (!see) return;'));
  assert.match(hideArm, /\.focus\(\)[\s\S]*focusBoardHome\(\)/, 'the x drops focus on the page');
});

