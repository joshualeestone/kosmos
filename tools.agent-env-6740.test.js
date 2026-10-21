'use strict';
/* kosmos#6740: the agent identity a CLI test must not inherit. test-support/agent-env.js names it for a test run on its
   own; tools/run-tests.sh unsets it for the whole suite. Every name in the helper must be unset by the runner too, or
   `yarn test` and `node --test <file>` would read different environments again. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AGENT_IDENTITY, withoutAgentIdentity } = require('./test-support/agent-env');

test('#6740 every agent-identity name the helper clears is also unset by tools/run-tests.sh', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'tools', 'run-tests.sh'), 'utf8');
  const unset = new Set(runner.split('\n').filter((l) => /^unset\s/.test(l)).flatMap((l) => l.replace(/#.*/, '').trim().split(/\s+/).slice(1)));
  assert.ok(unset.size > 0, 'premise: the runner unsets something (the parse found its unset lines)');
  const missing = AGENT_IDENTITY.filter((k) => !unset.has(k));
  assert.deepEqual(missing, [], 'named by the helper but not unset by the runner: ' + missing.join(', '));
  // Review 1: and the other way: an agent-identity name the runner clears is one a test run on its own clears too.
  const extra = [...unset].filter((k) => /^KOSMOS_AGENT_/.test(k) && !AGENT_IDENTITY.includes(k));
  assert.deepEqual(extra, [], 'unset by the runner but not by the helper: ' + extra.join(', '));
});

test('#6740 the helper removes the identity, keeps everything else, and leaves its input alone', () => {
  const env = { KOSMOS_AGENT_TOKEN: 't', KOSMOS_AGENT_SESSION: 's', KOSMOS_AGENT_TOKEN_ONLY: '1', HOME: '/h', KOSMOS_PORT: '1' };
  const out = withoutAgentIdentity(env);
  assert.deepEqual(out, { HOME: '/h', KOSMOS_PORT: '1' });
  assert.equal(env.KOSMOS_AGENT_TOKEN, 't', 'the input was changed');
});
