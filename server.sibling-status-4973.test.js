'use strict';
/**
 * #4973: a read of /api/status that another of the person's computers' pages caused (Sec-Fetch-Site same-site or
 * cross-site; the #4812 relay passes that header through and rewrites Origin) gets the agents only: sessionName, name,
 * state (and the guide's mark). The board's own page (same-origin), an address-bar load (none) and the CLI (no header)
 * get the full answer.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sibling-status-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const setupAssistant = require('./engine/setup-assistant');

const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

let port;
test.before(async () => {
  stub(setupAssistant, 'guideName', () => 'guidebot');
  stub(setupAssistant, 'isGuideFolder', (n) => n === 'guidebot');
  await start(0);
  port = server.address().port;
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* http.request, not fetch: the header goes out exactly as written. */
function status(site) {
  return new Promise((resolve, reject) => {
    const headers = site === undefined ? {} : { 'sec-fetch-site': site };
    const r = http.request({ host: '127.0.0.1', port, path: '/api/status', method: 'GET', headers }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(b) }); } catch (e) { reject(e); } });
    });
    r.on('error', reject); r.end();
  });
}

test('#4973: a sibling read (same-site, cross-site) gets the agents only; the full answer is not in it', async () => {
  const board = fleet.install([fleet.agent('guidebot', { state: 'idle' }), fleet.agent('mara', { state: 'working' })]);
  try {
    const full = await status('same-origin');
    assert.equal(full.code, 200);
    assert.ok('updateLog' in full.body && 'bootedAt' in full.body && 'counts' in full.body, 'CONTROL: the board\'s own read is the full answer');
    assert.ok('target' in full.body.agents[0] && 'commitments' in full.body.agents[0], 'CONTROL: a full row carries the pane address and more, so the exact shape below can fail');
    for (const site of ['same-site', 'cross-site']) {
      const r = await status(site);
      assert.equal(r.code, 200, site);
      assert.deepEqual(Object.keys(r.body), ['agents'], site + ': a sibling read carried more than the agents: ' + Object.keys(r.body).join(','));
      const mara = r.body.agents.find((a) => a.sessionName === 'mara');
      const fullMara = full.body.agents.find((a) => a.sessionName === 'mara');
      assert.deepEqual(Object.keys(mara).sort(), ['name', 'sessionName', 'state'], site + ': not the three fields the Agents view uses');
      assert.equal(mara.name, fullMara.name, site);
      assert.equal(mara.state, fullMara.state, site);
      assert.equal(r.body.agents.find((a) => a.sessionName === 'guidebot').isGuide, true, site + ': the guide lost its mark, so the other computer would list it');
      assert.equal(r.body.agents.length, full.body.agents.length, site + ': rows were dropped');
    }
  } finally { board.restore(); }
});

test('#4973: the board\'s own page, an address-bar load and the CLI still get the full answer', async () => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    for (const site of ['same-origin', 'none', undefined]) {
      const r = await status(site);
      assert.equal(r.code, 200);
      assert.ok('updateLog' in r.body && 'counts' in r.body && 'bootedAt' in r.body, String(site) + ': the full answer was cut');
    }
  } finally { board.restore(); }
});
