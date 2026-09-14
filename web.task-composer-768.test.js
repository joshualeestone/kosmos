'use strict';

/**
 * The task-conversation composer send handler (#768): tkSayPost, run for real
 * against a stub DOM + a controllable fetch. Pins the properties a blind review
 * flagged as easy to lose:
 *   - the in-flight re-entry guard: two quick sends (the Enter path does NOT go
 *     through the disabled button) must fire exactly ONE POST, not a duplicate;
 *   - empty input is a no-op (no request);
 *   - the mid-flight task-switch guard: if the person opens a different task while
 *     the POST is in flight, the shared input is NOT cleared (never-delete-a-draft).
 *
 * TK_OPEN is read as a free global (as the real page's `let TK_OPEN` is), so the
 * fetch stub can flip it mid-await to exercise the post-await guard's true branch --
 * the same technique web.task-activity-768.test.js uses for paintTaskActivity.
 *
 *   node --test web.task-composer-768.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  if (SCRIPT.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

/* Build tkSayPost reading TK_OPEN as a free global (not a bound parameter), so a
   test can move the open task mid-flight. `onResolve` runs when the held fetch is
   released, so a test can flip globalThis.TK_OPEN right before the body resolves. */
function harness({ inputValue = 'a note', openNum = 7 } = {}) {
  const input = { value: inputValue };
  const msg = { textContent: '' };
  const go = { disabled: false };
  const els = { 'tk-say': input, 'tk-say-msg': msg, 'tk-say-go': go };
  const doc = { getElementById: (id) => els[id] || null };
  const project = { id: 'p1' };
  let fetchCalls = 0;
  let release;
  const fetchStub = () => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => ({ ok: true }) });
    });
  };
  globalThis.TK_OPEN = openNum;
  const src = fnSource('tkSayPost');
  const tkSayPost = new Function(
    'document', 'pjById', 'PJ_CURRENT', 'fetch', 'paintTaskActivity', 'encodeURIComponent',
    src + '\n; return tkSayPost;',
  )(doc, () => project, project.id, fetchStub, () => {}, encodeURIComponent);
  return { tkSayPost, input, msg, go, fetchCalls: () => fetchCalls, release: () => release && release() };
}

test('two quick sends fire exactly one POST (the in-flight re-entry guard)', async () => {
  const h = harness({ inputValue: 'only once please' });
  try {
    const a = h.tkSayPost();   // sets go.disabled = true before its await
    const b = h.tkSayPost();   // must see the guard and return without a POST
    assert.equal(h.fetchCalls(), 1, 'a second send fired a duplicate POST despite the in-flight guard');
    h.release();
    await a; await b;
    assert.equal(h.fetchCalls(), 1, 'still exactly one POST after both settle');
  } finally { delete globalThis.TK_OPEN; }
});

test('empty input is a no-op: no POST, no error band', async () => {
  const h = harness({ inputValue: '   ' });
  try {
    await h.tkSayPost();
    assert.equal(h.fetchCalls(), 0, 'an empty message must not POST');
    assert.equal(h.msg.textContent, '', 'an empty message must not write an error');
  } finally { delete globalThis.TK_OPEN; }
});

test('a send that lands after the person left the task does NOT clear the shared input', async () => {
  // Send for task 7; the person opens task 9 (and starts a new draft) before the
  // POST resolves. The post-await guard (n !== TK_OPEN) must fire so the shared
  // input keeps task 9's fresh draft rather than being wiped by task 7's success.
  const h = harness({ inputValue: 'for task 7', openNum: 7 });
  try {
    const p = h.tkSayPost();
    // The operator navigates away and types a new draft into the shared input.
    globalThis.TK_OPEN = 9;
    h.input.value = 'a fresh draft for task 9';
    h.release();
    await p;
    assert.equal(h.input.value, 'a fresh draft for task 9',
      'the guard did not fire: task 7 success cleared task 9\'s draft');
    assert.equal(h.go.disabled, false, 'the shared Send button must always re-enable');
  } finally { delete globalThis.TK_OPEN; }
});

test('opening a task clears a leftover composer draft + refusal band (no cross-task carry)', async () => {
  // #tk-say / #tk-say-msg are static markup, so an unsent draft or stale error from
  // the last task would persist into the next one and could be sent under the wrong
  // task. openTaskPage must clear both. Run the real openTaskPage against stubs.
  const say = { value: 'a draft I never sent for the last task' };
  const sayMsg = { textContent: 'a stale refusal from the last task' };
  const els = {
    'tk-say': say, 'tk-say-msg': sayMsg, 'tk-msg': { textContent: '' },
    'tk-activity': { innerHTML: '' }, 'tk-back': { focus() {} },
  };
  const doc = { getElementById: (id) => els[id] || null };
  const project = { id: 'p1', tasks: [{ number: 5, sentence: 'a task' }] };
  const src = fnSource('openTaskPage');
  const openTaskPage = new Function(
    'document', 'pjById', 'PJ_CURRENT', 'paintTaskPage', 'paintTaskActivity', 'pjView',
    'var TK_OPEN = null;\n' + src + '\n; return openTaskPage;',
  )(doc, () => project, project.id, () => {}, () => {}, () => {});
  openTaskPage(5);
  assert.equal(say.value, '', 'the leftover draft was not cleared on opening the task');
  assert.equal(sayMsg.textContent, '', 'the stale refusal band was not cleared on opening the task');
});

test('a send that stays on the same task DOES clear the input (guard control)', async () => {
  // The control that proves the test above is not vacuous: with no task switch,
  // the same handler reaches the clear and empties the input.
  const h = harness({ inputValue: 'stays put', openNum: 7 });
  try {
    const p = h.tkSayPost();
    h.release();
    await p;
    assert.equal(h.input.value, '', 'a normal same-task send should clear the input');
  } finally { delete globalThis.TK_OPEN; }
});
