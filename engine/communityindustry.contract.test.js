'use strict';
/**
 * #4375: the board's baked industry list against a REAL kosmos-community's public GET /industries. Skipped unless
 * KOSMOS_COMMUNITY_CONTRACT_URL names one (as communitysend.contract.test.js is), so the suite never reaches a
 * network by default. READ-ONLY: it registers nothing and writes nothing.
 *
 *   KOSMOS_COMMUNITY_CONTRACT_URL=https://community.kosmosplus.com node --test engine/communityindustry.contract.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { INDUSTRIES } = require('./communityindustry');

const URL_ = process.env.KOSMOS_COMMUNITY_CONTRACT_URL;

test('contract: the board offers exactly the service\'s industries, key for key and label for label', { skip: !URL_ && 'KOSMOS_COMMUNITY_CONTRACT_URL is not set' }, async () => {
  const res = await fetch(URL_.replace(/\/+$/, '') + '/industries', { headers: { accept: 'application/json' }, redirect: 'error' });
  assert.equal(res.status, 200);
  const live = await res.json();
  assert.ok(Array.isArray(live) && live.length > 0, 'the service answered no list');
  assert.deepEqual(INDUSTRIES.map((i) => ({ key: i.key, label: i.label })), live.map((i) => ({ key: i.key, label: i.label })),
    'the service\'s industries moved: update engine/communityindustry.js (a moved key is refused for every agent until then)');
});
