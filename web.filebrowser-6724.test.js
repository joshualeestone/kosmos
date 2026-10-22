'use strict';
/* #6724 (Josh viewing a board from another computer: "Open in Finder" opens on the far Mac): the page's half.
 *   - every button that opens a window on the board's computer carries data-remote-hide, and is hidden while the page
 *     is reached through Kosmos+ (kplusRemote(): the page's own address is not loopback);
 *   - the agent's Files screen is a browser: folders first, a path line back up, Download folder (a zip).
 * The functions are the REAL ones lifted from web/index.html, run against a stub DOM and fetch.
 *
 *   node --test web.filebrowser-6724.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// CURRENT is a REAL board card (fixture-discipline): sandbox the roots before requiring the fleet.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filebrowser-page-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('ana')]);
test.after(() => { try { BOARD.restore(); } catch { /* restored */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const FINDER_BUTTONS = ['d-files-finder', 'docs-finder', 'pjs-reveal', 'pjs-chats-reveal', 'tk-chats-reveal', 'set-reveal', 'upd-open-folder'];

test('every button that opens a folder window on the board’s computer carries data-remote-hide, and the rule hides them', () => {
  for (const id of FINDER_BUTTONS) {
    const at = PAGE.indexOf('id="' + id + '"');
    assert.ok(at > 0, 'premise: ' + id + ' is on the page');
    const tag = PAGE.slice(PAGE.lastIndexOf('<', at), PAGE.indexOf('>', at) + 1);
    assert.match(tag, /\sdata-remote-hide[\s>]/, id + ' would open a window on the far Mac and stays on screen over Kosmos+');
  }
  assert.match(PAGE, /html\[data-kplus-remote\] \[data-remote-hide\] \{ display: none !important; \}/);
  // CONTROL: Download folder is for exactly that device, so it is never hidden that way.
  const zip = PAGE.slice(PAGE.lastIndexOf('<', PAGE.indexOf('id="d-files-zip"')), PAGE.indexOf('>', PAGE.indexOf('id="d-files-zip"')) + 1);
  assert.doesNotMatch(zip, /data-remote-hide/);
});

test('iteration 5: a hint that only describes a hidden button goes with it: every Linux-hidden line right after a remote-hidden button is remote-hidden too', () => {
  let checked = 0;
  for (const id of FINDER_BUTTONS) {
    const at = PAGE.indexOf('id="' + id + '"');
    const end = PAGE.indexOf('</button>', at) + '</button>'.length;
    const next = PAGE.slice(end, end + 400).match(/^\s*<p\b[^>]*>/);
    if (!next || !/data-linux-hide/.test(next[0])) continue;
    checked += 1;
    assert.match(next[0], /data-remote-hide/, 'the hint under ' + id + ' stays on screen over Kosmos+ under nothing');
  }
  assert.ok(checked >= 2, 'premise: the two conversation-folder hints were found (' + checked + ')');
});

test('the page stamps data-kplus-remote on <html> only when it is reached through another address', () => {
  const remote = page.lift(SCRIPT, 'kplusRemote');
  const at = SCRIPT.indexOf("document.documentElement.setAttribute('data-kplus-remote', '')");
  assert.ok(at > 0, 'premise: the stamp is in the page');
  const stamp = SCRIPT.slice(SCRIPT.lastIndexOf('\n', at) + 1, SCRIPT.indexOf('\n', at));
  const run = (hostname) => {
    const attrs = {};
    const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
    new Function('document', 'location', remote + '\n' + stamp)(document, { hostname });
    return Object.prototype.hasOwnProperty.call(attrs, 'data-kplus-remote');
  };
  assert.equal(run('127.0.0.1'), false, 'stamped at the computer itself');
  assert.equal(run('localhost'), false);
  assert.equal(run('[::1]'), false);
  assert.equal(run('ana.kosmosplus.com'), true, 'not stamped through Kosmos+');
});

/* The browser's painter against a stub DOM: the folder rows, the path line, and an answer that arrives for a folder the
   person has already left. */
function harness(respond) {
  const make = (id) => {
    const el = { id, hidden: false, children: [], attrs: {}, dataset: {}, className: '', append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; }, insertAdjacentHTML() {},
      querySelector() { return this.children.find((c) => /pj-doc/.test(c.className)) || null; }, focus() { focused.push(this); } };
    Object.defineProperty(el, 'textContent', { configurable: true, get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
    return el;
  };
  const focused = [];
  const el = {};
  for (const id of ['d-filesall-list', 'd-filesall-msg', 'd-filesall-more', 'd-filesall-path', 'd-filesall-h']) el[id] = make(id);
  const document = {
    getElementById: (id) => el[id] || null,
    createElement: () => make(''),
    querySelector: () => null,
  };
  const calls = [];
  const env = { CURRENT: BOARD.agents.find((c) => c.sessionName === 'ana') };
  const FNS = page.liftAll(SCRIPT, ['agentFileRow', 'fileFingerprint', 'rowKey', 'focusedRowKey', 'refocusRow', 'folderIcon', 'agentDirRow', 'agentFilesPath', 'agentFilesGo', 'paintAgentFilesAll']);
  let gate = null;
  const api = new Function('document', 'fetch', 'fileIcon', 'pjSize', 'asSentence', 'env',
    'let AGENT_FILES_ALL_EPOCH = 0; let AGENT_FILES_DIR = ""; let AGENT_FILES_ALL_STAMP = null; let AGENT_FILES_FOCUS = false; let AGENT_FILES_ALL_FAIL = null;\n'
    + FNS.replace(/\bCURRENT\b/g, 'env.CURRENT')
    + '\nreturn { paintAgentFilesAll, agentFilesGo, dir: () => AGENT_FILES_DIR, focusPending: () => AGENT_FILES_FOCUS };')(document, async (url) => {
    calls.push(url);
    if (gate) await gate;
    const out = respond(url);
    return { ok: !out.__status, status: out.__status || 200, json: async () => out };
  }, () => '', (n) => n + ' B', (t) => t.charAt(0).toUpperCase() + t.slice(1) + '.', env);
  return { el, api, calls, focused, hold: (p) => { gate = p; } };
}
const answer = (dir) => ({ ok: true, dir, stamp: 's-' + dir, dirs: dir ? [] : [{ name: 'reports', modified: '2026-09-20T10:00:00Z' }],
  files: dir ? [{ name: dir + '/a.pdf', size: 3, modified: '2026-09-20T10:00:00Z' }] : [{ name: 'note.txt', size: 1 }] });

test('a folder row goes into the folder: the browse route is asked for it, files show their own names, and the path line leads back', async () => {
  const h = harness((url) => answer(decodeURIComponent(url.split('dir=')[1] || '')));
  await h.api.paintAgentFilesAll('ana');
  assert.equal(h.el['d-filesall-list'].children[0].dataset.dir, 'reports');
  h.api.agentFilesGo('reports');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls[1], '/api/agent/ana/files/browse?dir=reports');
  const row = h.el['d-filesall-list'].children[0];
  assert.equal(row.dataset.doc, 'reports/a.pdf', 'the row must carry the name the routes take');
  assert.equal(row.children[0].textContent, 'a.pdf', 'the row shows the name, not the path');
  assert.equal(h.focused[0], row, 'after a move to another folder the keyboard is on its first row');
  const crumbs = h.el['d-filesall-path'].children.filter((c) => c.dataset && 'dir' in c.dataset);
  assert.deepEqual(crumbs.map((c) => [c.textContent, c.dataset.dir]), [['Files', ''], ['reports', 'reports']]);
  assert.equal(crumbs[1].attrs['aria-current'], 'location');
  assert.equal(h.el['d-filesall-path'].hidden, false);
  h.api.agentFilesGo('');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.el['d-filesall-path'].hidden, true, 'back at the top, the path line goes');
});

test('an answer for a folder the person has already left is not painted', async () => {
  const h = harness((url) => answer(decodeURIComponent(url.split('dir=')[1] || '')));
  let release;
  h.hold(new Promise((r) => { release = r; }));
  const first = h.api.paintAgentFilesAll('ana');   // the top, held
  h.hold(null);
  h.api.agentFilesGo('reports');
  await new Promise((r) => setImmediate(r));
  release();
  await first;
  assert.equal(h.el['d-filesall-list'].children[0].dataset.doc, 'reports/a.pdf', 'the top’s late answer was painted over the folder');
});

test('a failed read clears the stamp, so the same answer afterwards repaints over the failure', async () => {
  let fail = false;
  const h = harness(() => (fail ? { __status: 500, ok: false, because: 'no' } : answer('')));
  await h.api.paintAgentFilesAll('ana');
  fail = true;
  await h.api.paintAgentFilesAll('ana');
  assert.match(h.el['d-filesall-msg'].textContent, /No/);
  fail = false;
  await h.api.paintAgentFilesAll('ana');
  assert.equal(h.el['d-filesall-msg'].textContent, '', 'the old failure stayed on screen');
  assert.equal(h.el['d-filesall-list'].children.length, 2);
});

test('Download folder asks for the folder being shown, as its own name’s zip, and a refusal is said', async () => {
  const fn = page.lift(SCRIPT, 'kplusDownloadFolder');
  const clicked = [];
  const fetched = [];
  const msg = { textContent: '' };
  const say = (t) => { msg.textContent = t; };
  say.el = msg;
  const run = new Function('document', 'fetch', 'asSentence', 'KPLUS_LATEST', fn + '\nreturn kplusDownloadFolder;')(
    { createElement: () => ({ click() { clicked.push({ href: this.href, download: this.download }); }, remove() {} }), body: { appendChild() {} } },
    async (u) => { fetched.push(u); return { ok: false, json: async () => ({ because: 'that folder holds more than 2000 files, which is too many to download as one zip' }) }; },
    (t) => t.charAt(0).toUpperCase() + t.slice(1) + '.', new WeakMap());
  run('ana', 'reports/2026', say);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(clicked, [{ href: '/api/agent/ana/files/download-folder?dir=reports%2F2026', download: '2026.zip' }]);
  assert.deepEqual(fetched, ['/api/agent/ana/files/download-folder?check=1&dir=reports%2F2026']);
  assert.match(msg.textContent, /too many to download/);
  clicked.length = 0;
  run('ana', '', say);
  assert.equal(clicked[0].download, 'Files.zip', 'the top of Files downloads as Files.zip');
});

test('the wiring: a folder row is a folder before it is a file, another agent starts at the top, the poll follows a folder', () => {
  const at = SCRIPT.indexOf("for (const [listId, msgId] of [['d-files-list', 'd-files-msg'], ['d-filesall-list', 'd-filesall-msg']])");
  const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});', at));
  assert.ok(handler.indexOf("row.classList.contains('pj-dir')") > 0 && handler.indexOf("row.classList.contains('pj-dir')") < handler.indexOf('filesPvOpen('), 'a folder row would be taken as a file');
  const open = SCRIPT.slice(SCRIPT.indexOf('function openDetail(sessionName, section, fromProject) {'), SCRIPT.indexOf('paintAgentFiles(a.sessionName);', SCRIPT.indexOf('function openDetail(sessionName, section, fromProject) {')));
  assert.match(open, /AGENT_FILES_DIR = '';/, 'another agent opens in the folder the last one had open');
  const poll = page.lift(SCRIPT, 'paintAgentFiles');
  // Iteration 2: before the glance list's own read, so neither its failure nor an unchanged top of Files skips a tick.
  assert.ok(poll.indexOf('paintAgentFilesAll(sessionName)') > 0 && poll.indexOf('paintAgentFilesAll(sessionName)') < poll.indexOf("await fetch('/api/agent/'"), 'the screen follows a folder only when the glance list read succeeds');
  assert.match(open, /AGENT_FILES_FOCUS = false;/, 'a focus left pending from the last agent can land on this one');
});

test('iteration 2: the same failure on the next tick is not written again (a status line rewritten is re-announced); a recovery and a new failure are', async () => {
  let answer = { __status: 409, ok: false, because: 'this is a file, not a folder' };
  const h = harness(() => answer);
  await h.api.paintAgentFilesAll('ana');
  const msg = h.el['d-filesall-msg'];
  assert.match(msg.textContent, /file, not a folder/);
  let writes = 0;
  const real = Object.getOwnPropertyDescriptor(msg, 'textContent');
  Object.defineProperty(msg, 'textContent', { get: real.get, set(v) { writes++; real.set.call(this, v); } });
  await h.api.paintAgentFilesAll('ana');
  assert.equal(writes, 0, 'the same refusal was written into the status line again');
  answer = { __status: 409, ok: false, because: 'we cannot read this folder' };
  await h.api.paintAgentFilesAll('ana');
  assert.ok(writes > 0, 'a changed refusal was not shown');
  answer = answer0();
  await h.api.paintAgentFilesAll('ana');
  assert.equal(msg.textContent, '', 'a recovery left the failure on screen');
});
const answer0 = () => ({ ok: true, dir: '', stamp: 's-top', dirs: [], files: [{ name: 'note.txt', size: 1 }] });

test('iteration 2: a move whose read fails leaves no focus pending to land on a later screen', async () => {
  const h = harness(() => ({ __status: 404, ok: false, because: 'that folder is not there any more, or it was moved' }));
  h.api.agentFilesGo('gone');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.api.focusPending(), false);
  assert.equal(h.focused.length, 0);
});

test('iteration 2: the overflow line quotes the server\u2019s own limit', async () => {
  const h = harness(() => ({ ok: true, dir: '', stamp: 'x', truncated: true, limit: 1000, dirs: [], files: [{ name: 'a.txt', size: 1 }] }));
  await h.api.paintAgentFilesAll('ana');
  assert.equal(h.el['d-filesall-more'].textContent, 'This folder holds more than ' + (1000).toLocaleString() + ' items, so not all of them are listed here.');
  assert.match(PAGE, /id="d-filesall-h" tabindex="-1"/, 'the heading, the last place focus can go, cannot take it');
});

test('iteration 2: a text file in the preview: its words as text, a note when cut, the file card when it will not read, nothing after close', async () => {
  const fn = page.lift(SCRIPT, 'pvTextInto');
  const node = () => ({ className: '', textContent: '', kids: [], appendChild(c) { this.kids.push(c); } });
  const asked = [];
  const run = async (res, closed = false) => {
    const stage = node();
    Object.defineProperty(stage, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.kids = []; } });
    const doc = { createElement: () => node(), contains: () => !closed };
    await new Function('document', 'fetch', fn + '\nreturn pvTextInto;')(doc, async (u) => { asked.push(u); return res; })(stage, { kind: 'agent', owner: 'ana', name: 'docs/a b.txt' }, () => ({ card: true }));
    return stage;
  };
  const ok = (body, cut) => ({ ok: true, text: async () => body, headers: { get: (k) => (k === 'x-kosmos-preview-cut' && cut ? '1' : null) } });
  const plain = await run(ok('<b>words</b>', false));
  assert.equal(asked[0], '/api/agent/ana/files/preview?name=' + encodeURIComponent('docs/a b.txt'), 'the address it writes for an agent\u2019s file');
  assert.equal(plain.kids[0].className, 'pv-text');
  assert.equal(plain.kids[0].textContent, '<b>words</b>', 'the words are shown as they are, as text');
  assert.equal(plain.kids.length, 1, 'a whole file got a "start of the file" note');
  const cut = await run(ok('the start', true));
  assert.equal(cut.kids[1].textContent, 'The start of the file');
  const refused = await run({ ok: false });
  assert.deepEqual(refused.kids, [{ card: true }], 'a preview that will not read must show the file card');
  const late = await run(ok('late', false), true);
  assert.equal(late.kids[0].textContent, 'Reading…', 'an answer after the preview closed was written');
});

test('iteration 3: a list stopped by the read budget says Kosmos stopped looking, not a count', async () => {
  const h = harness(() => ({ ok: true, dir: '', stamp: 'y', truncated: true, scanCut: true, dirs: [], files: [{ name: 'a.txt', size: 1 }] }));
  await h.api.paintAgentFilesAll('ana');
  assert.equal(h.el['d-filesall-more'].textContent, 'This folder holds a lot, so Kosmos stopped looking partway through it. Some files may not be listed here.');
});

test('iteration 6: the preview fetches a text file only through an explicit Files address, never from an attachment\u2019s own words', () => {
  const kind = new Function(page.lift(SCRIPT, 'pvStageKind') + '\nreturn pvStageKind;')();
  // An attachment's preview is the file's first characters: untrusted, and never an address.
  assert.equal(kind({ kind: 'text', preview: '/api/accounts' }), 'card', 'a text attachment beginning "/api/" would make the viewer fetch that path');
  assert.equal(kind({ kind: 'text', preview: 'hello there' }), 'snippet', 'CONTROL: an attachment\u2019s words show as its snippet');
  assert.equal(kind({ kind: 'text', textOf: { kind: 'agent', owner: 'ana', name: 'a.txt' } }), 'textOf');
  assert.equal(kind({ kind: 'text', textOf: { kind: 'project', owner: 'p-1', name: 'a.txt' } }), 'textOf');
  assert.equal(kind({ kind: 'text', textOf: { kind: 'accounts', owner: 'x', name: 'a.txt' } }), 'card', 'textOf names an agent or a project list, nothing else');
  assert.equal(kind({ kind: 'text', textUrl: '/api/agent/ana/files/preview?name=a.txt' }), 'card', 'an address on the record is never fetched');
  assert.equal(kind({ kind: 'image', preview: '/api/attachment/1/preview' }), 'media', 'CONTROL: pictures as before');
  const open = page.lift(SCRIPT, 'pvOpen');
  assert.match(open, /pvTextInto\(stage, a\.textOf, fileCard\)/);
  assert.doesNotMatch(open, /pvTextInto\(stage, a\.preview/, 'the preview text is used as an address again');
  assert.match(PAGE, /#d-filesall-path button \{ min-height: 44px;/, 'the path line\u2019s buttons are small on a phone');
});
