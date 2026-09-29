// Browser-check-surface: rm-back boot-cover updconfirm plus-lost-modal
'use strict';

/**
 * kosmos#4506: on a machine that draws classic scrollbars the tab layout reserves a scrollbar gutter on <html>
 * (#1309), and a fixed full-window layer cannot paint over it. Beside every dialog (.rm-back, a 0.72 dark wash)
 * that left a bright strip of undimmed page down the right edge, and beside the boot cover a strip of the page.
 * The same shape as #4494 (the first-run wizard and the update overlay), with two different fixes:
 *   - .rm-back is see-through, so dropping the gutter would move the board 15px behind it on every dialog open.
 *     Instead the canvas takes the dimmed ground while a dialog is up (a gutter paints the canvas colour), the way
 *     the tour's dim does (#3737). Measured here by PIXELS: the gutter must match the dimmed page beside it.
 *   - #boot-cover is opaque, so it takes #4494's rule: no gutter and no scroll while it is up.
 *
 * Harness (render-layer-gutter-4494's, #4494): a tiny static server for web/index.html with a minimal board; every machine gets a real 15px
 * scrollbar (a ::-webkit-scrollbar width, --hide-scrollbars dropped, and a page tall enough to scroll). Pixels are
 * read from a screenshot decoded in the page (the render-room-msgbox-2806 pattern). Chromium only.
 * Not covered: the Kosmos+ navy Plus section, where the ground lives on the body and the root cannot read it (#4542).
 * Scope of the gutter pixels: the harness scrollbar has a thumb and no track, so its gutter shows the canvas even on
 * this long page. That is Windows' own shape: under win32 the page draws a 10px thumb with a transparent track (the
 * win32 ::-webkit-scrollbar rules in web/index.html), so there the fix reaches scrolling pages too. On a Mac drawing
 * classic scrollbars, a page that scrolls shows the system's track in the gutter, which no page colour reaches; the
 * canvas shows there only on a page that does not scroll. (Reasoned from the CSS, not measured on either machine.)
 *
 * Arms, each in light and dark:
 *   - control: the gutter really is 15px, and the page colour it shows would fail the match below (so a green is
 *     not a harness with no gutter, and not a page whose dim happens to equal its ground). Dark's strip is faint,
 *     3 to 6 per channel on main, which is why the tolerance is 3. So the dark pixel arms tell a strip from none but
 *     little finer: a wrong mix, or a missing min-height, shows red only in light;
 *   - a dialog up, on Agents and on Tasks (whose #4216 canvas rule must give way): the board does not move (same
 *     width), and the gutter matches the dimmed page within 3 per channel;
 *   - the dialog closed: the gutter shows the page's own colour again;
 *   - the canvas is left alone for a dialog shown inside a hidden section, and on a machine without the mark;
 *   - while the tour dims, a dialog leaves the tour's canvas alone; on Talk, a dialog leaves the body's height alone
 *     (at 1280px, where Talk's body is already the window's height, so the arm pins that the rule skips Talk, not the
 *     phone layout the skip exists for);
 *   - a dialog on a short page (no spacer, a 1200px window): a pixel below the page content matches one inside it,
 *     so the canvas under a short body is not dimmed twice;
 *   - the boot cover up: no gutter, no scroll, and the cover is under the right edge; hidden, the gutter comes back.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dialog-gutter-4506.js
 */

const fs = require('node:fs');
const http = require('node:http');
const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-dialog-gutter-4506: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const ROOT = nodePath.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(nodePath.join(ROOT, 'web', 'index.html'));
const BAR = 15;
const W = 1280;
const H = 800;
const TOL = 3;

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/status')) return json(res, { agents: [], counts: { total: 0, working: 0, idle: 0, unreadableLines: 0 }, checkedAt: new Date().toISOString() });
  if (req.url.startsWith('/api/first-run')) return json(res, { done: true });
  if (req.url.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
  if (req.url === '/' || req.url.startsWith('/?')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML); return; }
  res.writeHead(404); res.end();
});

// The gutter's pixel and the page's pixel just left of it, low on the page (below the scrollbar thumb, which sits
// at the top of a long page).
const pixels = async (page) => {
  const url = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ url, bar, w }) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const at = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    const y = img.height - 50;
    return { gutter: at(w - Math.ceil(bar / 2), y), page: at(w - bar - 20, y) };
  }, { url, bar: BAR, w: W });
};
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= TOL);
const width = (page) => page.evaluate(() => {
  const root = document.documentElement, cs = getComputedStyle(root);
  return { cw: root.clientWidth, bar: window.innerWidth - root.clientWidth, gutter: cs.scrollbarGutter, overflow: cs.overflowY };
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/?tab=';
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] }); }
  catch (err) {
    console.error('FAIL  render-dialog-gutter-4506: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    server.close();
    process.exit(1);
  }
  const open = async (scheme, tab, short) => {
    const ctx = await browser.newContext({ viewport: { width: W, height: short ? 1200 : H }, colorScheme: scheme });
    // A classic, space-taking scrollbar on every machine (an overlay scrollbar gives the gutter no width).
    await ctx.addInitScript(([bar, short]) => {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '::-webkit-scrollbar { width: ' + bar + 'px; height: ' + bar + 'px; } ::-webkit-scrollbar-thumb { background: #999; }';
        document.head.appendChild(st);
        // A custom scrollbar takes its width only on a page that really scrolls (#4494). A spacer, not a product node.
        if (short) return;   // the short-page arm: the body stays shorter than the window
        const tall = document.createElement('div');
        tall.dataset.testSpacer = '4506';
        tall.style.height = '3000px';
        document.body.appendChild(tall);
      });
    }, [BAR, !!short]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await page.goto(base + tab, { waitUntil: 'networkidle' });
    // A classic-scrollbar machine is marked data-scrollbar-classic by kosmosMeasureScrollbarWidth, which the Tasks
    // canvas rule (#4216) keys on. It measures with overflow hidden, and a custom scrollbar takes no width on a page
    // that cannot scroll, so here it reads 0 (measured). Set the mark that measurement gives on such a machine.
    await page.evaluate(() => document.documentElement.setAttribute('data-scrollbar-classic', ''));
    await page.waitForTimeout(300);
    return page;
  };

  for (const scheme of ['light', 'dark']) {
    // ── A dialog (.rm-back), on the Agents tab and on Tasks, whose own gutter rule (#4216) must give way. ──
    for (const tab of ['agents', 'tasks']) {
      const t = '[' + scheme + ' ' + tab + ']';
      const page = await open(scheme, tab);
      const w0 = await width(page);
      const p0 = await pixels(page);
      ok(t + ' control: the page has a real 15px gutter before the dialog opens', w0.bar === BAR && w0.gutter === 'stable', JSON.stringify(w0));
      if (tab === 'tasks') {
        // So the Tasks arm tests the #4216 canvas giving way, not a canvas that was never the surface.
        const bg = await page.evaluate(() => {
          const probe = document.createElement('i'); probe.style.backgroundColor = 'var(--k-surface)'; document.body.appendChild(probe);
          const want = getComputedStyle(probe).backgroundColor; probe.remove();
          return { have: getComputedStyle(document.documentElement).backgroundColor, want };
        });
        ok(t + ' control: the Tasks canvas is the surface before the dialog opens (#4216)', bg.have === bg.want, JSON.stringify(bg));
      }
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; });
      await page.waitForTimeout(150);
      const w1 = await width(page);
      const p1 = await pixels(page);
      // The page's own colour would fail the match below: a gutter left undimmed is a strip this check sees.
      ok(t + ' control: the undimmed page colour does not match the dimmed page (a strip would show)', !near(p0.gutter, p1.page), JSON.stringify({ before: p0, up: p1 }));
      ok(t + ' a dialog up: the board does not move', w1.cw === w0.cw && w1.bar === BAR, JSON.stringify({ w0, w1 }));
      ok(t + ' a dialog up: the gutter matches the dimmed page beside it', near(p1.gutter, p1.page), JSON.stringify(p1));
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = true; });
      await page.waitForTimeout(150);
      const p2 = await pixels(page);
      ok(t + ' the dialog closed: the gutter shows the page colour again', near(p2.gutter, p0.gutter), JSON.stringify({ before: p0, after: p2 }));
      await page.context().close();
    }
    // ── The tour owns the canvas while it dims, and Talk's page keeps its own height. ──
    {
      const t = '[' + scheme + ']';
      const page = await open(scheme, 'agents');
      const st = () => page.evaluate(() => ({ bg: getComputedStyle(document.documentElement).backgroundColor, minH: getComputedStyle(document.body).minHeight }));
      // The tour's own state, as tipDimming sets it (a class, a flag and one mixed colour).
      await page.evaluate(() => { const r = document.documentElement; r.style.setProperty('--tip-canvas', 'rgb(1, 2, 3)'); r.setAttribute('data-tip-ground', ''); r.classList.add('tip-dimming'); });
      const tour = await st();
      ok(t + ' control: the tour\'s canvas is in place', tour.bg === 'rgb(1, 2, 3)', JSON.stringify(tour));
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; });
      ok(t + ' a dialog over the tour leaves the tour\'s canvas', (await st()).bg === 'rgb(1, 2, 3)', JSON.stringify(await st()));
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = true; const r = document.documentElement; r.classList.remove('tip-dimming'); r.removeAttribute('data-tip-ground'); r.style.removeProperty('--tip-canvas'); });
      // Talk: the agent page with its Talk section showing (the markup's own sections, unhidden).
      const off = await st();
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; });
      const offUp = await st();
      ok(t + ' control: off Talk, a dialog does set the body\'s height', offUp.minH !== off.minH, JSON.stringify({ off, offUp }));
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = true; for (const p of document.querySelectorAll('body > section[id^="panel-"]')) p.hidden = true; document.getElementById('panel-detail').hidden = false; document.getElementById('d-sec-talk').hidden = false; });
      const talk = await st();
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; });
      const talkUp = await st();
      ok(t + ' on Talk, a dialog leaves the body\'s height as it was', talkUp.minH === talk.minH, JSON.stringify({ talk, talkUp }));
      ok(t + ' on Talk, a dialog still dims the canvas', talkUp.bg !== talk.bg, JSON.stringify({ talk, talkUp }));
      await page.context().close();
    }
    // ── Two cases where the canvas must NOT change. ──
    {
      const t = '[' + scheme + ']';
      const page = await open(scheme, 'agents');
      const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      const before = await bg();
      // A shown .rm-back inside a hidden section (the Plus dialog while Settings is not on screen) puts nothing up.
      const inHidden = await page.evaluate(() => { const m = document.getElementById('plus-lost-modal'); const s = m && m.parentElement && m.parentElement.closest('[hidden]'); if (!s) return null; m.hidden = false; return s.id; });
      ok(t + ' control: the Plus dialog sits inside a hidden section here', inHidden === 's-sec-plus' || inHidden === 'panel-settings', JSON.stringify(inHidden));
      ok(t + ' a dialog shown inside a hidden section leaves the canvas as it was', (await bg()) === before, JSON.stringify({ before, after: await bg() }));
      await page.evaluate(() => { document.getElementById('plus-lost-modal').hidden = true; });
      // A machine without the classic-scrollbar mark has no gutter to fix, so a dialog leaves its canvas alone.
      await page.evaluate(() => { document.documentElement.removeAttribute('data-scrollbar-classic'); document.getElementById('updconfirm').hidden = false; });
      const plain = await bg();
      await page.evaluate(() => document.documentElement.setAttribute('data-scrollbar-classic', ''));
      const marked = await bg();
      ok(t + ' control: with the mark the same dialog does change the canvas', marked !== before, JSON.stringify({ before, marked }));
      ok(t + ' without the classic-scrollbar mark a dialog leaves the canvas as it was', plain === before, JSON.stringify({ before, plain }));
      await page.context().close();
    }
    // ── A dialog on a short page: the body ends above the window's foot, so canvas shows below it. The canvas is
    // the dimmed ground while a dialog is up, so unless the body fills the window that band is dimmed twice. ──
    {
      const t = '[' + scheme + ' short page]';
      const page = await open(scheme, 'agents', true);
      await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; });
      await page.waitForTimeout(150);
      const geo = await page.evaluate(() => ({ body: Math.round(document.body.getBoundingClientRect().height), win: window.innerHeight, main: Math.round((document.querySelector('main') || document.body).getBoundingClientRect().bottom) }));
      // The body's natural height, without the fix's min-height, so the arm is known to reach a short page.
      const natural = await page.evaluate(() => { const b = document.body, m = b.style.minHeight; b.style.minHeight = '0px'; const h = b.scrollHeight; b.style.minHeight = m; return h; });
      ok(t + ' control: the page content ends well above the window foot', natural < geo.win - 200, JSON.stringify({ natural, ...geo }));
      const url = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
      const two = await page.evaluate(async ({ url, natural }) => {
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = url; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        const at = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
        return { inside: at(20, Math.max(10, natural - 20)), below: at(20, img.height - 20) };
      }, { url, natural });
      ok(t + ' a dialog up: below the page content is dimmed once, like the page', near(two.below, two.inside), JSON.stringify(two));
      await page.context().close();
    }
    // ── The boot cover. ──
    {
      const t = '[' + scheme + ']';
      const page = await open(scheme, 'agents');
      const w0 = await width(page);
      ok(t + ' control: the page has a real 15px gutter before the cover shows', w0.bar === BAR && w0.gutter === 'stable', JSON.stringify(w0));
      await page.evaluate(() => { document.getElementById('boot-cover').hidden = false; });
      await page.waitForTimeout(150);
      const w1 = await width(page);
      const covered = await page.evaluate((bar) => {
        const cover = document.getElementById('boot-cover');
        const x = window.innerWidth - Math.ceil(bar / 2);
        return [60, 400, 740].every((y) => { const h = document.elementFromPoint(x, y); return !!h && cover.contains(h); });
      }, BAR);
      ok(t + ' the boot cover up: no gutter and no page scroll', w1.bar === 0 && w1.gutter === 'auto' && w1.overflow === 'hidden', JSON.stringify(w1));
      ok(t + ' the boot cover up: it covers the right edge', covered);
      await page.evaluate(() => { document.getElementById('boot-cover').hidden = true; });
      await page.waitForTimeout(150);
      const w2 = await width(page);
      ok(t + ' the boot cover hidden: the gutter comes back', w2.bar === BAR && w2.gutter === 'stable' && w2.overflow !== 'hidden', JSON.stringify(w2));
      await page.context().close();
    }
  }

  await browser.close();
  server.close();
  if (problems.length) {
    console.error('FAIL  render-dialog-gutter-4506: ' + problems.length + ' problem(s), ' + pass + ' passed');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-dialog-gutter-4506: ' + pass + ' passed (with a real 15px scrollbar measured first, light and dark: a dialog leaves the board still and the gutter the colour of the dimmed page, and gives the page colour back on close; on a short page the band below the content is dimmed once, not twice; a dialog inside a hidden section, or on a machine without the classic-scrollbar mark, leaves the canvas alone; the tour keeps its canvas and Talk its height; the boot cover leaves no gutter and no scroll and covers the right edge, and the gutter returns when it hides). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-dialog-gutter-4506: ' + (e && e.message ? e.message.split('\n')[0] : e)); server.close(); process.exit(1); });
