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
  const rows = [{ sessionName: 'sub-zero', runner: 'claude', account: { dir: '/agent-sep' } }];
  attachPluginReach(rows, { personHome: '/person', fs });
  assert.equal(rows[0].reach.reaches, false);
  assert.equal(rows[0].reach.reason, 'separate-account-folder');
  assert.deepEqual(rows[0].reach.missing.sort(), ['crm@acme', 'tickets']);
});

test('#5309 p2 /api/status: a default-account agent reaches (true) and a Gemini agent is null (not-applicable)', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const rows = [
    { sessionName: 'raiden', runner: 'claude', account: { dir: null } },     // default -> shares the home
    { sessionName: 'grok-one', runner: 'gemini', account: { dir: '/g' } },   // other runner -> not-applicable
  ];
  attachPluginReach(rows, { personHome: '/person', fs });
  assert.deepEqual(rows[0].reach, { reaches: true, reason: 'reaches' });
  assert.equal(rows[1].reach.reaches, null);
});

test('#5309 p2 /api/status: a Codex agent fires on the person Codex presence; empty renders nothing', () => {
  _resetCache();
  const present = fakeFs({ ...personFiles(), '/person/.codex/config.toml': '[mcp_servers.foo]\n' },
    { ...personMtimes(), '/person/.codex/config.toml': 1, '/person/.codex/plugins': 1 });
  const rows = [{ sessionName: 'sub-zero', runner: 'codex', account: { dir: '/cx' } }];
  attachPluginReach(rows, { personHome: '/person', fs: present });
  assert.deepEqual(rows[0].reach, { reaches: false, reason: 'codex-isolated-runtime' });

  _resetCache();
  const empty = fakeFs(personFiles(), personMtimes()); // no ~/.codex entries
  const rows2 = [{ sessionName: 'sub-zero', runner: 'codex', account: { dir: '/cx' } }];
  attachPluginReach(rows2, { personHome: '/person', fs: empty });
  assert.equal(rows2[0].reach.reaches, null); // no-evidence -> renders nothing
});

test('#5309 p2 /api/status: a pane we cannot tie to an agent (no account) gets reach null', () => {
  _resetCache();
  const fs = fakeFs(personFiles(), personMtimes());
  const rows = [{ sessionName: 'stranger', runner: 'claude', account: null }];
  attachPluginReach(rows, { personHome: '/person', fs });
  assert.equal(rows[0].reach, null);
});

test('#5309 p2 /api/status: a SECOND status pass re-reads nothing when files are unchanged (Liu Kang #5309)', () => {
  _resetCache();
  const files = personFiles(); const mtimes = personMtimes();
  const fs = fakeFs(files, mtimes);
  const rows = () => [
    { sessionName: 'sub-zero', runner: 'claude', account: { dir: '/agent-sep' } },
    { sessionName: 'raiden', runner: 'claude', account: { dir: null } },
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
