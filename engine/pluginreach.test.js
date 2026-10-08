'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const pluginreach = require('./pluginreach');
const {
  reachFrom, reachForAgent,
  REACHES, SEPARATE_ACCOUNT, CODEX_ISOLATED, NOT_APPLICABLE, UNKNOWN,
} = pluginreach;

const HOME = '/Users/person/.claude';

test('#5309 p2: a default-account Claude agent (CLAUDE_CONFIG_DIR unset) reaches the person plugins', () => {
  // A clean default launch leaves the dir unset; the effective folder IS the person home.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: null, personClaudeHome: HOME }),
    { reaches: true, reason: REACHES });
  // Same folder, stated explicitly, also reaches.
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
  // Same two shapes, one equal folder and one different, must give opposite verdicts, so the
  // SEPARATE_ACCOUNT result is a real comparison, not a constant.
  const same = reachFrom({ runner: 'claude', agentClaudeDir: HOME, personClaudeHome: HOME });
  const diff = reachFrom({ runner: 'claude', agentClaudeDir: HOME + '-other', personClaudeHome: HOME });
  assert.equal(same.reaches, true);
  assert.equal(diff.reaches, false);
});

test('#5309 p2: path forms that resolve equal are NOT a mismatch', () => {
  assert.equal(reachFrom({ runner: 'claude', agentClaudeDir: '/Users/person/./.claude', personClaudeHome: HOME }).reaches, true);
  assert.equal(reachFrom({ runner: 'claude', agentClaudeDir: '/Users/person/.claude/', personClaudeHome: HOME }).reaches, true);
});

test('#5309 p2: Codex never reaches (isolated runtime, by design), whatever its dir', () => {
  assert.deepEqual(reachFrom({ runner: 'codex', agentClaudeDir: '/Users/person/.codex', personClaudeHome: HOME }),
    { reaches: false, reason: CODEX_ISOLATED });
  // The Codex verdict must not depend on the dir at all.
  assert.deepEqual(reachFrom({ runner: 'codex', agentClaudeDir: null, personClaudeHome: HOME }),
    { reaches: false, reason: CODEX_ISOLATED });
  // Case-insensitive on the runner.
  assert.equal(reachFrom({ runner: 'CODEX', personClaudeHome: HOME }).reason, CODEX_ISOLATED);
});

test('#5309 p2: other runners are not-applicable (null reach, not a false negative)', () => {
  for (const runner of ['gemini', 'grok', 'antigravity', 'muse']) {
    const r = reachFrom({ runner, agentClaudeDir: '/x', personClaudeHome: HOME });
    assert.equal(r.reaches, null);
    assert.equal(r.reason, NOT_APPLICABLE, runner);
  }
});

test('#5309 p2: an unreadable runner or missing person-home is UNKNOWN, never a false reaches:true', () => {
  assert.deepEqual(reachFrom({ runner: '', personClaudeHome: HOME }), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachFrom({}), { reaches: null, reason: UNKNOWN });
  // Claude but we could not resolve the person home: do not claim it reaches.
  assert.deepEqual(reachFrom({ runner: 'claude', agentClaudeDir: HOME, personClaudeHome: '' }),
    { reaches: null, reason: UNKNOWN });
});

// --- resolver (injected deps, no real plist) ---

function deps({ job, home = '/Users/person' }) {
  return {
    create: { readJob: () => (job === 'throw' ? (() => { throw new Error('no job'); })() : job) },
    accounts: { homeDir: () => home },
  };
}

test('#5309 p2 resolver: default-account Claude agent reaches', () => {
  const r = reachForAgent('ann', deps({ job: { runner: 'claude', configDir: null } }));
  assert.deepEqual(r, { reaches: true, reason: REACHES });
});

test('#5309 p2 resolver: Claude agent on a non-default folder does not reach, names it', () => {
  const r = reachForAgent('bob', deps({ job: { runner: 'claude', configDir: '/Users/person/.claude-two' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
  assert.equal(r.folder, '/Users/person/.claude-two');
});

test('#5309 p2 resolver: a Codex agent is isolated regardless of its configDir', () => {
  const r = reachForAgent('cy', deps({ job: { runner: 'codex', configDir: '/Users/person/.codex' } }));
  assert.deepEqual(r, { reaches: false, reason: CODEX_ISOLATED });
});

test('#5309 p2 resolver: a plist with no runner field is treated as Claude (readJob default)', () => {
  // readJob returns runner:'claude' when the 9th arg is absent; an explicit undefined here mirrors
  // a job object that simply has no runner key.
  const r = reachForAgent('old', deps({ job: { configDir: '/Users/person/.claude-old' } }));
  assert.equal(r.reaches, false);
  assert.equal(r.reason, SEPARATE_ACCOUNT);
});

test('#5309 p2 resolver: no readable job (null or throws) is UNKNOWN', () => {
  assert.deepEqual(reachForAgent('gone', deps({ job: null })), { reaches: null, reason: UNKNOWN });
  assert.deepEqual(reachForAgent('err', deps({ job: 'throw' })), { reaches: null, reason: UNKNOWN });
});
