'use strict';
/**
 * The Mac-side contract test against a REAL kosmos-community instance (#4287, and
 * #4282's acceptance 6). Skipped unless KOSMOS_COMMUNITY_CONTRACT_URL names one, so
 * the suite never reaches a network by default. To run it:
 *
 *   (in kosmos-community) alembic upgrade head && PORT=18731 python -m app
 *   KOSMOS_COMMUNITY_CONTRACT_URL=http://127.0.0.1:18731 node --test engine/communitysend.contract.test.js
 *
 * It drives the board's real choke and the real send layer end to end: register,
 * post, held-never-sent, take-down read, delete. Each run registers fresh agent names.
 */
require('../test-support/tmpscope'); // #4273: this file's temp dirs go with the process
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const URL_ = process.env.KOSMOS_COMMUNITY_CONTRACT_URL;
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communitysend-contract-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
if (URL_) process.env.AGENT_WORKFORCE_COMMUNITY_URL = URL_;
const store = require('./store');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

test('contract: a board sends to a real kosmos-community and reads it back', { skip: !URL_ && 'KOSMOS_COMMUNITY_CONTRACT_URL is not set' }, async () => {
  cs.setSender((url, init) => fetch(url, init));
  cs.setSwitch(() => ({ on: true, ok: true }));
  await cs.sweep();                                         // records `since`
  const tag = crypto.randomBytes(3).toString('hex');
  const agent = 'contract-' + tag;
  store.writeProfile(agent, { displayName: 'Contract ' + tag, role: 'Test agent' });
  const publish = (fields, trusted) => {
    if (trusted) communitystore.grantTrust(agent);
    return feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), ...fields }, { agentId: agent });
  };
  const held = publish({ topic: 'held ' + tag, body: 'this one waits for its owner' }, false);
  assert.equal(held.status, 'held');
  const pub = publish({ topic: 'Contract ' + tag, body: 'A post from the Mac-side contract test.' }, true);
  assert.equal(pub.status, 'published');
  await cs.sweep();

  const st = cs.statuses();
  assert.equal(st[pub.id].state, 'sent', JSON.stringify(st));
  assert.equal(st[held.id], undefined, 'a held post was attempted');

  const feed = await (await fetch(URL_.replace(/\/+$/, '') + '/posts/feed?sort=new&limit=50')).json();
  const mine = feed.posts.filter((p) => p.agent.name === 'Contract ' + tag);
  assert.deepEqual(mine.map((p) => [p.channel, p.sub_channel, p.title, p.body]),
    [['general', null, 'Contract ' + tag, 'A post from the Mac-side contract test.']]);

  // Take-down read path (nothing taken down here): the check runs and records false.
  await cs.sweep(Date.now() + 31 * 60 * 1000);
  assert.equal(cs.statuses()[pub.id].takenDown, false);

  // Delete.
  assert.equal(cs.requestDelete(pub.id).ok, true);
  await cs.sweep();
  assert.equal(cs.statuses()[pub.id].state, 'deleted');
  const after = await (await fetch(URL_.replace(/\/+$/, '') + '/posts/feed?sort=new&limit=50')).json();
  assert.equal(after.posts.filter((p) => p.agent.name === 'Contract ' + tag).length, 0);
});
