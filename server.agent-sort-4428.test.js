'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-agent-sort-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
const fleet = require('./test-support/fleet');
const { withAgentSortFields } = require('./server');

const board = fleet.install(['ada', 'bea', 'cam', 'dee', 'eli', 'fia'].map((name) => (
  fleet.agent(name, { displayName: name[0].toUpperCase() + name.slice(1), state: 'idle' })
)));
test.after(() => {
  board.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const card = (name, id) => Object.assign({}, board.card(name.toLowerCase()), { profile: id ? { id } : {} });

test('#4428: the status payload derives each agent sort time from existing records', () => {
  const ada = card('Ada', 'agent-ada');
  const [row] = withAgentSortFields([ada], {
    direct: { ada: { unread: 4, lastAt: '2026-09-28T10:00:00Z', lastAgentAt: '2026-09-28T09:00:00Z' } },
    roomRows: [
      { kind: 'post', operator: true, mentioned: ['ada'], at: '2026-09-28T11:00:00Z' },
      { kind: 'post', operator: false, from: 'ada', at: '2026-09-28T12:00:00Z' },
      { kind: 'post', operator: true, mentioned: ['somebody-else'], at: '2026-09-28T23:00:00Z' },
    ],
    births: [
      { id: 'agent-ada', name: 'Old display name', outcome: 'created', at: '2026-09-20T00:00:00Z' },
      { id: 'agent-ada', name: 'Ada', outcome: 'refused', at: '2026-09-19T00:00:00Z' },
    ],
    workFor: () => ({ found: true, at: '2026-09-28T13:00:00Z' }),
  });
  assert.equal(row.dmUnread, 4);
  assert.equal(row.lastTalkedAt, '2026-09-28T11:00:00.000Z', 'the latest direct message or person mention wins');
  assert.equal(row.lastActiveAt, '2026-09-28T13:00:00.000Z', 'the latest agent reply, room post or work mark wins');
  assert.equal(row.createdAt, '2026-09-20T00:00:00.000Z', 'stable profile id survives an agent rename');
});

test('#4428: missing evidence stays null and an absent DIRECT thread is known zero', () => {
  const [none] = withAgentSortFields([card('Bea')], {
    direct: {}, roomRows: [], births: [], workFor: () => ({ found: false }),
  });
  assert.equal(none.dmUnread, 0);
  assert.equal(none.lastTalkedAt, null);
  assert.equal(none.lastActiveAt, null);
  assert.equal(none.createdAt, null);

  const [blind] = withAgentSortFields([card('Cam')], {
    direct: null,
    roomRows: [{ kind: 'post', operator: true, mentioned: ['cam'], at: '2026-09-28T11:00:00Z' }],
    births: null,
    workFor: () => ({ found: true, at: '2026-09-28T13:00:00Z' }),
  });
  assert.equal(blind.dmUnread, null);
  assert.equal(blind.lastTalkedAt, null, 'a blind DIRECT store cannot claim a latest conversation from the room half');
  assert.equal(blind.lastActiveAt, null, 'a blind DIRECT store cannot claim latest activity from the other sources');
  assert.equal(blind.createdAt, null);
});

test('#4428: a damaged one-agent thread does not poison siblings, but that agent sorts last', () => {
  const rows = withAgentSortFields([card('Dee'), card('Eli')], {
    direct: { dee: null, eli: { unread: 1, lastAt: '2026-09-28T10:00:00Z', lastAgentAt: null } },
    roomRows: [], births: [], workFor: () => ({ found: false }),
  });
  assert.deepEqual(rows.map((r) => [r.sessionName, r.dmUnread, r.lastTalkedAt]), [
    ['dee', null, null],
    ['eli', 1, '2026-09-28T10:00:00.000Z'],
  ]);
});

test('#4428: an unreadable work marker makes Recently active unknown', () => {
  const [row] = withAgentSortFields([card('Fia')], {
    direct: { fia: { unread: 0, lastAt: null, lastAgentAt: '2026-09-28T10:00:00Z' } },
    roomRows: [{ kind: 'post', operator: false, from: 'fia', at: '2026-09-28T11:00:00Z' }],
    births: [],
    workFor: () => ({ found: false, because: 'we could not read the activity record' }),
  });
  assert.equal(row.lastActiveAt, null, 'partial evidence must not claim a latest value when one source is unreadable');
});
