'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pluginreach = require('./pluginreach');
const {
  reachFrom, reachForAgent,
  agentPluginReach, folderPluginSet, codexPersonPresence, gateOnEvidence, _resetCache,
  REACHES, SEPARATE_ACCOUNT, CODEX_ISOLATED, NOT_APPLICABLE, UNKNOWN, NO_EVIDENCE,
} = pluginreach;

// #5309 slice 2 evidence-gate tests use a fake fs that serves a fixed file map and COUNTS reads/stats,
// so a test can prove the mtime cache stops a second poll from re-reading unchanged files.
function fakeFs(files, mtimes) {
  const counts = { read: 0, stat: 0, readdir: 0 };
  const enoent = (m) => { const e = new Error(m); e.code = 'ENOENT'; return e; };
  const fs = {
    counts,
    readFileSync(p) { counts.read++; if (!(p in files)) throw enoent('read ' + p); if (files[p] instanceof Error) throw files[p]; return files[p]; },
    statSync(p) { counts.stat++; if (!(p in mtimes)) throw enoent('stat ' + p); return { mtimeMs: mtimes[p] }; },
    readdirSync(p) { counts.readdir++; if (!(p in files)) throw enoent('readdir ' + p); const v = files[p]; if (v instanceof Error) throw v; return v; },
  };
  return fs;
}

const HOME = '/Users/person/.claude';

test('#5309 p2: a default-account Claude agent (CLAUDE_CONFIG_DIR unset) reaches the person plugins', () => {
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: HOME }),
    { reaches: true, reason: REACHES });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: HOME, personClaudeHome: HOME }),
    { reaches: true, reason: REACHES });
});

test('#5309 p2: a non-default Claude account folder does NOT reach, and names the folder', () => {
  const r = reachFrom({ runner: 'claude', agentClaudeDir: '/Users/person/.claude-work', personClaudeHome: HOME });
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
  assert.equal(r.folder, '/Users/person/.claude-work');
});

test('#5309 p2: CONTROL - the folder comparison distinguishes both ways (not blanket true/false)', () => {
  const same = reachFrom({ runner: 'claude', agentClaudeDir: HOME, personClaudeHome: HOME });
  const diff = reachFrom({ runner: 'claude', agentClaudeDir: HOME + '-other', personClaudeHome: HOME });
  assert.equal(same.reaches, true);
  assert.equal(diff.reaches, false);
});

test('#5309 p2: path forms that resolve equal are NOT a mismatch', () => {
  assert.equal(reachFrom({ runner: 'claude', agentClaudeDir: '/Users/person/./.claude', personClaudeHome: HOME }).reaches, true);
  assert.equal(reachFrom({ runner: 'claude', agentClaudeDir: '/Users/person/.claude/', personClaudeHome: HOME }).reaches, true);
});

test('#5309 p2: a RELATIVE agent dir is UNKNOWN, never a spurious reach (path.resolve would use cwd)', () => {
  // A relative dir could resolve against the process cwd to anything, including the person home.
  // Refuse to compare it rather than risk a false reaches:true.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: 'relative/.claude', personClaudeHome: HOME }),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: '.claude', personClaudeHome: HOME }),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2: a non-string agent dir or person-home is UNKNOWN and never throws', () => {
  // reachFrom must not throw on an unexpected (truthy non-string) input; it is a public export slice 2
  // feeds with live pane env.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: {}, personClaudeHome: HOME }),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: 42, personClaudeHome: HOME }),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: HOME, personClaudeHome: 123 }),
    { reaches: null, reason: UNKNOWN });
  // A null or non-object argument must not throw (the `= {}` default only covers undefined).
  assert.deepEqual(reachFrom(null), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom(42), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom(), { reaches: null, reason: UNKNOWN });
});

test('#5309 p2: a dir with a ".." segment is UNKNOWN, never a symlink-traversal spurious reach', () => {
  // path.resolve is lexical: '/Users/person/x/../.claude' collapses to '/Users/person/.claude' WITHOUT
  // following a symlink at x, so a crafted dir could otherwise compare equal to the person home. Reject
  // '..' in either path.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: '/Users/person/x/../.claude', personClaudeHome: HOME }),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: '/Users/person/x/../.claude' }),
    { reaches: null, reason: UNKNOWN });
  // win32 separator: a '\\'-separated '..' must be caught too -- split on /[\\/]/, not path.sep, or a
  // forward-slash path on win32 (path.sep='\\') would let the '..' through.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: '/abs\\..\\.claude', personClaudeHome: HOME }),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2: Codex never reaches (isolated runtime, by design), whatever its dir', () => {
  assert.deepEqual(reachFrom({ runner: 'codex', agentClaudeDir: '/Users/person/.codex', personClaudeHome: HOME }),
    { reaches: false, reason: CODEX_ISOLATED });
  assert.deepEqual(reachFrom({ runner: 'codex', agentClaudeDir: null, personClaudeHome: HOME }),
    { reaches: false, reason: CODEX_ISOLATED });
  assert.equal(reachFrom({ runner: 'CODEX', personClaudeHome: HOME }).reason, CODEX_ISOLATED);
});

test('#5309 p2: runner is trimmed as well as lowercased (whitespace does not change the verdict)', () => {
  // The pure core and the resolver must agree on normalisation; both must read ' claude ' as claude.
  assert.equal(reachFrom({ runner: '  Claude  ', agentClaudeDir: '/Users/person/.claude-two', personClaudeHome: HOME }).reason, SEPARATE_ACCOUNT);
  assert.equal(reachFrom({ runner: ' codex ', personClaudeHome: HOME }).reason, CODEX_ISOLATED);
});

test('#5309 p2: other runners are not-applicable (null reach, not a false negative)', () => {
  for (const runner of ['gemini', 'grok', 'antigravity', 'muse']) {
    const r = reachFrom({ runner, agentClaudeDir: '/x', personClaudeHome: HOME });
    assert.equal(r.reaches, null);
    assert.equal(r.reason, NOT_APPLICABLE, runner);
  }
});

test('#5309 p2: an unreadable/non-string runner or missing person-home is UNKNOWN, never reaches:true', () => {
  assert.deepEqual(reachFrom({ runner: '', personClaudeHome: HOME }), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 42, personClaudeHome: HOME }), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({}), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: HOME, personClaudeHome: '' }),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2: a DEFAULT launch with a non-absolute/empty/non-string person-home is UNKNOWN, not reaches:true', () => {
  // Regression: the default-launch return must sit BELOW the person-home
  // absoluteness guard, so an anomalous relative/empty/non-string homeDir() (e.g. a relative
  // AGENT_WORKFORCE_HOME) does not yield a reaches:true the signal cannot stand behind. agentClaudeDir
  // null is the default launch (CLAUDE_CONFIG_DIR unset).
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: 'relative/.claude' }),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: '' }),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: {} }),
    { reaches: null, reason: UNKNOWN });
  // Positive control: a default launch on an ABSOLUTE person-home still reaches.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: HOME }),
    { reaches: true, reason: REACHES });
});

// --- resolver (injected deps, no real plist) ---

function deps({ job, home = '/Users/person' }) {
  return {
    create: { readJob: () => (job === 'throw' ? (() => { throw new Error('no job'); })() : job) },
    accounts: { homeDir: () => (home === 'throw' ? (() => { throw new Error('no home'); })() : home) },
  };
}

// Resolver signature is reachForAgent(agentName, worldId, deps): worldId is a real argument (threaded to
// readJob for world-scoping), deps is the LAST, test-only seam. The calls below pass worldId `undefined`
// (the default, unnamed world) except the dedicated worldId-threading test.

test('#5309 p2 resolver: default-account Claude agent reaches', () => {
  assert.deepEqual(reachForAgent('ann', undefined, deps({ job: { runner: 'claude', configDir: null } })),
    { reaches: true, reason: REACHES });
});

test('#5309 p2 resolver: Claude agent on a non-default folder does not reach, names it', () => {
  const r = reachForAgent('bob', undefined, deps({ job: { runner: 'claude', configDir: '/Users/person/.claude-two' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
  assert.equal(r.folder, '/Users/person/.claude-two');
});

test('#5309 p2 resolver: a whitespace/mixed-case runner does NOT become a false reaches:true', () => {
  // Invariant: the resolver and reachFrom must read a padded runner identically. A padded ' claude' on a
  // non-default folder is claude-on-a-separate-folder, never a default-launch reaches:true.
  const r = reachForAgent('pad', undefined, deps({ job: { runner: ' claude', configDir: '/Users/person/.claude-two' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
});

test('#5309 p2 resolver: a Codex agent is isolated regardless of its configDir', () => {
  assert.deepEqual(reachForAgent('cy', undefined, deps({ job: { runner: 'codex', configDir: '/Users/person/.codex' } })),
    { reaches: false, reason: CODEX_ISOLATED });
});

test('#5309 p2 resolver: a plist with no runner key is treated as Claude (readJob default)', () => {
  // A job object with no runner key defaults to 'claude' (the resolver defaults runner only on
  // null/undefined, matching readJob's own default for a plist with no 9th arg).
  const r = reachForAgent('old', undefined, deps({ job: { configDir: '/Users/person/.claude-old' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
});

test('#5309 p2 resolver: no readable job, or homeDir throwing, is UNKNOWN', () => {
  assert.deepEqual(reachForAgent('gone', undefined, deps({ job: null })), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('err', undefined, deps({ job: 'throw' })), { reaches: null, reason: UNKNOWN });
  // homeDir throwing -> personClaudeHome '' -> a Claude job cannot be judged -> UNKNOWN (not a guess).
  assert.deepEqual(reachForAgent('nohome', undefined, deps({ job: { runner: 'claude', configDir: '/Users/person/.claude-x' }, home: 'throw' })),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 resolver: a non-string configDir is UNKNOWN, not a false default-launch reaches:true', () => {
  // Regression: the resolver must pass configDir through unchanged and let reachFrom judge its type, so a
  // non-string configDir (an object) does NOT get coerced to null and read as a default launch (which
  // would be a false reaches:true). The resolver and the pure core must agree on the same input.
  assert.deepEqual(reachForAgent('weird', undefined, deps({ job: { runner: 'claude', configDir: {} } })),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('weird2', undefined, deps({ job: { runner: 'claude', configDir: 7 } })),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 resolver: a raw homeDir with ".." is UNKNOWN (checked BEFORE path.join collapses it)', () => {
  // Regression: path.join(homeDir, '.claude') collapses a '..', hiding it from reachFrom's '..' guard, so
  // a '..'-bearing home must be rejected at the resolver before the join -- else '/Users/q/link/..' joins
  // to '/Users/q/.claude' and matches a configDir of '/Users/q/.claude' as a false reaches:true.
  assert.deepEqual(reachForAgent('q', undefined, deps({ job: { runner: 'claude', configDir: '/Users/q/.claude' }, home: '/Users/q/link/..' })),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 resolver: a falsy-but-present runner or a non-object job is UNKNOWN, not a false default-launch', () => {
  // A present-but-falsy runner ('') must stay falsy so reachFrom reads it as UNKNOWN, not silently
  // default to 'claude' and (with a null configDir) report reaches:true.
  assert.deepEqual(reachForAgent('e', undefined, deps({ job: { runner: '', configDir: null } })),
    { reaches: null, reason: UNKNOWN });
  // A truthy non-object job (garbage) is UNKNOWN, never a default-launch reaches:true.
  assert.deepEqual(reachForAgent('t', undefined, deps({ job: true })), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('s', undefined, deps({ job: 'nope' })), { reaches: null, reason: UNKNOWN });
  // An array is typeof 'object' but has no runner/configDir; it must not default to a reaches:true.
  assert.deepEqual(reachForAgent('arr', undefined, deps({ job: [] })), { reaches: null, reason: UNKNOWN });
  // A null deps argument must not throw (the default only covers undefined); it falls back to {}.
  assert.doesNotThrow(() => reachForAgent('x', undefined, null));
});

test('#5309 p2 resolver: worldId is threaded UNCHANGED to readJob (named-world scoping)', () => {
  // The dangerous direction a worldId closes: a named-world agent must read ITS OWN world's job, not the
  // default world's same-named one (jobs are world-keyed), or it could over-report another world's reach.
  // Capture exactly what readJob received -- the resolver must pass the caller's worldId straight through,
  // never substitute or drop it.
  let seen = 'UNSET';
  const spy = {
    create: { readJob: (name, worldId) => { seen = worldId; return { runner: 'claude', configDir: null }; } },
    accounts: { homeDir: () => '/Users/person' },
  };
  const r = reachForAgent('zed', 'qa-world', spy);
  assert.equal(seen, 'qa-world');                       // the named world's id reached readJob unchanged
  assert.deepEqual(r, { reaches: true, reason: REACHES });
  // An omitted worldId passes undefined through (the default-world case), never a substitute world.
  seen = 'UNSET';
  reachForAgent('zed', undefined, spy);
  assert.equal(seen, undefined);
});

// ---------- #5309 slice 2: the evidence gate ----------

test('#5309 p2 evidence: folderPluginSet unions enabledPlugins (settings.json) + mcpServers (top + per-project)', () => {
  _resetCache();
  const fs = fakeFs({
    '/h/settings.json': JSON.stringify({ enabledPlugins: { 'crm@acme': true, 'notes@x': false } }),
    '/h/.claude.json': JSON.stringify({ mcpServers: { tickets: {} }, projects: { '/p': { mcpServers: { calendar: {} } } } }),
  }, { '/h/settings.json': 1, '/h/.claude.json': 1 });
  const r = folderPluginSet('/h/settings.json', '/h/.claude.json', { fs });
  assert.equal(r.readable, true);
  assert.deepEqual([...r.ids].sort(), ['calendar', 'crm@acme', 'notes@x', 'tickets']);
});

test('#5309 p2 evidence: enabledPlugins as an ARRAY is also read (shape-tolerant)', () => {
  _resetCache();
  const fs = fakeFs({ '/h/settings.json': JSON.stringify({ enabledPlugins: ['a@m', 'b@m'] }), '/h/.claude.json': '{}' },
    { '/h/settings.json': 1, '/h/.claude.json': 1 });
  assert.deepEqual([...folderPluginSet('/h/settings.json', '/h/.claude.json', { fs }).ids].sort(), ['a@m', 'b@m']);
});

test('#5309 p2 evidence: a MISSING file is readable-empty (a home enabled nothing), not UNKNOWN', () => {
  _resetCache();
  const fs = fakeFs({}, {}); // both files ENOENT
  const r = folderPluginSet('/h/settings.json', '/h/.claude.json', { fs });
  assert.equal(r.readable, true);
  assert.equal(r.ids.size, 0);
});

test('#5309 p2 evidence: invalid JSON is NOT readable (-> UNKNOWN upstream), never a silent empty set', () => {
  _resetCache();
  const fs = fakeFs({ '/h/settings.json': '{not json', '/h/.claude.json': '{}' }, { '/h/settings.json': 1, '/h/.claude.json': 1 });
  assert.equal(folderPluginSet('/h/settings.json', '/h/.claude.json', { fs }).readable, false);
});

test('#5309 p2 evidence: folderPluginSet does NOT re-read on unchanged mtime, and DOES re-read when mtime changes', () => {
  _resetCache();
  const files = { '/h/settings.json': JSON.stringify({ enabledPlugins: { 'a@m': true } }), '/h/.claude.json': '{}' };
  const mtimes = { '/h/settings.json': 10, '/h/.claude.json': 10 };
  const fs = fakeFs(files, mtimes);
  folderPluginSet('/h/settings.json', '/h/.claude.json', { fs });
  const afterFirst = fs.counts.read;
  folderPluginSet('/h/settings.json', '/h/.claude.json', { fs });   // unchanged mtime
  assert.equal(fs.counts.read, afterFirst, 'second call with unchanged mtime must not readFileSync again');
  mtimes['/h/settings.json'] = 11;                                   // the file changed
  folderPluginSet('/h/settings.json', '/h/.claude.json', { fs });
  assert.ok(fs.counts.read > afterFirst, 'a changed mtime MUST trigger a re-read (cache is not stale-blind)');
});

test('#5309 p2 evidence: codexPersonPresence detects an [mcp_servers] header OR a non-empty plugins dir', () => {
  _resetCache();
  const fsMcp = fakeFs({ '/c/config.toml': '[mcp_servers.foo]\ncommand="x"\n' }, { '/c/config.toml': 1, '/c/plugins': 1 });
  assert.deepEqual(codexPersonPresence('/c', { fs: fsMcp }), { present: true, readable: true });
  _resetCache();
  const fsPlug = fakeFs({ '/c/plugins': ['some-plugin'] }, { '/c/config.toml': 1, '/c/plugins': 1 });
  assert.deepEqual(codexPersonPresence('/c', { fs: fsPlug }), { present: true, readable: true });
});

test('#5309 p2 evidence: an empty Codex home is readable + NOT present; a non-absolute home is NOT readable', () => {
  _resetCache();
  const fsEmpty = fakeFs({}, {}); // config.toml + plugins both ENOENT
  assert.deepEqual(codexPersonPresence('/c', { fs: fsEmpty }), { present: false, readable: true });
  assert.equal(codexPersonPresence('relative/.codex', { fs: fsEmpty }).readable, false);
});

test('#5309 p2 evidence: a non-ENOENT read error on Codex config is NOT readable (-> UNKNOWN, fail silent)', () => {
  _resetCache();
  const eacces = new Error('eacces'); eacces.code = 'EACCES';
  const fs = fakeFs({ '/c/config.toml': eacces }, { '/c/config.toml': 1, '/c/plugins': 1 });
  assert.equal(codexPersonPresence('/c', { fs }).readable, false);
});

test('#5309 p2 gate (pure): reaches:true and reaches:null pass through the gate unchanged', () => {
  assert.deepEqual(gateOnEvidence({ reaches: true, reason: REACHES }, {}), { reaches: true, reason: REACHES });
  assert.deepEqual(gateOnEvidence({ reaches: null, reason: NOT_APPLICABLE }, {}), { reaches: null, reason: NOT_APPLICABLE });
});

test('#5309 p2 gate (pure): separate-account fires ONLY when the person has ids the agent lacks', () => {
  const reach = { reaches: false, reason: SEPARATE_ACCOUNT, folder: '/a' };
  const person = { ids: new Set(['crm@acme', 'tickets']), readable: true };
  // agent lacks both -> fire, listing what is missing
  assert.deepEqual(gateOnEvidence(reach, { personSet: person, agentSet: { ids: new Set(), readable: true } }),
    { reaches: false, reason: SEPARATE_ACCOUNT, folder: '/a', missing: ['crm@acme', 'tickets'] });
  // agent has both -> nothing missing -> NO_EVIDENCE (renders nothing)
  assert.deepEqual(gateOnEvidence(reach, { personSet: person, agentSet: { ids: new Set(['crm@acme', 'tickets']), readable: true } }),
    { reaches: null, reason: NO_EVIDENCE });
});

test('#5309 p2 gate (pure): an unreadable person OR agent set is UNKNOWN, never a guessed warning', () => {
  const reach = { reaches: false, reason: SEPARATE_ACCOUNT, folder: '/a' };
  const ok = { ids: new Set(['x']), readable: true };
  assert.deepEqual(gateOnEvidence(reach, { personSet: { ids: new Set(), readable: false }, agentSet: ok }), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(gateOnEvidence(reach, { personSet: ok, agentSet: { ids: new Set(), readable: false } }), { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 gate (pure): Codex fires on presence, is NO_EVIDENCE when empty, UNKNOWN when unreadable', () => {
  const reach = { reaches: false, reason: CODEX_ISOLATED };
  assert.deepEqual(gateOnEvidence(reach, { codex: { present: true, readable: true } }), { reaches: false, reason: CODEX_ISOLATED });
  assert.deepEqual(gateOnEvidence(reach, { codex: { present: false, readable: true } }), { reaches: null, reason: NO_EVIDENCE });
  assert.deepEqual(gateOnEvidence(reach, { codex: { present: false, readable: false } }), { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 integration: agentPluginReach fires for a separate-account agent missing the person plugins', () => {
  _resetCache();
  const fs = fakeFs({
    '/person/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'crm@acme': true } }),
    '/person/.claude.json': JSON.stringify({ mcpServers: { tickets: {} } }),
    '/agent/settings.json': '{}', '/agent/.claude.json': '{}',
  }, { '/person/.claude/settings.json': 1, '/person/.claude.json': 1, '/agent/settings.json': 1, '/agent/.claude.json': 1 });
  const r = agentPluginReach({ runner: 'claude', agentClaudeDir: '/agent', personClaudeDir: '/person/.claude', personClaudeJson: '/person/.claude.json' }, { fs });
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
  assert.deepEqual(r.missing.sort(), ['crm@acme', 'tickets']);
});

test('#5309 p2 integration: a default-account agent reaches (true) and reads NO evidence files', () => {
  _resetCache();
  const fs = fakeFs({}, {});
  const r = agentPluginReach({ runner: 'claude', agentClaudeDir: null, personClaudeDir: '/person/.claude', personClaudeJson: '/person/.claude.json' }, { fs });
  assert.deepEqual(r, { reaches: true, reason: REACHES });
  assert.equal(fs.counts.read, 0, 'a reaches:true needs no evidence read');
});

test('#5309 p2 integration: READ-COUNT - a second status read re-reads nothing when mtimes are unchanged (Liu Kang #5309)', () => {
  _resetCache();
  const files = {
    '/person/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'crm@acme': true } }),
    '/person/.claude.json': '{}', '/agent/settings.json': '{}', '/agent/.claude.json': '{}',
  };
  const mtimes = { '/person/.claude/settings.json': 1, '/person/.claude.json': 1, '/agent/settings.json': 1, '/agent/.claude.json': 1 };
  const fs = fakeFs(files, mtimes);
  const input = { runner: 'claude', agentClaudeDir: '/agent', personClaudeDir: '/person/.claude', personClaudeJson: '/person/.claude.json' };
  agentPluginReach(input, { fs });                       // poll 1
  const afterPoll1 = fs.counts.read;
  assert.ok(afterPoll1 > 0, 'poll 1 reads the evidence files');
  agentPluginReach(input, { fs });                       // poll 2, nothing changed
  assert.equal(fs.counts.read, afterPoll1, 'poll 2 must not re-read any unchanged file');
  // CONTROL: the cache is not vacuously passing - touching a file makes poll 3 read again.
  mtimes['/person/.claude/settings.json'] = 2;
  agentPluginReach(input, { fs });                       // poll 3
  assert.ok(fs.counts.read > afterPoll1, 'a changed file MUST be re-read on the next poll');
});

test('#5309 p2 integration: Codex agent fires on person Codex presence, renders nothing when empty', () => {
  _resetCache();
  const fsPresent = fakeFs({ '/person/.codex/config.toml': '[mcp_servers.foo]\n' }, { '/person/.codex/config.toml': 1, '/person/.codex/plugins': 1 });
  assert.deepEqual(agentPluginReach({ runner: 'codex', agentClaudeDir: null, personClaudeDir: '/person/.claude', personClaudeJson: '/person/.claude.json', personCodexHome: '/person/.codex' }, { fs: fsPresent }),
    { reaches: false, reason: CODEX_ISOLATED });
  _resetCache();
  const fsEmpty = fakeFs({}, {});
  assert.deepEqual(agentPluginReach({ runner: 'codex', agentClaudeDir: null, personClaudeDir: '/person/.claude', personClaudeJson: '/person/.claude.json', personCodexHome: '/person/.codex' }, { fs: fsEmpty }),
    { reaches: null, reason: NO_EVIDENCE });
});
