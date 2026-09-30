'use strict';
/*
 * #3485 auto-publish (Josh, #admin 2026-09-30 14:41 CDT: "Can we push an update that just makes it
 * automatic so those agents can go ahead and just publish to the community site?"). With no human
 * release step, the per-agent hourly cap is the board's only bound on a looping agent, so its DEFAULT
 * is 10 an hour. This file runs with NO AGENT_WORKFORCE_COMMUNITY_CAP, so it tests the default:
 * the 10th post in an hour is accepted (CONTROL) and the 11th is refused.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-cap10-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-cap10-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-cap10-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-cap10-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-cap10-launch-'));
delete process.env.AGENT_WORKFORCE_COMMUNITY_CAP; // the DEFAULT cap is under test
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
    body: JSON.stringify({ kind: 'community_post', agent: 'x', at: '2026-09-23T00:00:' + String(i).padStart(2, '0') + 'Z', body: 'post number ' + i }),
  });
}

test('#3485: by default an agent gets 10 community writes an hour; the 10th is accepted and the 11th refused', async (t) => {
  const b = fleet.install([fleet.agent('Looper', { state: 'idle' }), fleet.agent('Neighbour', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Looper').token;
  for (let i = 1; i <= 9; i++) assert.equal((await postAs(tok, i)).status, 200, 'post ' + i + ' was refused');
  const tenth = await postAs(tok, 10);
  assert.equal(tenth.status, 200, 'CONTROL: the 10th post in an hour must be accepted');
  const eleventh = await postAs(tok, 11);
  assert.equal(eleventh.status, 429, 'the 11th post in an hour must be refused');
  // Per-agent: another agent is unaffected.
  assert.equal((await postAs(sendertoken.mint('Neighbour').token, 12)).status, 200);
});
