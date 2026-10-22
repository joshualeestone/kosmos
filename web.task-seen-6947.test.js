'use strict';
/**
 * #6947: the task page tells the board the person opened a task (POST .../task/<n>/seen), only when that page is really
 * on screen in a visible tab, and the open path sends it after the page is shown. tkMarkSeen is taken out of
 * web/index.html and run against stand-ins for the page, so its rule is driven, not just read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function fnSource(name) {
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' not found in web/index.html');
  let depth = 0;
  for (let i = HTML.indexOf('{', at); i < HTML.length; i += 1) {
    if (HTML[i] === '{') depth += 1;
    else if (HTML[i] === '}') { depth -= 1; if (depth === 0) return HTML.slice(at, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

function run({ visible = 'visible', onScreen = true, open = 3, project = { id: 'p one' } } = {}) {
  const posts = [];
  const document = {
    visibilityState: visible,
    getElementById: (id) => (id === 'tk-back' ? { offsetParent: onScreen ? {} : null } : null),
  };
  const fetch = (url, opts) => { posts.push([url, opts && opts.method]); return Promise.resolve({}); };
  // eslint-disable-next-line no-new-func
  const f = new Function('document', 'fetch', 'pjById', 'PJ_CURRENT', 'TK_OPEN', fnSource('tkMarkSeen') + '\nreturn tkMarkSeen;');
  f(document, fetch, () => project, 'p one', open)();
  return posts;
}

test('#6947: an opened task on screen in a visible tab posts seen for that task', () => {
  assert.deepEqual(run(), [['/api/project/p%20one/task/3/seen', 'POST']]);
});

test('#6947: a hidden tab, a page not on screen, no open task or no project posts nothing', () => {
  assert.deepEqual(run({ visible: 'hidden' }), []);
  assert.deepEqual(run({ onScreen: false }), []);
  assert.deepEqual(run({ open: null }), []);
  assert.deepEqual(run({ project: null }), []);
});

test('#6947: opening a task sends seen only after the page is shown, and coming back to the tab sends it too', () => {
  const open = fnSource('openTaskPage');
  const shown = open.indexOf("pjView('task')");
  const sent = open.indexOf('tkMarkSeen()');
  assert.ok(shown > 0 && sent > shown, 'openTaskPage must call tkMarkSeen after pjView(\'task\') puts the page on screen');
  assert.match(HTML, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible'\) tkMarkSeen\(\); \}\);/);
});
