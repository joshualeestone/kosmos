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
  try { localStorage.removeItem('kosmos.fold.myagents'); } catch { /* fine */ }
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
    current: [...box.querySelectorAll('.namego[aria-current="page"]')].map((b) => b.closest('.lrow').dataset.agent),
    roles: [...box.querySelectorAll('.lrow .ltitle')].map((r) => r.textContent),
    badge: (box.querySelector('.lrow[data-agent="dario"] .dmbadge') || {}).textContent,
    state: box.querySelectorAll('.lrow .lstate').length ? { display: getComputedStyle(box.querySelector('.lrow .lstate')).display, width: box.querySelector('.lrow .lstate').getBoundingClientRect().width, say: box.querySelector('.lrow .lstate').textContent.trim() } : null,
    back: getComputedStyle(back).visibility === 'hidden' ? 'none' : getComputedStyle(back).display,
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
      ok(t + ' each row has its role and its unread count, and its state only for a screen reader', on.roles[0] === 'Project Manager' && on.badge === '2' && on.state && on.state.display !== 'none' && on.state.width <= 1 && on.state.say.length > 0, JSON.stringify(on));
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
        const row = box.querySelector('.lrow'); const nameKept = getComputedStyle(row.querySelector('.lname')).display !== 'none' && getComputedStyle(row.querySelector('.lname')).width === '1px'; const rowTitle = row.title; row.querySelector('.namego').focus(); const nameFocus = document.activeElement === row.querySelector('.namego');
        const left = document.getElementById('panel-detail').getBoundingClientRect().left;
        const saved = localStorage.getItem('kosmos.fold.myagents');
        b.click();
        return { wide, narrow, expanded, nameKept, rowTitle, nameFocus, left, saved, again: box.getBoundingClientRect().width };
      });
      ok(t + ' it folds to its avatars and says so, and the page takes the room', fold.narrow < 80 && fold.wide > 200 && fold.expanded === 'false' && fold.left < 100 && fold.left >= fold.narrow && fold.saved === '1', JSON.stringify(fold));
      ok(t + ' it opens again', fold.again === fold.wide, JSON.stringify(fold));
      ok(t + ' folded, each agent still has its name for the keyboard and on hover', fold.nameKept === true && fold.nameFocus === true && fold.rowTitle === 'Mark', JSON.stringify(fold));

      const notices = await page.evaluate(() => {
        const askcard = document.getElementById('askcard'); const conn = document.getElementById('conn');
        askcard.hidden = false; askcard.textContent = 'A phone wants to connect'; conn.hidden = false; conn.textContent = 'Kosmos cannot reach a Claude subscription.';
        const right = document.getElementById('my-agents').getBoundingClientRect().right;
        const lefts = [askcard.getBoundingClientRect().left, conn.getBoundingClientRect().left];
        askcard.hidden = true; conn.hidden = true;
        return { right, lefts };
      });
      ok(t + ' the notices above the page are not under the column', notices.lefts.every((l) => l >= notices.right), JSON.stringify(notices));

      const keys = await page.evaluate(() => {
        const list = document.getElementById('my-agents-list');
        const star = list.querySelector('[data-star="jen"]');
        star.focus();
        AGENT_STARS = new Set(['jen']);
        repaintAgentOrder(false);
        const starKept = document.activeElement && document.activeElement.dataset.star === 'jen';
        AGENT_STARS = new Set(['mark']);
        repaintAgentOrder(false);
        list.querySelector('.lrow[data-agent="dario"] .namego').focus();
        LAST[0].role = 'Changed role';
        keepStarFocus(paintMyAgents);
        const nameKept = document.activeElement && document.activeElement.classList.contains('namego') && document.activeElement.closest('.lrow').dataset.agent === 'dario';
        LAST[0].role = 'Project Manager';
        keepStarFocus(paintMyAgents);
        const opened = [];
        const real = openDetail;
        openDetail = (s) => opened.push(s);
        list.querySelector('.lrow.current .namego').click();
        openDetail = real;
        return { starKept, nameKept, opened };
      });
      ok(t + ' a rebuild keeps a focused star on its agent', keys.starKept === true, JSON.stringify(keys));
      ok(t + ' a rebuild keeps a focused name on its agent', keys.nameKept === true, JSON.stringify(keys));
      ok(t + ' clicking the agent already open does not reload its page', keys.opened.length === 0, JSON.stringify(keys));

      const real = await page.evaluate(() => {
        openDetail('dario');
        const onDario = { current: document.querySelector('#my-agents-list .lrow.current')?.dataset.agent, toAll: document.getElementById('panel-detail').hasAttribute('data-to-all') };
        PROJECTS = [{ id: 'k', name: 'Kosmos', agents: [], archived: false }];
        openDetail('mark', undefined, 'k');
        const fromProject = { current: document.querySelector('#my-agents-list .lrow.current')?.dataset.agent, toAll: document.getElementById('panel-detail').hasAttribute('data-to-all') };
        openDetail('jen');
        return { onDario, fromProject };
      });
      ok(t + ' opening an agent for real moves the mark to it', real.onDario.current === 'dario' && real.onDario.toAll === true, JSON.stringify(real));
      ok(t + ' opening one from a project for real keeps its link', real.fromProject.current === 'mark' && real.fromProject.toAll === false, JSON.stringify(real));

      const marks = await page.evaluate(() => {
        LAST[1].running = true; LAST[1].state = 'needs_you'; LAST[1].context = { percent: 10 };
        paintMyAgents();
        const row = document.querySelector('#my-agents-list .lrow[data-agent="mark"]');
        const lav = row.querySelector('.lav').getBoundingClientRect();
        const place = (sel) => { const el = row.querySelector(sel); if (!el || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left - lav.left), t: Math.round(r.top - lav.top), r: Math.round(lav.right - r.right), b: Math.round(lav.bottom - r.bottom), w: Math.round(r.width) }; };
        const out = { pres: place('.lpres'), warn: place('.lwarn'), lavW: Math.round(lav.width), lavH: Math.round(lav.height), rowH: Math.round(row.getBoundingClientRect().height) };
        LAST[1].running = false; LAST[1].state = 'stopped'; LAST[1].context = null;
        paintMyAgents();
        return out;
      });
      ok(t + ' the presence dot sits on the avatar\'s corner, not its face', marks.pres && marks.pres.w <= 16 && marks.pres.r <= 2 && marks.pres.b <= 2 && marks.pres.l >= 20, JSON.stringify(marks));
      ok(t + ' the warning mark is on the avatar, centred', marks.warn && marks.warn.w === 18 && Math.abs(marks.warn.l - marks.warn.r) <= 2 && marks.warn.t >= 0 && marks.warn.b >= 0, JSON.stringify(marks));
      ok(t + ' the marks do not push the avatar or the row out of shape', marks.lavW === 34 && marks.lavH === 34 && marks.rowH <= 70, JSON.stringify(marks));

      const typing = await page.evaluate(() => {
        const name = document.querySelector('#my-agents-list .lrow[data-agent="dario"] .namego');
        const real = openDetail; openDetail = () => {};
        name.focus();
        name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        const afterMouse = document.activeElement === name;
        name.focus();
        name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        const afterKey = document.activeElement === name;
        name.blur();
        openDetail = real;
        return { afterMouse, afterKey };
      });
      ok(t + ' a clicked name lets go of focus so typing reaches the conversation', typing.afterMouse === false, JSON.stringify(typing));
      ok(t + ' CONTROL: a keyboard press keeps it', typing.afterKey === true, JSON.stringify(typing));

      const switched = await page.evaluate(() => {
        PROJECTS = [{ id: 'k', name: 'Kosmos', agents: [], archived: false }];
        openDetail('mark', undefined, 'k');
        document.querySelector('#my-agents-list .lrow[data-agent="dario"]').click();
        const out = { open: CURRENT && CURRENT.sessionName, from: DETAIL_FROM_PROJECT, toAll: document.getElementById('panel-detail').hasAttribute('data-to-all') };
        openDetail('jen');
        return out;
      });
      ok(t + ' moving between agents keeps the way back to the project', switched.open === 'dario' && switched.from === 'k' && switched.toAll === false, JSON.stringify(switched));

      const answerable = await page.evaluate(() => {
        // A row with a question goes by the answer route: it too must not reopen the open agent, and must keep the project.
        const calls = [];
        const realOpen = openDetail; const realAns = pjAnswerFrom;
        pjAnswerFrom = (s) => { calls.push('answer:' + s); DETAIL_FROM_PROJECT = null; };
        openDetail = (s) => calls.push('open:' + s);
        DETAIL_FROM_PROJECT = 'k';
        const list = document.getElementById('my-agents-list');
        const cur = list.querySelector('.lrow.current'); cur.dataset.answer = cur.dataset.agent;
        cur.click();
        const onCurrent = calls.slice();
        delete cur.dataset.answer;
        const other = list.querySelector('.lrow[data-agent="dario"]'); other.dataset.answer = 'dario';
        other.click();
        const after = DETAIL_FROM_PROJECT;
        delete other.dataset.answer;
        pjAnswerFrom = realAns; openDetail = realOpen;
        DETAIL_FROM_PROJECT = null; detailBackPaint(); paintMyAgents();
        return { onCurrent, calls, after };
      });
      ok(t + ' the open agent, asking a question, is not reopened', answerable.onCurrent.length === 0, JSON.stringify(answerable));
      ok(t + ' answering another agent keeps the way back to the project', answerable.calls.join() === 'answer:dario' && answerable.after === 'k', JSON.stringify(answerable));

      const onlyGuide = await page.evaluate(([fn]) => {
        const keep = LAST;
        LAST = keep.filter((a) => a.isGuide);
        paintMyAgents();
        const r = (0, eval)('(' + fn + ')')();
        LAST = keep;
        paintMyAgents();
        return { guide: r, back: (0, eval)('(' + fn + ')')().hidden };
      }, [read.toString()]);
      ok(t + ' with nobody to list there is no column, and the link stays', onlyGuide.guide.hidden === true && onlyGuide.guide.back !== 'none' && onlyGuide.guide.pageLeft < 100, JSON.stringify(onlyGuide.guide));
      ok(t + ' CONTROL: it comes back with the agents', onlyGuide.back === false, JSON.stringify(onlyGuide.back));

      const wiring = await page.evaluate(() => tick.toString().includes('keepStarFocus(paintMyAgents)'));
      ok(t + ' every poll repaints the column', wiring === true);

      const row = await page.evaluate(() => { const b = document.getElementById('detail-back').getBoundingClientRect(); return { h: Math.round(b.height), focusable: (() => { const el = document.getElementById('detail-back'); el.focus(); const f = document.activeElement === el; el.blur(); return f; })() }; });
      ok(t + ' the link keeps its row, so the page does not move, and cannot be reached', row.h > 0 && row.focusable === false, JSON.stringify(row));

      const newLook = await page.evaluate(() => {
        document.documentElement.setAttribute('data-look', 'new');
        paintMyAgents();
        const shown = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display !== 'none' : null; };
        const out = { back: shown('#d-crumb-back'), lead: shown('#d-talk-box .d-crumb-rootwrap') };
        document.documentElement.removeAttribute('data-look');
        return out;
      });
      ok(t + ' the new look has no way back to All agents either', newLook.back === false && newLook.lead === false, JSON.stringify(newLook));

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
      const stale = await page.evaluate(() => document.querySelectorAll('#my-agents-list [data-agent]').length);
      ok(t + ' and leaves no copy of the rows behind', stale === 0, String(stale));
      await page.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
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
