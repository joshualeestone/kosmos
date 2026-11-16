'use strict';
/**
 * kosmos#7215 step 3: Settings links the community's own page (where the signed-in person sees and deletes their agents'
 * posts and comments) only when this computer's agents can be linked to the account (sharing on, Kosmos+ live here,
 * the community and the coordinator both production or both not) and one of them is linked through this computer for
 * its current key, as the owner-link sweep counts it. communitysend.ownerPageUrl() decides it, and
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
delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;   // the pairing must read the production coordinator
const cs = require('./communitysend');
const remote = require('./remote');
const mine = require('./communitymine');
const phonenotify = require('./phonenotify');

// communitysend's ownerLinkLive looks up phonenotify.plusLive when it runs, and remote.COORDINATOR and remote.macIdHere
// likewise, so replacing them on the module objects reaches the code under test.
const realPlusLive = phonenotify.plusLive;
const realMacId = remote.macIdHere;
const realCoordinator = remote.COORDINATOR;
const ON = () => ({ on: true, ok: true });
/* keys.json where communitysend keeps it for a community address (its folder is named for the service), with one
   agent whose owner link through `mac` is confirmed (or another field, to test what does not count). */
const crypto = require('node:crypto');
const SAME = { 'https://community.kosmosplus.com': 'https://community.installkosmos.com' };
function linkAgent(address, field = 'ownerLinked', mac = 'mac-test-7215', markedKey = 'key-ava', apiKey = 'key-ava', extra = {}, agentKey = 'ava') {
  const svc = SAME[address] || address;
  const dir = path.join(require('./store').ROOT, 'communitysend', crypto.createHash('sha256').update(svc).digest('hex').slice(0, 12));
  fs.mkdirSync(dir, { recursive: true });
  // The marker as communitysend writes it: the computer id and a digest of the agent's key (ownerLinkMarker).
  const marker = mac + ':' + crypto.createHash('sha256').update(markedKey).digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ [agentKey]: { name: 'Ava', apiKey, [field]: marker, ...extra } }));
}
const PROD = 'https://community.kosmosplus.com';
test.after(() => { cs.setSwitch(null); phonenotify.plusLive = realPlusLive; remote.macIdHere = realMacId; fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.beforeEach(() => {
  remote.macIdHere = () => 'mac-test-7215';   // a computer id, as on a signed-in Mac
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  linkAgent(PROD);   // one agent linked through this computer on the production community
});
test.afterEach(() => { cs.setSwitch(null); phonenotify.plusLive = realPlusLive; remote.COORDINATOR = realCoordinator; remote.macIdHere = realMacId; delete process.env.AGENT_WORKFORCE_COMMUNITY_URL; });

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

test('#7215: a production community with a non-production coordinator: no page; both non-production: their page', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  remote.COORDINATOR = () => 'http://127.0.0.1:8';
  assert.equal(cs.ownerPageUrl(), null, 'production site, test coordinator');
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:9';
  linkAgent('http://127.0.0.1:9');   // that service keeps its own keys
  assert.equal(cs.ownerPageUrl(), 'http://127.0.0.1:9/my-agents', 'both test: the test site');
});

test('#7215: no computer id here (as before the first sign-in finished): no page (CONTROL: with one, a page)', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  remote.macIdHere = () => null;
  assert.equal(cs.ownerPageUrl(), null);
  remote.macIdHere = () => 'mac-test-7215';
  assert.ok(cs.ownerPageUrl(), 'control');
});

test('#7215: a check that throws past its own guard is no page, never a crash of the summary', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  remote.COORDINATOR = () => { throw new Error('boom'); };   // not caught by ownerLinkLive: reaches ownerPageUrl's catch
  assert.equal(cs.ownerPageUrl(), null);
  assert.equal(mine.summary([], []).ownerPage, null);
  remote.COORDINATOR = realCoordinator;
  assert.ok(cs.ownerPageUrl(), 'control');
});

/* summary() takes its entries as arguments, so the public count is pinned on exact entries: live and public counts,
   a company space's does not, nor does one that is not live. */
const entry = (live, company) => ({ live, key: null, row: { company } });
test('#7215: onSite counts live PUBLIC posts and comments only (CONTROL: flipping one row changes the number)', () => {
  const posts = [entry(true, false), entry(true, true), entry(false, false)];
  const comments = [entry(true, false), entry(true, false), entry(true, true)];
  assert.equal(mine.summary(posts, comments).onSite, 3, 'one public post and two public comments');
  posts[1] = entry(true, false);   // the company post was a public one after all
  assert.equal(mine.summary(posts, comments).onSite, 4, 'control: the count follows the rows');
  assert.equal(mine.summary(posts, null).onSite, 2, 'comments unreadable: the posts alone');
});

test('#7215: the route\'s whole answer (mineAll) carries ownerPage when all is on (CONTROL: off, null)', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  assert.equal(mine.mineAll().summary.ownerPage, 'https://community.kosmosplus.com/my-agents');
  phonenotify.plusLive = () => false;
  assert.equal(mine.mineAll().summary.ownerPage, null, 'control');
});

test('#7215: no agent linked through this computer yet: no page (CONTROL: one confirmed link gives one)', () => {
  cs.setSwitch(ON);
  phonenotify.plusLive = () => true;
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  assert.equal(cs.ownerPageUrl(), null, 'no keys at all');
  linkAgent(PROD, 'ownerLinkMaybe');
  assert.equal(cs.ownerPageUrl(), null, 'a link not yet confirmed does not count');
  linkAgent(PROD, 'ownerLinked', 'another-mac');
  assert.equal(cs.ownerPageUrl(), null, 'a link through another computer does not count');
  linkAgent(PROD, 'ownerLinked', 'mac-test-7215', 'key-old', 'key-new');
  assert.equal(cs.ownerPageUrl(), null, 'registered again since (a new key): not linked yet');
  linkAgent(PROD, 'ownerLinked', 'mac-test-7215', 'key-ava', null);
  assert.equal(cs.ownerPageUrl(), null, 'no key held: not linked');
  linkAgent(PROD, 'ownerLinked', 'mac-test-7215', 'key-ava', 'key-ava', { refused: true });
  assert.equal(cs.ownerPageUrl(), null, 'a key the site refused: not linked');
  linkAgent(PROD, 'ownerLinked', 'mac-test-7215', 'key-ava', 'key-ava', {}, 'retired:ava:2026-11-16T00:00:00.000Z');
  assert.equal(cs.ownerPageUrl(), null, 'a deleted agent\'s old account (retired): not linked');
  linkAgent(PROD, 'ownerLinked', 'mac-test-7215', 'key-ava', 'key-ava', {}, require('./communityswitch').TEST_SEAT_PREFIX + 'ava');
  assert.equal(cs.ownerPageUrl(), null, 'a test seat: not linked');
  linkAgent(PROD);
  cs.requestRetire('ava');   // being retired (a delete or rename under way)
  assert.equal(cs.ownerPageUrl(), null, 'an agent being retired: not linked');
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });   // the retire request goes with it
  linkAgent(PROD);
  assert.equal(cs.ownerPageUrl(), 'https://community.kosmosplus.com/my-agents', 'control: confirmed through this computer, for its current key');
});
