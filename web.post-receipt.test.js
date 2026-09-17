'use strict';

/**
 * The room post receipt: the delivery facts under a room post (pjReceiptSentence)
 * and the rendered room row (pjRoomRow).
 *
 * 🛑 HISTORY. This file was born for the "Nothing back from <agent>" silence
 * sentence (#145): Josh posted into a room and got "Placed with Johnson, Rick
 * and Bob." while nothing came back, a receipt that was TRUE yet could not tell
 * working from broken. #3130 (Josh 6.68) removed that silence sentence, #3134
 * removed the inline delivery receipt from the room, and #3202 removed the dead
 * silence-computation plumbing. What remains under test: the delivery clauses
 * that still speak ("could not be reached", "may have it; not confirmed") and
 * that no silence sentence reaches the screen.
 *
 * ⚠️ THE FUNCTIONS ARE EXECUTED, not grepped for. A test that reads index.html
 * as text can prove a sentence is present somewhere in a 15,000-line file and
 * nothing about whether the branch producing it is reachable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/**
 * The page's own script, evaluated whole, with a DOM stub.
 *
 * 🛑 THIS FILE USED TO SLICE INDIVIDUAL FUNCTIONS OUT BY BRACE-MATCHING, and
 * that is why the renderer had no test: `pjRoomRow` reaches nine helpers and
 * two module-level values, and each one discovered by a ReferenceError was
 * another guess about what the page contains. A harness that is hard to point
 * at the real thing gets pointed at a fragment instead — and the fragment
 * passed while the hop that makes the feature visible was never executed.
 *
 * ⚠️ Evaluating the whole script is also the only version that CANNOT drift:
 * there is no list of dependencies to keep in step with the page.
 */
function pageScope() {
  const src = PAGE.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(src, 'the page has no script block');
  /* ⚠️ THE STUB RECORDS `innerHTML`, because that is the only way to see what
     `paintRoom` produced. A stub that swallows writes lets the whole wiring hop
     go untested — and that hop is the one that makes the feature visible.
     ⚠️ WHAT IT CANNOT REPRESENT, said so the next author does not read a green
     paintRoom test as covering more than it does: an UNSET property. `get`
     returns a truthy proxy for any unknown key, so the page's repaint-suppression
     checks (`if (el.__lastLive === html) return`, `box.__lastRoom`, and their
     neighbours) never match and always fall through to the write. In a browser
     those branches skip. Every test here passes THROUGH that machinery without
     exercising it, so a regression in the caching path is invisible from here. */
  const written = {};
  /* ⚠️ GEOMETRY IS NUMBERS, NOT PROXIES (#1037). paintRoom now measures whether
     the reader is on the floor before it rewrites, and `proxy > 0` throws
     "Cannot convert object to primitive value" — which took two tests in this
     file red on a correct product. Zero is the honest model: this stub has no
     layout, so it is a box nobody can see, and the page's own rule is that an
     unseen box is never treated as being at the bottom. The scroll behaviour is
     measured in a real browser by docs/browser-checks/render-room-scroll.js. */
  const GEOMETRY = { scrollTop: 0, scrollHeight: 0, clientHeight: 0, offsetHeight: 0 };
  const el = (id) => new Proxy(function () {}, {
    get: (t, k) => (k === 'textContent' || k === 'value' ? ''
      : (k in GEOMETRY ? GEOMETRY[k]
      : (k === 'innerHTML' ? (written[id] || '') : el(id)))),
    set: (t, k, v) => { if (k === 'innerHTML') written[id] = String(v); return true; },
    apply: () => el(id),
  });
  const document = {
    getElementById: (id) => el(id), querySelector: () => el('?'), querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('new'),
    documentElement: el('html'), body: el('body'), readyState: 'complete',
  };
  const window = {
    addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { hash: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  // eslint-disable-next-line no-new-func
  const api = new Function(
    'document', 'window', 'navigator', 'fetch', 'setInterval', 'setTimeout',
    'clearInterval', 'EventSource', 'location', 'localStorage',
    src[1] + `
    return { pjJoinNames, pjNameOf,
             pjReceiptSentence, pjOldEnoughToJudge, pjRoomRow, pjFoldRoomRows, PJ_SILENCE_AFTER_MS,
             paintRoom, setProject: (proj) => { PROJECTS = [proj]; PJ_CURRENT = proj.id; } };`,
  )(document, window, {}, () => new Promise(() => {}), () => 0, () => 0, () => {},
    function EventSource() {}, window.location, window.localStorage);
  return Object.assign(api, { written });
}

const api = pageScope();
const renderer = () => api.pjRoomRow;

test('the threshold this file tests is the one the page ships', () => {
  /**
   * ⚠️ Read, then asserted, so a change to the page is a FAILURE here rather
   * than a silently different pass. Two minutes is the number the design
   * settled on: under it, silence is the normal shape of a working room.
   */
  assert.equal(api.PJ_SILENCE_AFTER_MS, 2 * 60 * 1000,
    'the page changed the silence threshold; the tests below describe two minutes');
});

/**
 * A project's member list, in the shape `engine/projects.js` really emits.
 *
 * ⚠️ NOT A BOARD CARD, which is what the suite's hand-built-fixture rule is
 * about — these come from `describe()`, not from `snapshot()`. But the shape is
 * still pinned to the producer rather than invented, below, so it cannot drift
 * into a stand-in carrying fields nothing emits.
 *
 * ⚠️ And built with shorthand, which is how `describe()` builds it too.
 */
const member = (sessionName, name) => ({ sessionName, name });
const P = { agents: [member('johnson', 'Johnson'), member('rick', 'Rick'), member('bob', 'Bob')] };

test('the member fixture is the shape the engine actually emits', () => {
  /**
   * ⚠️ THE FIXTURE IS PINNED TO ITS PRODUCER. Every test below reads a member's
   * `name` through `pjNameOf`, and a fixture free to invent fields is how a
   * display name ships dead: the tests pass against a shape the engine never
   * produces.
   */
  const src = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');
  const at = src.indexOf('const members = (project.agents || []).map(');
  assert.notEqual(at, -1, 'describe() no longer builds members here, so this fixture is unanchored');
  const block = src.slice(at, at + 900);
  assert.match(block, /\n\s+sessionName,/, 'members no longer carry sessionName');
  assert.match(block, /\n\s+name: card && card\.name/, 'members no longer carry a display name');
});
const ALL_PLACED = { johnson: 'placed', rick: 'placed', bob: 'placed' };
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

/** A room: the person's post, then whatever came after it. */
function room(after) {
  /* ⚠️ `from: 'you'`, NOT null. That is what `sendPost` writes for an operator
     post, and the first version of this fixture invented `null` — which made
     the operator test unable to fail, because a null name matches no agent
     whatever the code does. */
  const post = { kind: 'post', id: 'm-op', operator: true, from: 'you', to: Object.keys(ALL_PLACED),
    at: ago(5), outcomes: ALL_PLACED, text: 'hello' };
  return { rows: [post, ...after], post };
}
/* ⚠️ THE SHAPE THE /room ROUTE EMITS, field for field: it builds every post row
   as { kind, id, from, to, operator, text, at, outcomes }. The earlier fixture
   was { from, at, text } — three of eight — and that omission is what made the
   safer allow-list (`kind === 'post'`) impossible to adopt: tightening the code
   failed every test, so the loose code was the only code the fixtures allowed.
   A fixture free to invent a shape does not only miss defects; it can pin the
   defect in place. */
const said = (who) => ({ kind: 'post', id: 'm-' + who, from: who, to: ['you'],
  operator: false, at: ago(4), text: 'here', outcomes: {} });

/* ⚠️ SESSION NAMES, which is what the page passes now. It used to map them to
   display names first — and display names are not unique, so two agents both
   showing "Rick" merged into one match. */
const sentence = () => api.pjReceiptSentence(ALL_PLACED, P);

test('#3130 (Josh 6.68): the "Nothing back from ..." silence sentence is gone', () => {
  /**
   * Josh asked to remove the "nothing back from <agent>" / "nothing back from
   * any of them" messages entirely. `pjReceiptSentence` no longer emits them, so
   * a post placed with everyone yields an EMPTY receipt -- the delivery facts
   * (could-not-reach / unconfirmed) still speak; the silence clause does not.
   * (#3202 then removed the now-dead silence-computation plumbing -- pjSilences /
   * pjSilentSince / pjJoinOr / the `silent` params -- that used to feed it.)
   */
  assert.equal(sentence(), '');
  assert.equal(sentence(), '');
  assert.equal(sentence(), '');
});

test('a post that simply worked says nothing at all', () => {
  /**
   * 🔑 JOSH, 2026-08-21: *"lets kill the bubble that says 'Placed with Name,
   * Name, and Name' when i post a message"*. Reaching everyone is the expected
   * outcome of posting, and a sentence saying only that printed under every
   * post is the CLI overclaim with the sign flipped: noise people learn to stop
   * reading. The whole receipt is now empty in the healthy case.
   *
   * ⚠️ AND THE DELIVERY HALF MUST STILL SPEAK WHEN IT HAS NEWS, which is the
   * assertion that keeps this from being "delete the receipt". "Placed with A
   * and B" is what makes "C could not be reached" actionable — without it a
   * person cannot tell whether anybody got it.
   */
  assert.equal(sentence(), '');
  assert.equal(sentence(), '');

  const mixed = { johnson: 'placed', rick: 'placed', bob: 'could_not' };
  assert.equal(api.pjReceiptSentence(mixed, P),
    'Placed with Johnson and Rick. Bob could not be reached.',
    'the names of who DID get it went missing from the case that needs them');

  const unsure = { johnson: 'placed', rick: 'unconfirmed', bob: 'placed' };
  assert.match(api.pjReceiptSentence(unsure, P), /^Placed with Johnson and Bob\./,
    'an unconfirmed recipient should still leave the placed names on screen');
});

test('#3130: a placed-everywhere post with a silent recipient now yields an empty receipt', () => {
  // Was "Nothing back from Rick."; the silence clause is removed.
  const one = { rick: 'placed' };
  assert.equal(api.pjReceiptSentence(one, P), '');
});

test('#3130: delivery facts still speak, but no silence sentence is appended', () => {
  /**
   * The actionable delivery clauses ("could not be reached", "may have it; not
   * confirmed") are kept -- Josh removed the silence noise, not the delivery
   * receipt. Whatever the silent list, no "Nothing back from ..." is added.
   */
  const mixed = { johnson: 'placed', rick: 'could_not', bob: 'unconfirmed' };
  const s = api.pjReceiptSentence(mixed, P);
  assert.match(s, /Rick could not be reached\./);
  assert.match(s, /Bob may have it; not confirmed/);
  assert.doesNotMatch(s, /Nothing back/);
});

test('two minutes is a floor, and a message with no timestamp is not "long ago"', () => {
  /**
   * ⚠️ THE DEFAULT ON A MISSING TIMESTAMP IS THE QUIET ONE. Treating an
   * unparseable date as old would put "nothing back from all of them" under a
   * post that was sent a second earlier — a false alarm produced by our own
   * missing data.
   */
  assert.equal(api.pjOldEnoughToJudge(ago(5)), true);
  assert.equal(api.pjOldEnoughToJudge(ago(1)), false);
  assert.equal(api.pjOldEnoughToJudge(new Date().toISOString()), false);
  for (const bad of [undefined, null, '', 'not a date', {}]) {
    assert.equal(api.pjOldEnoughToJudge(bad), false, `${JSON.stringify(bad)} was treated as long ago`);
  }
});

test('the room render carries no silence sentence and no delivery receipt', () => {
  /**
   * 🛑 THIS DRIVES THE REAL `pjRoomRow`, not a stub, and reads the HTML a person
   * would receive. The file's "ships dead" lesson: nothing here executed pjRoomRow
   * once, so a dead render path stayed green. #3130 removed the "Nothing back ..."
   * silence sentence and #3134-followup (Josh 6.72) removed the inline delivery
   * receipt from the room entirely, so this asserts BOTH are absent from the
   * rendered row -- driving the real renderer so a stray receipt or sentence would
   * be caught rather than shipping unnoticed.
   */
  const render = renderer();

  const post = { kind: 'post', operator: true, from: 'you', at: ago(5), outcomes: ALL_PLACED, text: 'anyone there?' };

  /* #3130: the row renders (anchored on the post's own text) and carries NO silence
     sentence whatever the silent list.
     #3134-followup (Josh 6.72): the room now renders NO inline delivery receipt at all --
     `.delivery` is gone from pjRoomRow entirely -- so an all-placed operator post draws
     no `.delivery` span (the old "empty pill" guard is subsumed: there is no pill to be
     empty). Non-vacuous vs the pre-6.72 code, which rendered a `.delivery placed` span. */
  const withSilence = render(post, P, ['rick', 'bob']);
  assert.match(withSilence, /anyone there\?/, 'the row did not render at all');
  assert.doesNotMatch(withSilence, /Nothing back/, 'the removed silence sentence still reached the row');
  assert.doesNotMatch(withSilence, /class="delivery/, 'the room still renders a delivery receipt/pill (removed in #3134-followup)');

  const quiet = render(post, P, []);
  assert.match(quiet, /anyone there\?/, 'the row did not render at all');
  assert.doesNotMatch(quiet, /Nothing back/, 'a room where everyone answered still got the sentence');
  assert.doesNotMatch(quiet, /class="delivery/, 'the room still renders a delivery receipt/pill (removed in #3134-followup)');
});

test('#3134-followup (Josh 6.72): a room post renders NO inline delivery receipt', () => {
  /**
   * Josh 6.72: "I don't need to know who the message was pasted to or sent to."
   * The inline delivery receipt ("Placed with X. Y could not be reached.") is
   * removed from the ROOM entirely -- for an agent's post AND the person's own,
   * whatever the outcomes. This SUPERSEDES the #3130 decision that kept the
   * failure facts inline as "actionable"; pjReceiptSentence still exists and is
   * still exercised for pjRoomAnnounce (see the tests above), it is just no longer
   * rendered in the thread.
   *
   * ⚠️ NON-VACUOUS: the fixture is a partly-unreachable room (the `/room` route
   * shape when one recipient timed out) -- the exact case that DID draw a
   * receipt on the pre-6.72 code, so `doesNotMatch(/class="delivery/)` fails
   * against that code and only passes once the receipt is gone.
   */
  const render = renderer();
  const agentPost = { kind: 'post', from: 'rick', at: ago(5), outcomes: { johnson: 'placed', bob: 'could_not' }, text: 'on it' };

  const html = render(agentPost, P, ['johnson']);
  assert.match(html, /on it/, 'the row did not render at all');
  assert.doesNotMatch(html, /class="delivery/, 'the inline delivery receipt should be gone from the room');
  assert.doesNotMatch(html, /could not be reached/, 'the delivery facts should no longer render inline in the room');

  // The person's own post carries no inline receipt either (same removal, both senders).
  const ownPost = { kind: 'post', operator: true, from: 'you', at: ago(5), outcomes: { johnson: 'placed', bob: 'could_not' }, text: 'anyone?' };
  const own = render(ownPost, P, ['johnson']);
  assert.match(own, /anyone\?/, 'the row did not render at all');
  assert.doesNotMatch(own, /class="delivery/, 'the inline delivery receipt should be gone from the person’s own post too');
  assert.doesNotMatch(own, /could not be reached/, 'the delivery facts should no longer render inline on the person’s own post');
});

test('#3130: the delivery facts stand alone, with no silence sentence appended', () => {
  /**
   * The receipt keeps "Placed with A and B. C could not be reached." (which is
   * what makes the failure actionable) but no longer appends any "Nothing back
   * from ..." clause. (Was the "any of them never sweeps in the unreached
   * agent" test; that whole sentence is removed.)
   */
  const mixed = { johnson: 'placed', rick: 'placed', bob: 'could_not' };
  const s = api.pjReceiptSentence(mixed, P);
  assert.match(s, /Placed with Johnson and Rick\. Bob could not be reached\./);
  assert.doesNotMatch(s, /Nothing back/);
  assert.doesNotMatch(s, /any of them/);
});

test('paintRoom renders the post with no silence sentence reaching the screen', () => {
  /**
   * 🛑 THIS DRIVES `paintRoom` END TO END and reads what it wrote into the room,
   * through a DOM stub that records `innerHTML` rather than swallowing it -- the
   * hop that stays uncovered when tests call `pjRoomRow` directly. It asserts the
   * post renders and NO "Nothing back ..." silence sentence reaches the screen
   * (#3130 removed that clause). NOTE: since #3134-followup (Josh 6.72) the room
   * render no longer calls `pjReceiptSentence` at all -- the inline receipt is gone
   * -- so the render path here is the room payload -> `pjRoomRow` -> HTML;
   * `pjReceiptSentence` now feeds only the `pjRoomAnnounce` aria-live line, tested
   * separately above.
   */
  const scope = pageScope();
  scope.setProject({ id: 'proj-1', name: 'Test project', agents: P.agents });

  const post = { kind: 'post', operator: true, from: 'you', at: ago(5), outcomes: ALL_PLACED, text: 'anyone there?' };
  scope.paintRoom({ ok: true, rows: [post, said('rick')] });
  const html = scope.written['pj-room'];

  assert.ok(html && html.length > 0, 'paintRoom wrote nothing, so this tests nothing');
  /* #3130: paintRoom renders the post (anchored on its own text, since the
     healthy receipt is empty), and NO "Nothing back from ..." silence sentence
     reaches the screen for any recipient -- the clause is removed. */
  assert.match(html, /anyone there\?/, 'paintRoom rendered no post at all');
  assert.doesNotMatch(html, /Nothing back/, 'the removed silence sentence still reached the screen');
});

test('paintRoom leaves a fresh post alone, so the gate is applied on the way to the screen', () => {
  /**
   * ⚠️ THE OTHER HALF. Without it, a renderer that appended the sentence to
   * every post would satisfy the test above.
   */
  const scope = pageScope();
  scope.setProject({ id: 'proj-1', name: 'Test project', agents: P.agents });

  const fresh = { kind: 'post', operator: true, from: 'you', at: ago(0), outcomes: ALL_PLACED, text: 'just now' };
  scope.paintRoom({ ok: true, rows: [fresh] });
  const html = scope.written['pj-room'];

  assert.match(html, /just now/, 'nothing rendered at all');
  assert.doesNotMatch(html, /Nothing back/, 'a post seconds old was already reported as unanswered');
});

/* ── #2700: the refusal pile collapses to one band ─────────────────────────
   A valve-stopped room refuses every agent that then tries to post, and #315
   draws each refusal as its own band. In a busy room that is a WALL of
   near-identical bands (Josh's screenshot: one valve notice + six "X tried to
   post here and Kosmos stopped it" lines, all repeating one reason).
   pjFoldRoomRows collapses a consecutive same-reason run into one refused-group
   row; pjRoomRow draws that as a single band naming every held agent once.

   ⚠️ THE ROW IS THE SHAPE THE ROOM PATH REALLY EMITS. engine/messages.js writes
   a room refusal as { kind:'refused', from, to:projectId, project, because, at }
   with ONE fixed `because`, so every refusal in a room shares it and the run
   groups. The fixture is pinned to that producer, below, so it cannot drift. */
const REFUSE_WHY = 'the room was going back and forth without landing, so Kosmos was holding it for the person';
const refused = (who, because) => ({ kind: 'refused', from: who, to: 'proj-1',
  project: 'proj-1', because: because == null ? REFUSE_WHY : because, at: ago(4) });

test('the refusal fixture is the shape engine/messages.js actually emits', () => {
  /* Pinned to the producer, exactly as the member fixture is: a fixture free to
     invent the `because` could pass while the real refusal string drifts, which
     is the field the fold groups on. */
  const src = fs.readFileSync(nodePath.join(__dirname, 'engine', 'messages.js'), 'utf8');
  assert.ok(src.includes("kind: 'refused', from, to: projectId, project: projectId"),
    'the room refusal row no longer carries from/project the way this fixture assumes');
  assert.ok(src.includes(REFUSE_WHY),
    'the room refusal reason changed; REFUSE_WHY here no longer matches the product, so the fold-by-reason test is fiction');
});

test('a pile of same-reason refusals folds into ONE refused-group naming every held agent', () => {
  const post = { kind: 'post', operator: true, from: 'you', at: ago(6), outcomes: ALL_PLACED, text: 'anyone?' };
  const valve = { kind: 'valve', to: 'proj-1', project: 'proj-1', because: 'Kosmos stopped it', at: ago(5) };
  const folded = api.pjFoldRoomRows([post, valve, refused('rick'), refused('bob'), refused('johnson')]);

  const groups = folded.filter((m) => m.kind === 'refused-group');
  assert.equal(groups.length, 1, 'the run of three refusals did not collapse to a single band');
  assert.deepEqual(groups[0].from, ['rick', 'bob', 'johnson'], 'the group dropped or reordered a held agent');
  assert.equal(folded.filter((m) => m.kind === 'refused').length, 0, 'a refusal escaped the fold and still stands alone');
  // the post and the valve are untouched: only refusals fold.
  assert.deepEqual(folded.map((m) => m.kind), ['post', 'valve', 'refused-group'],
    'the fold disturbed a non-refusal row');
});

test('the folded band renders once, names every held agent, and gives the reason a single time', () => {
  const group = { kind: 'refused-group', from: ['rick', 'bob', 'johnson'], because: REFUSE_WHY, at: ago(4) };
  const html = renderer()(group, P);
  assert.equal((html.match(/msg-valve/g) || []).length, 1, 'the group drew more than one band');
  assert.match(html, /Rick, Bob and Johnson tried to post here and Kosmos stopped them:/,
    'the band did not name every held agent in one line');
  // The reason appears exactly once -- the whole point is that it stops repeating per agent.
  assert.equal((html.match(/going back and forth without landing/g) || []).length, 1,
    'the reason is repeated inside the collapsed band');
});

test('a lone refusal is left exactly as its own band (a run of one never groups)', () => {
  const folded = api.pjFoldRoomRows([refused('rick')]);
  assert.deepEqual(folded.map((m) => m.kind), ['refused'], 'a single refusal was turned into a group');
  const html = renderer()(folded[0], P);
  assert.match(html, /Rick tried to post here and Kosmos stopped it:/, 'the single-refusal wording changed');
});

test('a different reason breaks the run: only the matching neighbours fold', () => {
  const folded = api.pjFoldRoomRows([refused('rick'), refused('bob'), refused('johnson', 'a different reason')]);
  assert.deepEqual(folded.map((m) => m.kind), ['refused-group', 'refused'],
    'a refusal with a different reason was swept into the group');
  assert.deepEqual(folded[0].from, ['rick', 'bob'], 'the group crossed the reason boundary');
  assert.equal(folded[1].from, 'johnson', 'the odd-reason refusal was not left standing on its own');
});

test('a real post between two refusals breaks the run, so neither collapses', () => {
  const folded = api.pjFoldRoomRows([refused('rick'), said('bob'), refused('johnson')]);
  assert.deepEqual(folded.map((m) => m.kind), ['refused', 'post', 'refused'],
    'two refusals split by a real post were folded across it');
});

test('paintRoom turns the whole wall into a single refusal band on the screen', () => {
  /* 🛑 THE HOP THAT MATTERS (this file's own lesson): the fold lives at the ONE
     paintRoom call site, so a pure-function test alone would pass while the
     wiring was removed. This drives paintRoom and reads what it wrote. */
  const scope = pageScope();
  scope.setProject({ id: 'proj-1', name: 'Test project', agents: P.agents });
  const post = { kind: 'post', operator: true, from: 'you', at: ago(6), outcomes: ALL_PLACED, text: 'anyone there?' };
  const valve = { kind: 'valve', to: 'proj-1', project: 'proj-1',
    because: 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.', at: ago(5) };
  scope.paintRoom({ ok: true, rows: [post, valve, refused('rick'), refused('bob'), refused('johnson')] });
  const html = scope.written['pj-room'];

  assert.ok(html && html.length > 0, 'paintRoom wrote nothing, so this tests nothing');
  assert.equal((html.match(/tried to post here and Kosmos stopped/g) || []).length, 1,
    'the wall of per-agent refusal bands reached the screen instead of one collapsed band');
  assert.match(html, /Rick, Bob and Johnson tried to post here and Kosmos stopped them:/,
    'the collapsed band never reached the screen, or dropped a held agent');
  // the valve headline still stands on its own, above the collapsed band.
  assert.match(html, /asked everyone to bring you in/, 'the valve notice was lost in the fold');
});
