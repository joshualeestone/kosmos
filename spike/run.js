'use strict';
/* #4904 spike: boot today's board on Linux, create one agent (stub CLI), send it a message, record what happens.
   A measurement on a throwaway branch: never merged. Every outbound address is closed, and the workflow also
   blocks the network at the firewall, so nothing reaches a public counter. */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..');
const LABEL = process.env.SPIKE_LABEL || 'A';
const SB = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'spike-' + LABEL + '-'));
const HOME = path.join(SB, 'home');
fs.mkdirSync(HOME, { recursive: true });
const ROOT = path.join(HOME, 'Library', 'Application Support', 'Kosmos');   // store.js's non-Windows default
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'internal.json'), JSON.stringify({ internal: true }));
// A Claude account record, as server.create-live-1903.test.js writes, so create gets past "no account signed in".
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'spike@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
const PORT = 17890;
const CLOSED = 'https://127.0.0.1:9';
const env = Object.assign({}, process.env, {
  HOME, PORT: String(PORT),
  AGENT_WORKFORCE_CLAUDE_BIN: path.join(__dirname, 'stub-claude.sh'),
  AGENT_WORKFORCE_CREATED_URL: CLOSED, AGENT_WORKFORCE_FEEDBACK_URL: CLOSED, AGENT_WORKFORCE_RELEASE_BASE: CLOSED,
  AGENT_WORKFORCE_COMMUNITY_URL: CLOSED, AGENT_WORKFORCE_TUNNEL_COORDINATOR: CLOSED, AGENT_WORKFORCE_TUNNEL_RELAY: '127.0.0.1:9',
});
delete env.NODE_TEST_CONTEXT;

const out = [];
const say = (s) => { s = '[' + LABEL + '] ' + s; out.push(s); console.log(s); };
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', env, timeout: 15000 }); } catch (e) { return 'ERR ' + (e.status) + ' ' + String(e.stderr || e.message).slice(0, 2000); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  say('== platform ' + process.platform + ' ' + os.release() + ' node ' + process.version);
  say('== tmux ' + sh('tmux', ['-V']).trim());
  const board = spawn(process.execPath, [path.join(REPO, 'server.js')], { env, cwd: REPO });
  let log = '';
  board.stdout.on('data', (d) => { log += d; process.stdout.write('[board] ' + d); });
  board.stderr.on('data', (d) => { log += d; process.stdout.write('[board!] ' + d); });
  let exited = null;
  board.on('exit', (c, s) => { exited = { c, s }; say('== BOARD EXITED code=' + c + ' signal=' + s); });
  const t0 = Date.now();
  while (!/Kosmos on http/.test(log) && !exited && Date.now() - t0 < 60000) await sleep(250);
  say('== banner ' + (/Kosmos on http/.test(log) ? 'SEEN after ' + (Date.now() - t0) + ' ms' : 'NOT SEEN') + (exited ? ' (board exited)' : ''));
  if (exited) return finish(1);
  const base = 'http://127.0.0.1:' + PORT;
  let tok = '';
  try { tok = fs.readFileSync(path.join(ROOT, 'board.token'), 'utf8').trim(); } catch { say('== no board.token at ' + ROOT); }
  const H = { 'content-type': 'application/json' };
  if (tok) H['x-kosmos-board-token'] = tok;
  const call = async (method, p, body) => {
    try {
      const r = await fetch(base + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      say('== ' + method + ' ' + p + ' -> ' + r.status + ' ' + text.slice(0, 1500).replace(/\s+/g, ' '));
      return { status: r.status, text };
    } catch (e) { say('== ' + method + ' ' + p + ' -> THREW ' + e.message); return { status: 0, text: '' }; }
  };
  await call('GET', '/');
  await call('POST', '/api/agents', { name: 'linuxa', role: 'pm' });
  say('== workers dir: ' + sh('find', [path.join(HOME), '-maxdepth', '4', '-path', '*linuxa*']).trim().slice(0, 800));
  await sleep(15000);
  say('== tmux ls: ' + sh('tmux', ['ls']).trim());
  const panes = sh('tmux', ['list-panes', '-a', '-F', '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}']).trim();
  say('== panes: ' + panes);
  const target = (panes.split('\n').find((l) => /linuxa/i.test(l)) || '').split(' ')[0];
  if (target) say('== pane before message:\n' + sh('tmux', ['capture-pane', '-p', '-t', target]));
  await call('POST', '/api/agent/linuxa/thread', { text: 'hello from the linux spike' });
  await sleep(10000);
  if (target) {
    const cap = sh('tmux', ['capture-pane', '-p', '-S', '-200', '-t', target]);
    say('== pane after message:\n' + cap);
    say('== AGENT ANSWERED: ' + (/STUB-REPLY: got \[.*hello from the linux spike/.test(cap) ? 'YES' : 'NO'));
  } else say('== AGENT ANSWERED: NO (no tmux pane for linuxa)');
  say('== restart the agent');
  await call('POST', '/api/agent/linuxa/restart', {});
  await sleep(10000);
  say('== tmux ls after restart: ' + sh('tmux', ['ls']).trim());
  say('== supervisor/launchd references in the board log: ' + (log.match(/launchctl|launchd|osascript|security find|pmset|caffeinate|defaults (read|write)/g) || []).length);
  finish(0);

  function finish(code) {
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'board-' + LABEL + '.log'), log);
    fs.appendFileSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'spike-summary.txt'), out.join('\n') + '\n');
    try { board.kill('SIGTERM'); } catch { /* gone */ }
    setTimeout(() => process.exit(code), 3000);
  }
})();
