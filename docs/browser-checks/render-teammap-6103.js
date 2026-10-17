// Browser-check-surface: pj-teammap
/* kosmos#6103: a project's team map, read-only, behind a quiet "Team map" button in the Members card.
 *
 * Drives the SHIPPED page against a real server (sandboxed roots, fixture panes, never a live agent): a project with
 * three fixture members. Asserts the map starts closed, the button opens it with aria-expanded true, every member is
 * on it as a button, a second click closes it, a forced rebuild keeps a focused member focused, a member on the map
 * opens that agent's page, and at phone width the open map does not widen the page. One hand-off arm proves movedBy
 * reaches the page through the real GET /api/projects route (a part written to the store as moved by an agent shows
 * as handed; a screen-given task first shows none). The counting rules themselves are the unit suite's
 * (web.teammap-6103.test.js, on the real tasks engine).
 *
 * Every arm reds on the pre-#6103 page: there is no #pj-teammap-btn and no #pj-teammap.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-teammap-6103.js
 * Sandboxed roots; kills only what it starts.
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const NAMES = ['tmada', 'tmben', 'tmcy'];

let failures = 0;
const say = (n, cond, note) => { if (cond) console.log('PASS  ' + n); else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); } };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'teammap-' + k.toLowerCase() + '-'));
  }
  // FIXTURE members, never live agents: a real session name would be a real pane.
  const fleet = require('../../test-support/fleet');
  fs.writeFileSync(roots.DATA + '/fake-panes', NAMES.map((n) => fleet.line({ session: n + '-discord', claim: n, title: '✳ idle' })).join('\n') + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', NAMES.map((n) => n + '-discord\n').join(''));

  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    const added = await p.evaluate(async (names) => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Map Team' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      const codes = [];
      for (const n of names) codes.push((await fetch('/api/project/' + body.project.id + '/agent/' + n, { method: 'POST', headers: { 'content-type': 'application/json' } })).status);
      return codes;
    }, NAMES);
    say('CONTROL: the three fixture members were added', added.every((c) => c >= 200 && c < 300), JSON.stringify(added));
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Map Team').first().click();
    await p.waitForFunction(() => document.querySelectorAll('#pj-one-agents .pj-member').length === 3, null, { timeout: 15000 });

    const state = () => p.evaluate(() => {
      const btn = document.getElementById('pj-teammap-btn');
      const box = document.getElementById('pj-teammap');
      return { btn: !!btn && btn.getClientRects().length > 0, expanded: btn && btn.getAttribute('aria-expanded'),
        open: !!box && !box.hidden && box.getClientRects().length > 0,
        nodes: box ? [...box.querySelectorAll('.pjtm-node[data-agent]')].map((n) => n.dataset.agent) : [] };
    });
    const before = await state();
    say('the Team map button shows on a project with members', before.btn);
    say('the map starts closed', before.open === false && before.expanded === 'false', JSON.stringify(before));
    await p.click('#pj-teammap-btn');
    await p.waitForFunction(() => !document.getElementById('pj-teammap').hidden, null, { timeout: 5000 }).catch(() => {});
    const opened = await state();
    say('the button opens the map and says so', opened.open && opened.expanded === 'true', JSON.stringify(opened));
    say('every member is on the map', NAMES.every((n) => opened.nodes.includes(n)) && opened.nodes.length === 3, JSON.stringify(opened.nodes));
    const words = await p.textContent('#pj-teammap');
    say('the map says what each holds and who handed work', /holds no open parts/.test(words) && /Who handed work to whom/.test(words), words);

    // Phone width: the open map must not widen the page.
    await p.setViewportSize({ width: 375, height: 800 });
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    say('at phone width the open map does not widen the page', over <= 0, 'overflow ' + over + 'px');
    await p.setViewportSize({ width: 1280, height: 900 });

    await p.click('#pj-teammap-btn');
    await p.waitForTimeout(200);
    const closed = await state();
    say('a second click closes it', closed.open === false && closed.expanded === 'false', JSON.stringify(closed));

    // A repaint of the open map keeps a focused member focused (keyboard users), found by data-agent.
    await p.click('#pj-teammap-btn');
    await p.waitForSelector('#pj-teammap .pjtm-node[data-agent="tmcy"]', { state: 'visible', timeout: 5000 });
    const kept = await p.evaluate(() => {
      const old = document.querySelector('#pj-teammap .pjtm-node[data-agent="tmcy"]');
      old.focus();
      const before = document.activeElement && document.activeElement.dataset.agent;
      document.getElementById('pj-teammap').__lastLive = null;   // setLive's memory of what it wrote: forces a rebuild
      paintOneProject();
      const now = document.querySelector('#pj-teammap .pjtm-node[data-agent="tmcy"]');
      const rebuilt = !!now && now !== old;   // a NEW node, so focus had to be put back, not merely kept
      return { before, rebuilt, after: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.agent : null };
    });
    say('a repaint keeps the focused member focused', kept.before === 'tmcy' && kept.rebuilt && kept.after === 'tmcy', JSON.stringify(kept));
    await p.click('#pj-teammap-btn');   // closed again, as the arms below expect

    // The agent page is open when #panel-detail shows and #d-name names the agent.
    const detailOf = () => p.evaluate(() => { const d = document.getElementById('panel-detail'); const n = document.getElementById('d-name');
      return { shown: !!d && !d.hidden && d.getClientRects().length > 0, name: n ? (n.textContent || '').trim() : '' }; });
    const waitDetail = () => p.waitForFunction(() => { const d = document.getElementById('panel-detail'); return d && !d.hidden && d.getClientRects().length > 0; }, null, { timeout: 5000 }).catch(() => {});
    // CONTROL: a member ROW opens the agent page (the existing path), so the read below can see an open page.
    await p.click('#pj-one-agents .pj-member[data-agent="tmcy"]');
    await waitDetail();
    const viaRow = await detailOf();
    say('CONTROL: a member row opens the agent page, and this check can see it', viaRow.shown && /tmcy/i.test(viaRow.name), JSON.stringify(viaRow));
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Map Team').first().click();
    await p.waitForFunction(() => document.querySelectorAll('#pj-one-agents .pj-member').length === 3, null, { timeout: 15000 });
    if ((await state()).open === false) await p.click('#pj-teammap-btn');
    await p.waitForSelector('#pj-teammap .pjtm-node[data-agent="tmben"]', { state: 'visible', timeout: 5000 });
    await p.click('#pj-teammap .pjtm-node[data-agent="tmben"]');
    await waitDetail();
    const viaMap = await detailOf();
    say('a member on the map opens that agent page', viaMap.shown && /tmben/i.test(viaMap.name), JSON.stringify(viaMap));

    // movedBy reaches the browser through the real route (GET /api/projects), not only through projects.mbList in the
    // unit test: a part recorded on disk as moved by tmada shows as a hand-off on the page.
    const mbPid = await p.evaluate(async () => {
      const r = await fetch('/api/projects'); const j = await r.json();
      const pr = (j.projects || []).find((x) => x.name === 'Map Team');
      const t = await fetch('/api/project/' + pr.id + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentence: 'Hand this over', who: 'tmben' }) });
      if (!t.ok) throw new Error('task create failed: ' + t.status + ' ' + (await t.text()));
      return pr.id;
    });
    const mbOpenMap = async () => {
      await p.reload({ waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText('Map Team').first().click();
      await p.waitForFunction(() => document.querySelectorAll('#pj-one-agents .pj-member').length === 3, null, { timeout: 15000 });
      if ((await state()).open === false) await p.click('#pj-teammap-btn');
      return p.textContent('#pj-teammap');
    };
    const mbBefore = await mbOpenMap();
    say('CONTROL: a task given out from the screen is no hand-off between agents', /tmben[^]*holds 1 open part/.test(mbBefore) && /No hand-offs between agents/.test(mbBefore), mbBefore);
    // Every projects.json under the data root; the store is the one holding this project (backups and copies can sit beside it).
    const mbFindStores = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isFile() && e.name === 'projects.json') out.push(f); else if (e.isDirectory()) mbFindStores(f, out); } return out; };
    const mbCandidates = mbFindStores(roots.DATA);
    const mbStore = mbCandidates.find((f) => { try { return fs.readFileSync(f, 'utf8').includes(mbPid); } catch { return false; } });
    say('CONTROL: the projects store is on disk where the board reads it', !!mbStore, JSON.stringify(mbCandidates));
    const mbAll = JSON.parse(fs.readFileSync(mbStore, 'utf8'));
    const mbList = Array.isArray(mbAll) ? mbAll : mbAll.projects;
    const mbProj = mbList.find((x) => x.id === mbPid);
    const mbTask = mbProj.tasks.find((x) => x.sentence === 'Hand this over');
    const mbParts = Array.isArray(mbTask.parts) && mbTask.parts.length ? mbTask.parts : [{ id: 1, who: mbTask.who, sentence: mbTask.sentence, closedAt: null }];
    mbTask.parts = mbParts.map((x, i) => (i === 0 ? { ...x, who: 'tmben', movedVia: 'process', movedBy: 'tmada', movedAt: new Date().toISOString() } : x));
    fs.writeFileSync(mbStore, JSON.stringify(mbAll, null, 2));
    const mbDisk1 = fs.readFileSync(mbStore, 'utf8').includes('"movedBy": "tmada"');
    const mbAfter = await mbOpenMap();
    // What the route itself serves for that part, so a red says whether the route or the page lost movedBy.
    const mbServed = await p.evaluate(async (id) => {
      const j = await (await fetch('/api/projects')).json();
      const t = ((j.projects || []).find((x) => x.id === id) || {}).tasks || [];
      const hit = t.find((x) => x.sentence === 'Hand this over');
      return hit ? { keys: Object.keys(hit), parts: hit.parts } : 'no such task in the route';
    }, mbPid);
    say('a part moved by an agent shows as a hand-off on the page (movedBy survives the route)', /tmada handed tmben 1 open part/.test(mbAfter), 'disk after write=' + mbDisk1 + ' disk after route=' + fs.readFileSync(mbStore, 'utf8').includes('"movedBy": "tmada"') + ' route parts=' + JSON.stringify(mbServed) + ' page=' + mbAfter);

    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    failures++;
    console.log('FAIL  the check could not run  --  ' + (e && e.stack || e));
  } finally {
    await b.close();
    srv.kill();
    for (const d of Object.values(roots)) fs.rmSync(d, { recursive: true, force: true });
  }
  if (failures) { console.log('FAIL  teammap (#6103): ' + failures + ' failing'); process.exit(1); }
  console.log('TEAMMAP OK (#6103): the Team map button opens and closes the map, every member is on it, a member opens its page, and it fits a phone.');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
