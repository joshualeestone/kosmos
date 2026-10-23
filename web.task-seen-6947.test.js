'use strict';
/**
 * #6947: the task page tells the board the person has a task's conversation in front of them (POST .../task/<n>/seen).
 * paintTaskActivity marks it after every draw that succeeded (opening the task, a redraw after an action, coming back
 * to the tab); tkMarkSeen posts only for the project and task still open, with the tab visible and the page on screen.
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
function page({ visible = 'visible', onScreen = true, open = 3, pj = 'p one', read = 'ok', hold = false } = {}) {
  const posts = []; const counts = { bodies: 0 };
  const acts = { innerHTML: '' };
  const doc = {
    visibilityState: visible,
    getElementById: (id) => (id === 'tk-back' ? { getClientRects: () => (onScreen ? [{}] : []) } : id === 'tk-activity' ? acts : null),
    addEventListener: (type, fn) => { if (type === 'visibilitychange') doc.listener = fn; },
  };
  let release = () => {};
  const gate = hold ? new Promise((r) => { release = r; }) : Promise.resolve();
  const fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(url); return { status: 200, text: async () => { counts.bodies += 1; return ''; } }; }
    await gate;
    if (read === 'fail') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ events: read === 'empty' ? [] : [{ at: new Date().toISOString(), kind: 'said', text: 'hi' }] }) };
  };
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'fetch', 'pjById', 'tkActRowsHtml', 'init',
    'let PJ_CURRENT = init.pj; let TK_OPEN = init.open;\n' + fnSource('paintTaskActivity') + '\n' + fnSource('tkMarkSeen')
    + '\n' + listenerSource() + '\nreturn { paintTaskActivity, set(pjId, n) { PJ_CURRENT = pjId; TK_OPEN = n; } };');
  const api = make(doc, fetch, (id) => (id ? { id } : null), () => '<rows>', { pj, open });
  const settle = () => new Promise((r) => setImmediate(r));
  return { posts, counts, acts, doc, ...api, release: () => release(), settle, tabBack: async () => { doc.listener(); await settle(); await settle(); } };
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


test('#6947: the seen reply\'s body is read, so the request finishes (an unread reply keeps it open in Chromium)', async () => {
  const p = page();
  await p.paintTaskActivity(3);
  await p.settle();
  assert.equal(p.posts.length, 1);
  assert.equal(p.counts.bodies, 1, 'the seen reply was left unread, which keeps the request open (render-url-state timed out on it)');
});
