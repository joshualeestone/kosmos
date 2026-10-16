// Browser-check-surface: alist-teammap
/* kosmos#6324: the team map (#6103) from the CONSOLIDATED layout, which hides the Members card holding the tab
 * layout's "Team map" button. The Agents rail head gets its own button and box.
 *
 * Drives the SHIPPED page against a real server (sandboxed roots, fixture panes, never a live agent): a project with
 * ten fixture members, the consolidated layout at 1280x900 and at its narrowest, 960x720. Asserts the tab layout's button cannot be
 * reached there (the problem), the rail's button shows and starts closed, opens the map with aria-expanded true, every
 * member is on it, the map fits sideways and scrolls inside its own box while the first agent row stays in view,
 * focus survives a repaint, folding the agents column hides it, the open state carries to the tab layout, a second
 * click closes it, and a member on the map opens that agent's page. What the map counts is the unit suites'
 * (web.teammap-6103.test.js, web.teammap-rail-6324.test.js).
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
// Ten members, so the open map is taller than the rail can give it and the height cap is exercised.
const NAMES = ['rmada', 'rmben', 'rmcy', 'rmdee', 'rmeve', 'rmfay', 'rmgus', 'rmhal', 'rmivy', 'rmjo'];

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
    say('CONTROL: the ten fixture members were added', made.codes.every((c) => c >= 200 && c < 300), JSON.stringify(made.codes));
    // A four-level reporting chain (rmada <- rmben <- rmcy <- rmdee), so the map indents and the sideways arms test it.
    const chained = await p.evaluate(async (pairs) => {
      const codes = [];
      for (const [who, to] of pairs) codes.push((await fetch('/api/agent/' + who + '/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reportsTo: to }) })).status);
      return codes;
    }, [['rmben', 'rmada'], ['rmcy', 'rmben'], ['rmdee', 'rmcy']]);
    say('CONTROL: the reporting chain was saved', chained.every((c) => c >= 200 && c < 300), JSON.stringify(chained));

    await p.click('[data-tab="projects"]');
    await p.evaluate(() => applyLayout('consolidated', true));
    await p.evaluate(() => loadProjects());
    // The Agents and Projects rail labels share one line (#3948 item 2): their tops, in px apart.
    const labelGap = () => p.evaluate(() => {
      const a = document.querySelector('#rail-agents .railname');
      const pr = document.querySelector('#rail-projects .railname');
      if (!a || !pr) return null;
      return Math.abs(a.getBoundingClientRect().top - pr.getBoundingClientRect().top);
    });
    const gapClosed = await labelGap();
    say('CONTROL: with no project open the two rail labels share a line', gapClosed !== null && gapClosed <= 1, 'apart ' + gapClosed + 'px');
    await p.evaluate((id) => openProject(id), made.id);
    await p.waitForFunction((names) => names.every((n) => document.querySelector('#alist .lrow[data-agent="' + n + '"]')), NAMES, { timeout: 15000 });
    await p.waitForFunction(() => { const b = document.getElementById('alist-teammap-btn'); return b && !b.hidden && b.getClientRects().length > 0; }, null, { timeout: 5000 }).catch(() => {});

    const state = () => p.evaluate(() => {
      const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
      const btn = document.getElementById('alist-teammap-btn');
      const box = document.getElementById('alist-teammap');
      return { cons: document.body.classList.contains('consolidated'), open: PJ_CURRENT,
        tabBtn: vis(document.getElementById('pj-teammap-btn')),
        btn: vis(btn), expanded: btn && btn.getAttribute('aria-expanded'), shown: vis(box),
        nodes: box ? [...box.querySelectorAll('.pjtm-node[data-agent]')].map((n) => n.dataset.agent) : [],
        over: box ? box.scrollWidth - box.clientWidth : null,
        tall: box ? box.scrollHeight - box.clientHeight : null,
        // The page scrolling down: the body is the scroller in this layout (height 100vh, overflow-y auto), so read both.
        pageDown: Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight,
          document.body.scrollHeight - document.body.clientHeight),
        // The first agent row of the list, wholly inside the window: the list was not pushed off.
        firstRow: (() => { const r0 = document.querySelector('#alist .lrow'); if (!r0) return null; const r = r0.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight; })() };
    });
    const before = await state();
    say('CONTROL: the consolidated layout is on with the project open', before.cons && before.open === made.id, JSON.stringify(before));
    say('CONTROL: the tab layout\'s Team map button cannot be reached here (the card\'s problem)', before.tabBtn === false, JSON.stringify(before));
    say('the rail shows a Team map button', before.btn, JSON.stringify(before));
    say('the rail map starts closed', before.shown === false && before.expanded === 'false', JSON.stringify(before));
    const gapBtn = await labelGap();
    say('with the Team map button showing the two rail labels still share a line', gapBtn !== null && gapBtn <= 1, 'apart ' + gapBtn + 'px');
    // CONTROL for that instrument: push the Agents label line down and it must read them apart.
    const pushed = await p.evaluate(() => {
      const lead = document.querySelector('#rail-agents .lead');
      lead.style.paddingTop = '20px';
      const a = document.querySelector('#rail-agents .railname').getBoundingClientRect().top;
      const pr = document.querySelector('#rail-projects .railname').getBoundingClientRect().top;
      lead.style.paddingTop = '';
      return Math.abs(a - pr);
    });
    say('CONTROL: the label instrument reads a pushed label line as apart', pushed > 1, 'apart ' + pushed + 'px');

    await p.click('#alist-teammap-btn');
    await p.waitForFunction(() => !document.getElementById('alist-teammap').hidden, null, { timeout: 5000 }).catch(() => {});
    const opened = await state();
    say('the button opens the map and says so', opened.shown && opened.expanded === 'true', JSON.stringify(opened));
    say('every member is on the rail map', NAMES.every((n) => opened.nodes.includes(n)) && opened.nodes.length === NAMES.length, JSON.stringify(opened.nodes));
    const depth = await p.evaluate(() => {
      let d = 0;
      for (const ul of document.querySelectorAll('#alist-teammap .pjtm-map ul')) { let n = 0; for (let e = ul; e && e.id !== 'alist-teammap'; e = e.parentElement) if (e.tagName === 'UL') n++; d = Math.max(d, n); }
      return d;
    });
    say('CONTROL: the map nests four levels deep', depth >= 4, 'depth ' + depth);
    const words = await p.textContent('#alist-teammap');
    say('the map says what each holds and who handed work', /holds no open parts/.test(words) && /Who handed work to whom/.test(words), words);
    say('the open map fits the rail (no sideways scroll)', opened.over !== null && opened.over <= 0, 'overflow ' + opened.over + 'px');
    // CONTROL for the sideways arms: a node forced wider than the rail must read as overflow.
    const wide = await p.evaluate(() => {
      const box = document.getElementById('alist-teammap');
      const n = box.querySelector('.pjtm-node');
      n.style.minWidth = '400px';
      const over = box.scrollWidth - box.clientWidth;
      n.style.minWidth = '';
      return over;
    });
    say('CONTROL: the sideways instrument reads a too-wide node as overflow', wide > 0, 'overflow ' + wide + 'px');
    const pageOver = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    say('the open map does not widen the page', pageOver <= 0, 'overflow ' + pageOver + 'px');
    // Height: with ten members the map is taller than its cap, so it scrolls inside its own box.
    say('CONTROL: ten members make the map taller than its box (so the cap is reached)', opened.tall > 0, 'map overflow ' + opened.tall + 'px');
    say('CONTROL: the first agent row is in view before the map opens', before.firstRow === true, JSON.stringify(before.firstRow));
    say('with the map open the first agent row is still in view', opened.firstRow === true, JSON.stringify(opened.firstRow));
    say('with the map open the page does not scroll down', opened.pageDown <= 0, 'page ' + opened.pageDown + 'px');
    const uncapped = () => p.evaluate(() => {
      const box = document.getElementById('alist-teammap');
      box.style.maxHeight = 'none';
      const r0 = document.querySelector('#alist .lrow');
      const r = r0 ? r0.getBoundingClientRect() : null;
      const out = { pageDown: Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight,
          document.body.scrollHeight - document.body.clientHeight), firstRow: r ? (r.top >= 0 && r.bottom <= window.innerHeight) : null };
      box.style.maxHeight = '';
      return out;
    });
    // CONTROL for the arm above: without the cap the same instrument must see the row leave, or it cannot see a push.
    const uncapTall = await uncapped();
    say('CONTROL: at 1280x900, with the cap removed, the first agent row leaves the view', uncapTall.firstRow === false, JSON.stringify(uncapTall));
    say('CONTROL: at 1280x900, with the cap removed, the page scrolls down', uncapTall.pageDown > 0, JSON.stringify(uncapTall));
    // The narrowest, shortest window the consolidated layout keeps: 960x720. Below 1280 the agents column folds by
    // default (CONSOLIDATED_FOLD_WIDTH), and the map goes with it; a person who unfolds it gets the rail at its floor.
    await p.setViewportSize({ width: 960, height: 720 });
    await p.waitForFunction(() => window.innerWidth === 960 && window.innerHeight === 720 && document.body.classList.contains('fold-a'), null, { timeout: 5000 }).catch(() => {});
    const auto = await state();
    say('at 960 wide the agents column folds by default and the map goes with it', auto.cons && auto.btn === false && auto.shown === false, JSON.stringify(auto));
    if (await p.evaluate(() => document.body.classList.contains('fold-a'))) await p.click('#rail-agents-fold');
    await p.waitForFunction(() => !document.body.classList.contains('fold-a') && !document.getElementById('alist-teammap').hidden
      && document.getElementById('alist-teammap').getClientRects().length > 0, null, { timeout: 5000 }).catch(() => {});
    const short = await state();
    say('CONTROL: at 960x720, unfolded, the layout is still consolidated with the map open', short.cons && short.shown, JSON.stringify(short));
    say('at 960x720 the map fits the rail sideways', short.over !== null && short.over <= 0, 'overflow ' + short.over + 'px');
    say('CONTROL: at 960x720 the map is still taller than its box (so the cap is reached)', short.tall > 0, 'map overflow ' + short.tall + 'px');
    say('at 960x720 the first agent row is still in view', short.firstRow === true, JSON.stringify(short.firstRow));
    say('at 960x720 the page does not scroll down', short.pageDown <= 0, 'page ' + short.pageDown + 'px');
    // CONTROL for the two arms above: without the cap the same instruments must go red, or they cannot see a push.
    const uncapShort = await uncapped();
    say('CONTROL: at 960x720, with the cap removed, the first agent row leaves the view', uncapShort.firstRow === false, JSON.stringify(uncapShort));
    say('CONTROL: at 960x720, with the cap removed, the page scrolls down', uncapShort.pageDown > 0, JSON.stringify(uncapShort));
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.waitForFunction(() => window.innerWidth === 1280 && !document.body.classList.contains('fold-a') && !document.getElementById('alist-teammap').hidden, null, { timeout: 5000 }).catch(() => {});

    // Focus survives a repaint that replaces the map's buttons (a member's word changing between polls).
    const kept = await p.evaluate((pid) => {
      const node = document.querySelector('#alist-teammap .pjtm-node[data-agent="rmcy"]');
      node.focus();
      const pj = PROJECTS.find((x) => x.id === pid);
      const m = pj.agents.find((a) => a.sessionName === 'rmcy');
      const was = m.name;
      m.name = 'Cy renamed';
      paintRailPjNotice();
      const now = document.querySelector('#alist-teammap .pjtm-node[data-agent="rmcy"]');
      const a = document.activeElement;
      const r = { replaced: !!now && now !== node && !node.isConnected, on: a && a.dataset ? a.dataset.agent || a.id : null };
      m.name = was;
      paintRailPjNotice();
      return r;
    }, made.id);
    say('CONTROL: the repaint really replaced the focused button', kept.replaced, JSON.stringify(kept));
    say('focus comes back to the same member after a repaint', kept.on === 'rmcy', JSON.stringify(kept));
    // A repaint keeps the map's own scroll position (a person scrolled down a big team stays where they were).
    const scrolled = await p.evaluate((pid) => {
      const box = document.getElementById('alist-teammap');
      box.scrollTop = box.scrollHeight;
      const at = box.scrollTop;
      const node = box.querySelector('.pjtm-node[data-agent="rmada"]');
      const m = PROJECTS.find((x) => x.id === pid).agents.find((a) => a.sessionName === 'rmada');
      const was = m.name;
      m.name = 'Ada renamed';
      paintRailPjNotice();
      const r = { at, now: box.scrollTop, replaced: !node.isConnected };
      // The same repaint WITHOUT the restore: write the changed markup straight into the box.
      box.scrollTop = box.scrollHeight;
      r.at2 = box.scrollTop;
      m.name = 'Ada renamed again';
      setIfChanged(box, pjTeamMap(PROJECTS.find((x) => x.id === pid), LAST, pjRedHere));
      r.bare = box.scrollTop;
      m.name = was;
      paintRailPjNotice();
      box.scrollTop = 0;
      return r;
    }, made.id);
    say('CONTROL: the map was scrolled down and the repaint replaced its buttons', scrolled.at > 0 && scrolled.replaced, JSON.stringify(scrolled));
    say('a repaint keeps the map scrolled where it was', Math.abs(scrolled.now - scrolled.at) <= 1, JSON.stringify(scrolled));
    say('CONTROL: the same repaint without the restore loses the position', scrolled.bare < scrolled.at2 - 1, JSON.stringify(scrolled));
    // A focused member leaving the project: its button is gone, so focus goes to the Team map button, not the page.
    const left = await p.evaluate((pid) => {
      document.querySelector('#alist-teammap .pjtm-node[data-agent="rmjo"]').focus();
      const pj = PROJECTS.find((x) => x.id === pid);
      const saved = pj.agents;
      pj.agents = saved.filter((a) => a.sessionName !== 'rmjo');
      paintRailPjNotice();
      const a = document.activeElement;
      const r = { gone: !document.querySelector('#alist-teammap .pjtm-node[data-agent="rmjo"]'), on: a ? a.id || (a.dataset && a.dataset.agent) || a.tagName : null };
      pj.agents = saved;
      paintRailPjNotice();
      return r;
    }, made.id);
    say('CONTROL: the member really left the map', left.gone, JSON.stringify(left));
    say('a focused member that leaves hands focus to the Team map button', left.on === 'alist-teammap-btn', JSON.stringify(left));

    // Folding the agents column hides the map with the rest of the head, and unfolding brings it back.
    await p.click('#rail-agents-fold');
    await p.waitForFunction(() => document.body.classList.contains('fold-a'), null, { timeout: 5000 }).catch(() => {});
    const folded = await state();
    say('folding the agents column hides the button and the map', folded.btn === false && folded.shown === false, JSON.stringify(folded));
    await p.click('#rail-agents-fold');
    await p.waitForFunction(() => !document.body.classList.contains('fold-a'), null, { timeout: 5000 }).catch(() => {});
    const unfolded = await state();
    say('unfolding brings the open map back', unfolded.btn && unfolded.shown, JSON.stringify(unfolded));

    // The open state is one per project, shared with the tab layout: switch layouts with the map open.
    // No loadProjects() here: the switch's own repaint must show it.
    await p.evaluate(() => applyLayout('tabs', true));
    await p.waitForFunction(() => { const box = document.getElementById('pj-teammap'); return !document.body.classList.contains('consolidated')
      && box && !box.hidden && box.getClientRects().length > 0; }, null, { timeout: 8000 }).catch(() => {});
    const carried = await p.evaluate(() => {
      const btn = document.getElementById('pj-teammap-btn');
      const box = document.getElementById('pj-teammap');
      return { cons: document.body.classList.contains('consolidated'), expanded: btn && btn.getAttribute('aria-expanded'),
        shown: !!box && !box.hidden && box.getClientRects().length > 0 };
    });
    await p.evaluate(() => applyLayout('consolidated', true));
    say('the map opened in the rail is open in the tab layout too', carried.cons === false && carried.shown && carried.expanded === 'true', JSON.stringify(carried));
    await p.waitForFunction(() => document.body.classList.contains('consolidated') && !document.getElementById('alist-teammap').hidden, null, { timeout: 5000 }).catch(() => {});

    await p.click('#alist-teammap-btn');
    await p.waitForFunction(() => document.getElementById('alist-teammap').hidden, null, { timeout: 5000 }).catch(() => {});
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
