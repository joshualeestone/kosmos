// Browser-check-surface: docs-seg docs-convo docs-list docseg docsSegShow DOCS_OPEN_GEN openDocsView docs-finder docs-msg docs-pager cons-agents-lay
'use strict';
/**
 * #4937 (Josh, 2026-10-01 20:56): on a project's Documents screen the conversation's files stacked
 * above the folder's and pushed them down a long page. Now one segmented control, "In the project
 * folder" | "From this conversation", shows one list at a time, the folder first.
 *
 * HERMETIC (file://, fetch stubbed, as render-docs-subfolders-2245). On chromium and webkit:
 *   - with conversation files: the control shows, the folder segment is chosen and its list is on
 *     screen while the conversation's is not; a click on "From this conversation" swaps them; an arrow
 *     key moves and chooses; opening the screen again starts on the folder;
 *   - with none: the control is in the page but hidden, and the folder's list shows (nothing to switch to);
 *   - Home and End choose the first and last segment; a failed Open in Finder shows its sentence on the
 *     folder's segment; a reopen while the first room read is out shows each conversation file once;
 *   - at 320px wide the switch fits on one row with no sideways scroll.
 * Controls: the stub's conversation file reaches the page (its row is in the DOM), so "not on screen"
 * means hidden, not missing; with none, the room read was ANSWERED before the switch is judged.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-docs-seg-4937.js
 */
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const shown = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getClientRects().length && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]'));
}, sel);

(async () => {
  let ran = 0;
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: process.env.HEADED === '0' });
    try {
      for (const withConvo of [true, false]) {
        const tag = `${engineName} ${withConvo ? 'with' : 'without'} conversation files`;
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.addInitScript((wc) => {
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.setInterval = () => 0; // refuse the app's tick
          const files = [{ name: 'plan.pdf', size: 2048, modified: '2026-10-01T10:00:00.000Z' }];
          const rows = wc ? [{ text: 'here it is', attachments: [{ id: 'a1', name: 'drop.png', size: 512, url: '/api/attachments/a1' }] }] : [{ text: 'no files' }];
          window.ROOM_HITS = 0; window.ROOM_DONE = 0;
          window.fetch = async (url, init) => {
            const u = String(url);
            if (u.includes('/reveal-folder')) return new Response(JSON.stringify({ error: 'we could not open that folder' }), { status: 500, headers: { 'content-type': 'application/json' } });
            if (u.includes('/documents')) return enc({ ok: true, total: 1, files, names: files.map((f) => f.name), stamp: 'x' });
            if (u.includes('/room')) { window.ROOM_HITS += 1; if (window.HOLD_ROOM) await window.HOLD_ROOM; const r = enc({ rows }); setTimeout(() => { window.ROOM_DONE += 1; }, 0); return r; }
            if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
            return enc({});
          };
        }, withConvo);
        await page.goto(PAGE);
        const open = () => page.evaluate(async () => {
          const fr = document.getElementById('firstrun');   // a file:// page has no board, so first run would cover it
          if (fr) { fr.hidden = true; fr.style.display = 'none'; }
          for (const el of document.querySelectorAll('[inert]')) el.inert = false;   // first run leaves the app inert behind it
          showTab('projects');                       // first: it resets the project and the view
          await new Promise((r) => setTimeout(r, 50));
          PROJECTS = [{ id: 'p1', name: 'Five Families' }];
          PJ_CURRENT = 'p1';
          await openDocsView();
          await new Promise((r) => setTimeout(r, 150));
        });
        await open();
        const segShown = await shown(page, '#docs-seg');
        if (withConvo) {
          const convoRow = await page.evaluate(() => !!document.querySelector('#docs-convo .pj-doc'));
          chk(convoRow, `${tag}: control: the conversation's file reached the page`);
          chk(segShown, `${tag}: the switch shows`);
          const checked = await page.evaluate(() => [...document.querySelectorAll('#docs-seg [data-docseg]')].map((b) => b.dataset.docseg + '=' + b.getAttribute('aria-checked')));
          chk(checked.join() === 'folder=true,convo=false', `${tag}: In the project folder is chosen on open`, JSON.stringify(checked));
          chk(await shown(page, '#docs-list .pj-doc') && !(await shown(page, '#docs-convo .pj-doc')), `${tag}: the folder's list shows, the conversation's does not`);
          await page.click('#docs-seg [data-docseg="convo"]');
          chk(await shown(page, '#docs-convo .pj-doc') && !(await shown(page, '#docs-list .pj-doc')), `${tag}: a click on From this conversation swaps the lists`);
          await page.focus('#docs-seg [data-docseg="convo"]');
          await page.keyboard.press('ArrowRight');
          const afterKey = await page.evaluate(() => ({ seg: document.getElementById('pj-docs-view').dataset.docseg, focus: document.activeElement && document.activeElement.dataset.docseg }));
          chk(afterKey.seg === 'folder' && afterKey.focus === 'folder' && await shown(page, '#docs-list .pj-doc') && !(await shown(page, '#docs-convo .pj-doc')),
            `${tag}: an arrow key moves, chooses (wrapping) and swaps the lists`, JSON.stringify(afterKey));
          const segNow = () => page.evaluate(() => ({ seg: document.getElementById('pj-docs-view').dataset.docseg, focus: document.activeElement && document.activeElement.dataset.docseg }));
          await page.keyboard.press('End');
          const atEnd = await segNow();
          await page.keyboard.press('Home');
          const atHome = await segNow();
          chk(atEnd.seg === 'convo' && atEnd.focus === 'convo' && atHome.seg === 'folder' && atHome.focus === 'folder', `${tag}: End and Home choose the last and first segment`, JSON.stringify({ atEnd, atHome }));
          await page.click('#docs-seg [data-docseg="convo"]');
          await page.click('#docs-finder');
          await page.waitForTimeout(150);
          const fin = await page.evaluate(() => ({ seg: document.getElementById('pj-docs-view').dataset.docseg, msg: document.getElementById('docs-msg').textContent }));
          chk(fin.seg === 'folder' && /could not open that folder/i.test(fin.msg) && await shown(page, '#docs-msg'),
            `${tag}: a failed Open in Finder from the conversation's list shows its sentence (on the folder's segment)`, JSON.stringify(fin));
          /* Two opens while the first's room read is still out: the list ends with one row, not two. */
          const twice = await page.evaluate(async () => {
            let release;
            window.HOLD_ROOM = new Promise((r) => { release = r; });
            const first = openDocsView();
            const second = openDocsView();
            await new Promise((r) => setTimeout(r, 50));
            release();
            window.HOLD_ROOM = null;
            await Promise.all([first, second]);
            await new Promise((r) => setTimeout(r, 100));
            return document.querySelectorAll('#docs-convo .pj-doc').length;
          });
          chk(twice === 1, `${tag}: a reopen while the first read is out shows each conversation file once`, String(twice));
          await page.click('#docs-seg [data-docseg="convo"]');
          await open();
          chk(await page.evaluate(() => document.getElementById('pj-docs-view').dataset.docseg) === 'folder', `${tag}: opening the screen again starts on the folder`);
        } else {
          await page.waitForFunction(() => window.ROOM_DONE >= 1);
          await page.waitForTimeout(100);
          chk(await page.evaluate(() => window.ROOM_DONE) >= 1, `${tag}: control: the conversation's read was answered`);
          const segState = await page.evaluate(() => { const s = document.getElementById('docs-seg'); return s ? (s.hidden ? 'hidden' : 'shown') : 'absent'; });
          chk(segState === 'hidden' && !(await shown(page, '#docs-seg')), `${tag}: the switch is in the page but hidden (nothing to switch to)`, segState);
          chk(await shown(page, '#docs-list .pj-doc'), `${tag}: the folder's list shows`);
        }
        chk(errs.length === 0, `${tag}: no page errors`, errs.join(' | '));
        ran += 1;
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  /* A phone: at 320px wide the switch fits without the page scrolling sideways, both segments on screen. */
  let phones = 0;
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: process.env.HEADED === '0' });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.addInitScript(() => {
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url) => {
          const u = String(url);
          if (u.includes('/documents')) return enc({ ok: true, total: 1, files: [{ name: 'plan.pdf', size: 2048, modified: '2026-10-01T10:00:00.000Z' }], names: ['plan.pdf'], stamp: 'x' });
          if (u.includes('/room')) return enc({ rows: [{ text: 'x', attachments: [{ id: 'a1', name: 'drop.png', size: 5, url: '/api/attachments/a1' }] }] });
          return enc({});
        };
      });
      await page.goto(PAGE);
      const r = await page.evaluate(async () => {
        const fr = document.getElementById('firstrun');
        if (fr) { fr.hidden = true; fr.style.display = 'none'; }
        for (const el of document.querySelectorAll('[inert]')) el.inert = false;
        showTab('projects');
        await new Promise((res) => setTimeout(res, 50));
        PROJECTS = [{ id: 'p1', name: 'Five Families' }];
        PJ_CURRENT = 'p1';
        await openDocsView();
        await new Promise((res) => setTimeout(res, 150));
        const seg = document.getElementById('docs-seg');
        const btns = [...seg.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
        return { shown: !seg.hidden, sideways: document.documentElement.scrollWidth > innerWidth, right: Math.round(Math.max(...btns.map((b) => b.right))), vw: innerWidth, oneRow: btns.length === 2 && Math.abs(btns[0].top - btns[1].top) < 1 };
      });
      chk(r.shown && !r.sideways && r.right <= r.vw && r.oneRow, `${engineName} 320px: the switch fits on one row without the page scrolling sideways`, JSON.stringify(r));
      chk(errs.length === 0, `${engineName} 320px: no page errors`, errs.join(' | '));
      phones += 1;
    } finally {
      await browser.close();
    }
  }
  chk(ran === 4 && phones === 2, 'precondition: both engines, with and without conversation files, and the phone arm', `ran=${ran} phones=${phones}`);
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
