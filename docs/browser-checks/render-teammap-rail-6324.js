// Browser-check-surface: alist-teammap
/* kosmos#6324: the team map (#6103) from the CONSOLIDATED layout, which hides the Members card holding the tab
 * layout's "Team map" button. The Agents rail head gets its own button and box.
 *
 * Drives the SHIPPED page against a real server (sandboxed roots, fixture panes, never a live agent): a project with
 * three fixture members, the consolidated layout at 1280 wide. Asserts the tab layout's button cannot be reached there
 * (the problem), the rail's button shows and starts closed, opens the map with aria-expanded true, every member is on
 * it, the map fits the rail, folding the agents column hides it, a second click closes it, and a member on the map opens
 * that agent's page. What the map counts is the unit suites' (web.teammap-6103.test.js, web.teammap-rail-6324.test.js).
 *
 * Every arm after the controls reds on the #6103 page alone: there is no #alist-teammap-btn and no #alist-teammap.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-teammap-rail-6324.js
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
const NAMES = ['rmada', 'rmben', 'rmcy'];

let failures = 0;
const say = (n, cond, note) => { if (cond) console.log('PASS  ' + n); else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); } };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'teammaprail-' + k.toLowerCase() + '-'));
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
    const made = await p.evaluate(async (names) => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rail Team' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      const codes = [];
      for (const n of names) codes.push((await fetch('/api/project/' + body.project.id + '/agent/' + n, { method: 'POST', headers: { 'content-type': 'application/json' } })).status);
      return { id: body.project.id, codes };
    }, NAMES);
    say('CONTROL: the three fixture members were added', made.codes.every((c) => c >= 200 && c < 300), JSON.stringify(made.codes));

    await p.click('[data-tab="projects"]');
    await p.evaluate(() => applyLayout('consolidated', true));
    await p.evaluate(() => loadProjects());
    await p.evaluate((id) => openProject(id), made.id);
    await p.waitForFunction((names) => names.every((n) => document.querySelector('#alist .lrow[data-agent="' + n + '"]')), NAMES, { timeout: 15000 });

    const state = () => p.evaluate(() => {
      const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
      const btn = document.getElementById('alist-teammap-btn');
      const box = document.getElementById('alist-teammap');
      return { cons: document.body.classList.contains('consolidated'), open: PJ_CURRENT,
        tabBtn: vis(document.getElementById('pj-teammap-btn')),
        btn: vis(btn), expanded: btn && btn.getAttribute('aria-expanded'), shown: vis(box),
        nodes: box ? [...box.querySelectorAll('.pjtm-node[data-agent]')].map((n) => n.dataset.agent) : [],
        over: box ? box.scrollWidth - box.clientWidth : null };
    });
    const before = await state();
    say('CONTROL: the consolidated layout is on with the project open', before.cons && before.open === made.id, JSON.stringify(before));
    say('CONTROL: the tab layout\'s Team map button cannot be reached here (the card\'s problem)', before.tabBtn === false, JSON.stringify(before));
    say('the rail shows a Team map button', before.btn, JSON.stringify(before));
    say('the rail map starts closed', before.shown === false && before.expanded === 'false', JSON.stringify(before));

    await p.click('#alist-teammap-btn');
    await p.waitForFunction(() => !document.getElementById('alist-teammap').hidden, null, { timeout: 5000 }).catch(() => {});
    const opened = await state();
    say('the button opens the map and says so', opened.shown && opened.expanded === 'true', JSON.stringify(opened));
    say('every member is on the rail map', NAMES.every((n) => opened.nodes.includes(n)) && opened.nodes.length === 3, JSON.stringify(opened.nodes));
    const words = await p.textContent('#alist-teammap');
    say('the map says what each holds and who handed work', /holds no open parts/.test(words) && /Who handed work to whom/.test(words), words);
    say('the open map fits the rail (no sideways scroll)', opened.over !== null && opened.over <= 0, 'overflow ' + opened.over + 'px');
    const pageOver = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    say('the open map does not widen the page', pageOver <= 0, 'overflow ' + pageOver + 'px');

    // Folding the agents column hides the map with the rest of the head, and unfolding brings it back.
    await p.click('#rail-agents-fold');
    await p.waitForTimeout(250);
    const folded = await state();
    say('folding the agents column hides the button and the map', folded.btn === false && folded.shown === false, JSON.stringify(folded));
    await p.click('#rail-agents-fold');
    await p.waitForTimeout(250);
    const unfolded = await state();
    say('unfolding brings the open map back', unfolded.btn && unfolded.shown, JSON.stringify(unfolded));

    await p.click('#alist-teammap-btn');
    await p.waitForTimeout(200);
    const closed = await state();
    say('a second click closes it', closed.shown === false && closed.expanded === 'false', JSON.stringify(closed));

    // The agent page is open when #panel-detail shows and #d-name names the agent.
    const detailOf = () => p.evaluate(() => { const d = document.getElementById('panel-detail'); const n = document.getElementById('d-name');
      return { shown: !!d && !d.hidden && d.getClientRects().length > 0, name: n ? (n.textContent || '').trim() : '' }; });
    const waitDetail = () => p.waitForFunction(() => { const d = document.getElementById('panel-detail'); return d && !d.hidden && d.getClientRects().length > 0; }, null, { timeout: 5000 }).catch(() => {});
    await p.click('#alist-teammap-btn');
    await p.waitForSelector('#alist-teammap .pjtm-node[data-agent="rmben"]', { state: 'visible', timeout: 5000 });
    const beforeClick = await detailOf();
    say('CONTROL: no agent page is open before the map is pressed', !(beforeClick.shown && /rmben/i.test(beforeClick.name)), JSON.stringify(beforeClick));
    await p.click('#alist-teammap .pjtm-node[data-agent="rmben"]');
    await waitDetail();
    const viaMap = await detailOf();
    say('a member on the rail map opens that agent page', viaMap.shown && /rmben/i.test(viaMap.name), JSON.stringify(viaMap));

    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    failures++;
    console.log('FAIL  the check could not run  --  ' + (e && e.stack || e));
  } finally {
    await b.close();
    srv.kill();
    for (const d of Object.values(roots)) fs.rmSync(d, { recursive: true, force: true });
  }
  if (failures) { console.log('FAIL  teammap rail (#6324): ' + failures + ' failing'); process.exit(1); }
  console.log('TEAMMAP RAIL OK (#6324): in the consolidated layout the Agents rail opens and closes the team map, every member is on it, it fits and folds, and a member opens its page.');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
