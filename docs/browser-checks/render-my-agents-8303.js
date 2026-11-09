'use strict';
// Browser-check-surface: my-agents paintMyAgents myagents detailBackPaint has-myagents
/* kosmos#8303 (Josh, 11-09): My Agents, a collapsible list of every agent down the left of the agent page.
 * Drives the real page with a fixed board and no server.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-my-agents-8303.js [outdir]
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const OUT = process.argv[2] || null;

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const setup = (layout) => {
  const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
  document.documentElement.setAttribute('data-layout', layout);
  try { localStorage.removeItem('my-agents-fold'); } catch { /* fine */ }
  const a = (s, n, r, x) => ({ sessionName: s, name: n, role: r, running: false, state: 'stopped', context: null, ...x });
  LAST = [a('dario', 'Dario', 'Project Manager', { dmUnread: 2 }), a('mark', 'Mark', 'Project Manager'), a('jen', 'Jennika', 'Kids worker'), a('guide', 'Guide', '', { isGuide: true })];
  AGENT_STARS = new Set(['mark']);
  CURRENT = LAST[2]; DETAIL_FROM_PROJECT = null; detailBackPaint();
};
const read = () => {
  const box = document.getElementById('my-agents');
  const back = document.getElementById('detail-back');
  return {
    hidden: box.hidden,
    title: (box.querySelector('.railname') || {}).textContent,
    names: [...box.querySelectorAll('.lrow .namego')].map((b) => b.textContent),
    groups: box.querySelectorAll('.alist-grouphdr').length,
    current: [...box.querySelectorAll('.lrow[aria-current="page"]')].map((r) => r.dataset.agent),
    roles: [...box.querySelectorAll('.lrow .ltitle')].map((r) => r.textContent),
    badge: (box.querySelector('.lrow[data-agent="dario"] .dmbadge') || {}).textContent,
    state: box.querySelectorAll('.lrow .lstate').length ? getComputedStyle(box.querySelector('.lrow .lstate')).display : null,
    back: getComputedStyle(back).display,
    backText: back.textContent,
    pageLeft: Math.round(document.getElementById('panel-detail').getBoundingClientRect().left),
    boxRight: Math.round(box.getBoundingClientRect().right),
  };
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const layout of ['tabs', 'consolidated']) {
    for (const theme of ['light', 'dark']) {
      const t = '[' + layout + ' ' + theme + ']';
      const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, colorScheme: theme });
      page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
      await page.addInitScript(() => { window.setInterval = () => 0; });
      await page.goto(PAGE);

      const off = await page.evaluate(([l, fn]) => { (0, eval)('(' + fn + ')')(l); showTab('agents'); return document.getElementById('my-agents').hidden; }, [layout, setup.toString()]);
      ok(t + ' CONTROL: it is not on the board page', off === true);

      const on = await page.evaluate(([fn]) => { showTab('detail'); return (0, eval)('(' + fn + ')')(); }, [read.toString()]);
      ok(t + ' it shows on the agent page, titled My Agents', on.hidden === false && on.title === 'My Agents', JSON.stringify(on));
      ok(t + ' every agent in one list, starred first, the guide left out', JSON.stringify(on.names) === JSON.stringify(['Mark', 'Dario', 'Jennika']) && on.groups === 0, JSON.stringify(on.names));
      ok(t + ' the open agent is marked', JSON.stringify(on.current) === JSON.stringify(['jen']), JSON.stringify(on.current));
      ok(t + ' each row has its role and its unread count, and no state column', on.roles[0] === 'Project Manager' && on.badge === '2' && on.state === 'none', JSON.stringify(on));
      ok(t + ' no "All agents" link beside it', /All agents/.test(on.backText) && on.back === 'none', JSON.stringify(on));
      ok(t + ' the page moved over and does not sit under it', on.pageLeft >= on.boxRight, on.pageLeft + ' vs ' + on.boxRight);

      const fromProject = await page.evaluate(([fn]) => {
        PROJECTS = [{ id: 'k', name: 'Kosmos', agents: [], archived: false }];
        DETAIL_FROM_PROJECT = 'k'; detailBackPaint(); paintMyAgents();
        const r = (0, eval)('(' + fn + ')')();
        DETAIL_FROM_PROJECT = null; detailBackPaint(); paintMyAgents();
        return r;
      }, [read.toString()]);
      ok(t + ' an agent opened from a project keeps the link naming it', /Kosmos/.test(fromProject.backText) && fromProject.back !== 'none', JSON.stringify(fromProject));

      if (OUT && layout === 'tabs') await page.screenshot({ path: path.join(OUT, 'my-agents-' + theme + '.png') });

      const clicked = await page.evaluate(() => {
        const opened = [];
        const real = openDetail;
        openDetail = (s) => opened.push(s);
        document.querySelector('#my-agents .lrow[data-agent="dario"]').click();
        openDetail = real;
        return opened;
      });
      ok(t + ' a row opens that agent', JSON.stringify(clicked) === JSON.stringify(['dario']), JSON.stringify(clicked));

      const plus = await page.evaluate(() => {
        let n = 0;
        const real = document.getElementById('new-agent');
        const fn = () => { n += 1; };
        real.addEventListener('click', fn, { capture: true, once: true });
        real.addEventListener('click', (e) => e.stopImmediatePropagation(), { capture: true, once: true });
        document.getElementById('my-agents-new').click();
        return n;
      });
      ok(t + ' + starts New agent', plus === 1, String(plus));

      const fold = await page.evaluate(() => {
        const b = document.getElementById('my-agents-fold');
        const box = document.getElementById('my-agents');
        const wide = box.getBoundingClientRect().width;
        b.click();
        const narrow = box.getBoundingClientRect().width;
        const expanded = b.getAttribute('aria-expanded');
        const nameShown = getComputedStyle(box.querySelector('.lrow .lname')).display;
        const left = document.getElementById('panel-detail').getBoundingClientRect().left;
        const saved = localStorage.getItem('my-agents-fold');
        b.click();
        return { wide, narrow, expanded, nameShown, left, saved, again: box.getBoundingClientRect().width };
      });
      ok(t + ' it folds to its avatars and says so, and the page takes the room', fold.narrow < 80 && fold.wide > 200 && fold.expanded === 'false' && fold.nameShown === 'none' && fold.left < 100 && fold.saved === '1', JSON.stringify(fold));
      ok(t + ' it opens again', fold.again === fold.wide, JSON.stringify(fold));

      const repaint = await page.evaluate(() => {
        const list = document.getElementById('my-agents-list');
        const row = list.firstElementChild;
        paintMyAgents();
        const same = list.firstElementChild === row;
        AGENT_STARS = new Set(['dario']);
        paintMyAgents();
        return { same, first: list.querySelector('.lrow').dataset.agent };
      });
      ok(t + ' a poll that changes nothing does not rebuild the list', repaint.same === true, JSON.stringify(repaint));
      ok(t + ' CONTROL: a changed star does', repaint.first === 'dario', JSON.stringify(repaint));

      const left = await page.evaluate(() => { showTab('agents'); return { hidden: document.getElementById('my-agents').hidden, cls: document.body.classList.contains('has-myagents') }; });
      ok(t + ' leaving the agent page removes it', left.hidden === true && left.cls === false, JSON.stringify(left));
      await page.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', (e) => problems.push('[narrow] pageerror: ' + e.message));
  await page.addInitScript(() => { window.setInterval = () => 0; });
  await page.goto(PAGE);
  const narrow = await page.evaluate(([s, r]) => { (0, eval)('(' + s + ')')('tabs'); showTab('detail'); return (0, eval)('(' + r + ')')(); }, [setup.toString(), read.toString()]);
  ok('[narrow] below the floor there is no column, and the link stays', narrow.hidden === true && narrow.back !== 'none' && narrow.pageLeft < 100, JSON.stringify(narrow));
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.waitForTimeout(200);
  const widened = await page.evaluate(() => document.getElementById('my-agents').hidden);
  ok('[narrow] widening the window brings it', widened === false);
  await page.close();
  await browser.close();

  if (problems.length) {
    for (const p of problems) console.error('  FAIL  ' + p);
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
