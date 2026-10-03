'use strict';

/**
 * kosmos#2624 (Josh): the top header is PIXEL-STABLE across views. "Flipping between
 * views must not jitter or shift by a single pixel; the banner is always preserved at
 * the top." #2282 put one header on every view; this pins that it also sits in ONE
 * place: the K mark, the Kosmos switcher, the You menu and the header's bottom rule
 * land on the same pixels in the tab view and the consolidated view, with and without
 * a tall notice (update / login advisory) showing. Since #5018 the notice floats over the
 * page below the header, and this also asserts it does not grow the header.
 *
 * ⚠️ WHY A BROWSER. Every number here is layout: padding, grid/flex alignment, and how
 * a wrapped notice sizes the row. No source grep can say where a control lands. This
 * reads getBoundingClientRect in both views.
 *
 * Measured on the served 0.6.95 build before the fix: the controls sat 33px lower in
 * the tab view at 1440px and 92px lower at 1100px, and a notice moved them in EITHER
 * view. This reds on that CSS (origin/main before kosmos#2624).
 *
 * HERMETIC: loads web/index.html over file://, boots no server. The two views are
 * entered through the same hooks applyLayout/showTab set (data-layout on <html>,
 * .consolidated on <body>), as render-tophead-consolidated-2282 does.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-tophead-stable-2624.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-tophead-stable-2624: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

// A notice as tall as the served login advisory measured at 1440px (84px). Its height
// is what matters: a centred row put the controls at the middle of it.
const NOTICE = '<div data-check-notice style="width:240px;height:84px"></div>';

async function measure(page, view, notice) {
  return page.evaluate(([view, notice, NOTICE]) => {
    // Every notice slot off (over file:// the offline notice shows, since no board
    // answers), then one tall notice on when asked for.
    for (const id of ['utoast-slot', 'uabort-slot', 'login-adv-slot', 'uoffline-slot']) {   // #3955 removed unote/unews
      const s = document.getElementById(id); if (s) s.style.display = 'none';
    }
    const slot = document.getElementById('login-adv-slot');
    if (slot) { slot.innerHTML = notice ? NOTICE : ''; slot.style.display = notice ? 'block' : 'none'; }
    // The switcher is display:none with no worlds to list (nothing to list over
    // file://); the served board shows it. Give it its own display so where it LANDS
    // is measured, which is all this check is about.
    const sw = document.querySelector('.apphead header .worldsw');
    if (sw) { sw.hidden = false; sw.style.display = 'inline-flex'; }
    const cons = view === 'consolidated';
    document.documentElement.setAttribute('data-layout', cons ? 'consolidated' : 'tabs');
    document.body.classList.toggle('consolidated', cons);
    const top = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? Math.round(r.top * 10) / 10 : null; };
    const head = document.querySelector('.apphead');
    const hdr = head && head.querySelector('header');
    // The bottom rule is .apphead's border in the tab view and the header's in
    // consolidated; read whichever carries one.
    const ruleOf = (el) => { const cs = getComputedStyle(el); return parseFloat(cs.borderBottomWidth) > 0 ? Math.round((el.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth)) * 10) / 10 : null; };
    const rule = (head && ruleOf(head)) ?? (hdr && ruleOf(hdr));
    return {
      klink: top('.apphead header .klink'),
      worldsw: top('.apphead header .worldsw'),
      you: top('.apphead header .headright'),
      rule,
      headH: head ? Math.round(head.getBoundingClientRect().height * 10) / 10 : null,
      // #5018: where the injected notice landed (null when it did not render), to prove it rendered and floats.
      noteTop: (() => { const n = document.querySelector('[data-check-notice]'); if (!n) return null; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? Math.round(r.top * 10) / 10 : null; })(),
      headBottom: hdr ? Math.round(hdr.getBoundingClientRect().bottom * 10) / 10 : null,
      tabsShown: top('.apphead header .tabs') !== null,
      // #4345: the center tabs now show in the consolidated view too, so they cannot tell the two
      // views apart. What the consolidated CSS still does, and only when its layout attribute and
      // class are both in force, is hide the header's h1 (not body.consolidated itself: this
      // function sets that class, so reading it back would prove nothing).
      consolidated: (() => { const h = document.querySelector('.apphead h1'); return !!h && getComputedStyle(h).display === 'none'; })(),
    };
  }, [view, notice, NOTICE]);
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-tophead-stable-2624: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  const problems = [];
  const rows = [];
  for (const width of [1440, 1100]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('file://' + PAGE);
    const ref = await measure(page, 'consolidated', false);
    for (const view of ['tabs', 'consolidated']) {
      for (const notice of [false, true]) {
        const m = await measure(page, view, notice);
        rows.push({ width, view, notice, ...m });
        const where = `${width}px ${view}${notice ? ' with a tall notice' : ''}`;
        for (const k of ['klink', 'worldsw', 'you']) {
          if (m[k] === null) problems.push(`${where}: .${k} does not render in the header`);
          else if (m[k] !== ref[k]) problems.push(`${where}: ${k} top is ${m[k]}, consolidated without a notice has ${ref[k]} (the header moved ${Math.round((m[k] - ref[k]) * 10) / 10}px)`);
        }
        // #5018: notices float over the page now, so the rule holds WITH a notice too (it used to grow the bar).
        if (m.rule !== ref.rule) problems.push(`${where}: the header's bottom rule is at ${m.rule}, consolidated has it at ${ref.rule}`);
        // CONTROL: the tab view really is the tab view and the consolidated view really is
        // consolidated, so equal numbers are not two readings of one layout. (#4345: the center
        // tabs render in both views now, so the view is read from what the consolidated CSS does to the h1.)
        if (view === 'tabs' && (m.consolidated || !m.tabsShown)) problems.push(`CONTROL failed: ${where}: this is not the tab view (consolidated=${m.consolidated}, tabs shown=${m.tabsShown})`);
        if (view === 'consolidated' && !m.consolidated) problems.push(`CONTROL failed: ${where}: the consolidated CSS is not in force (the header h1 still displays), so this is not the consolidated view`);
      }
    }
    // #5018 (Josh: "i hate that these push the navigation down"): the notice floats over the page, so the header
    // keeps its height. CONTROL: the notice really rendered (it has a box, below the header), so "the header did not
    // grow" is not "the notice never rendered". Before #5018 this read the opposite: the notice grew the bar.
    for (const view of ['tabs', 'consolidated']) {
      const plain = rows.find((r) => r.width === width && r.view === view && !r.notice);
      const tall = rows.find((r) => r.width === width && r.view === view && r.notice);
      if (tall.noteTop === null) problems.push(`CONTROL failed: ${width}px ${view}: the injected notice did not render`);
      else if (!(tall.noteTop >= tall.headBottom)) problems.push(`${width}px ${view}: the notice sits inside the header (top ${tall.noteTop}, header bottom ${tall.headBottom}), not over the page below it`);
      if (tall.headH !== plain.headH) problems.push(`${width}px ${view}: the notice grew the header (${plain.headH} -> ${tall.headH}); it must float over the page`);
    }
    // Mona Lisa, 2026-10-03: the Claude-unreachable line (#conn) shows on the same day as an expiring login, and a
    // floating notice painted over it. It must sit below the notice stack, the way the Allow card does. CONTROL: both
    // render (a box each), so "below" is not two hidden elements comparing zeros.
    for (const view of ['tabs', 'consolidated']) {
      await measure(page, view, true);
      await page.evaluate(() => {
        const ask = document.getElementById('askcard'); if (ask) ask.hidden = true;
        const c = document.getElementById('conn'); c.hidden = false;
        c.textContent = 'Kosmos cannot reach a Claude subscription on this computer, so agents on it cannot answer.';
      });
      // --topnotes-h is written by a ResizeObserver, which runs after layout: give it two frames.
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const c = await page.evaluate(() => {
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
        const conn = box(document.getElementById('conn')); const stack = box(document.getElementById('topnotes'));
        return { connTop: conn ? Math.round(conn.top) : null, stackBottom: stack ? Math.round(stack.bottom) : null };
      });
      const where = `${width}px ${view} with a notice and the Claude-unreachable line`;
      if (c.connTop === null || c.stackBottom === null) problems.push(`CONTROL failed: ${where}: ${c.connTop === null ? '#conn' : 'the notice stack'} did not render`);
      else if (c.connTop < c.stackBottom) problems.push(`${where}: the line starts at ${c.connTop}, under the notice (stack bottom ${c.stackBottom}); it must move below it`);
      else console.log(`  PASS  ${where}: the line starts at ${c.connTop}, below the notice stack (bottom ${c.stackBottom})`);
      await page.evaluate(() => { const c = document.getElementById('conn'); c.hidden = true; c.textContent = ''; });
      // And with no notice the line does not move at all (the clearance is 0, not a fixed gap).
      await measure(page, view, false);
      await page.evaluate(() => { const c = document.getElementById('conn'); c.hidden = false; c.textContent = 'Kosmos cannot reach a Claude subscription.'; });
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const mt = await page.evaluate(() => getComputedStyle(document.getElementById('conn')).marginTop);
      if (mt !== '0px') problems.push(`${width}px ${view} with no notice: the Claude-unreachable line is pushed down by ${mt}; with nothing floating it must not move`);
      else console.log(`  PASS  ${width}px ${view} with no notice: the line keeps its place (margin-top 0px)`);
      await page.evaluate(() => { const c = document.getElementById('conn'); c.hidden = true; c.textContent = ''; });
    }
    await page.close();
  }

  // CONTROL, below 960px: only the tab view exists there and it keeps its own spacing
  // (the fix is scoped to where views can be switched). If this reads the wide numbers,
  // the scope leaked and the narrow header changed with nobody asking.
  const narrow = await browser.newPage({ viewport: { width: 800, height: 900 } });
  await narrow.goto('file://' + PAGE);
  const n = await measure(narrow, 'tabs', false);
  const wide = rows.find((r) => r.width === 1440 && r.view === 'tabs' && !r.notice);
  if (n.klink === wide.klink) problems.push(`CONTROL failed: at 800px the K mark sits at ${n.klink}, the same as the wide fix; the 960px scope leaked`);
  await narrow.close();
  await browser.close();

  for (const r of rows) console.log('  ' + JSON.stringify(r));
  console.log('  narrow 800px tab view: ' + JSON.stringify(n));
  if (problems.length) {
    console.error('render-tophead-stable-2624: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-tophead-stable-2624: OK (the top header sits on the same pixels in the tab and consolidated views, with or without a notice)');
  process.exit(0);
})();
