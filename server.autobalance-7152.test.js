'use strict';

/**
 * kosmos#7152 slice 2 through the real server (in-process, every root sandboxed, dry run): usage auto-balance's
 * switch route and what /api/accounts adds. The switch reads on when never set; its PUT takes only a screen (an
 * Origin the board serves) and only true or false; /api/accounts puts the engine's bulkTargetable on every Claude row,
 * and the decision only when Settings asks for the agents (?agents=1).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-autobalance-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, _autobalanceSweepDepsForTest } = require('./server');
const statusline = require('./engine/kosmos-statusline');
const jobfix = require('./test-support/jobfixture');
const fleet = require('./test-support/fleet');

let port = 0;
test.before(async () => { await start(0); port = server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* node:http, so the Origin header is sent as written (fetch controls some request headers itself). */
function call(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch { j = null; } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const screen = () => ({ origin: `http://127.0.0.1:${port}` });

test('#7152 slice 2: the switch reads on when never set, and only a screen may change it, to true or false', async () => {
  const first = await call('GET', '/api/autobalance-setting');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { on: true, ok: true }, 'a person who never set it did not get it on');
  const noScreen = await call('PUT', '/api/autobalance-setting', { on: false });
  assert.equal(noScreen.status, 403, 'a caller that is not the screen changed it');
  const notBool = await call('PUT', '/api/autobalance-setting', { on: 'no' }, screen());
  assert.equal(notBool.status, 400, 'a value that is not true or false was taken');
  assert.deepEqual((await call('GET', '/api/autobalance-setting')).json, { on: true, ok: true }, 'a refused change was saved anyway');
  const off = await call('PUT', '/api/autobalance-setting', { on: false }, screen());
  assert.equal(off.status, 200, 'CONTROL: the screen can change it');
  assert.deepEqual(off.json, { on: false, ok: true });
  assert.deepEqual((await call('GET', '/api/autobalance-setting')).json, { on: false, ok: true }, 'turning it off did not stick');
  await call('PUT', '/api/autobalance-setting', { on: true }, screen());
});

test('#7152 slice 2: every Claude row carries bulkTargetable, and the decision comes only with ?agents=1', async () => {
  /* The default Claude account, as accounts.list finds it: <home>/.claude, signed in through <home>/.claude.json. */
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.test' } }));
  const plain = await call('GET', '/api/accounts');
  assert.equal(plain.status, 200);
  const claude = (plain.json.accounts || []).filter((a) => a.provider === 'anthropic');
  assert.ok(claude.length >= 1, 'CONTROL: the sandbox lists a Claude account');
  assert.ok(claude.every((a) => typeof a.bulkTargetable === 'boolean'), 'a Claude row went without the engine\'s answer');
  assert.equal('autobalance' in plain.json, false, 'the decision was worked out for a page that does not show it');
  const settings = await call('GET', '/api/accounts?agents=1');
  const ab = settings.json && settings.json.autobalance;
  assert.ok(ab && typeof ab.eligible === 'number' && Array.isArray(ab.moves), 'Settings was not given the decision');
  assert.equal(ab.on, true);
  assert.equal(ab.ok, true, 'the setting\'s ok did not reach the page, so a corrupt file could read as a confident Off');
  assert.equal(ab.eligible, claude.filter((a) => !a.apiKey).length, 'the account count is not the Claude subscription rows');
  assert.equal(JSON.stringify(settings.json.autobalance).includes('@'), false, 'an email went into the decision');
});

test('#7152 review 3: with two accounts and one running out, the real route works out the decision and names it', async () => {
  const home = process.env.AGENT_WORKFORCE_HOME;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.test' } }));
  const second = path.join(home, '.claude-spare');
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(second, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'other@example.test' } }));
  const weekly = (dir, usedPct) => fs.writeFileSync(path.join(dir, statusline.FILE),
    JSON.stringify({ usedPct, resetsAt: Math.floor((Date.now() + 40 * 3600e3) / 1000), at: Date.now() - 60e3, history: [] }));
  weekly(path.join(home, '.claude'), 95);
  weekly(second, 10);
  const ab = (await call('GET', '/api/accounts?agents=1')).json.autobalance;
  assert.equal(ab.eligible, 2, 'CONTROL: the sandbox lists two Claude subscription accounts');
  assert.equal(ab.unreadable, undefined, 'the decision failed through the real route');
  assert.deepEqual(ab.atRisk.map((x) => x.from), [path.join(home, '.claude')], 'the account at 95% was not named as running out');
  assert.match(ab.atRisk[0].why, /95% of its weekly limit/);
  assert.equal(JSON.stringify(ab).includes('@'), false, 'an email went into the decision');
  weekly(path.join(home, '.claude'), 50);
  assert.deepEqual((await call('GET', '/api/accounts?agents=1')).json.autobalance.atRisk, [], 'CONTROL: at 50% nothing is running out');
});

test('#7152 review 5: a setting file that could not be read reaches the page as not ok', async () => {
  const file = require('./engine/autobalance-setting').FILE;   // where the board keeps it (the data root has its own folder)
  assert.ok(file.startsWith(process.env.AGENT_WORKFORCE_DATA), 'CONTROL: the setting is in the sandbox');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json');
  try {
    const ab = (await call('GET', '/api/accounts?agents=1')).json.autobalance;
    assert.equal(ab.ok, false, 'a corrupt setting reached the page as a good reading');
    assert.equal(ab.on, false, 'CONTROL: the engine reads it off');
  } finally { fs.rmSync(file, { force: true }); }
});

test('#7152 review 6: an idle agent the real board lists, on an account running out, is found movable through the real route', async (t) => {
  const home = process.env.AGENT_WORKFORCE_HOME;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.test' } }));
  const spare = path.join(home, '.claude-spare');
  fs.mkdirSync(spare, { recursive: true });
  fs.writeFileSync(path.join(spare, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'other@example.test' } }));
  /* Review 9: the spare account shares the default's memory (its projects link), so the route has a row it marks true. */
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  try { fs.symlinkSync(path.join(home, '.claude', 'projects'), path.join(spare, 'projects')); } catch { /* already linked by an earlier test */ }
  const weekly = (dir, usedPct) => fs.writeFileSync(path.join(dir, statusline.FILE),
    JSON.stringify({ usedPct, resetsAt: Math.floor((Date.now() + 40 * 3600e3) / 1000), at: Date.now() - 60e3, history: [] }));
  weekly(path.join(home, '.claude'), 95);
  weekly(spare, 10);
  /* One agent, built by the real producers (test-support/fleet), on the default account by its launch job. */
  const pp = jobfix.jobPath('ada');
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, jobfix.jobFor('ada', '/bin/claude', '/bin/tmux', 'opus', null, 'claude'));
  const read = async (state) => {
    const board = fleet.install([fleet.agent('ada', { state })], { strict: false });
    try { return (await call('GET', '/api/accounts?agents=1')).json; } finally { board.restore(); }
  };
  const idle = await read('idle');
  const row = (idle.accounts || []).find((a) => a.provider === 'anthropic' && a.isDefault);
  assert.ok(row && row.agentsHere && row.agentsHere.names.includes('ada'), 'CONTROL: the board lists ada on the default account: ' + JSON.stringify(row && row.agentsHere));
  const ab = idle.autobalance;
  assert.equal(ab.unreadable, undefined, 'the decision failed through the real route');
  assert.deepEqual(ab.atRisk.map((x) => x.from), [path.join(home, '.claude')]);
  /* `held` is filled only when the account has MOVABLE agents and no target, so it proves the real roster card went
     through movableFor (idle, commitments free, no open work) and decide. No target here: the spare account shares
     memory, so the page's bulk move may offer it (bulkTargetable true), but nothing has checked its login yet
     (unchecked), and an automatic move needs a positively signed-in one. */
  assert.deepEqual(ab.held.map((h) => h.from), [path.join(home, '.claude')],
    'an idle agent the real board lists was not found movable (moves ' + JSON.stringify(ab.moves) + ', held ' + JSON.stringify(ab.held) + ')');
  const spareRow = (idle.accounts || []).find((a) => a.dir === spare);
  assert.ok(spareRow && spareRow.weekly && spareRow.weekly.usedPct === 10, 'CONTROL: the spare account is measured at 10%');
  assert.equal(spareRow.memoryShared, true, 'CONTROL: the spare account shares the default\'s memory');
  assert.equal(spareRow.bulkTargetable, true, 'the route did not mark a row the bulk move may take as true');
  assert.equal(spareRow.connection.badge, 'unchecked', 'CONTROL: its login is unchecked, which is why the automatic move holds');
  const busy = (await read('working')).autobalance;
  assert.deepEqual(busy.held, [], 'CONTROL: a working agent is not found movable');
  assert.deepEqual(busy.moves, []);
  assert.deepEqual(busy.atRisk.map((x) => x.from), [path.join(home, '.claude')], 'CONTROL: the account is still named as running out');
  fs.rmSync(pp, { force: true });
});

test('#7152 slice 3: Settings is told the sweep does not record under a test, and gets the record newest first', async () => {
  const sweep = require('./engine/autobalance-sweep');
  const file = path.join(path.dirname(require('./engine/autobalance-setting').FILE), sweep.FILE);
  assert.ok(file.startsWith(SANDBOX), 'CONTROL: the record would be written inside the sandbox');
  const first = (await call('GET', '/api/accounts?agents=1')).json.autobalance;
  assert.equal(first.recording, false, 'a board under a test said its sweep records (the sweep cannot run here)');
  assert.equal('movesOn' in first, false, 'the route still reports a move switch, and nothing in this slice moves');
  assert.deepEqual(first.recent, [], 'a record was shown before anything was recorded');
  sweep.append(file, { kind: 'decision', at: 1, moves: [{ agent: 'ada', from: '/a', to: '/b', why: 'x' }], held: [], atRisk: [] });
  sweep.append(file, { kind: 'decision', at: 2, moves: [{ agent: 'bo', from: '/a', to: '/b', why: 'x' }], held: [], atRisk: [] });
  const recent = (await call('GET', '/api/accounts?agents=1')).json.autobalance.recent;
  assert.deepEqual(recent.map((e) => e.at), [2, 1], 'the record did not reach Settings newest first');
  /* Review 13: with the switch off the page shows no record, so the route does not read it. */
  await call('PUT', '/api/autobalance-setting', { on: false }, screen());
  try {
    assert.deepEqual((await call('GET', '/api/accounts?agents=1')).json.autobalance.recent, [], 'the record was read with the switch off');
  } finally { await call('PUT', '/api/autobalance-setting', { on: true }, screen()); }
});
test('#7152 slice 3: one real tick through the board wiring records the decision, moves nothing, and names no email', async () => {
  const sweep = require('./engine/autobalance-sweep');
  const usagepoll = require('./engine/usagepoll');
  const home = process.env.AGENT_WORKFORCE_HOME;
  const main = path.join(home, '.claude');
  fs.mkdirSync(main, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.test' } }));
  const spare = path.join(home, '.claude-spare');
  fs.mkdirSync(spare, { recursive: true });
  fs.writeFileSync(path.join(spare, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'other@example.test' } }));
  fs.mkdirSync(path.join(main, 'projects'), { recursive: true });
  try { fs.symlinkSync(path.join(main, 'projects'), path.join(spare, 'projects')); } catch { /* already linked by an earlier test */ }
  /* Slice 1's usage records, as its poll writes them: a fresh reading that worked, for each account. */
  const now = Date.now();
  const usage = (dir, usedPct, email) => fs.writeFileSync(path.join(dir, usagepoll.FILE), JSON.stringify({ at: now - 60e3, measuredAt: now - 60e3,
    state: 'ok', email, weekly: { usedPct, resetsAt: Math.floor((now + 40 * 3600e3) / 1000) }, fiveHour: null }));
  usage(main, 95, 'person@example.test');
  usage(spare, 10, 'other@example.test');
  const pp = jobfix.jobPath('ada');
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, jobfix.jobFor('ada', '/bin/claude', '/bin/tmux', 'opus', null, 'claude'));
  const file = path.join(SANDBOX, 'autobalance-sweep-tick.jsonl');
  const board = fleet.install([fleet.agent('ada', { state: 'idle' })], { strict: false });
  let r;
  let deps;
  try {
    deps = _autobalanceSweepDepsForTest();
    assert.equal('startMove' in deps, false, 'the sweep was handed a way to move agents');
    r = await sweep.create({ file }).tick(deps, now);
  } finally { board.restore(); }
  const lines = sweep.readLines(file);
  assert.equal(r.did, 'recorded', 'the tick did not record a decision: ' + JSON.stringify(r) + ' ' + JSON.stringify(lines));
  const d = lines[0];
  assert.deepEqual(d.moves.map((m) => [m.agent, m.from, m.to, m.toLabel, m.fromLabel]), [['ada', main, spare, 'spare', 'the main account']],
    'the real wiring did not name ada moving to the measured spare account');
  assert.equal(fs.readFileSync(file, 'utf8').includes('@'), false, 'an email reached the record');
  /* CONTROL: without a fresh reading the spare account is not a target, so the same wiring holds instead. */
  fs.rmSync(path.join(spare, usagepoll.FILE), { force: true });
  const board2 = fleet.install([fleet.agent('ada', { state: 'idle' })], { strict: false });
  try { await sweep.create({ file: file + '.2' }).tick(_autobalanceSweepDepsForTest(), now); } finally { board2.restore(); }
  assert.deepEqual(sweep.readLines(file + '.2')[0].held.map((h) => h.from), [main], 'an unmeasured account was taken as a target');
  fs.rmSync(path.join(main, usagepoll.FILE), { force: true });
  fs.rmSync(pp, { force: true });
  /* Review 12: leave the sandbox as the next test expects it, one account and no second sign-in. */
  fs.rmSync(spare, { recursive: true, force: true });
});

test('#7152 slice 3 review 2: the real guide check: a guide folder with its marker is never movable, nor the seeded guide name', () => {
  const ab = require('./engine/autobalance');
  const sa = require('./engine/setup-assistant');
  const instructions = require('./engine/instructions');
  const board = fleet.install([fleet.agent('gd'), fleet.agent('ada')], { strict: false });
  try {
    const cards = [board.card('gd'), board.card('ada')];
    const file = instructions.fileFor('gd');
    assert.ok(file && file.startsWith(SANDBOX), 'CONTROL: the guide folder is inside the sandbox: ' + file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const marker = path.join(path.dirname(file), sa.GUIDE_MARKER);
    const m = () => ab.movableFor({ cards, records: [], readCommitment: () => ({ state: 'clear' }) });   // the real isGuide and guideName
    assert.equal(m()('gd'), true, 'CONTROL: with no marker, an ordinary idle agent is movable through the real checks');
    fs.writeFileSync(marker, '');
    assert.equal(sa.isGuideFolderStrict('gd'), true);
    assert.equal(m()('gd'), false, 'the guide, by its folder marker, was movable');
    assert.equal(m()('ada'), true, 'CONTROL: another agent is still movable');
    fs.rmSync(marker);
    fs.mkdirSync(marker);   // a marker that is not a file: not the guide (lstat answers), so still movable
    assert.equal(m()('gd'), true);
    fs.rmSync(marker, { recursive: true });
    /* The seeded name, read strictly: the guide's record names it; an unreadable record refuses everyone. */
    const flag = path.join(require('./engine/store').ROOT, 'setup-assistant.json');   // setup-assistant's flagPath()
    assert.ok(flag.startsWith(SANDBOX), 'CONTROL: the guide record is inside the sandbox: ' + flag);
    const had = fs.existsSync(flag) ? fs.readFileSync(flag) : null;
    try {
      fs.writeFileSync(flag, JSON.stringify({ name: 'ada' }));
      assert.equal(m()('ada'), false, 'the seeded guide name was movable');
      fs.writeFileSync(flag, '{ not json');
      assert.throws(() => sa.guideNameStrict());
      assert.equal(sa.guideName(), null, 'CONTROL: the lenient read takes a broken record as never seeded');
      assert.throws(() => m(), 'a guide record that could not be read let the decision go ahead (review 10: it is unreadable)');
    } finally { if (had) fs.writeFileSync(flag, had); else fs.rmSync(flag, { force: true }); }
  } finally { board.restore(); }
});
