'use strict';
/**
 * #6947: the task page tells the board the person has a task's conversation in front of them (POST .../task/<n>/seen):
 * only after the conversation is drawn, for the task drawn, and only when the page is on screen in a visible tab.
 * tkMarkSeen and the tab-return listener are taken out of web/index.html and run against stand-ins for the page, so the
 * rule is driven, not just read.
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
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' not found in web/index.html');
  return balanced(at);
}
const LISTENER = "document.addEventListener('visibilitychange', () => {";

function page({ visible = 'visible', onScreen = true, open = 3, project = { id: 'p one' }, drawn = true } = {}) {
  const posts = []; const painted = [];
  const document = {
    visibilityState: visible,
    getElementById: (id) => (id === 'tk-back' ? { offsetParent: onScreen ? {} : null } : null),
  };
  const fetch = (url, opts) => { posts.push([url, opts && opts.method]); return Promise.resolve({}); };
  const paintTaskActivity = (n) => { painted.push(n); return Promise.resolve(drawn); };
  // The #6947 listener, not the page's other visibilitychange listeners: the first one after its own comment.
  const at = HTML.indexOf(LISTENER, HTML.indexOf('/* #6947: coming back to the tab while a task'));
  assert.ok(at > 0, 'the tab-return listener is missing');
  const listenerSrc = HTML.slice(at, at + balanced(at).length) + ');';
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'fetch', 'pjById', 'PJ_CURRENT', 'TK_OPEN', 'paintTaskActivity',
    fnSource('tkMarkSeen') + '\n' + listenerSrc + '\nreturn tkMarkSeen;');
  let listener = null;
  document.addEventListener = (type, fn) => { if (type === 'visibilitychange') listener = fn; };
  const tkMarkSeen = make(document, fetch, () => project, 'p one', open, paintTaskActivity);
  return { posts, painted, tkMarkSeen, tabBack: async () => { listener(); await new Promise((r) => setImmediate(r)); } };
}

test('#6947: the open task, on screen in a visible tab, posts seen for that task', () => {
  const p = page();
  p.tkMarkSeen(3);
  assert.deepEqual(p.posts, [['/api/project/p%20one/task/3/seen', 'POST']]);
});

test('#6947: a hidden tab, a page not on screen, another task, no open task or no project posts nothing', () => {
  for (const [opts, n] of [[{ visible: 'hidden' }, 3], [{ onScreen: false }, 3], [{}, 4], [{ open: null }, 3], [{ project: null }, 3]]) {
    const p = page(opts);
    p.tkMarkSeen(n);
    assert.deepEqual(p.posts, [], JSON.stringify(opts) + ' n=' + n);
  }
});

test('#6947: coming back to the tab draws the conversation again before saying seen, and says nothing if that draw failed', async () => {
  const ok = page();
  await ok.tabBack();
  assert.deepEqual(ok.painted, [3], 'the conversation was not drawn again');
  assert.deepEqual(ok.posts, [['/api/project/p%20one/task/3/seen', 'POST']]);
  const failed = page({ drawn: false });
  await failed.tabBack();
  assert.deepEqual(failed.painted, [3]);
  assert.deepEqual(failed.posts, [], 'a failed draw must not read as seen');
  const away = page({ onScreen: false });
  await away.tabBack();
  assert.deepEqual(away.painted, [], 'a task page not on screen is not redrawn');
  assert.deepEqual(away.posts, []);
});

test('#6947: opening a task says seen only after the page is shown and the conversation was drawn', () => {
  const open = fnSource('openTaskPage');
  const drawnFirst = open.indexOf('const painted = paintTaskActivity(n);');
  const shown = open.indexOf("pjView('task');");
  const sent = open.indexOf('Promise.resolve(painted).then((drawn) => { if (drawn === true) tkMarkSeen(n); });');
  assert.ok(drawnFirst > 0 && shown > drawnFirst && sent > shown, 'openTaskPage: draw, show, then say seen once drawn');
  // paintTaskActivity says when it drew: both of its drawing exits return true, so the callers above can tell.
  const paint = fnSource('paintTaskActivity');
  assert.equal((paint.match(/return true;/g) || []).length, 2, 'paintTaskActivity should return true exactly where it drew');
});
