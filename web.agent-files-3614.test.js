'use strict';
/* #3614: the agent page's Files block. Placement is checked on the shipped markup (directly under
 * the four-pack, inside the left column); the painter is the REAL function lifted from
 * web/index.html, run against a stub DOM and fetch.
 *
 *   node --test web.agent-files-3614.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// CURRENT is a REAL board card (fixture-discipline): sandbox the roots before requiring the fleet.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-page-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('ana'), fleet.agent('bix')]);
const card = (name) => BOARD.agents.find((c) => c.sessionName === name);
test.after(() => { try { BOARD.restore(); } catch { /* restored */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

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

function harness(respond, current = card('ana')) {
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
  const make2 = new Function('document', 'fetch', 'fileIcon', 'pjSize', 'asSentence', 'env',
    'let AGENT_FILES_EPOCH = 0; let AGENT_FILES_STAMP = null;\n'
    + 'const CURRENT_REF = env; \n'
    + FNS.replace(/\bCURRENT\b/g, 'CURRENT_REF.CURRENT')
    + '\nreturn { paintAgentFiles, resetStamp: () => { AGENT_FILES_STAMP = null; } };');
  const api = make2(document, async (url) => {
    calls.push(url);
    const out = respond(url);
    const status = (out && out.__status) || 200;
    return { ok: status < 400, status, json: async () => out };
  }, () => '', (n) => n + ' B', (t) => t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.'), env);
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
  const other = harness(() => ({ ok: true, total: 1, stamp: 'x', files: [{ name: 'theirs.txt', size: 1 }] }), card('bix'));
  await other.api.paintAgentFiles('ana');
  assert.equal(other.el['d-files-list'].children.length, 0, 'one agent’s files were painted under another agent');
});

test('a 404 (no folder of its own) says so in agent-page words, not "no agent by that name"; reasons are sentences', async () => {
  const h = harness(() => ({ __status: 404, ok: false, because: 'there is no agent by that name on this computer' }));
  await h.api.paintAgentFiles('ana');
  assert.match(h.el['d-files-msg'].textContent, /This agent has no folder of its own on this computer/);
  assert.doesNotMatch(h.el['d-files-msg'].textContent, /no agent by that name/, 'the agent page told the person their open agent does not exist');
  const r = harness(() => ({ ok: false, because: 'this is a file, not a folder' }));
  await r.api.paintAgentFiles('ana');
  assert.equal(r.el['d-files-msg'].textContent, 'This is a file, not a folder.', 'a reason was shown unformed');
});

/* The two click handlers are listeners, not named functions, so they are exercised through the
   shipped source: each must re-check the agent after its await, clear on a plain success, and
   the reveal handler must not repaint over its own failure. */
test('the click handlers: agent re-checked after the await, success clears, a failed reveal keeps its reason', () => {
  const at = SCRIPT.indexOf("document.getElementById('d-files-list') && document.getElementById('d-files-list').addEventListener('click'");
  const reveal = SCRIPT.indexOf("document.getElementById('d-files-finder') && document.getElementById('d-files-finder').addEventListener('click'");
  assert.ok(at > 0 && reveal > at, 'the handlers moved; update this test');
  const openSrc = SCRIPT.slice(at, reveal);
  const revealSrc = SCRIPT.slice(reveal, SCRIPT.indexOf('\n});', reveal) + 4); // the handler's own closing line
  assert.match(openSrc, /const who = CURRENT\.sessionName/);
  assert.match(openSrc, /CURRENT && CURRENT\.sessionName === who\) msg\.textContent = say/, 'the open handler writes without re-checking the agent');
  assert.match(openSrc, /res\.ok \? \(b\.revealedInstead \? \(b\.say \|\| ''\) : ''\)/, 'a plain success does not clear an old refusal');
  assert.match(revealSrc, /if \(!CURRENT \|\| CURRENT\.sessionName !== who\) return;/, 'the reveal handler writes without re-checking the agent');
  assert.match(revealSrc, /if \(failed\) \{ if \(msg\) msg\.textContent = failed; return; \}/, 'a failed reveal is repainted over');
  assert.ok(revealSrc.indexOf('if (failed)') < revealSrc.indexOf('paintAgentFiles(who)'), 'the repaint runs before the failure is handled');
  assert.match(revealSrc, /res\.status === 404\) failed = 'This agent has no folder of its own on this computer/, 'a 404 from Open in Finder tells the person their open agent does not exist');
});

test('an unchanged refusal is not rewritten into the status region on the next tick; a changed one is', async () => {
  let because = 'this is a file, not a folder';
  const h = harness(() => ({ ok: false, because, files: [] }));
  await h.api.paintAgentFiles('ana');
  const msg = h.el['d-files-msg'];
  let writes = 0;
  const real = Object.getOwnPropertyDescriptor(msg, 'textContent');
  Object.defineProperty(msg, 'textContent', { get: real.get, set(v) { writes++; real.set.call(this, v); } });
  await h.api.paintAgentFiles('ana');
  assert.equal(writes, 0, 'the same refusal was written into the live region again');
  because = 'we could not read this folder';
  await h.api.paintAgentFiles('ana');
  assert.ok(writes > 0, 'a changed refusal was not shown');
  assert.match(msg.textContent, /We could not read this folder/);
});

test('a read that keeps failing on the network is not rewritten into the status region each tick', async () => {
  const h = harness(() => { throw new Error('offline'); });
  await h.api.paintAgentFiles('ana');
  const msg = h.el['d-files-msg'];
  assert.match(msg.textContent, /could not read this agent/);
  let writes = 0;
  const real = Object.getOwnPropertyDescriptor(msg, 'textContent');
  Object.defineProperty(msg, 'textContent', { get: real.get, set(v) { writes++; real.set.call(this, v); } });
  await h.api.paintAgentFiles('ana');
  assert.equal(writes, 0, 'the same network failure was written into the live region again');
});

test('opening an agent clears the previous agent\'s Files rows before its own arrive', () => {
  const at = SCRIPT.indexOf('function openDetail(sessionName, section, fromProject) {');
  const body = SCRIPT.slice(at, SCRIPT.indexOf('paintAgentFiles(a.sessionName);', at));
  assert.match(body, /fl\.textContent = ''/, 'the old rows stay on screen under the new agent');
  assert.match(body, /fm\.textContent = ''/);
  assert.match(body, /fo\.hidden = true/);
});
