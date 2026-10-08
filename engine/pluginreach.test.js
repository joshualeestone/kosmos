'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pluginreach = require('./pluginreach');
const {
  reachFrom, reachForAgent,
  REACHES, SEPARATE_ACCOUNT, CODEX_ISOLATED, NOT_APPLICABLE, UNKNOWN,
} = pluginreach;

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

test('#5309 p2 resolver: default-account Claude agent reaches', () => {
  assert.deepEqual(reachForAgent('ann', deps({ job: { runner: 'claude', configDir: null } })),
    { reaches: true, reason: REACHES });
});

test('#5309 p2 resolver: Claude agent on a non-default folder does not reach, names it', () => {
  const r = reachForAgent('bob', deps({ job: { runner: 'claude', configDir: '/Users/person/.claude-two' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
  assert.equal(r.folder, '/Users/person/.claude-two');
});

test('#5309 p2 resolver: a whitespace/mixed-case runner does NOT become a false reaches:true', () => {
  // Regression: the resolver once gated the dir on a no-trim runner check while reachFrom trimmed, so
  // a padded runner on a non-default folder slipped into the default (reaches:true) branch. Both must
  // read it as claude-on-a-separate-folder.
  const r = reachForAgent('pad', deps({ job: { runner: ' claude', configDir: '/Users/person/.claude-two' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
});

test('#5309 p2 resolver: a Codex agent is isolated regardless of its configDir', () => {
  assert.deepEqual(reachForAgent('cy', deps({ job: { runner: 'codex', configDir: '/Users/person/.codex' } })),
    { reaches: false, reason: CODEX_ISOLATED });
});

test('#5309 p2 resolver: a plist with no runner key is treated as Claude (readJob default)', () => {
  // readJob returns runner:'claude' when the 9th plist arg is absent; a job object with no runner key
  // exercises the resolver's `job.runner || 'claude'` fallback.
  const r = reachForAgent('old', deps({ job: { configDir: '/Users/person/.claude-old' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
});

test('#5309 p2 resolver: no readable job, or homeDir throwing, is UNKNOWN', () => {
  assert.deepEqual(reachForAgent('gone', deps({ job: null })), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('err', deps({ job: 'throw' })), { reaches: null, reason: UNKNOWN });
  // homeDir throwing -> personClaudeHome '' -> a Claude job cannot be judged -> UNKNOWN (not a guess).
  assert.deepEqual(reachForAgent('nohome', deps({ job: { runner: 'claude', configDir: '/Users/person/.claude-x' }, home: 'throw' })),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 resolver: a non-string configDir is UNKNOWN, not a false default-launch reaches:true', () => {
  // Regression: the resolver must pass configDir through unchanged and let reachFrom judge its type, so a
  // non-string configDir (an object) does NOT get coerced to null and read as a default launch (which
  // would be a false reaches:true). The resolver and the pure core must agree on the same input.
  assert.deepEqual(reachForAgent('weird', deps({ job: { runner: 'claude', configDir: {} } })),
    { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('weird2', deps({ job: { runner: 'claude', configDir: 7 } })),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 resolver: a raw homeDir with ".." is UNKNOWN (checked BEFORE path.join collapses it)', () => {
  // Regression: path.join(homeDir, '.claude') collapses a '..', hiding it from reachFrom's '..' guard, so
  // a '..'-bearing home must be rejected at the resolver before the join -- else '/Users/q/link/..' joins
  // to '/Users/q/.claude' and matches a configDir of '/Users/q/.claude' as a false reaches:true.
  assert.deepEqual(reachForAgent('q', deps({ job: { runner: 'claude', configDir: '/Users/q/.claude' }, home: '/Users/q/link/..' })),
    { reaches: null, reason: UNKNOWN });
});

test('#5309 p2 resolver: a falsy-but-present runner or a non-object job is UNKNOWN, not a false default-launch', () => {
  // A present-but-falsy runner ('') must stay falsy so reachFrom reads it as UNKNOWN, not silently
  // default to 'claude' and (with a null configDir) report reaches:true.
  assert.deepEqual(reachForAgent('e', deps({ job: { runner: '', configDir: null } })),
    { reaches: null, reason: UNKNOWN });
  // A truthy non-object job (garbage) is UNKNOWN, never a default-launch reaches:true.
  assert.deepEqual(reachForAgent('t', deps({ job: true })), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('s', deps({ job: 'nope' })), { reaches: null, reason: UNKNOWN });
  // An array is typeof 'object' but has no runner/configDir; it must not default to a reaches:true.
  assert.deepEqual(reachForAgent('arr', deps({ job: [] })), { reaches: null, reason: UNKNOWN });
  // A null deps argument must not throw (the default only covers undefined); it falls back to {}.
  assert.doesNotThrow(() => reachForAgent('x', null));
});
