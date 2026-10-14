'use strict';

// #5309 part 2, slice 2: the /api/status wiring of the per-agent plugin-reach signal.
// Drives the exported attachPluginReach (the seam the route calls) with fixture rows + an injected fs
// that COUNTS reads, exactly as web.community-card-5314 drives withAgentSortFields. Proves: the right
// reach verdict lands on each row, and a second status pass re-reads nothing when mtimes are unchanged
// (the per-poll read discipline Liu Kang required, #5309; consistent with #5314's read-once pattern).

const test = require('node:test');
const assert = require('node:assert/strict');
const { attachPluginReach } = require('./server');
const { _resetCache } = require('./engine/pluginreach');

// A fake fs serving a fixed file map, counting reads/stats (so a test can prove the mtime cache stops a
// second pass from re-reading unchanged files). Mirrors engine/pluginreach.test.js's fakeFs.
function fakeFs(files, mtimes) {
  const counts = { read: 0, stat: 0, readdir: 0 };
  const enoent = (m) => { const e = new Error(m); e.code = 'ENOENT'; return e; };
  return {
    counts,
    readFileSync(p) { counts.read++; if (!(p in files)) throw enoent('read ' + p); if (files[p] instanceof Error) throw files[p]; return files[p]; },
    statSync(p) { counts.stat++; if (!(p in mtimes)) throw enoent('stat ' + p); return { mtimeMs: mtimes[p] }; },
    readdirSync(p) { counts.readdir++; if (!(p in files)) throw enoent('readdir ' + p); const v = files[p]; if (v instanceof Error) throw v; return v; },
  };
}

// Person home at /person: enabled plugin crm@acme + MCP server tickets; empty Codex home.
function personFiles() {
  return {
    '/person/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'crm@acme': true } }),
    '/person/.claude.json': JSON.stringify({ mcpServers: { tickets: {} } }),
    '/agent-sep/settings.json': '{}', '/agent-sep/.claude.json': '{}',       // separate account: lacks both
  };
}
function personMtimes() {
  return {
    '/person/.claude/settings.json': 1, '/person/.claude.json': 1,
    '/agent-sep/settings.json': 1, '/agent-sep/.claude.json': 1,
  };
}

test('#5309 p2 /api/status: a separate-account Claude agent gets reaches:false with what is missing', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const rows = [{ runner: 'claude', account: { dir: '/agent-sep' } }]; // sub-zero: a separate account
  attachPluginReach(rows, { personHome: '/person', fs });
  assert.equal(rows[0].reach.reaches, false);
  assert.equal(rows[0].reach.reason, 'separate-account-folder');
  assert.deepEqual(rows[0].reach.missing.sort(), ['crm@acme', 'tickets']);
});

test('#5309 p2 /api/status: a default-account agent reaches (true) and a Gemini agent is null (not-applicable)', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const rows = [
    { runner: 'claude', account: { dir: null }, session: 'raiden' },     // raiden, default -> shares the home
    { runner: 'gemini', account: { dir: '/g' } },   // grok-one, other runner -> not-applicable
  ];
  // #6095: a default agent's session is read for its real folder; '' is the clean default launch.
  attachPluginReach(rows, { personHome: '/person', fs, sessionDirs: () => new Map([['raiden', '']]) });
  assert.deepEqual(rows[0].reach, { reaches: true, reason: 'reaches' });
  assert.equal(rows[1].reach.reaches, null);
});

test('#5309 p2 /api/status: a Codex agent fires on the person Codex presence; empty renders nothing', () => {
  _resetCache();
  const present = fakeFs({ ...personFiles(), '/person/.codex/config.toml': '[mcp_servers.foo]\n' },
    { ...personMtimes(), '/person/.codex/config.toml': 1, '/person/.codex/plugins': 1 });
  const rows = [{ runner: 'codex', account: { dir: '/cx' } }]; // sub-zero: a Codex agent
  attachPluginReach(rows, { personHome: '/person', fs: present });
  assert.deepEqual(rows[0].reach, { reaches: false, reason: 'codex-isolated-runtime' });

  _resetCache();
  const empty = fakeFs(personFiles(), personMtimes()); // no ~/.codex entries
  const rows2 = [{ runner: 'codex', account: { dir: '/cx' } }]; // sub-zero: Codex, empty person ~/.codex
  attachPluginReach(rows2, { personHome: '/person', fs: empty });
  assert.equal(rows2[0].reach.reaches, null); // no-evidence -> renders nothing
});

test('#5309 p2 /api/status: a pane we cannot tie to an agent (no account) gets reach null', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const rows = [{ runner: 'claude', account: null }]; // a pane we cannot tie to an agent (no account)
  attachPluginReach(rows, { personHome: '/person', fs });
  assert.equal(rows[0].reach, null);
});

test('#5309 p2 /api/status: a SECOND status pass re-reads nothing when files are unchanged (Liu Kang #5309)', () => {
  _resetCache();
  const files = personFiles(); const mtimes = personMtimes();
  const fs = fakeFs(files, mtimes);
  const rows = () => [
    { runner: 'claude', account: { dir: '/agent-sep' } }, // sub-zero: separate account
    { runner: 'claude', account: { dir: null } },         // raiden: default, shares the home
  ];
  attachPluginReach(rows(), { personHome: '/person', fs });   // pass 1
  const afterPass1 = fs.counts.read;
  assert.ok(afterPass1 > 0, 'pass 1 reads the evidence files');
  attachPluginReach(rows(), { personHome: '/person', fs });   // pass 2, nothing changed
  assert.equal(fs.counts.read, afterPass1, 'pass 2 must not re-read any unchanged file');
  // CONTROL: the cache is not vacuously passing -- a changed file is re-read on the next pass.
  mtimes['/person/.claude/settings.json'] = 2;
  attachPluginReach(rows(), { personHome: '/person', fs }); // pass 3
  assert.ok(fs.counts.read > afterPass1, 'a changed file MUST be re-read on the next pass');
});

// Per-project mcpServers through the SERVER wiring: attachPluginReach resolves each agent's own working
// folder (workerDir -> canonicalize) and passes it so ONLY that folder's project servers count (#5309).
// workerDir + canonicalize are injected so the test needs no real worker dir on disk.
function projectFiles() {
  return {
    '/person/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'crm@acme': true } }),
    '/person/.claude.json': JSON.stringify({ mcpServers: { tickets: {} }, projects: { '/work/p': { mcpServers: { calendar: {} } } } }),
    '/agent-sep/settings.json': '{}', '/agent-sep/.claude.json': '{}',
  };
}
function projectMtimes() {
  return { '/person/.claude/settings.json': 1, '/person/.claude.json': 1, '/agent-sep/settings.json': 1, '/agent-sep/.claude.json': 1 };
}
const idCanon = (p) => p; // identity: a fake worker dir resolves to itself (no realpath on a non-existent path)

test('#5309 p2 /api/status: a per-project mcpServer counts ONLY for the agent whose own folder it is (server wiring)', () => {
  _resetCache();
  // the agent's own working folder IS /work/p -> the person's /work/p calendar server is one it loses -> counted
  const r1 = [{ runner: 'claude', account: { dir: '/agent-sep' } }]; // separate-account agent
  attachPluginReach(r1, { personHome: '/person', fs: fakeFs(projectFiles(), projectMtimes()), workerDir: () => '/work/p', canonicalize: idCanon });
  assert.equal(r1[0].reach.reaches, false);
  assert.deepEqual(r1[0].reach.missing.sort(), ['calendar', 'crm@acme', 'tickets']);
});

test('#5309 p2 /api/status: a project server in ANOTHER folder is NOT counted (no false warning)', () => {
  _resetCache();
  const r = [{ runner: 'claude', account: { dir: '/agent-sep' } }];
  attachPluginReach(r, { personHome: '/person', fs: fakeFs(projectFiles(), projectMtimes()), workerDir: () => '/work/other', canonicalize: idCanon });
  assert.deepEqual(r[0].reach.missing.sort(), ['crm@acme', 'tickets']);
});

test('#5309 p2 /api/status: a workerDir thunk that THROWS falls back to top-level only (no crash)', () => {
  _resetCache();
  const r = [{ runner: 'claude', account: { dir: '/agent-sep' } }];
  attachPluginReach(r, { personHome: '/person', fs: fakeFs(projectFiles(), projectMtimes()), workerDir: () => { throw new Error('boom'); }, canonicalize: idCanon });
  assert.deepEqual(r[0].reach.missing.sort(), ['crm@acme', 'tickets']);
});

/* #6095: a default-account Claude agent is not ASSUMED to run in the person's folder. Its tmux session's real
   CLAUDE_CONFIG_DIR is read (engine/sessionccd, one call for every such agent): a pinned folder is judged as that
   folder, '' is the clean default, and unknown gives reach UNKNOWN (the board renders nothing). */
test('#6095: a default agent whose session is pinned to another folder is judged as that folder', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const rows = [{ runner: 'claude', account: { dir: null }, session: 'pinned' }];
  attachPluginReach(rows, { personHome: '/person', fs, sessionDirs: () => new Map([['pinned', '/agent-sep']]) });
  assert.equal(rows[0].reach.reaches, false, 'it runs in /agent-sep, not the person\'s folder');
  assert.equal(rows[0].reach.reason, 'separate-account-folder');
  assert.deepEqual(rows[0].reach.missing.sort(), ['crm@acme', 'tickets']);
});

test('#6095: unknown (no answer, a failed read, no session) is UNKNOWN, never the default', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const unknownRow = () => ({ runner: 'claude', account: { dir: null }, session: 'u' });
  for (const [why, dirs] of [
    ['answered unknown', () => new Map([['u', null]])],
    ['not in the answer', () => new Map()],
    ['the read threw', () => { throw new Error('tmux gone'); }],
  ]) {
    const rows = [unknownRow()];
    attachPluginReach(rows, { personHome: '/person', fs, sessionDirs: dirs });
    assert.deepEqual(rows[0].reach, { reaches: null, reason: 'unknown' }, why);
  }
  const noSession = [{ runner: 'claude', account: { dir: null } }];
  attachPluginReach(noSession, { personHome: '/person', fs, sessionDirs: () => new Map() });
  assert.deepEqual(noSession[0].reach, { reaches: null, reason: 'unknown' }, 'no session to name');
});

test('#6095: one session read for every default agent; accounts with a folder and other runners are not asked about', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const asked = [];
  const rows = [
    { runner: 'claude', account: { dir: null }, session: 'a' },
    { runner: null, account: { dir: null }, session: 'b', sessionName: 'b-name' },
    { runner: 'claude', account: { dir: '/agent-sep' }, session: 'c' },
    { runner: 'codex', account: { dir: null }, session: 'd' },
    { runner: 'claude', account: { dir: null }, sessionName: 'e' },
  ];
  attachPluginReach(rows, { personHome: '/person', fs, sessionDirs: (names) => { asked.push(names); return new Map(names.map((n) => [n, ''])); } });
  assert.deepEqual(asked, [['a', 'b', 'e']], 'one call; the session first, else the sessionName; only default Claude agents');
  assert.deepEqual(rows[0].reach, { reaches: true, reason: 'reaches' });
  assert.deepEqual(rows[1].reach, { reaches: true, reason: 'reaches' });
});

test('#6095: Windows has no tmux sessions and keeps the default reading, with no session read', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  let called = 0;
  const rows = [{ runner: 'claude', account: { dir: null }, session: 'w' }];
  attachPluginReach(rows, { personHome: '/person', fs, platform: 'win32', sessionDirs: () => { called += 1; return new Map(); } });
  assert.equal(called, 0);
  assert.deepEqual(rows[0].reach, { reaches: true, reason: 'reaches' });
});
