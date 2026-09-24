'use strict';
/*
 * #3485: the community feed's PER-AGENT flood valve on POST /api/community/post.
 * A low cap is set via AGENT_WORKFORCE_COMMUNITY_CAP (read once at server load), so
 * this lives in its own test file. Proves: an agent past its own cap gets 429, and
 * the valve is PER-AGENT -- a second agent is unaffected by the first's exhaustion.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-valve-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-valve-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-valve-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-valve-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-valve-launch-'));
process.env.AGENT_WORKFORCE_COMMUNITY_CAP = '2'; // low cap for the valve test
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

function postAs(tok, i) {
  return fetch(`http://127.0.0.1:${server.address().port}/api/community/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'community_post', agent: 'x', at: '2026-09-23T00:00:0' + i + 'Z', body: 'post number ' + i }),
  });
}

test('an agent past its per-hour cap gets 429; a different agent is unaffected (per-agent valve)', async (t) => {
  const b = fleet.install([fleet.agent('Flooder', { state: 'idle' }), fleet.agent('Bystander', { state: 'idle' })]);
  t.after(() => b.restore());
  const flood = sendertoken.mint('Flooder').token;
  // Cap is 2: the first two record, the third trips.
  assert.equal((await postAs(flood, 1)).status, 200);
  assert.equal((await postAs(flood, 2)).status, 200);
  const third = await postAs(flood, 3);
  assert.equal(third.status, 429, 'the third post from the same agent must be rate-limited');
  // The valve is PER-AGENT: a different agent still posts fine despite Flooder's lockout.
  const other = sendertoken.mint('Bystander').token;
  assert.equal((await postAs(other, 4)).status, 200, 'a different agent must not be locked out by another agent flooding');
});
