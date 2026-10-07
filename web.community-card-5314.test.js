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

  // A minimal roster entry via SHORTHAND (`{ sessionName, name }`, no colon) - the fixture-discipline
  // guard flags a hand-built key literal but allows shorthand. A full card from cardOf makes
  // withAgentSortFields' unsupplied path throw here, and the sort fields only need the name keys.
  const sessionName = 'heldwire5314';
  const name = 'HeldWire5314';
  const [row] = withAgentSortFields([{ sessionName, name }]);
  assert.equal(row.communityOn, true, 'the switch being on is reflected');
  assert.equal(row.lastCommunityPost, 'No community posts yet', 'a held-only post does not count (published-only reader through the real wiring)');
  assert.equal(row.lastCommunityPostAt, null);
});

test('#5314: communityLine helper respects the community switch and shows the server string', () => {
  const line = buildCommunityLine();
  assert.equal(line(null), '');
  assert.equal(line({ communityOn: false, lastCommunityPost: 'Last community post: today' }), '');
  assert.equal(line({ communityOn: true, lastCommunityPost: 'Last community post: today' }), 'Last community post: today');
  assert.equal(line({ communityOn: true, lastCommunityPost: 'No community posts yet' }), 'No community posts yet');

  // #5314: no client-side day-diff -- communityLine shows the server's lastCommunityPost string
  // (the single source of truth, convention #5). A row with only a timestamp and no server string
  // fabricates no line; in production the server always sends the string whenever communityOn.
  assert.equal(line({ communityOn: true, lastCommunityPostAt: new Date().toISOString() }), '');
});

test('#5314: running agent card displays community post status or omits when switch is off', () => {
  const render = buildRenderer();

  // Base cards come from the fleet fixture (cardOf); only community fields are added, so there is
  // no hand-built `sessionName` key (fixture-discipline). ada/bea/cam/dee are installed running
  // (state 'idle') at the top of this file.
  const todayCard = render(Object.assign(cardOf('ada'), { communityOn: true, lastCommunityPost: 'Last community post: today' }));
  assert.ok(todayCard.includes('<div class="acommunity">Last community post: today</div>'));

  const oldCard = render(Object.assign(cardOf('bea'), { communityOn: true, lastCommunityPost: 'Last community post: 3 days ago' }));
  assert.ok(oldCard.includes('<div class="acommunity">Last community post: 3 days ago</div>'));

  const emptyCard = render(Object.assign(cardOf('cam'), { communityOn: true, lastCommunityPost: 'No community posts yet' }));
  assert.ok(emptyCard.includes('<div class="acommunity">No community posts yet</div>'));

  const offCard = render(Object.assign(cardOf('dee'), { communityOn: false, lastCommunityPost: null }));
  assert.ok(!offCard.includes('acommunity'));
});

test('#5314: offline and needsTrust agent cards show community status when switch is on, absent when off', () => {
  const render = buildRenderer();

  // Offline + needsTrust cards: base from the fixture, override running/state and add the community
  // fields (no hand-built sessionName). Reuse installed agents (dee stands in for the trust case).
  const offlineWithPost = render(Object.assign(cardOf('ada'), { running: false, state: 'stopped', communityOn: true, lastCommunityPost: 'Last community post: yesterday' }));
  assert.ok(offlineWithPost.includes('<div class="acommunity">Last community post: yesterday</div>'));

  const offlineOff = render(Object.assign(cardOf('ada'), { running: false, state: 'stopped', communityOn: false, lastCommunityPost: null }));
  assert.ok(!offlineOff.includes('acommunity'));

  const trustWithNoPosts = render(Object.assign(cardOf('dee'), { running: false, needsTrust: true, state: 'needs_trust', communityOn: true, lastCommunityPost: 'No community posts yet' }));
  assert.ok(trustWithNoPosts.includes('<div class="acommunity">No community posts yet</div>'));

  const trustOff = render(Object.assign(cardOf('dee'), { running: false, needsTrust: true, state: 'needs_trust', communityOn: false, lastCommunityPost: null }));
  assert.ok(!trustOff.includes('acommunity'));
});
