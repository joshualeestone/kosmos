'use strict';

/**
 * The task activity list (#768/#992): paintTaskActivity + tkActPhrase, run for
 * real against a stub DOM + stubbed fetch. These prove the RENDER logic --
 * oldest-first order, the per-kind phrasing, the empty state, the unknown-kind
 * fallback, the stale-fetch guard, and the escaping the module header demands
 * (stored transcript text is RAW). They cannot see pixels; the headed pass is
 * the browser check docs/browser-checks/render-tasks.js.
 *
 *   node --test web.task-activity-768.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* 🛑 SANDBOX EVERY ROOT BEFORE REQUIRING fleet/projects -- they resolve their
   roots at require time, and an unsandboxed run reads/writes the operator's real
   app data and instruction files (the same hazard web.task-page.test.js records).
   The roster row this test resolves names through comes from the REAL producer
   (fleet + projects.describe), not a hand-built literal -- fixture-discipline.test.js
   forbids the literal, because a hand-built row is free to carry or miss fields the
   producer never would. */
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkact-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkact-data-'));
process.env.AGENT_WORKFORCE_HOME = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkact-home-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkact-wk-'));
const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* Brace-anchored extractor, the sibling suites' shared shape: a function whose
   name PREFIXES the wanted one must not be captured, so match `function name(`. */
function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  // Keep a leading `async ` so an async function does not lose its keyword when
  // lifted -- without this the extracted body has a bare `await` and cannot run.
  if (SCRIPT.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

const FIXED_NOW = Date.parse('2026-09-07T12:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return FIXED_NOW; }
}
// A stored `at` this many ms before FIXED_NOW; agoWords turns 5min -> "5 minutes ago".
const minsAgo = (m) => new Date(FIXED_NOW - m * 60000).toISOString();

/* Built from the real producer in test.before -- a project with one real roster
   row (session 'mona', display name 'Mona'), so tkMemberName resolves a real
   member the way the page does. */
let PROJECT = null;
test.before(() => {
  const board = fleet.install([fleet.agent('mona', { state: 'idle', displayName: 'Mona' })]);
  try {
    const made = projects.create({ name: 'Alpha' });
    projects.addAgent(made.id, 'mona');
    PROJECT = projects.describe(projects.readAll().find((x) => x.id === made.id), board.agents);
    assert.ok(PROJECT.agents.length === 1 && PROJECT.agents[0].sessionName === 'mona'
      && PROJECT.agents[0].name === 'Mona', 'the premise: a real roster row for mona/Mona');
  } finally { board.restore(); }
});

/* Build the real render fns (esc, agoWords, tkMemberName, tkActPhrase,
   paintTaskActivity) against a stub document + a stubbed fetch that yields
   `events`. Returns the #tk-activity element so a test can read its innerHTML. */
async function render(events, { openNum, fetchOk = true } = {}) {
  const src = [fnSource('esc'), fnSource('agoWords'), fnSource('tkMemberName'),
    fnSource('tkActPhrase'), fnSource('paintTaskActivity')].join('\n');
  const acts = { innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'tk-activity' ? acts : null) };
  const fetchStub = async () => ({
    ok: fetchOk,
    json: async () => ({ events, count: events.length }),
  });
  const TK_OPEN = openNum === undefined ? 7 : openNum;
  const paint = new Function('document', 'pjById', 'PJ_CURRENT', 'TK_OPEN', 'fetch', 'Date',
    src + '\n; return paintTaskActivity;')(
    doc, () => PROJECT, PROJECT.id, TK_OPEN, fetchStub, FixedDate);
  await paint(7);   // the task being viewed is #7
  return acts;
}

test('renders each recorded event, oldest first, with its phrase and a time', async () => {
  const acts = await render([
    { at: minsAgo(20), kind: 'created', who: 'mona' },
    { at: minsAgo(5), kind: 'closed' },
  ]);
  const html = acts.innerHTML;
  assert.match(html, /Created and given to Mona/, 'the created phrase (with the resolved name) is missing');
  assert.match(html, /Marked done/, 'the closed phrase is missing');
  assert.match(html, /minutes ago/, 'no relative time rendered');
  assert.ok(html.indexOf('Created and given to Mona') < html.indexOf('Marked done'),
    'events are not oldest-first: created must render before closed');
});

test('an assignee that does not resolve falls back to nothing, never a broken name', async () => {
  // 'created' with no who -> "Created" (not "Created and given to null").
  const acts = await render([{ at: minsAgo(1), kind: 'created', who: null }]);
  assert.match(acts.innerHTML, /Created</, 'the bare "Created" phrase is missing');
  assert.doesNotMatch(acts.innerHTML, /given to/, 'an unassigned created event should not say "given to"');
});

test('empty transcript renders the "Nothing yet" state, not a blank box', async () => {
  const acts = await render([]);
  assert.match(acts.innerHTML, /Nothing yet/, 'an empty activity must say so');
});

test('an unknown event kind renders its bare name rather than vanishing', async () => {
  // A kind the engine adds later must SHOW (as itself), so a new event is never
  // silently dropped from the history.
  const acts = await render([{ at: minsAgo(2), kind: 'future-thing' }]);
  assert.match(acts.innerHTML, /future-thing/, 'an unknown kind was dropped instead of shown');
});

test('stored text is escaped -- an injection payload in a part sentence stays inert', async () => {
  // The DANGEROUS-ANSWER control. engine/taskchat.js stores raw text; the render
  // site owns escaping. A part sentence carrying markup must render as text.
  const acts = await render([
    { at: minsAgo(3), kind: 'part-added', sentence: '<img src=x onerror=alert(1)>' },
  ]);
  assert.doesNotMatch(acts.innerHTML, /<img/, 'a raw <img survived: the stored text was not escaped');
  assert.match(acts.innerHTML, /&lt;img/, 'the payload should render as escaped, visible text');
});

test('#768: a composer message (said) renders its text in the activity', async () => {
  const acts = await render([
    { at: minsAgo(2), kind: 'said', text: 'checked the draft with the client' },
  ]);
  assert.match(acts.innerHTML, /checked the draft with the client/, 'the said message text is missing');
});

test('#768: a said message with an author renders "Name: text"; without one, bare text', async () => {
  const withWho = await render([{ at: minsAgo(2), kind: 'said', who: 'mona', text: 'on it' }]);
  assert.match(withWho.innerHTML, /Mona: on it/, 'an authored said message should read "Name: text"');
  const authorless = await render([{ at: minsAgo(2), kind: 'said', text: 'a note' }]);
  assert.match(authorless.innerHTML, />\s*a note\s*</, 'an authorless said message should render bare text');
  assert.doesNotMatch(authorless.innerHTML, /: a note/, 'an authorless message must not render a stray colon prefix');
});

test('#768: said text is escaped -- it is user input stored raw, escaped once at render', async () => {
  const acts = await render([
    { at: minsAgo(1), kind: 'said', text: '<img src=x onerror=alert(1)>' },
  ]);
  assert.doesNotMatch(acts.innerHTML, /<img/, 'a raw <img survived: the said text was not escaped');
  assert.match(acts.innerHTML, /&lt;img/, 'the payload should render as escaped, visible text');
});

test('a fetch that lands after the person left the task does not paint the wrong page', async () => {
  // paintTaskActivity(7) resolves, but TK_OPEN has moved to 9 -> it must return
  // without writing, so a slow read cannot stamp task 7 onto task 9. This
  // exercises the guard at the FIRST await (fetch).
  const acts = await render([{ at: minsAgo(1), kind: 'created' }], { openNum: 9 });
  assert.equal(acts.innerHTML, '', 'a stale fetch painted over a page the person had left');
});

test('the guard also fires at the SECOND await (res.json), not only after fetch', async () => {
  // The person leaves DURING the body parse: n === TK_OPEN at the fetch check,
  // then TK_OPEN moves before json() resolves. Only the post-json guard catches
  // this. TK_OPEN is read as a free global here so the stub can flip it mid-call
  // (the real page reads the `let TK_OPEN` global the same way).
  const src = [fnSource('esc'), fnSource('agoWords'), fnSource('tkMemberName'),
    fnSource('tkActPhrase'), fnSource('paintTaskActivity')].join('\n');
  const acts = { innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'tk-activity' ? acts : null) };
  const prev = globalThis.TK_OPEN;
  globalThis.TK_OPEN = 7;   // on task 7 when the fetch resolves...
  const fetchStub = async () => ({
    ok: true,
    // ...but the person opens task 9 before the body finishes parsing.
    json: async () => { globalThis.TK_OPEN = 9; return { events: [{ at: minsAgo(1), kind: 'created' }], count: 1 }; },
  });
  try {
    const paint = new Function('document', 'pjById', 'PJ_CURRENT', 'fetch', 'Date',
      src + '\n; return paintTaskActivity;')(doc, () => PROJECT, PROJECT.id, fetchStub, FixedDate);
    await paint(7);
    assert.equal(acts.innerHTML, '', 'the post-json guard did not fire: task 7 events painted after the page moved to 9');
  } finally {
    if (prev === undefined) delete globalThis.TK_OPEN; else globalThis.TK_OPEN = prev;
  }
});

test('a failed read leaves a quiet could-not-read line, never a false empty state', async () => {
  const acts = await render([], { fetchOk: false });
  assert.match(acts.innerHTML, /could not read/i, 'a failed read must not read as "nothing happened"');
  assert.doesNotMatch(acts.innerHTML, /Nothing yet/, 'a read failure must not show the empty state');
});
