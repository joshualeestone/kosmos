'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-community-card-5314-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');

const fleet = require('./test-support/fleet');
const page = require('./test-support/page');
const { withAgentSortFields } = require('./server');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

const board = fleet.install(['ada', 'bea', 'cam', 'dee'].map((name) => (
  fleet.agent(name, { displayName: name[0].toUpperCase() + name.slice(1), state: 'idle' })
)));

test.after(() => {
  board.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const cardOf = (name) => Object.assign({}, board.card(name.toLowerCase()));

function buildRenderer() {
  const helpers = [
    'agentNeedsAttention',
    'face',
    'dmBadge',
    'communityLine',
    'card',
  ].map((name) => page.lift(SCRIPT, name)).join('\n');

  const stubs = `
    const CARD_ST = { idle: { st: 'idle', pres: 'on' } };
    const cardStOf = (x) => ({ st: 'idle', pres: 'on' });
    const stateCopyOf = (x) => ({ label: 'Idle' });
    const pctOf = (x) => 0;
    const answerBtn = (x) => '';
    const NEARLY_FULL = 90;
    const memPrint = (c, p) => '';
    const PRESSAY = { on: 'Running', off: 'Not running' };
    const boardMods = () => '';
    const ring = () => '';
    const staleBadge = () => '';
    const roleLine = () => '';
    const ROLE_TITLES = null;
    const CURRENT = null;
    const glyphOf = () => '';
    const modelLine = () => 'Claude Sonnet';
    const taskLine = () => 'Working';
    const discTint = () => '#eee';
    const discInk = () => '#111';
    const initials = (n) => (n ? n[0] : '?');
    const GLYPH = { stopped: '<span class="stop"></span>', unknown: '<span class="qmark">?</span>' };
    const STATE_COPY = { needs_trust: { label: 'Waiting at a workspace-trust prompt' }, unknown: { label: "Can't tell" } };
  `;

  const fn = new Function('a', 'esc', `${stubs}\n${helpers}\nreturn card(a);`);
  const esc = (x) => String(x == null ? '' : x);
  return (a) => fn(a, esc);
}

function buildCommunityLine() {
  const fn = new Function('a', `${page.lift(SCRIPT, 'communityLine')}\nreturn communityLine(a);`);
  return fn;
}

test('#5314: stylesheet defines font size, color, and spacing for .acommunity', () => {
  assert.ok(PAGE.includes('.acard .acommunity'), 'missing .acard .acommunity css rule');
  assert.ok(PAGE.includes('.acard.notrunning .acommunity'), 'missing .acard.notrunning .acommunity css rule');
});

test('#5314: withAgentSortFields omits post time when community switch is off', () => {
  const ada = cardOf('ada');
  const [row] = withAgentSortFields([ada], {
    communityOn: false,
    communityPosts: { ada: ['2026-10-05T12:00:00Z'] },
  });
  assert.equal(row.communityOn, false);
  assert.equal(row.lastCommunityPost, null);
  assert.equal(row.lastCommunityPostAt, null);
});

test('#5314: withAgentSortFields reports today, yesterday, and older days ago', () => {
  const ada = cardOf('ada');
  const bea = cardOf('bea');
  const cam = cardOf('cam');
  const dee = cardOf('dee');

  const now = new Date('2026-10-05T15:00:00.000Z');
  const todayPost = '2026-10-05T09:00:00.000Z';
  const yesterdayPost = '2026-10-04T18:00:00.000Z';
  const threeDaysAgoPost = '2026-10-02T10:00:00.000Z';

  const rows = withAgentSortFields([ada, bea, cam, dee], {
    communityOn: true,
    now: now.toISOString(),
    communityPosts: {
      ada: [todayPost],
      bea: [yesterdayPost],
      cam: [threeDaysAgoPost],
      dee: [],
    },
  });

  const byName = Object.fromEntries(rows.map((r) => [r.sessionName, r]));

  assert.equal(byName.ada.communityOn, true);
  assert.equal(byName.ada.lastCommunityPost, 'Last community post: today');
  assert.equal(byName.ada.lastCommunityPostAt, new Date(todayPost).toISOString());

  assert.equal(byName.bea.communityOn, true);
  assert.equal(byName.bea.lastCommunityPost, 'Last community post: yesterday');
  assert.equal(byName.bea.lastCommunityPostAt, new Date(yesterdayPost).toISOString());

  assert.equal(byName.cam.communityOn, true);
  assert.equal(byName.cam.lastCommunityPost, 'Last community post: 3 days ago');
  assert.equal(byName.cam.lastCommunityPostAt, new Date(threeDaysAgoPost).toISOString());

  assert.equal(byName.dee.communityOn, true);
  assert.equal(byName.dee.lastCommunityPost, 'No community posts yet');
  assert.equal(byName.dee.lastCommunityPostAt, null);
});

test('#5314: withAgentSortFields matches agent names case-insensitively and handles Maps', () => {
  const ada = cardOf('ada');
  const map = new Map();
  map.set('ada', ['2026-10-05T10:00:00.000Z']);

  const [row] = withAgentSortFields([ada], {
    communityOn: true,
    now: '2026-10-05T15:00:00.000Z',
    communityPosts: map,
  });

  assert.equal(row.lastCommunityPost, 'Last community post: today');
});

test('#5314: with no supplied arg, withAgentSortFields reads the published-only store through the switch', () => {
  // The REAL wiring (no `supplied`): withAgentSortFields calls communitysend.switchOn() and
  // communitystore.publishedPostTimesAll() against the sandboxed store. Seed ONLY a held post for
  // the agent - it was never published, so the card must read "No community posts yet". A swap back
  // to postTimesAll would count the held post and wrongly show "Last community post: today".
  const communityswitch = require('./engine/communityswitch');
  const communitystore = require('./engine/communitystore');
  communityswitch.setOn(true);
  communitystore.insertPost({ kind: 'community_post', agent: 'HeldWire5314', at: 'x', body: 'held, never published', status: 'held' });

  const [row] = withAgentSortFields([{ sessionName: 'heldwire5314', name: 'HeldWire5314' }]);
  assert.equal(row.communityOn, true, 'the switch being on is reflected');
  assert.equal(row.lastCommunityPost, 'No community posts yet', 'a held-only post does not count (published-only reader through the real wiring)');
  assert.equal(row.lastCommunityPostAt, null);
});

test('#5314: communityLine helper respects community switch and formats relative time', () => {
  const line = buildCommunityLine();
  assert.equal(line(null), '');
  assert.equal(line({ communityOn: false, lastCommunityPost: 'Last community post: today' }), '');
  assert.equal(line({ communityOn: true, lastCommunityPost: 'Last community post: today' }), 'Last community post: today');
  assert.equal(line({ communityOn: true, lastCommunityPost: 'No community posts yet' }), 'No community posts yet');

  const now = new Date();
  assert.equal(line({ communityOn: true, lastCommunityPostAt: now.toISOString() }), 'Last community post: today');
});

test('#5314: running agent card displays community post status or omits when switch is off', () => {
  const render = buildRenderer();

  const todayCard = render({
    name: 'Ada',
    sessionName: 'ada',
    running: true,
    state: 'idle',
    communityOn: true,
    lastCommunityPost: 'Last community post: today',
  });
  assert.ok(todayCard.includes('<div class="acommunity">Last community post: today</div>'));

  const oldCard = render({
    name: 'Bea',
    sessionName: 'bea',
    running: true,
    state: 'idle',
    communityOn: true,
    lastCommunityPost: 'Last community post: 3 days ago',
  });
  assert.ok(oldCard.includes('<div class="acommunity">Last community post: 3 days ago</div>'));

  const emptyCard = render({
    name: 'Cam',
    sessionName: 'cam',
    running: true,
    state: 'idle',
    communityOn: true,
    lastCommunityPost: 'No community posts yet',
  });
  assert.ok(emptyCard.includes('<div class="acommunity">No community posts yet</div>'));

  const offCard = render({
    name: 'Dee',
    sessionName: 'dee',
    running: true,
    state: 'idle',
    communityOn: false,
    lastCommunityPost: null,
  });
  assert.ok(!offCard.includes('acommunity'));
});

test('#5314: offline and needsTrust agent cards show community status when switch is on, absent when off', () => {
  const render = buildRenderer();

  const offlineWithPost = render({
    name: 'Ada',
    sessionName: 'ada',
    running: false,
    state: 'stopped',
    communityOn: true,
    lastCommunityPost: 'Last community post: yesterday',
  });
  assert.ok(offlineWithPost.includes('<div class="acommunity">Last community post: yesterday</div>'));

  const offlineOff = render({
    name: 'Ada',
    sessionName: 'ada',
    running: false,
    state: 'stopped',
    communityOn: false,
    lastCommunityPost: null,
  });
  assert.ok(!offlineOff.includes('acommunity'));

  const trustWithNoPosts = render({
    name: 'Winny',
    sessionName: 'winny',
    running: false,
    needsTrust: true,
    state: 'needs_trust',
    communityOn: true,
    lastCommunityPost: 'No community posts yet',
  });
  assert.ok(trustWithNoPosts.includes('<div class="acommunity">No community posts yet</div>'));

  const trustOff = render({
    name: 'Winny',
    sessionName: 'winny',
    running: false,
    needsTrust: true,
    state: 'needs_trust',
    communityOn: false,
    lastCommunityPost: null,
  });
  assert.ok(!trustOff.includes('acommunity'));
});
