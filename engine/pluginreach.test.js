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
