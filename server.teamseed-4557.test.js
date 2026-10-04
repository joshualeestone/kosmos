'use strict';
/**
 * #4557, driven through the real routes: the seeded-team reads, and the specs they return made into real
 * agents through the real POST /api/agents, in order, the way the page will make them.
 *
 * What this proves end to end, beyond engine/teamseed.test.js:
 * - a report's `reportsTo` lands on its profile as the lead's machine name, even for a renamed lead
 *   with a space in it, and the board's org chart can resolve it (the lead exists by that name);
 * - the project id rides every spec, and /api/agents' own attach puts every member on the project;
 * - the specs route is read-only: it creates nothing.
 *
 * 🛑 Every root the create path writes to is sandboxed, with DRY_RUN and fake bins, the same fixture
 * discipline as server.team-route-1279.test.js. The catalogue is a fixture in the shape agreed with
 * #4555 on the card, injected through teamseed.setCatalogue, so this does not depend on the seed.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamseed-4557-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(os.tmpdir(), 'aw-teamseed4557-claude-' + process.pid + '.json');
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const create = require('./engine/create');
const projects = require('./engine/projects');
const teamseed = require('./engine/teamseed');

const BODY = (who, slot) => 'You are **' + who + '**, the ' + slot + ' on this team.\n\n## Who you are\nA careful colleague.\n';
const CATALOGUE = {
  teams: () => [TEAM],
  team: (k) => (k === TEAM.key ? TEAM : null),
  memberInstructions: (teamKey, slot, names) => BODY(names[slot], slot),
};
const TEAM = {
  key: 'marketing', kind: 'business', rank: 1, label: 'Marketing Team', blurb: 'One line', purpose: 'Grow it.',
  project: { name: 'Marketing', goal: 'Grow it' },
  members: [
    { slot: 'lead', role: 'marketing', title: 'Chief Marketing Officer', name: 'Maya', reportsTo: null, avatar: { id: 'l', image: null } },
    { slot: 'content', role: 'copy', title: 'Content Writer', name: 'Leo', reportsTo: 'lead', avatar: { id: 'c', image: null } },
    { slot: 'social', role: 'social', title: 'Social Media Manager', name: 'Ana', reportsTo: 'lead', avatar: { id: 's', image: null } },
  ],
};

let base;
test.before(async () => {
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  create.setClaudeProbe(null);
  teamseed.setCatalogue(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function call(method, p, body) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

test('a catalogue that throws: all three routes answer 503 with a sentence, not a 500', async () => {
  teamseed.setCatalogue({ teams() { throw new Error('bad build'); }, team() { throw new Error('bad build'); } });
  const quiet = console.error; console.error = () => {};
  try {
    for (const [m, p, b] of [['GET', '/api/teams/seeded'], ['GET', '/api/teams/seeded/marketing'], ['POST', '/api/teams/seeded/marketing/specs', { names: {} }]]) {
      const r = await call(m, p, b);
      assert.equal(r.status, 503, p);
      assert.equal(r.json.error, teamseed.BROKEN, p);
    }
  } finally { console.error = quiet; teamseed.setCatalogue(CATALOGUE); }
});

test('not installed: all three routes answer 503 with a sentence, and nothing crashes', async () => {
  teamseed.setCatalogue(false);
  try {
    for (const [m, p, b] of [['GET', '/api/teams/seeded'], ['GET', '/api/teams/seeded/marketing'], ['POST', '/api/teams/seeded/marketing/specs', { names: {} }]]) {
      const r = await call(m, p, b);
      assert.equal(r.status, 503, p);
      assert.equal(r.json.error, teamseed.NOT_INSTALLED, p);
    }
  } finally { teamseed.setCatalogue(CATALOGUE); }
});

test('#4632: opening the Team screen downloads first, then reads: list and detail wait for the refresh, specs does not ask', async () => {
  let loaded = false;
  let asked = 0;
  // A catalogue that holds nothing until its refresh has finished, a tick later.
  teamseed.setCatalogue({
    ...CATALOGUE,
    status: () => ({ loaded }),
    refresh: () => new Promise((done) => setTimeout(() => { asked += 1; loaded = true; done(); }, 20)),
  });
  try {
    const l = await call('GET', '/api/teams/seeded');
    assert.equal(asked, 1, 'the list asked for the download');
    assert.equal(l.status, 200, 'and answered from what the download brought, not from before it: ' + JSON.stringify(l.json));
    assert.equal(l.json.teams.length, 1);
    loaded = false;
    const d = await call('GET', '/api/teams/seeded/marketing');
    assert.equal(asked, 2, 'opening one team asked too');
    assert.equal(d.status, 200, JSON.stringify(d.json));
    const s = await call('POST', '/api/teams/seeded/marketing/specs', { names: { lead: 'Maya', content: 'Leo', social: 'Ana' } });
    assert.equal(asked, 2, 'building the specs does not download');
    assert.equal(s.status, 200, JSON.stringify(s.json));
  } finally { teamseed.setCatalogue(CATALOGUE); }
});

test('#4632 not downloaded (offline): all three routes answer 503 with the sentence, never "no such team"', async () => {
  teamseed.setCatalogue({ ...CATALOGUE, status: () => ({ loaded: false }), refresh: async () => {} });
  try {
    for (const [m, p, b] of [['GET', '/api/teams/seeded'], ['GET', '/api/teams/seeded/marketing'], ['POST', '/api/teams/seeded/marketing/specs', { names: {} }]]) {
      const r = await call(m, p, b);
      assert.equal(r.status, 503, p);
      assert.equal(r.json.error, teamseed.NOT_DOWNLOADED, p);
    }
  } finally { teamseed.setCatalogue(CATALOGUE); }
});

test('review 23: a project whose folder is already a project is refused with a code the Team step acts on', async () => {
  const first = await call('POST', '/api/projects', { name: 'Taken 4557' });
  assert.ok(first.status === 200 || first.status === 201, JSON.stringify(first.json));
  const second = await call('POST', '/api/projects', { name: 'Taken 4557' });
  assert.equal(second.status, 400, JSON.stringify(second.json));
  assert.equal(second.json.code, 'folder_taken', JSON.stringify(second.json));
  const other = await call('POST', '/api/projects', { name: '' });
  assert.equal(other.status, 400);
  assert.equal(other.json.code, undefined, 'control: another refusal carries no code');
});

test('list and detail read the catalogue; an unknown team is a 404', async () => {
  teamseed.setCatalogue(CATALOGUE);
  const l = await call('GET', '/api/teams/seeded');
  assert.equal(l.status, 200);
  assert.deepEqual(l.json.teams, [{ key: 'marketing', label: 'Marketing Team', blurb: 'One line', kind: 'business', rank: 1, count: 3 }]);
  const d = await call('GET', '/api/teams/seeded/marketing');
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.members.map((m) => m.slot), ['lead', 'content', 'social']);
  assert.equal((await call('GET', '/api/teams/seeded/nope')).status, 404);
  assert.equal((await call('POST', '/api/teams/seeded/nope/specs', { names: {} })).status, 404);
});

test('specs refuses a bad name with a 400 and creates nothing', async () => {
  teamseed.setCatalogue(CATALOGUE);
  const before = create.createdCount();
  const r = await call('POST', '/api/teams/seeded/marketing/specs', { names: { lead: 'Maya', content: 'Maya', social: 'Ana' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /same name/);
  assert.equal(create.createdCount(), before);
});

test('check: true refuses a name whose agent folder already exists here; without it the same names build', async () => {
  teamseed.setCatalogue(CATALOGUE);
  fs.mkdirSync(create.workerDir('taken-one'), { recursive: true });
  const names = { lead: 'Taken One', content: 'Free Two', social: 'Free Three' };
  const refused = await call('POST', '/api/teams/seeded/marketing/specs', { names, check: true });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error, 'there is already an agent called Taken One on this computer; give the Chief Marketing Officer another name. If you were making this team a moment ago, those agents are already on your board');
  const unchecked = await call('POST', '/api/teams/seeded/marketing/specs', { names });
  assert.equal(unchecked.status, 200);
});

test('the specs, made in order through the real POST /api/agents, give a team: reports to the lead, all on the project', async () => {
  teamseed.setCatalogue(CATALOGUE);
  const p = await call('POST', '/api/projects', { name: 'Marketing 4557' });
  assert.ok(p.status === 200 || p.status === 201, 'project made: ' + p.status + ' ' + JSON.stringify(p.json));
  const projectId = (p.json && (p.json.project ? p.json.project.id : p.json.id));
  assert.ok(projectId, 'the project has an id: ' + JSON.stringify(p.json));

  const before = create.createdCount();
  const names = { lead: 'Maya Okafor', content: 'Leo Brand', social: 'Ana Reyes' };
  const s = await call('POST', '/api/teams/seeded/marketing/specs', { names, project: projectId });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(create.createdCount(), before, 'the specs route itself creates nothing');
  assert.deepEqual(s.json.specs.map((x) => x.slot), ['lead', 'content', 'social']);

  /* ⚠️ The profile write that stores reportsTo is skipped under DRY_RUN (create.js, `if (!DRY_RUN)`), and
     running creation for real would start launchd jobs. create.test.js already proves createAgent stores
     reportsTo. What only this test can prove is the JOIN: every report is handed, by the real route, the
     machine name the lead ACTUALLY got. So createAgent is watched, not replaced. */
  const handed = [];
  const real = create.createAgent;
  create.createAgent = (opts) => { handed.push({ name: opts.name, reportsTo: opts.reportsTo }); return real(opts); };
  const made = [];
  try {
    for (const { spec } of s.json.specs) {
      const r = await call('POST', '/api/agents', spec);
      assert.equal(r.json && r.json.outcome, 'created', spec.name + ': ' + JSON.stringify(r.json));
      made.push(r.json.name);
    }
  } finally { create.createAgent = real; }
  assert.deepEqual(made, ['maya-okafor', 'leo-brand', 'ana-reyes']);
  assert.equal(handed.length, 3, 'the route reached createAgent once per member: ' + JSON.stringify(handed));
  assert.ok(!handed[0].reportsTo, 'the lead reports to no one');
  for (const h of handed.slice(1)) assert.equal(h.reportsTo, made[0], h.name + ' is handed the lead\'s actual machine name');
  const proj = projects.readAll().find((x) => x.id === projectId);
  assert.deepEqual([...proj.agents].sort(), ['ana-reyes', 'leo-brand', 'maya-okafor']);
});

/* #4632, through the REAL engine/catalogue.js: nothing held, the list read downloads the published
   files (served here, verified against the shipped PUBLIC_KEY with their own signature), and the three
   routes then answer from them. The fixtures above stand in for the catalogue everywhere else in this
   file, and a fixture to an agreed shape hid a defect on this card once already (iteration 14). Last in
   the file: it stores a catalogue in the sandbox and merges its roles. */
test('#4632 through the real catalogue: nothing held, the list downloads it, and a real team builds', async () => {
  const http = require('node:http');
  const catalogue = require('./engine/catalogue');
  const published = path.join(__dirname, 'test-support', 'catalogue-published');
  const hits = [];
  const files = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\//, ''));
    hits.push(name);
    if (name !== 'catalogue.json' && name !== 'catalogue.json.sig') { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(fs.readFileSync(path.join(published, name)));
  });
  await new Promise((done) => files.listen(0, '127.0.0.1', done));
  const before = process.env.KOSMOS_CATALOGUE_BASE;
  process.env.KOSMOS_CATALOGUE_BASE = `http://127.0.0.1:${files.address().port}/`;
  catalogue.useKeyForTest(null);   // the shipped key, and forget anything read before
  teamseed.setCatalogue(null);     // the real module
  try {
    assert.equal(catalogue.status().loaded, false, 'control: this sandbox holds no catalogue');
    const s0 = await call('POST', '/api/teams/seeded/marketing/specs', { names: {} });
    assert.equal(s0.status, 503, 'specs does not download: with nothing held it says so');
    assert.equal(hits.length, 0, 'and asked the network for nothing');
    const l = await call('GET', '/api/teams/seeded');
    assert.equal(l.status, 200, JSON.stringify(l.json));
    assert.ok(hits.includes('catalogue.json') && hits.includes('catalogue.json.sig'), 'the list read downloaded both files: ' + hits.join());
    assert.ok(l.json.teams.length >= 1, 'and lists the published teams');
    assert.equal(catalogue.status().loaded, true);
    const key = l.json.teams[0].key;
    const d = await call('GET', '/api/teams/seeded/' + key);
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.equal(d.json.members.filter((m) => m.reportsTo === null).length, 1, 'one lead');
    const names = {};
    for (const m of d.json.members) names[m.slot] = m.name;
    const s = await call('POST', '/api/teams/seeded/' + key + '/specs', { names });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    assert.equal(s.json.specs.length, d.json.members.length);
    for (const x of s.json.specs) assert.ok(typeof x.spec.teamInstructions === 'string' && x.spec.teamInstructions.length > 0, x.slot + ' has its team section');
    // A row from another version of the team is refused as such.
    const c = await call('POST', '/api/teams/seeded/' + key + '/specs', { names: { ...names, 'no-such-seat': 'Zed' } });
    assert.equal(c.status, 400);
    assert.equal(c.json.error, teamseed.CHANGED);
  } finally {
    if (before === undefined) delete process.env.KOSMOS_CATALOGUE_BASE; else process.env.KOSMOS_CATALOGUE_BASE = before;
    teamseed.setCatalogue(CATALOGUE);
    await new Promise((done) => files.close(done));
  }
});

/* #4719/#4935: the specs route carries the team's one provider, account and model to every member (the engine test calls
   specs() directly, so dropping the two fields at the route would pass it). */
test('#4719/#4935: the specs route passes the provider, account and model through to every member', async () => {
  const names = { names: { lead: 'Maya', content: 'Leo', social: 'Ana' } };
  teamseed.setCatalogue({ ...CATALOGUE, status: () => ({ loaded: true }) });
  try {
  const s = await call('POST', '/api/teams/seeded/marketing/specs', { ...names, provider: 'openai', account: 'acct-7', model: 'gpt-5' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.ok(s.json.specs.length > 0, JSON.stringify(s.json));
  for (const spec of s.json.specs) {
    assert.equal(spec.spec.provider, 'openai', JSON.stringify(spec));
    assert.equal(spec.spec.account, 'acct-7', JSON.stringify(spec));
    assert.equal(spec.spec.model, 'gpt-5', JSON.stringify(spec));   // #4935: and the team's one model
  }
  // CONTROL: without them, no member carries a provider or an account (Claude, as the single form sends it).
  const plain = await call('POST', '/api/teams/seeded/marketing/specs', names);
  assert.equal(plain.status, 200, JSON.stringify(plain.json));
  for (const spec of plain.json.specs) assert.ok(!('provider' in spec.spec) && !('account' in spec.spec) && !('model' in spec.spec), JSON.stringify(spec));
  } finally { teamseed.setCatalogue(CATALOGUE); }
});
