'use strict';
/**
 * #6947: the task page tells the board the person has a task's conversation in front of them (POST .../task/<n>/seen).
 * paintTaskActivity marks it once per state of the conversation it drew (opening the task, a redraw after an action,
 * coming back to the tab, the five-second read); tkMarkSeen posts only for the project and task still open, with the
 * tab visible and the page on screen.
 * The real paintTaskActivity, tkMarkSeen and tab-return listener are taken out of web/index.html and run against
 * stand-ins for the page, so the rule is driven, not just read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function balanced(from) {
  let depth = 0;
  for (let i = HTML.indexOf('{', from); i < HTML.length; i += 1) {
    if (HTML[i] === '{') depth += 1;
    else if (HTML[i] === '}') { depth -= 1; if (depth === 0) return HTML.slice(from, i + 1); }
  }
  throw new Error('unbalanced at ' + from);
}
function fnSource(name) {
  const at = HTML.indexOf(HTML.includes('async function ' + name + '(') ? 'async function ' + name + '(' : 'function ' + name + '(');
  assert.ok(at >= 0, name + ' not found in web/index.html');
  return balanced(at);
}
const LISTENER = "document.addEventListener('visibilitychange', () => {";
function listenerSource() {
  // The #6947 listener, not the page's other visibilitychange listeners: the first one after its own comment.
  const at = HTML.indexOf(LISTENER, HTML.indexOf('/* #6947: coming back to the tab while a task'));
  assert.ok(at > 0, 'the tab-return listener is missing');
  return balanced(at) + ');';
}

/* A page with projects 'p one' and 'p two'; task `open` of project `pj` is showing. `read` is what the activity fetch
   does ('ok', 'empty' or 'fail'); `hold` delays it until release() so a test can change the page meanwhile. */
function page({ visible = 'visible', onScreen = true, open = 3, pj = 'p one', read = 'ok', hold = false, post = 200 } = {}) {
  const posts = []; const timers = []; const els = {};
  const st = { events: null, post, onScreen, read };
  const acts = { innerHTML: '' };
  const doc = {
    visibilityState: visible,
    getElementById: (id) => (id === 'tk-back' ? { getClientRects: () => (st.onScreen ? [{}] : []), focus() {} } : id === 'tk-activity' ? acts : (els[id] || (els[id] = { textContent: '', value: '', innerHTML: '', hidden: false }))),
    addEventListener: (type, fn) => { if (type === 'visibilitychange') doc.listener = fn; },
  };
  let release = () => {};
  const gate = hold ? new Promise((r) => { release = r; }) : Promise.resolve();
  const fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(url); if (st.post === 'lost') throw new Error('lost'); return { status: st.post, text: async () => { st.bodies = (st.bodies || 0) + 1; return ''; } }; }
    const asked = st.events;   // what the board held when this read was asked
    await gate;
    if (st.queue) await new Promise((r) => st.queue.push(r));
    if (st.read === 'fail') return { ok: false, json: async () => ({}) };
    const events = asked || (st.read === 'empty' ? [] : [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'hi' }]);
    return { ok: true, json: async () => ({ events }) };
  };
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'fetch', 'pjById', 'tkActRowsHtml', 'setTimeout', 'paintTaskPage', 'tkReceiptSync', 'pjView', 'init',
    'let PJ_CURRENT = init.pj; let TK_OPEN = init.open; let TKR_SHOWN = null; let TK_POLLING = false;\n' + fnSource('paintTaskActivity') + '\n' + fnSource('tkMarkSeen')
    + '\n' + fnSource('openTaskPage') + '\n' + fnSource('tkPollActivity') + '\n' + listenerSource()
    + '\nreturn { paintTaskActivity, openTaskPage, tkPollActivity, set(pjId, n) { PJ_CURRENT = pjId; TK_OPEN = n; } };');
  const api = make(doc, fetch, (id) => (id ? { id, tasks: [{ number: 3 }, { number: 4 }] } : null), () => '<rows>', (fn, ms) => timers.push([fn, ms]),
    () => {}, () => {}, () => {}, { pj, open });
  const settle = () => new Promise((r) => setImmediate(r));
  return { posts, acts, doc, timers, st, ...api, release: () => release(), settle, tabBack: async () => { doc.listener(); await settle(); await settle(); } };
}
const seenUrl = (pj, n) => '/api/project/' + encodeURIComponent(pj) + '/task/' + n + '/seen';

test('#6947: a draw that succeeded, on screen in a visible tab, marks that task of that project seen', async () => {
  for (const read of ['ok', 'empty']) {
    const p = page({ read });
    await p.paintTaskActivity(3);
    assert.deepEqual(p.posts, [seenUrl('p one', 3)], read);
  }
});

test('#6947: a failed read, a hidden tab or a page not on screen marks nothing', async () => {
  for (const opts of [{ read: 'fail' }, { visible: 'hidden' }, { onScreen: false }]) {
    const p = page(opts);
    await p.paintTaskActivity(3);
    assert.deepEqual(p.posts, [], JSON.stringify(opts));
  }
});

test('#6947: a draw that lands after the person moved to another task, or to the same number in another project, marks nothing', async () => {
  const task = page({ hold: true });
  const a = task.paintTaskActivity(3);
  task.set('p one', 4);
  task.release(); await a;
  assert.deepEqual(task.posts, [], 'another task');
  const proj = page({ hold: true });
  const b = proj.paintTaskActivity(3);
  proj.set('p two', 3);
  proj.release(); await b;
  assert.deepEqual(proj.posts, [], 'task 3 of another project must not be marked by project one\'s draw');
  assert.equal(proj.acts.innerHTML, '', 'project one\'s conversation must not be drawn into project two\'s page');
});

test('#6947: coming back to the tab redraws the conversation, which marks it; off screen it does neither', async () => {
  const ok = page();
  await ok.tabBack();
  assert.equal(ok.acts.innerHTML, '<rows>', 'the conversation was not drawn again');
  assert.deepEqual(ok.posts, [seenUrl('p one', 3)]);
  const failed = page({ read: 'fail' });
  await failed.tabBack();
  assert.deepEqual(failed.posts, [], 'a failed redraw must not read as seen');
  const away = page({ onScreen: false });
  await away.tabBack();
  assert.equal(away.acts.innerHTML, '', 'a task page not on screen is not redrawn');
  assert.deepEqual(away.posts, []);
});

test('#6951: the poll redraws, and marks seen, only when the conversation changed', async () => {
  const p = page();
  await p.paintTaskActivity(3);
  assert.equal(p.posts.length, 1, 'the first draw marks it');
  p.acts.innerHTML = 'kept';
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.equal(p.acts.innerHTML, 'kept', 'an unchanged conversation was redrawn on the poll');
  assert.equal(p.posts.length, 1, 'an unchanged conversation was marked again on the poll');
  p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'hi' }, { at: '2026-10-22T23:05:00.000Z', kind: 'said', text: 'still blocked' }];
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.equal(p.acts.innerHTML, '<rows>', 'a new message was not drawn on the poll');
  assert.deepEqual(p.posts, [seenUrl('p one', 3), seenUrl('p one', 3)], 'a new message drawn on the poll must mark the view');
  // CONTROL: a call that is not the poll draws even when nothing changed.
  p.acts.innerHTML = 'kept';
  await p.paintTaskActivity(3);
  assert.equal(p.acts.innerHTML, '<rows>');
});

test('#6951/#6953: the five-second read asks for a redraw only with the task page up, the tab visible and the person there', () => {
  const run = ({ open = 3, hidden = false, visible = 'visible', present = true, view = true } = {}) => {
    let polls = 0;
    // eslint-disable-next-line no-new-func
    new Function('document', 'TK_OPEN', 'tkPresent', 'tkPollActivity', fnSource('tkPollIfThere') + '\ntkPollIfThere();')(
      { visibilityState: visible, getElementById: (id) => (id === 'pj-task-view' && view ? { hidden } : null) },
      open, () => present, () => { polls += 1; });
    return polls;
  };
  assert.equal(run(), 1, 'the CONTROL arm: everything true asks for the read');
  assert.equal(run({ open: null }), 0, 'no task open');
  assert.equal(run({ hidden: true }), 0, 'the task page is not shown');
  assert.equal(run({ visible: 'hidden' }), 0, 'the tab is hidden');
  assert.equal(run({ present: false }), 0, 'the person is not there');
  assert.equal(run({ view: false }), 0, 'no task view at all');
  assert.match(fnSource('loadProjects'), /if \(TK_OPEN !== null\) tkPollIfThere\(\);/, 'loadProjects no longer calls the gate');
});

test('#6951: a seen post that failed on the server or was lost is tried once more; a refusal is not', async () => {
  for (const [post, retries] of [[500, 1], [503, 1], ['lost', 1], [403, 0], [404, 0], [200, 0]]) {
    const p = page({ post });
    await p.paintTaskActivity(3);
    await p.settle();
    assert.equal(p.timers.length, retries, 'post answered ' + post);
    if (retries) {
      assert.equal(p.timers[0][1], 3000);
      p.timers.shift()[0]();
      await p.settle();
      assert.equal(p.posts.length, 2, 'the retry posted (' + post + ')');
      assert.equal(p.timers.length, 0, 'retried more than once (' + post + ')');
    }
  }
});

test('#6951: a draw whose view could not be marked (page behind another Kosmos tab) is marked on the next read once on screen', async () => {
  const p = page({ onScreen: false });
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.equal(p.acts.innerHTML, '<rows>', 'the poll drew the new message into the page');
  assert.deepEqual(p.posts, [], 'not on screen, so not marked');
  p.st.onScreen = true;   // the person switches back to the task's page (no visibilitychange)
  p.acts.innerHTML = 'kept';
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  await p.settle();
  assert.equal(p.acts.innerHTML, 'kept', 'unchanged, so not redrawn');
  assert.deepEqual(p.posts, [seenUrl('p one', 3)], 'the unchanged but unmarked conversation must be marked now');
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  await p.settle();
  assert.equal(p.posts.length, 1, 'marked once, not again on every read');
});

test('#6951: after a failed read the next read draws, even if the conversation is the one drawn before', async () => {
  const p = page();
  await p.paintTaskActivity(3);
  p.st.read = 'fail';
  p.acts.innerHTML = '';
  await p.paintTaskActivity(3);
  assert.match(p.acts.innerHTML, /could not read/);
  p.st.read = 'ok';
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.equal(p.acts.innerHTML, '<rows>', 'the could-not-read line stayed although the read now works');
});

test('#6951: a refused or twice-failed view is settled: the five-second read does not send it again until the conversation changes', async () => {
  for (const [post, sends] of [[403, 1], [404, 1], [500, 2], ['lost', 2]]) {
    const p = page({ post });
    await p.paintTaskActivity(3);
    await p.settle();
    while (p.timers.length) { p.timers.shift()[0](); await p.settle(); }
    for (let i = 0; i < 3; i += 1) { await p.paintTaskActivity(3, { onlyIfChanged: true }); await p.settle(); }
    assert.equal(p.posts.length, sends, 'post answered ' + post + ': sent ' + p.posts.length + ' times');
    p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'hi' }, { at: '2026-10-22T23:09:00.000Z', kind: 'said', text: 'new' }];
    await p.paintTaskActivity(3, { onlyIfChanged: true });
    await p.settle();
    assert.equal(p.posts.length, sends + 1, 'a new message is a new attempt (' + post + ')');
  }
});

test('#6951: a failed read in between does not record a view already recorded for the same conversation', async () => {
  const p = page();
  await p.paintTaskActivity(3);
  await p.settle();
  p.st.read = 'fail';
  await p.paintTaskActivity(3);
  p.st.read = 'ok';
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  await p.settle();
  assert.equal(p.acts.innerHTML, '<rows>', 'redrawn after the failed read');
  assert.equal(p.posts.length, 1, 'the same conversation was recorded again');
});

test('#6951: a read during the retry window does not send a second record for the same conversation', async () => {
  const p = page({ post: 500 });
  await p.paintTaskActivity(3);
  await p.settle();
  assert.equal(p.timers.length, 1, 'the failure scheduled its retry');
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  await p.settle();
  assert.equal(p.posts.length, 1, 'a read inside the retry window sent another record');
  p.timers.shift()[0](); await p.settle();
  assert.equal(p.posts.length, 2, 'the retry itself still went');
  await p.paintTaskActivity(3, { onlyIfChanged: true }); await p.settle();
  assert.equal(p.posts.length, 2, 'settled after the failed retry');
});

test('#6951: a retry that finds the page gone leaves the conversation for the next read, which sends it', async () => {
  const p = page({ post: 500 });
  await p.paintTaskActivity(3);
  await p.settle();
  p.st.onScreen = false;
  p.timers.shift()[0](); await p.settle();
  assert.equal(p.posts.length, 1, 'the retry sent though the page was gone');
  p.st.onScreen = true; p.st.post = 200;
  await p.paintTaskActivity(3, { onlyIfChanged: true }); await p.settle();
  assert.equal(p.posts.length, 2, 'the next read did not try again');
});

test('#6951: the person counts as there only with the window focused and input in the last two minutes', () => {
  const src = HTML.slice(HTML.indexOf('function tkPresent('), HTML.indexOf('}', HTML.indexOf('function tkPresent(')) + 1);
  const run = (focused, lastInputAgoMs) => {
    // eslint-disable-next-line no-new-func
    return new Function('document', 'Date', 'TK_LAST_INPUT', src + '\nreturn tkPresent();')(
      { hasFocus: () => focused }, { now: () => 1000000 }, 1000000 - lastInputAgoMs);
  };
  assert.equal(run(true, 5000), true);
  assert.equal(run(true, 119000), true);
  assert.equal(run(true, 121000), false, 'two minutes without input is not there');
  assert.equal(run(false, 5000), false, 'an unfocused window is not there');
  assert.match(HTML, /for \(const ev of \['pointerdown', 'keydown', 'wheel', 'touchstart', 'touchmove'\]\) document\.addEventListener\(ev, \(\) => \{ TK_LAST_INPUT = Date\.now\(\); \}/);
});

test('#6951: an older read that lands after a newer one was drawn is dropped, and sends no record', async () => {
  const p = page();
  p.st.queue = [];
  p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'old' }];
  const older = p.paintTaskActivity(3, { onlyIfChanged: true });
  await p.settle();
  p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'old' }, { at: '2026-10-22T23:10:00.000Z', kind: 'said', text: 'new' }];
  const newer = p.paintTaskActivity(3, { onlyIfChanged: true });
  await p.settle();
  const [releaseOlder, releaseNewer] = p.st.queue;
  releaseNewer(); await newer; await p.settle();
  assert.equal(p.posts.length, 1, 'the newer read drew and marked');
  const drawnNewer = p.acts.tkDrawn;
  releaseOlder(); await older; await p.settle();
  assert.equal(p.acts.tkDrawn, drawnNewer, 'the older read replaced the newer conversation');
  assert.equal(p.posts.length, 1, 'the older read sent a record');
});

test('#6951: a retry left over from an earlier open of the same task cannot stop the new open from recording', async () => {
  const p = page({ post: 500 });
  p.openTaskPage(3); await p.settle();
  assert.equal(p.timers.length, 1, 'the first open\'s record is waiting on its retry');
  p.st.post = 200;
  p.openTaskPage(3);   // the person leaves and opens the task again (the real openTaskPage)
  p.timers.shift()[0](); await p.settle();   // the old retry comes due after the reopen
  await p.settle();
  assert.equal(p.posts.length, 2, 'the first open\'s record, then the new open\'s own; the old retry must not post: ' + p.posts.length);
  assert.equal(p.acts.tkMarked, p.acts.tkDrawn, 'the new open did not settle its own record');
});

test('#6951: a read still out when the task is opened again is dropped, and the new open records its view', async () => {
  const p = page();
  p.openTaskPage(3); await p.settle();
  assert.equal(p.posts.length, 1);
  p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'hi' }, { at: '2026-10-22T23:20:00.000Z', kind: 'said', text: 'new' }];
  p.st.queue = [];
  const stale = p.paintTaskActivity(3, { onlyIfChanged: true }); await p.settle();   // the earlier open's read, still out
  p.openTaskPage(3); await p.settle();   // the new open's read, also out
  p.st.post = 500;
  const [releaseStale, releaseNew] = p.st.queue;
  releaseStale(); await stale; await p.settle();
  releaseNew(); await p.settle(); await p.settle();
  while (p.timers.length) { p.timers.shift()[0](); await p.settle(); }
  assert.ok(p.acts.tkDrawn, 'nothing was drawn for the new open');
  assert.equal(p.acts.innerHTML, '<rows>');
  assert.equal(p.acts.tkMarking, null, 'a record was left marked as on its way, so this open can never record its view');
  assert.equal(p.acts.tkMarked, p.acts.tkDrawn, 'the new open did not settle its own record');
  assert.equal(p.posts.length, 3, 'the first open\'s record, the new open\'s, and its one retry: ' + p.posts.length);
});

test('#6951: the five-second read does not start another read while its last one is still out', async () => {
  const p = page();
  p.st.queue = [];
  p.tkPollActivity(); p.tkPollActivity(); p.tkPollActivity();
  await p.settle();
  assert.equal(p.st.queue.length, 1, 'reads stacked up: ' + p.st.queue.length);
  p.st.queue.shift()(); await p.settle(); await p.settle();
  p.tkPollActivity(); await p.settle();
  assert.equal(p.st.queue.length, 1, 'the next read did not start after the last one returned');
});

test('#6951: a read that fails while a record is on its way does not make the next read record the same conversation again', async () => {
  const p = page({ post: 500 });
  await p.paintTaskActivity(3); await p.settle();
  assert.equal(p.timers.length, 1, 'waiting on its retry');
  p.st.read = 'fail';
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  p.st.read = 'ok'; p.st.post = 200;
  p.timers.shift()[0](); await p.settle();   // the retry is recorded while the panel's draw is cleared
  await p.paintTaskActivity(3, { onlyIfChanged: true }); await p.settle();
  assert.equal(p.posts.length, 2, 'the same conversation was recorded again after the failed read: ' + p.posts.length);
});

test('#6951: the five-second read redraws without announcing the conversation; a redraw the person asked for still announces', async () => {
  const p = page();
  const calls = [];
  p.acts.setAttribute = (k, v) => calls.push([k, v]);
  await p.paintTaskActivity(3);
  assert.deepEqual(calls, [], 'a redraw the person asked for changed the live region');
  p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'hi' }, { at: '2026-10-22T23:30:00.000Z', kind: 'said', text: 'new' }];
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.deepEqual(calls, [['aria-live', 'off']], 'the poll redraw was not silenced before the swap');
  const restore = p.timers.find(([, ms]) => ms === 0);
  assert.ok(restore, 'the live region is never switched back on');
  restore[0]();
  assert.deepEqual(calls, [['aria-live', 'off'], ['aria-live', 'polite']]);
});

test('#6951: a read that hangs stops holding back the five-second read after 15 seconds', async () => {
  const p = page();
  p.st.queue = [];
  p.tkPollActivity(); await p.settle();
  const giveUp = p.timers.find(([, ms]) => ms === 15000);
  assert.ok(giveUp, 'no limit on a hung read');
  p.tkPollActivity(); await p.settle();
  assert.equal(p.st.queue.length, 1, 'a second read started while the first was out');
  giveUp[0]();
  p.tkPollActivity(); await p.settle();
  assert.equal(p.st.queue.length, 2, 'the five-second read stayed stuck behind the hung one');
});

test('#6951: the five-second read redraw puts keyboard focus back on the history row the person had focused', async () => {
  const p = page();
  await p.paintTaskActivity(3);
  let focused = 0;
  const summary = { focus: () => { focused += 1; } };
  const row = { dataset: { first: '0@2026-10-22T23:00:00.000Z' }, querySelector: () => summary };
  p.acts.contains = () => true;
  p.acts.setAttribute = () => {};
  p.acts.querySelectorAll = (sel) => (sel === '[data-first]' ? [row] : []);
  p.doc.activeElement = { closest: () => row };
  p.st.events = [{ at: '2026-10-22T23:00:00.000Z', kind: 'said', text: 'hi' }, { at: '2026-10-22T23:40:00.000Z', kind: 'said', text: 'new' }];
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.equal(focused, 1, 'focus was not put back after the poll redraw');
  // CONTROL: with focus outside the conversation, nothing is focused.
  p.acts.contains = () => false;
  p.st.events = p.st.events.concat([{ at: '2026-10-22T23:45:00.000Z', kind: 'said', text: 'more' }]);
  await p.paintTaskActivity(3, { onlyIfChanged: true });
  assert.equal(focused, 1, 'focus was moved although it was not in the conversation');
});

test('#6951: a hung read that finishes late does not release the flag held by the read that replaced it', async () => {
  const p = page();
  p.st.queue = [];
  p.tkPollActivity(); await p.settle();
  p.timers.find(([, ms]) => ms === 15000)[0]();   // the first read is given up on
  p.tkPollActivity(); await p.settle();
  assert.equal(p.st.queue.length, 2, 'the replacement read did not start');
  p.st.queue[0](); await p.settle(); await p.settle();   // the hung read finally lands
  p.tkPollActivity(); await p.settle();
  assert.equal(p.st.queue.length, 2, 'the late hung read freed the replacement read\'s flag, so a third started');
});

test('#6947: the seen reply\'s body is read, so the request finishes (an unread reply keeps it open in Chromium)', async () => {
  for (const post of [200, 403, 500]) {
    const p = page({ post });
    await p.paintTaskActivity(3);
    await p.settle();
    assert.equal(p.st.bodies, 1, 'the seen reply was left unread (' + post + '), which keeps the request open');
  }
});

test('#6953: coming back to the tab records the view again, even when the conversation is unchanged', async () => {
  const p = page();
  await p.paintTaskActivity(3); await p.settle();
  assert.equal(p.posts.length, 1);
  await p.paintTaskActivity(3); await p.settle();
  assert.equal(p.posts.length, 1, 'CONTROL: an ordinary redraw of the same conversation records nothing new');
  await p.tabBack(); await p.settle();
  assert.equal(p.posts.length, 2, 'a return to the tab did not record the view again');
});

test('#6953: a return to the tab does not re-ask a board that refused, or that failed twice', async () => {
  for (const [post, sends] of [[403, 1], [500, 2]]) {
    const p = page({ post });
    await p.paintTaskActivity(3); await p.settle();
    while (p.timers.length) { p.timers.shift()[0](); await p.settle(); }
    assert.equal(p.posts.length, sends, 'setup (' + post + ')');
    await p.tabBack(); await p.settle();
    assert.equal(p.posts.length, sends, 'a return to the tab asked again after ' + post);
  }
});
