'use strict';
/**
 * #7108 review 3: the routes the iPhone reads never carry a lone surrogate. JSON.stringify writes one as "\ud83d", and
 * the phone's JSON reader refuses the whole answer. Agent- and person-written text reaches these routes by many paths
 * (here a project description holding a broken character), so the server makes every string well-formed as it writes
 * the answer (engine/textcut.js strictStringify), over HTTP on a fully sandboxed board.
 *
 *   node --test server.strict-json-7108.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-strict-json-7108-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const fleet = require('./test-support/fleet');
const { strictStringify } = require('./engine/textcut');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

// JSON.stringify escapes only a LONE half (a valid pair is written as itself), so any such escape is one the phone refuses.
const LONE_ESCAPE = /\\ud[89a-f][0-9a-f]{2}/i;

test('#7108: /api/projects never carries a lone surrogate, even from a description stored with one', async () => {
  const p = projects.create({ name: 'Broken Char', description: 'fix the \uD83D logo' });
  assert.ok(LONE_ESCAPE.test(JSON.stringify(projects.list([]).find((x) => x.id === p.id))), 'CONTROL: the engine answer carries the lone half');
  const r = await fetch(`${base}/api/projects`);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.includes('Broken Char'), 'fixture: the project is in the answer');
  assert.ok(!LONE_ESCAPE.test(text), 'the projects answer carries a lone surrogate escape');
  assert.ok(text.includes('fix the � logo'), 'the broken character is not shown as the replacement mark');
});

test('#7108: /api/status is written the same way', async () => {
  const r = await fetch(`${base}/api/status`);
  assert.equal(r.status, 200);
  assert.ok(!LONE_ESCAPE.test(await r.text()), 'the status answer carries a lone surrogate escape');
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(/body = strictStringify\(\{[^\n]*\n\s*\.\.\.snap, agents: rows/.test(src), 'the status answer is not written through strictStringify');
});

test('#7108: strictStringify leaves well-formed text alone and mends only a lone half', () => {
  assert.equal(strictStringify({ a: 'ok \u{1F600}', b: [1, 'x\uD83D'] }), JSON.stringify({ a: 'ok \u{1F600}', b: [1, 'x�'] }));
  assert.equal(strictStringify({ a: 1 }, 2), JSON.stringify({ a: 1 }, null, 2));
});
