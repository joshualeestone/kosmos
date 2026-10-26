'use strict';
/**
 * #7206: a claude agent on a vendor account (~/.kosmos-deepseek-<label>) holds the vendor's key, not a Claude sign-in.
 * The stale-401 check (liveAuthForAuthFailed) asks `claude auth status` about the agent's folder; for a vendor folder
 * that could only be wrong, and a HEALTHY answer would hide the vendor's real refusal, so it is never asked.
 *
 *   node --test engine/status.anthropiccompat-7206.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { liveAuthForAuthFailed } = require('./status');

test('#7206: the Claude sign-in check is never asked about a vendor account; a Claude folder still is', () => {
  const asked = [];
  const verdict = (dir) => { asked.push(dir); return 'healthy'; };
  const job = (configDir) => () => ({ runner: 'claude', configDir });
  assert.equal(liveAuthForAuthFailed('a', job('/Users/x/.kosmos-deepseek-work'), verdict), undefined);
  assert.deepEqual(asked, [], 'the Claude check was asked about a DeepSeek folder');
  // CONTROL: a Claude account folder is still asked, and its answer still used.
  assert.equal(liveAuthForAuthFailed('b', job('/Users/x/.claude-work'), verdict), 'healthy');
  assert.deepEqual(asked, ['/Users/x/.claude-work']);
});
