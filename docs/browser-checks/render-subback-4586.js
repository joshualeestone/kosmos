'use strict';
// Browser-check-surface: docs-chev tsk-back tsk-crumb tsk-crumb-open sub-back pj-docs-view tsk-title tsk-new docs-back
// (#2518) the distinctive web/index.html tokens this check asserts: the round back chevron #4586 puts
// beside the title of a project's Documents (#docs-chev) and Tasks (#tsk-back) views, the titles it
// sits against, and #docs-back, which stays hidden in the consolidated view (#3502).
/* #4586 (Josh, 2026-09-29 11:35): "When I'm in either Documents or Tasks for a project, let's put a
 * back chevron back in ... click the back button at the top left next to the title and go right back
 * into the project."
 *
 * 🔑 WHAT ONLY A BROWSER CAN SAY: that the chevron is painted, sits to the LEFT of the title on the
 * title's own line (not across the row, where a space-between head would throw it), that "+ New task"
 * stays at the far right, and that a real click lands in the project's room. Each arm has a control:
 * Documents in the TAB view shows no chevron (it keeps its "<- name" back), and the Tasks view for no
 * project shows none.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-subback-4586.js
 *      (HEADED=0 on a machine with no console session)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const fp = path.join(WEB_DIR, p);
  if (fp.startsWith(WEB_DIR) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(fp).pipe(res);
  } else { res.writeHead(404); res.end('nf'); }
});

let failures = 0, ran = 0;
const say = (n, cond, note) => { ran++; if (cond) console.log('PASS  ' + n); else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); } };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const agents = [{ sessionName: 'a1', name: 'Agent One', status: 'idle' }];
  const project = { id: 'p1', name: 'Five Families', agents: [{ sessionName: 'a1', name: 'Agent One' }] };
  const now = Date.now();
  const tasks = [{ projectId: 'p1', projectName: 'Five Families', number: 1, title: 'Draft the ranking', state: 'open', createdAt: new Date(now - 3600e3).toISOString(), updatedAt: new Date(now - 60e3).toISOString() }];
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });

  async function boot(layout, width) {
    const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/**', async (route) => {
      const pth = new URL(route.request().url()).pathname; let body = {};
      if (pth === '/api/style') body = { layout, tokens: {}, theme: 'light', themes: [{ key: 'light', label: 'Light' }] };
      else if (pth === '/api/status') body = { agents };
      else if (pth === '/api/projects') body = { projects: [project] };
      else if (pth === '/api/tasks') body = { tasks, count: tasks.length };
      else if (pth === '/api/project-docs' || pth.startsWith('/api/projects/')) body = { files: [], attachments: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${BASE}/index.html?project=p1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('[inert]').forEach((e) => e.removeAttribute('inert'));
    });
    return { ctx, page, errs };
  }
  const geom = (page, chevId, titleSel, extraSel) => page.evaluate(([c, t, x]) => {
    const chev = document.getElementById(c);
    const title = document.querySelector(t);
    if (!chev || !title) return { missing: !chev ? c : t };
    const cs = getComputedStyle(chev);
    const cr = chev.getBoundingClientRect(), tr = title.getBoundingClientRect();
    const xr = x ? document.querySelector(x).getBoundingClientRect() : null;
    return {
      display: cs.display, radius: cs.borderTopLeftRadius, w: Math.round(cr.width), h: Math.round(cr.height),
      gap: Math.round(tr.left - cr.right), overlapY: Math.round(Math.min(cr.bottom, tr.bottom) - Math.max(cr.top, tr.top)),
      label: chev.getAttribute('aria-label'), extraRightOfTitle: xr ? Math.round(xr.left - tr.right) : null,
    };
  }, [chevId, titleSel, extraSel || null]);
  /* The Documents door's own handler (#pj-docs-all's click is `openDocsView()`, which also names the
     chevron). The door itself is painted only once the stub board lists files, so the handler is called;
     it is the same function, not a shortcut around it (pjView('docs') alone would skip the naming). */
  const openDocs = async (page) => {
    const how = await page.evaluate(async () => {
      if (typeof openDocsView !== 'function') return 'openDocsView is missing';
      await openDocsView();
      return 'handler';
    });
    await page.waitForTimeout(500);
    return how;
  };
  const inRoom = (page) => page.evaluate(() => ({ view: typeof PJ_VIEW === 'undefined' ? null : PJ_VIEW, oneShown: !document.getElementById('pj-one-view').hidden, docsShown: !document.getElementById('pj-docs-view').hidden, tasksShown: !document.getElementById('panel-tasks').hidden }));

  // ---- consolidated: Documents ----
  const c = await boot('consolidated');
  const doorC = await openDocs(c.page);
  say('#4586 consolidated: Documents opened through the door\'s handler', doorC === 'handler', doorC);
  const d = await geom(c.page, 'docs-chev', '#pj-docs-view .dname');
  say('#4586 consolidated Documents: the chevron is painted, round', d.display !== 'none' && d.w >= 28 && d.radius === '50%', JSON.stringify(d));
  say('#4586 consolidated Documents: it sits LEFT of "Documents", beside it (0-24px), on the title\'s line', d.gap >= 0 && d.gap <= 24 && d.overlapY > 10, JSON.stringify(d));
  say('#4586 consolidated Documents: it is named for the project', d.label === 'Back to Five Families', JSON.stringify(d));
  const oldBack = await c.page.evaluate(() => getComputedStyle(document.getElementById('docs-back')).display);
  say('#3502 still holds: the "<- name" back stays hidden in the consolidated view (one way back, not two)', oldBack === 'none', oldBack);
  await c.page.focus('#docs-chev');
  await c.page.keyboard.press('Enter');
  await c.page.waitForTimeout(400);
  const afterDocs = await inRoom(c.page);
  say('#4586 consolidated Documents: pressing it (keyboard) returns to the project room', afterDocs.view === 'one' && afterDocs.oneShown && !afterDocs.docsShown, JSON.stringify(afterDocs));

  // ---- consolidated: Tasks for a project ----
  await c.page.evaluate(() => openProjectTasks('p1'));
  await c.page.waitForTimeout(800);
  const t = await geom(c.page, 'tsk-back', '#tsk-title', '#tsk-new');
  say('#4586 Tasks for a project: the chevron is painted, round', t.display !== 'none' && t.w >= 28 && t.radius === '50%', JSON.stringify(t));
  say('#4586 Tasks for a project: it sits LEFT of the title, beside it (0-24px), on the title\'s line', t.gap >= 0 && t.gap <= 24 && t.overlapY > 10, JSON.stringify(t));
  say('#4586 Tasks for a project: "+ New task" stays at the far right (well clear of the title)', t.extraRightOfTitle > 100, JSON.stringify(t));
  say('#4586 Tasks for a project: it is named for the project', t.label === 'Back to Five Families', JSON.stringify(t));
  /* A repaint nobody pressed for (a load finishing) must leave focus ON the chevron. It carries
     data-open-project like the crumb's Open project, which sits earlier in the panel, so a restore
     keyed on the attribute alone moves focus to the crumb. */
  const keep = await c.page.evaluate(() => {
    const b = document.getElementById('tsk-back'); b.focus();
    const before = document.activeElement === b;
    tskPaintKeepingCurrentFocus();
    const a = document.activeElement;
    return { before, after: a === b, now: a ? (a.id || a.textContent.trim()) : null };
  });
  say('#4586 Tasks for a project: a background repaint keeps keyboard focus on the chevron', keep.before && keep.after, JSON.stringify(keep));
  await c.page.click('#tsk-back');
  await c.page.waitForTimeout(800);
  const afterTasks = await inRoom(c.page);
  say('#4586 Tasks for a project: clicking it returns to the project room', afterTasks.oneShown && afterTasks.view === 'one', JSON.stringify(afterTasks));
  // CONTROL: the Tasks view for no project has nowhere to go back to, so no chevron.
  await c.page.evaluate(() => openProjectTasks(null));
  await c.page.waitForTimeout(800);
  const none = await c.page.evaluate(() => { const b = document.getElementById('tsk-back'); return { hidden: b.hidden, display: getComputedStyle(b).display }; });
  say('#4586 CONTROL: the Tasks view for all projects shows no chevron', none.hidden === true && none.display === 'none', JSON.stringify(none));
  say('no page errors (consolidated)', c.errs.length === 0, c.errs.join(' | '));
  await c.ctx.close();

  /* #5053 (Mona Lisa's design call): at phone width "+ New task" always sits on its own row below the title,
     left-aligned with the title's text, and the chevron top-aligns with the title's first line. */
  const phoneHead = (page) => page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const t = r('tsk-title'), n = r('tsk-new'), h = document.querySelector('#panel-tasks .tsk-head').getBoundingClientRect();
    const b = document.getElementById('tsk-back'); const shown = !b.hidden && getComputedStyle(b).display !== 'none';
    const c = shown ? b.getBoundingClientRect() : null;
    return { newBelow: n.top >= t.bottom - 1, newLeftAtTitle: Math.abs(n.left - t.left) <= 2, chevShown: shown,
      chevTopAtTitle: c ? Math.abs(c.top - t.top) <= 4 : null, titleIndent: Math.round(t.left - h.left),
      t: [Math.round(t.left), Math.round(t.top), Math.round(t.bottom)], n: [Math.round(n.left), Math.round(n.top)], c: c ? [Math.round(c.left), Math.round(c.top)] : null };
  });

  // ---- #5053: a LONG project name at phone widths. The fixture's own name left only 29px of room at 390 on a Mac
  // (and overflowed by 3px on Linux), so the head row wrapped and left the chevron alone on its line. A name that
  // cannot fit must make the TITLE wrap inside its own box, never separate the chevron from it. ----
  {
    const LONG = 'Five Families Holdings';
    const was = [project.name, tasks.map((t) => t.projectName)];
    project.name = LONG; tasks.forEach((t) => { t.projectName = LONG; });
    try {
      /* 700: above the phone breakpoint the head is a row again, and a name too long for it wraps in the title's own
         box (this one is long enough to wrap at 700: the arm asserts it did). */
      {
        const LONGER = 'Five Families Holdings and Partners International Group';
        project.name = LONGER; tasks.forEach((t) => { t.projectName = LONGER; });
        const tv = await boot('tabs', 700);
        await tv.page.evaluate(() => openProjectTasks('p1'));
        await tv.page.waitForTimeout(800);
        const d = await tv.page.evaluate(() => { const t = document.getElementById('tsk-title'), r = t.getBoundingClientRect(), c = document.getElementById('tsk-back').getBoundingClientRect(), n = document.getElementById('tsk-new').getBoundingClientRect();
          return { h: Math.round(r.height), lh: parseFloat(getComputedStyle(t).lineHeight), gap: Math.round(r.left - c.right), newRight: n.left >= r.right, inView: n.right <= innerWidth + 1,
            chevTopAtTitle: Math.abs(c.top - r.top) <= 4, c: Math.round(c.top), t: Math.round(r.top) }; });
        say('#5053 long name at 700: the title really wraps (the arm tests something)', d.h > 36, JSON.stringify(d));
        say('#5053 long name at 700: the chevron, the title and "+ New task" share the row; wrapped lines do not touch', d.gap >= 0 && d.gap <= 24 && d.newRight && d.inView && d.lh >= 27.6, JSON.stringify(d));
        say('#5053 long name at 700: the chevron\'s top is at the title\'s first line', d.chevTopAtTitle, JSON.stringify(d));
        await tv.ctx.close();
        project.name = LONG; tasks.forEach((t) => { t.projectName = LONG; });
      }
      for (const width of [390, 360]) {
        const tv = await boot('tabs', width);
        await tv.page.evaluate(() => openProjectTasks('p1'));
        await tv.page.waitForTimeout(800);
        const g = await geom(tv.page, 'tsk-back', '#tsk-title', '#tsk-new');
        const t = await tv.page.evaluate(() => { const r = document.getElementById('tsk-title').getBoundingClientRect(), c = document.getElementById('tsk-back').getBoundingClientRect();
          return { text: document.getElementById('tsk-title').textContent, right: Math.round(r.right), inner: innerWidth, h: Math.round(r.height), chevTop: Math.round(c.top), titleTop: Math.round(r.top) }; });
        say(`#5053 long name at ${width}: the title is long enough to need the room (the arm tests something)`, t.text.includes(LONG) && t.h > 36, JSON.stringify(t));
        const lh = await tv.page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('tsk-title')).lineHeight));
        say(`#5053 long name at ${width}: the wrapped title's lines do not touch (line-height at least 1.15 x its 24px)`, lh >= 27.6, String(lh));
        say(`#5053 long name at ${width}: the chevron stays beside the title, on its first line`, g.display !== 'none' && g.gap >= 0 && g.gap <= 24 && g.overlapY > 10 && Math.abs(t.chevTop - t.titleTop) < 24, JSON.stringify({ g, t }));
        say(`#5053 long name at ${width}: the title stays on screen`, t.right <= t.inner, JSON.stringify(t));
        /* #5072: when the crumb wraps, its ' · ' must go to the next line WITH Open project, never dangle at the end of
           the line above. The dot is found as a character, wherever it sits, so one assert reads both the old markup
           (expected to fail) and the new. The arm only counts when the name ends on All tasks' line and Open project
           wraps alone: that is the one shape where the old markup strands the dot. */
        const cr = await tv.page.evaluate(() => {
          const box = document.getElementById('tsk-crumb'), first = box.querySelector('[data-proj=""]').getBoundingClientRect(), open = box.querySelector('[data-open-project]').getBoundingClientRect();
          const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let n, dot = null;
          while ((n = w.nextNode())) { const i = n.data.indexOf('\u00b7'); if (i >= 0) { const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + 1); dot = rg.getBoundingClientRect(); break; } }
          const mid = (r) => (r.top + r.bottom) / 2;
          // The name's last letter: the text right after All tasks, less any trailing spaces and dot.
          const nameNode = box.querySelector('[data-proj=""]').nextSibling, s = nameNode && nameNode.nodeType === 3 ? nameNode.data : '';
          const end = s.replace(/[\s\u00b7]+$/, '').length;
          let last = null; if (end > 0) { const rg = document.createRange(); rg.setStart(nameNode, end - 1); rg.setEnd(nameNode, end); last = rg.getBoundingClientRect(); }
          return { wrapped: open.top >= first.bottom - 1 && !!last && Math.abs(mid(last) - mid(first)) < 8, dotFound: !!dot, dotWithOpen: dot ? Math.abs(mid(dot) - mid(open)) < 8 : false,
            dot: dot ? [Math.round(dot.left), Math.round(mid(dot))] : null, last: last ? [Math.round(last.left), Math.round(mid(last))] : null, open: [Math.round(open.left), Math.round(mid(open))], first: [Math.round(first.left), Math.round(mid(first))] };
        });
        say(`#5072 long name at ${width}: the name ends on All tasks' line and Open project wraps alone (the arm tests something)`, cr.wrapped, JSON.stringify(cr));
        say(`#5072 long name at ${width}: the crumb's dot is on Open project's line, not dangling above it`, cr.dotFound && cr.dotWithOpen, JSON.stringify(cr));
        const nb = await tv.page.evaluate(() => {
          const n = document.getElementById('tsk-new').getBoundingClientRect(), tr = document.getElementById('tsk-title').getBoundingClientRect();
          return { rightOfTitle: n.left >= tr.right, below: n.top >= tr.bottom - 2, inView: n.right <= window.innerWidth + 1 };
        });
        say(`#5053 long name at ${width}: "+ New task" is right of the title or below it, and on screen`, (nb.rightOfTitle || nb.below) && nb.inView, JSON.stringify(nb));
        const ph = await phoneHead(tv.page);
        say(`#5053 long name at ${width}: "+ New task" is on its own row below the title, left-aligned with the title's text`, ph.newBelow && ph.newLeftAtTitle, JSON.stringify(ph));
        say(`#5053 long name at ${width}: the chevron's top is at the title's first line`, ph.chevShown && ph.chevTopAtTitle, JSON.stringify(ph));
        if (width === 390) {
          /* CONTROL: all projects, so no chevron; the title must not be indented by the chevron's empty column. */
          await tv.page.evaluate(() => openProjectTasks(null));
          await tv.page.waitForTimeout(600);
          const pa = await phoneHead(tv.page);
          say('#5053 CONTROL at 390: the all-projects head shows no chevron, its title is not indented, "+ New task" below it',
            !pa.chevShown && pa.titleIndent <= 1 && pa.newBelow && pa.newLeftAtTitle, JSON.stringify(pa));
        }
        say(`no page errors (#5053 long name at ${width})`, tv.errs.length === 0, tv.errs.join(' | '));
        await tv.ctx.close();
      }
    } finally {
      project.name = was[0]; tasks.forEach((t, i) => { t.projectName = was[1][i]; });
    }
  }

  // ---- tab view: Tasks for a project, at a desktop and a phone width ----
  for (const width of [1280, 390]) {
    const tv = await boot('tabs', width);
    await tv.page.evaluate(() => openProjectTasks('p1'));
    await tv.page.waitForTimeout(800);
    const g = await geom(tv.page, 'tsk-back', '#tsk-title', '#tsk-new');
    say(`#4586 tab view ${width}: the Tasks chevron is painted beside the title, on its line`, g.display !== 'none' && g.w >= 28 && g.gap >= 0 && g.gap <= 24 && g.overlapY > 10, JSON.stringify(g));
    /* "+ New task" must never land LEFT of the title's end on the title's line, i.e. between the chevron and the
       title. The exact rule per width (#5053: below at phone width, on the title's row on desktop) is asserted below. */
    const nb = await tv.page.evaluate(() => {
      const n = document.getElementById('tsk-new').getBoundingClientRect(), t = document.getElementById('tsk-title').getBoundingClientRect();
      return { sameLine: Math.min(n.bottom, t.bottom) - Math.max(n.top, t.top) > 4, rightOfTitle: n.left >= t.right, below: n.top >= t.bottom - 2, inView: n.right <= window.innerWidth + 1 };
    });
    say(`#4586 tab view ${width}: "+ New task" is right of the title or wrapped below it, and on screen`, ((nb.sameLine && nb.rightOfTitle) || nb.below) && nb.inView, JSON.stringify(nb));
    if (width === 390) {
      /* #5053: below ALWAYS at phone width, the short name included, so it stays in one place. */
      const ph = await phoneHead(tv.page);
      say('#5053 tab view 390, short name: "+ New task" below the title, left-aligned with it; the chevron at the title\'s first line', ph.newBelow && ph.newLeftAtTitle && ph.chevTopAtTitle, JSON.stringify(ph));
    } else {
      /* #5053: desktop is unchanged: "+ New task" stays on the title's row, right of it. */
      say('#5053 tab view 1280: "+ New task" stays on the title\'s row, right of it (desktop unchanged)', nb.sameLine && nb.rightOfTitle, JSON.stringify(nb));
      const hh = await tv.page.evaluate(() => Math.round(document.querySelector('#panel-tasks .tsk-head').getBoundingClientRect().height));
      say('#5053 tab view 1280: the head is still one button tall (the title\'s line-height did not grow it)', hh <= 36, String(hh));
    }
    await tv.page.click('#tsk-back');
    await tv.page.waitForTimeout(800);
    const r = await inRoom(tv.page);
    say(`#4586 tab view ${width}: clicking the chevron returns to the project room`, r.oneShown && r.view === 'one' && !r.tasksShown, JSON.stringify(r));
    say(`no page errors (tab view ${width})`, tv.errs.length === 0, tv.errs.join(' | '));
    await tv.ctx.close();
  }

  // ---- tab view: Documents keeps its own back, so no chevron ----
  const tb = await boot('tabs');
  const doorT = await openDocs(tb.page);
  say('#4586 tab view: Documents opened through the door\'s handler', doorT === 'handler', doorT);
  const td = await tb.page.evaluate(() => ({ chev: getComputedStyle(document.getElementById('docs-chev')).display, back: getComputedStyle(document.getElementById('docs-back')).display }));
  say('#4586 CONTROL: tab-view Documents shows its "<- name" back and no chevron (one way back)', td.chev === 'none' && td.back !== 'none', JSON.stringify(td));
  say('no page errors (tab view)', tb.errs.length === 0, tb.errs.join(' | '));
  await tb.ctx.close();

  await browser.close();
  server.close();
  console.log('\n' + (ran - failures) + ' passed, ' + failures + ' FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { server.close(); } catch { /* noop */ } process.exit(1); });
