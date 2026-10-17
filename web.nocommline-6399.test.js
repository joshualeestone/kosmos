'use strict';

// #6399 (Josh 2026-10-17 11:09: "just noise. Remember we want simplicity here."): agent cards carry no
// "Last community post" line. #5314 added it (cardpost-5314, 2026-10-05); this removes the card line, the
// server fields that fed only it, and their CSS. A removal with no guard is undone by the next change that
// reaches for the old helper, so this pins the absence on both sides.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-nocommline-6399-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');

const { withAgentSortFields } = require('./server');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#6399: the board page draws no community-post line on any card', () => {
  assert.ok(PAGE.includes('<div class="atask">'), 'CONTROL: the card markup this test reads is not in the page');
  for (const gone of ['Last community post', 'No community posts yet', 'acommunity', 'communityLine', 'lastCommunityPost']) {
    assert.ok(!PAGE.includes(gone), 'the page still carries ' + JSON.stringify(gone));
  }
});

test('#6399: the board payload carries no community-post fields, even with the community on and a post on record', () => {
  const ada = { name: 'Ada', sessionName: 'ada-discord' };
  // The inputs #5314's reader took: a switch on and a recent post. They must have no effect now.
  const [row] = withAgentSortFields([ada], {
    direct: null, roomRows: null, births: [], communityOn: true,
    communityPosts: new Map([['ada-discord', [new Date().toISOString()]]]),
  });
  assert.ok(Object.prototype.hasOwnProperty.call(row, 'createdAt'), 'CONTROL: withAgentSortFields did not build the row');
  for (const gone of ['communityOn', 'lastCommunityPost', 'lastCommunityPostAt']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(row, gone), 'the row still carries ' + gone);
  }
});
