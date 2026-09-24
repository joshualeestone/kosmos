'use strict';
/* #3614: the agent page's Files block. Placement is checked on the shipped markup (directly under
 * the four-pack, inside the left column); the painter is the REAL function lifted from
 * web/index.html, run against a stub DOM and fetch.
 *
 *   node --test web.agent-files-3614.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FNS = page.liftAll(SCRIPT, ['paintAgentFiles']);

test('the Files block sits directly under the four-pack, inside the left column, with the Explorer copy', () => {
  const navEnd = PAGE.indexOf('</nav>', PAGE.indexOf('id="d-nav"'));
  const files = PAGE.indexOf('id="d-files"');
  const secs = PAGE.indexOf('<div class="dsecs">');
  assert.ok(navEnd > 0 && files > navEnd, 'the Files block is not after the four-pack');
  assert.ok(files < secs, 'the Files block is not in the left column (it is after .dsecs opens)');
  assert.equal(PAGE.slice(navEnd, files).replace(/<!--[\s\S]*?-->/g, '').trim().startsWith('</nav>'), true, 'something else sits between the four-pack and Files');
  assert.match(PAGE, /id="d-files-finder"[^>]*data-win-copy="docsOpenFolder"/, 'the Finder button has no Windows copy');
  assert.match(SCRIPT, /paintAgentFiles\(a\.sessionName\)/, 'opening an agent does not paint its Files');
  assert.match(SCRIPT, /!document\.getElementById\('panel-detail'\)\.hidden\) paintAgentFiles\(CURRENT\.sessionName\)/, 'the poll does not refresh the Files list');
});

function harness(respond, current = { sessionName: 'ana' }) {
  const make = (id) => {
    const el = { id, textContent: '', hidden: false, children: [], append(...c) { this.children.push(...c); } };
    Object.defineProperty(el, 'textContent', {
      get() { return this._t || ''; },
      set(v) { this._t = v; if (v === '') this.children = []; },
    });
    return el;
  };
  const el = { 'd-files-list': make('d-files-list'), 'd-files-msg': make('d-files-msg'), 'd-files-more': make('d-files-more') };
  const document = {
    getElementById: (id) => el[id] || null,
    createElement: () => {
      const node = { className: '', dataset: {}, textContent: '', parts: [], append(...c) { this.parts.push(...c); }, insertAdjacentHTML() {} };
      return node;
    },
  };
  const calls = [];
  const env = { CURRENT: current };
  const make2 = new Function('document', 'fetch', 'fileIcon', 'pjSize', 'env',
    'let AGENT_FILES_EPOCH = 0; let AGENT_FILES_STAMP = null;\n'
    + 'const CURRENT_REF = env; \n'
    + FNS.replace(/\bCURRENT\b/g, 'CURRENT_REF.CURRENT')
    + '\nreturn { paintAgentFiles, resetStamp: () => { AGENT_FILES_STAMP = null; } };');
  const api = make2(document, async (url) => { calls.push(url); return { ok: true, json: async () => respond(url) }; }, () => '', (n) => n + ' B', env);
  return { el, api, calls, env };
}

test('a Files folder not made yet shows the empty sentence and no rows', async () => {
  const h = harness(() => ({ ok: true, missing: true, files: [], total: 0, stamp: 'missing' }));
  await h.api.paintAgentFiles('ana');
  assert.match(h.el['d-files-msg'].textContent, /Nothing here yet\. Files this agent makes for you in a Direct Message show up here\./);
  assert.equal(h.el['d-files-list'].children.length, 0);
  assert.equal(h.calls[0], '/api/agent/ana/files');
});

test('files render as rows with name, date and size; the rest are counted', async () => {
  const h = harness(() => ({ ok: true, total: 3, stamp: 's1', files: [
    { name: 'report.pdf', size: 2048, modified: '2026-09-20T10:00:00Z' },
    { name: 'notes.md', size: 10, modified: '2026-09-19T10:00:00Z' },
  ] }));
  await h.api.paintAgentFiles('ana');
  const rows = h.el['d-files-list'].children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.doc, 'report.pdf');
  assert.equal(rows[0].parts[0].textContent, 'report.pdf');
  assert.match(rows[0].parts[1].textContent, /2048 B$/);
  assert.match(rows[0].parts[1].textContent, /·/, 'no date shown');
  assert.equal(h.el['d-files-msg'].textContent, '');
  assert.equal(h.el['d-files-more'].hidden, false);
  assert.match(h.el['d-files-more'].textContent, /And 1 more/);
});

test('an unchanged folder is not repainted; a changed one is', async () => {
  let stamp = 's1';
  let files = [{ name: 'a.txt', size: 1, modified: '2026-09-20T10:00:00Z' }];
  const h = harness(() => ({ ok: true, total: files.length, stamp, files }));
  await h.api.paintAgentFiles('ana');
  const first = h.el['d-files-list'].children[0];
  await h.api.paintAgentFiles('ana');
  assert.equal(h.el['d-files-list'].children[0], first, 'an unchanged folder was repainted');
  stamp = 's2'; files = [{ name: 'b.txt', size: 1, modified: '2026-09-21T10:00:00Z' }, ...files];
  await h.api.paintAgentFiles('ana');
  assert.equal(h.el['d-files-list'].children[0].dataset.doc, 'b.txt', 'a changed folder was not repainted');
});

test('a read the server refuses shows its reason; an answer for another agent is not painted', async () => {
  const refused = harness(() => ({ ok: false, because: 'this agent’s Files is a link to somewhere else, so Kosmos will not list or open it', files: [] }));
  await refused.api.paintAgentFiles('ana');
  assert.match(refused.el['d-files-msg'].textContent, /is a link to somewhere else/);
  const other = harness(() => ({ ok: true, total: 1, stamp: 'x', files: [{ name: 'theirs.txt', size: 1 }] }), { sessionName: 'ben' });
  await other.api.paintAgentFiles('ana');
  assert.equal(other.el['d-files-list'].children.length, 0, 'one agent’s files were painted under another agent');
});
