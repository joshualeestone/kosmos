'use strict';

/**
 * kosmos#5393 slice 2: "At a glance" in the worlds switcher, driven in a real browser.
 *
 * The page is loaded from disk with fetch stubbed, at a desktop and a phone width. The check opens the switcher,
 * presses "At a glance", and reads what the sheet says for an overview of two Kosmoses (the open one with providers
 * and tasks, another whose providers are known only while it is open). It also checks the sheet's own behaviour:
 * - the overlay covers the window although the sheet sits inside #worldsw (the header), not on <body>;
 * - Refresh reads the route again, and a read that fails says so rather than leaving old rows up;
 * - Escape closes it and gives focus back to the switcher button;
 * - no quota figure appears, and the page throws no errors.
 *
 * Run: NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-worldview-5393.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldview-5393: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const NAMES = { worlds: [{ id: 'default', name: 'Home' }, { id: 'w2', name: 'Client work' }], activeWorldId: 'default', bootedWorldId: 'default' };
const until = new Date(Date.now() + 2 * 3600e3).toISOString();
const OVERVIEW = { worlds: [
  { id: 'default', name: 'Home', running: true, unassigned: { waiting: 3, held: 1 }, unassignedBecause: null,
    providers: [
      { provider: 'claude', agents: 2, stopped: 0, paused: 2, signInFailed: 0, until, state: 'paused' },
      { provider: 'codex', agents: 1, stopped: 0, paused: 0, signInFailed: 1, until: null, state: 'not_paused' },
    ], agentsWithoutProvider: 1, providersBecause: null },
  { id: 'w2', name: 'Client work', running: false, unassigned: null, unassignedBecause: 'we cannot read the projects in this Kosmos right now',
    providers: null, agentsWithoutProvider: null, providersBecause: 'known only while this Kosmos is open' },
] };

const results = [];
const check = (ok, label, got) => results.push({ ok: !!ok, label, got });

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldview-5393: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  for (const [w, h] of [[1100, 800], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.addInitScript(([names, overview]) => {
      try { localStorage.setItem('kosmos.multiKosmos', '1'); } catch {}
      window.__wvReads = 0;
      window.__wvFail = false;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        const url = String(u);
        if (url.indexOf('/api/worlds/overview') !== -1) {
          window.__wvReads += 1;
          if (window.__wvFail) return Promise.resolve({ ok: false, status: 500, json: async () => ({ because: 'the world registry is not readable on this machine' }) });
          if (window.__wvDeny) return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'this board needs its token' }) });
          return Promise.resolve({ ok: true, json: async () => overview });
        }
        if (url.indexOf('/api/worlds/names') !== -1) return Promise.resolve({ ok: true, json: async () => names });
        return realFetch(u, o);
      };
    }, [NAMES, OVERVIEW]);
    await page.goto('file://' + PAGE);
    const ready = await page.evaluate(async () => {
      if (typeof worldsFetch !== 'function' || typeof wvOpen !== 'function') return 'worldsFetch or wvOpen is missing';
      await worldsFetch();
      return document.getElementById('worldsw').hidden ? 'the switcher stayed hidden' : 'ok';
    });
    check(ready === 'ok', `@${w}: the switcher is up`, ready);
    await page.click('#worldsw-btn');
    await page.click('#worldsw-glance');
    await page.waitForFunction(() => /Home/.test(document.getElementById('wv-list').textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const got = await page.evaluate(() => {
      const back = document.getElementById('wv-modal').getBoundingClientRect();
      const box = document.querySelector('#wv-modal .rm-box').getBoundingClientRect();
      const lines = Array.from(document.querySelectorAll('#wv-list .wv-world')).map((d) => (d.textContent || '').replace(/\s+/g, ' ').trim());
      return { open: !document.getElementById('wv-modal').hidden, back: [back.left, back.top, back.width, back.height],
        box: [box.left, box.right, box.top, box.bottom], vw: innerWidth, vh: innerHeight,
        lines,
        menuHidden: document.getElementById('worldsw-menu').hidden, focus: document.activeElement && document.activeElement.id,
        sideways: document.documentElement.scrollWidth > innerWidth,
        // The tab layout reserves a scrollbar strip on <html> that no fixed layer can paint over (classic scrollbars:
        // CI, the Windows app). While the sheet is up the page must reserve none, as the other full-window layers do.
        // Asserted directly, because a Mac's overlay scrollbars hide the strip from the geometry arm.
        gutter: getComputedStyle(document.documentElement).scrollbarGutter,
        rootOverflow: getComputedStyle(document.documentElement).overflowY };
    });
    check(got.open && got.menuHidden, `@${w}: At a glance opens the sheet and closes the menu`, got);
    check(got.back[0] <= 0 && got.back[1] <= 0 && got.back[2] >= got.vw && got.back[3] >= got.vh,
      `@${w}: the overlay covers the window from inside the header`, got.back);
    check(got.gutter === 'auto' && got.rootOverflow === 'hidden',
      `@${w}: while the sheet is up the page reserves no scrollbar strip it cannot cover`, [got.gutter, got.rootOverflow]);
    check(got.box[0] >= 0 && got.box[1] <= got.vw && !got.sideways, `@${w}: the sheet fits the width, nothing scrolls sideways`, got.box);
    check(got.focus === 'wv-close', `@${w}: focus starts on Close`, got.focus);
    // The sheet is inside the sticky header (its own stacking context): it must still be ON TOP of floating UI, not
    // just the right size. A fixed element at the page's floating layer (46, the add menu's) sits in the corner.
    const onTop = await page.evaluate(() => {
      const f = document.createElement('div');
      f.id = 'zz-float';
      f.style.cssText = 'position:fixed;right:4px;bottom:4px;width:60px;height:60px;z-index:46;background:red;';
      document.body.appendChild(f);
      const box = document.querySelector('#wv-modal .rm-box').getBoundingClientRect();
      const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('#wv-modal')); };
      const out = { centre: hit(box.left + box.width / 2, box.top + box.height / 2), corner: hit(innerWidth - 20, innerHeight - 20),
        close: hit(document.getElementById('wv-close').getBoundingClientRect().left + 4, document.getElementById('wv-close').getBoundingClientRect().top + 4) };
      f.remove();
      return out;
    });
    check(onTop.centre && onTop.close && onTop.corner, `@${w}: the sheet and its backdrop are on top of floating UI (z 46)`, onTop);
    const home = got.lines[0] || '';
    const other = got.lines[1] || '';
    check(/^Home \(open now\)/.test(home), `@${w}: the open Kosmos is named and marked`, home);
    // The fixture's time is two hours ahead, which is tomorrow after 22:00: the day may lead the time.
    check(/Claude: Paused until (\S+ )?\d/.test(home), `@${w}: a paused provider says until when`, home);
    check(/OpenAI Codex: Not paused\. 1 agent could not sign in/.test(home), `@${w}: not paused, never "Working", and the failed sign-in`, home);
    check(!/working/i.test(home), `@${w}: no provider is called working`, home);
    check(/1 agent with no AI provider shown here/.test(home), `@${w}: agents with no provider are counted`, home);
    check(/3 tasks waiting for someone, and 1 on hold/.test(home), `@${w}: tasks nobody is on`, home);
    check(/Client work/.test(other) && /AI providers: known only while this Kosmos is open/.test(other), `@${w}: another Kosmos says its providers are known only while it is open`, other);
    check(/Tasks: we cannot read the projects/.test(other) && !/\b0 tasks\b/.test(other), `@${w}: an unreadable task list is said, not shown as 0`, other);
    check(!/quota|remaining|%/i.test(got.lines.join(' ')), `@${w}: no quota figure`, got.lines);
    // Refresh reads again; a failed read replaces the rows with the reason.
    const before = await page.evaluate(() => window.__wvReads);
    await page.evaluate(() => { window.__wvFail = true; });
    await page.click('#wv-refresh');
    await page.waitForFunction(() => /[Nn]ot readable/.test(document.getElementById('wv-list').textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const after = await page.evaluate(() => ({ reads: window.__wvReads, text: (document.getElementById('wv-list').textContent || '').trim() }));
    check(after.reads === before + 1, `@${w}: Refresh reads the route once more`, { before, after: after.reads });
    check(/[Nn]ot readable on this machine/.test(after.text) && !/Home/.test(after.text), `@${w}: a failed read says so and leaves no old rows up`, after.text);
    const status = await page.evaluate(() => { const e = document.getElementById('wv-status'); return { role: e.getAttribute('role'), live: e.getAttribute('aria-live'), text: e.textContent }; });
    check(status.role === 'status' && status.live === 'polite' && /[Nn]ot readable on this machine/.test(status.text), `@${w}: the failed read is announced`, status);
    // A board that is not signed in: the gated route answers 403 with `error`; the sheet says to sign in.
    await page.evaluate(() => { window.__wvFail = false; window.__wvDeny = true; });
    await page.click('#wv-refresh');
    await page.waitForFunction(() => /Sign in to this Kosmos/.test(document.getElementById('wv-list').textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const denied = await page.evaluate(() => ({ list: (document.getElementById('wv-list').textContent || '').trim(), said: document.getElementById('wv-status').textContent }));
    check(/Sign in to this Kosmos/.test(denied.list) && /Sign in to this Kosmos/.test(denied.said), `@${w}: a board that is not signed in is told to sign in, not to retry`, denied);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({ hidden: document.getElementById('wv-modal').hidden, focus: document.activeElement && document.activeElement.id }));
    check(closed.hidden && closed.focus === 'worldsw-btn', `@${w}: Escape closes it and focus goes back to the switcher`, closed);
    check(!errors.length, `@${w}: no page errors`, errors);
    await page.close();
  }
  // The consolidated layout: .apphead is static there, so the sheet's own z-index must hold at the root.
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.addInitScript(([names, overview]) => {
      try { localStorage.setItem('kosmos.multiKosmos', '1'); } catch {}
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        const url = String(u);
        if (url.indexOf('/api/worlds/overview') !== -1) return Promise.resolve({ ok: true, json: async () => overview });
        if (url.indexOf('/api/worlds/names') !== -1) return Promise.resolve({ ok: true, json: async () => names });
        return realFetch(u, o);
      };
    }, [NAMES, OVERVIEW]);
    await page.goto('file://' + PAGE);
    const layout = await page.evaluate(async () => {
      document.documentElement.setAttribute('data-layout', 'consolidated');
      document.body.classList.add('consolidated');
      if (typeof showTab === 'function') { try { showTab('agents'); } catch (_e) {} }
      await worldsFetch();
      return getComputedStyle(document.querySelector('.apphead')).position;
    });
    await page.click('#worldsw-btn');
    await page.click('#worldsw-glance');
    await page.waitForFunction(() => /Home/.test(document.getElementById('wv-list').textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const f = document.createElement('div');
      f.style.cssText = 'position:fixed;right:4px;bottom:4px;width:60px;height:60px;z-index:46;background:red;';
      document.body.appendChild(f);
      const box = document.querySelector('#wv-modal .rm-box').getBoundingClientRect();
      const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('#wv-modal')); };
      const back = document.getElementById('wv-modal').getBoundingClientRect();
      const out = { centre: hit(box.left + box.width / 2, box.top + box.height / 2), corner: hit(innerWidth - 20, innerHeight - 20),
        covers: back.left <= 0 && back.top <= 0 && back.width >= innerWidth && back.height >= innerHeight };
      f.remove();
      return out;
    });
    check(layout === 'static', 'consolidated: the arm really runs with a static .apphead', layout);
    check(r.centre && r.corner && r.covers, 'consolidated: the sheet covers the window and is on top of floating UI (z 46)', r);
    check(!errors.length, 'consolidated: no page errors', errors);
    await page.close();
  }
  await browser.close();
  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log('PASS  ' + r.label);
    else { failed += 1; console.log('FAIL  ' + r.label + '  --  ' + JSON.stringify(r.got).slice(0, 300)); }
  }
  if (failed) { console.error('FAIL  render-worldview-5393: ' + failed + ' of ' + results.length); process.exit(1); }
  console.log('render-worldview-5393: At a glance opens from the switcher, covers the window, says each provider\'s state and the tasks nobody is on without inventing a figure, reads again on Refresh, says a failed read, and closes on Escape.');
})().catch((e) => { console.error('FAIL  render-worldview-5393: ' + (e && e.stack || e)); process.exit(1); });
