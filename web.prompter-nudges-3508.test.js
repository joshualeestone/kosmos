'use strict';

/**
 * #3508: the Prompter's IN-APP check-in delivery -- the half #2623 removed, rebuilt
 * LOCAL. This is the reading end of engine/prompternudge.js: the web UI polls
 * /api/prompter-nudges and COMPOSES the check-in question per stalled agent.
 *
 * ⚠️ THIS FILE EXECUTES THE PAGE FUNCTIONS rather than grepping for their text.
 * A test that reads index.html as a string can only prove a sentence exists
 * somewhere in a 15,000-line file; it cannot prove the branch that produces it is
 * reachable, and this repo has shipped a transparent modal past 300+ such tests.
 * So `prompterCheckinQuestion` and `paintPrompterNudges` are extracted and CALLED.
 *
 * The one string assertion here is the reverse: that the Settings copy no longer
 * PROMISES a nudge it cannot deliver (the pre-#3508 "can't nudge you yet ... still
 * being built" wording). That is an absence, so it is a source read, not a call.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* Brace-matched slice of a top-level page function, returned as SOURCE so one
   function can be spliced in as another's dependency (the web.memory-words pattern). */
function extractSource(name) {
  let at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page at all`);
  // Keep the `async` keyword if the declaration has one, or the extracted slice
  // is a plain function whose body still has `await` -- a SyntaxError, not a fail.
  if (PAGE.slice(at - 6, at) === 'async ') at -= 6;
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  const from = i;
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth += 1;
    else if (PAGE[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = PAGE.slice(at, i + 1);
  assert.ok(body.length > 40 && from > at, `${name} extracted as something too small to be it`);
  return body;
}

/* prompterCheckinQuestion is pure -- extract and return it callable. */
const prompterCheckinQuestion = new Function(
  `${extractSource('prompterCheckinQuestion')}; return prompterCheckinQuestion;`,
)();

/* paintPrompterNudges depends on esc, prompterCheckinQuestion, the module-level
   HB_NUDGE_EPOCH, and the browser globals document + fetch. Dependencies come from
   the PAGE (never restated here, so what runs is what ships); document + fetch are
   bound in as fakes so the async render runs headless. */
function makePaint(doc, fetchFn) {
  const factory = new Function('document', 'fetch', `
    ${extractSource('esc')}
    ${extractSource('prompterCheckinQuestion')}
    let HB_NUDGE_EPOCH = 0;
    ${extractSource('paintPrompterNudges')}
    return paintPrompterNudges;
  `);
  return factory(doc, fetchFn);
}

function fakeBox() {
  return { hidden: false, innerHTML: 'stale', offsetParent: {} };
}
function fakeDoc(box) {
  return { getElementById: (id) => (id === 'hb-nudges' ? box : null) };
}
function okFetch(payload) {
  return async () => ({ ok: true, json: async () => payload });
}

test('prompterCheckinQuestion composes the question locally (the store holds no words)', () => {
  const stopped = prompterCheckinQuestion({ session: 'april', from: 'working', to: 'stopped' });
  assert.match(stopped, /mid-something, finished, or stopped/i);
  // auth_failed and connection_lost are the two stalls with a distinct cause worth
  // naming (both in heartbeat.js ASK_ON_EXIT_TO, #3410) -- each reads distinctly.
  const authf = prompterCheckinQuestion({ session: 'april', from: 'working', to: 'auth_failed' });
  assert.match(authf, /sign in/i);
  const connlost = prompterCheckinQuestion({ session: 'april', from: 'working', to: 'connection_lost' });
  assert.match(connlost, /connection/i);
  // All three read distinctly, so an assertion about one cannot pass on another.
  assert.equal(new Set([stopped, authf, connlost]).size, 3, 'the three stalls must not read identically');
});

test('a pending nudge renders the agent and its composed question, panel shown', async () => {
  const box = fakeBox();
  const paint = makePaint(fakeDoc(box), okFetch({ ok: true, at: 'now', nudges: [{ session: 'april', from: 'working', to: 'stopped' }] }));
  await paint();
  assert.equal(box.hidden, false, 'panel stays hidden with a pending nudge');
  assert.match(box.innerHTML, /april/, 'the agent name is not rendered');
  assert.match(box.innerHTML, /mid-something, finished, or stopped/i, 'the composed question is not rendered');
});

test('no nudges hides the panel and clears it (costs nothing when nothing is stalled)', async () => {
  const box = fakeBox();
  const paint = makePaint(fakeDoc(box), okFetch({ ok: true, at: null, nudges: [] }));
  await paint();
  assert.equal(box.hidden, true, 'the empty panel must be hidden');
  assert.equal(box.innerHTML, '', 'the empty panel must be cleared');
});

test('a read failure hides the panel rather than showing error noise', async () => {
  const box = fakeBox();
  const paint = makePaint(fakeDoc(box), async () => { throw new Error('down'); });
  await paint();
  assert.equal(box.hidden, true, 'a failed read must hide, not alarm');
  assert.equal(box.innerHTML, '', 'a failed read must not leave stale content');
});

test('a non-ok response is treated as a failure, not rendered as data', async () => {
  const box = fakeBox();
  const paint = makePaint(fakeDoc(box), async () => ({ ok: false, json: async () => ({}) }));
  await paint();
  assert.equal(box.hidden, true);
});

test('the agent name is HTML-escaped, never interpolated raw', async () => {
  const box = fakeBox();
  const paint = makePaint(fakeDoc(box), okFetch({ ok: true, at: 'now', nudges: [{ session: '<img src=x>', from: 'working', to: 'stopped' }] }));
  await paint();
  assert.doesNotMatch(box.innerHTML, /<img src=x>/, 'a raw tag reached the DOM string');
  assert.match(box.innerHTML, /&lt;img src=x&gt;/, 'the name was not escaped');
});

test('the Settings copy no longer promises an undeliverable nudge (#3508 restored delivery)', () => {
  // The hint under the Prompter row. Read the source for the ABSENCE of the
  // pre-#3508 wording -- an absence has no branch to execute.
  assert.doesNotMatch(PAGE, /can't nudge you about them yet/,
    'the Prompter hint still says it cannot nudge yet');
  assert.doesNotMatch(PAGE, /That part is still being built/,
    'the Prompter hint still says the delivery is unbuilt');
  // And it now tells the person a check-in appears -- the delivery this build adds.
  assert.match(PAGE, /shows a check-in/,
    'the Prompter hint does not mention the in-app check-in it now delivers');
});
