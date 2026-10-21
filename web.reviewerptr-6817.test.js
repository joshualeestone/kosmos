'use strict';
/* kosmos#6817 item 1: the board tells a member that someone in their company (or family) was made a reviewer. One notice
   in the floating stack while any grant from the last 30 days is newer than the newest this computer has seen; its x,
   See who, and the Settings list on screen count as seen. The board reads /api/org/grants, which spends none of the
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

/* The notice's functions with a stub document, storage and clock; nothing else of the page. */
function board({ onAgents = true, seen = null, storageThrows = false, listShown = false, plusShown = false } = {}) {
  const store = new Map(seen === null ? [] : [['kosmos.reviewerGrantSeen', String(seen)]]);
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, v); },
  };
  const slot = { innerHTML: '', dataset: {}, writes: 0 };
  Object.defineProperty(slot, 'html', { get: () => slot.innerHTML });
  const box = { hidden: !listShown };
  const document = { getElementById: (id) => (id === 'reviewer-slot' ? slot : id === 'plus-org-reviewers' ? box : null), addEventListener: () => {} };
  const src = 'const PLUS_ORG_REVIEWER_DAYS = 30;\n' + fn('function plusOrgIn(org, text)') + '\n'
    + PAGE.slice(PAGE.indexOf("const REVIEWER_NOTE_KEY = "), PAGE.indexOf('document.addEventListener(\'click\', (e) => {\n  const see = '));
  const api = new Function('document', 'localStorage', 'Date', 'esc', 'onAgentsTab', 'plusOnScreen', 'fetch',
    src + '\nreturn { REVIEWER_NOTE, reviewerNoteNewest, reviewerNoteSeen, reviewerNoteSeenAt, reviewerNoteSeenList, paintReviewerNote };')(
    document, localStorage, { now: () => NOW * 1000 }, (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    () => onAgents, () => plusShown, null);
  return { api, slot, store, box };
}
const grant = (ago) => ({ who: 'pat', grantedAt: NOW - ago, effectiveAt: NOW - ago + DAY });

test('#6817: the newest grant counts only inside the 30 days the Settings list shows, and malformed grants count for nothing', () => {
  const { api } = board();
  assert.equal(api.reviewerNoteNewest([grant(5 * DAY), grant(DAY), grant(40 * DAY)], NOW), NOW - DAY);
  assert.equal(api.reviewerNoteNewest([grant(31 * DAY)], NOW), 0, 'a grant older than the list\'s 30 days raised the notice');
  assert.equal(api.reviewerNoteNewest([null, { grantedAt: 'x' }, {}], NOW), 0);
  assert.equal(api.reviewerNoteNewest(undefined, NOW), 0);
});

test('#6817: a grant newer than the last one seen shows one notice, with See who and a close; the company\'s or the family\'s words', () => {
  const b = board({ seen: NOW - 3 * DAY });
  b.api.REVIEWER_NOTE.grants = [grant(5 * DAY), grant(2 * DAY), grant(DAY)];
  b.api.REVIEWER_NOTE.kind = 'company';
  b.api.paintReviewerNote();
  assert.equal((b.slot.html.match(/class="utoast reviewer-note"/g) || []).length, 1, 'not exactly one notice for two new grants');
  assert.match(b.slot.html, /<b>Someone was made a reviewer for your company\.<\/b>/);
  assert.match(b.slot.html, new RegExp('data-reviewer-see="' + (NOW - DAY) + '">See who</button>'), 'See who does not carry the newest grant');
  assert.match(b.slot.html, /class="ux" data-reviewer-hide="\d+" aria-label="Close this notice"/);
  b.api.REVIEWER_NOTE.kind = 'family';
  b.api.paintReviewerNote();
  assert.match(b.slot.html, /<b>Someone was made a reviewer for your family\.<\/b>/);
});

test('#6817: nothing shows once the newest grant is seen, before any read, or off the agents tab (CONTROL: the same grants show on it)', () => {
  const g = [grant(DAY)];
  const seenAll = board({ seen: NOW - DAY }); seenAll.api.REVIEWER_NOTE.grants = g; seenAll.api.paintReviewerNote();
  assert.equal(seenAll.slot.html, '', 'a grant already seen showed again');
  const unread = board(); unread.api.paintReviewerNote();
  assert.equal(unread.slot.html, '', 'a notice showed before the board read any grants');
  const off = board({ onAgents: false }); off.api.REVIEWER_NOTE.grants = g; off.api.paintReviewerNote();
  assert.equal(off.slot.html, '', 'the notice showed off the agents tab');
  const on = board(); on.api.REVIEWER_NOTE.grants = g; on.api.paintReviewerNote();
  assert.notEqual(on.slot.html, '', 'the control did not show the notice, so the three blanks above prove nothing');
});

test('#6817: seen moves forward only, clears the notice, and a computer that refuses storage still clears it for now', () => {
  const b = board({ seen: NOW - DAY });
  b.api.reviewerNoteSeen(NOW - 5 * DAY);
  assert.equal(b.store.get('kosmos.reviewerGrantSeen'), String(NOW - DAY), 'an older grant moved seen backwards');
  b.slot.innerHTML = 'x'; b.slot.dataset.v = 'x';
  b.api.reviewerNoteSeen(NOW - 10);
  assert.equal(b.store.get('kosmos.reviewerGrantSeen'), String(NOW - 10));
  assert.equal(b.slot.innerHTML, '', 'seeing a grant left its notice up');
  const blocked = board({ storageThrows: true });
  blocked.slot.innerHTML = 'x';
  assert.doesNotThrow(() => blocked.api.reviewerNoteSeen(NOW));
  assert.equal(blocked.slot.innerHTML, '', 'refused storage left the notice up');
  assert.equal(blocked.api.reviewerNoteSeenAt(), 0);
});

test('#6817: the Settings list counts as seen only while it is on screen (CONTROL: on screen, it does)', () => {
  const st = { reviewerGrants: [grant(DAY)] };
  for (const [opts, why] of [[{ listShown: false, plusShown: true }, 'a hidden list'], [{ listShown: true, plusShown: false }, 'Settings not on screen']]) {
    const b = board(opts); b.api.reviewerNoteSeenList(st);
    assert.equal(b.store.size, 0, why + ' counted as seen');
  }
  const b = board({ listShown: true, plusShown: true }); b.api.reviewerNoteSeenList(st);
  assert.equal(b.store.get('kosmos.reviewerGrantSeen'), String(NOW - DAY));
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

test('#6817: a removed grant is not news, whenever it was removed (CONTROL: the same grant not removed is)', () => {
  const { api } = board();
  assert.equal(api.reviewerNoteNewest([{ ...grant(DAY), removedAt: NOW - DAY + 60 }], NOW), 0, 'a grant undone a minute later raised the notice');
  assert.equal(api.reviewerNoteNewest([{ ...grant(5 * DAY), removedAt: NOW - DAY }], NOW), 0, 'a grant since removed raised the notice');
  assert.equal(api.reviewerNoteNewest([grant(DAY)], NOW), NOW - DAY);
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
