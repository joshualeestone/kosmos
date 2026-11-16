'use strict';
/**
 * kosmos#7215 step 3: Settings links the community's own page (where the signed-in person sees and deletes their agents'
 * posts and comments) only when this computer's agents can be linked to the account: sharing on, Kosmos+ live here,
 * and the community and the coordinator both production or both not. communitysend.ownerPageUrl() decides it, and
 * communitymine.summary() carries it as `ownerPage`. Each "no link" case has the all-on control in the same file.
 *
 *   node --test engine/communitymine-ownerpage-7215.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-ownerpage-7215-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_COMMUNITY_URL;
const cs = require('./communitysend');
const mine = require('./communitymine');
const phonenotify = require('./phonenotify');

const realPlusLive = phonenotify.plusLive;
const ON = () => ({ on: true, ok: true });
test.after(() => { cs.setSwitch(null); phonenotify.plusLive = realPlusLive; fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.afterEach(() => { cs.setSwitch(null); phonenotify.plusLive = realPlusLive; delete process.env.AGENT_WORKFORCE_COMMUNITY_URL; });

test('#7215: all on (sharing on, Kosmos+ live, both production): the page on the production community', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  assert.equal(cs.ownerPageUrl(), 'https://community.kosmosplus.com/my-agents');
  assert.equal(mine.summary([], []).ownerPage, 'https://community.kosmosplus.com/my-agents', 'the summary carries it');
});

test('#7215: sharing off: no page (CONTROL: the same with sharing on gives one)', () => {
  phonenotify.plusLive = () => true;
  cs.setSwitch(() => ({ on: false, ok: true }));
  assert.equal(cs.ownerPageUrl(), null);
  assert.equal(mine.summary([], []).ownerPage, null);
  cs.setSwitch(ON);
  assert.ok(cs.ownerPageUrl(), 'control');
});

test('#7215: Kosmos+ not live here: no page (CONTROL: live gives one)', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => false;
  assert.equal(cs.ownerPageUrl(), null);
  phonenotify.plusLive = () => true;
  assert.ok(cs.ownerPageUrl(), 'control');
});

test('#7215: a non-production community with the production coordinator: no page (no link can be made)', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:9';
  assert.equal(cs.ownerPageUrl(), null);
  delete process.env.AGENT_WORKFORCE_COMMUNITY_URL;
  assert.ok(cs.ownerPageUrl(), 'control: back on production');
});

test('#7215: a check that throws is no page, never a crash of the summary', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => { throw new Error('boom'); };
  assert.equal(cs.ownerPageUrl(), null);
  assert.equal(mine.summary([], []).ownerPage, null);
});
