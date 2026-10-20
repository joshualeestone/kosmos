'use strict';
// Browser-check-surface: astar grid alist starBtn repaintAgentOrder toggleStar
/* #6719 (Josh, 2026-10-20): "lets add a small star functionality to the top right of these tiles so like if I starred
 * you it would basically pin you to the top". Drives the real tiles, list rows and click handler on the shipped page,
 * file://, with /api/agent-stars stubbed in the page (an in-memory store that records every PUT), on chromium and
 * webkit, both themes:
 *   - every tile and every list row has a star; it starts as an outline, labelled "Star <name>";
 *   - a click on the last agent's star moves it first in the grid AND the list, fills it, relabels it "Unstar <name>",
 *     sends one PUT { name, on: true }, and does not open the agent (CONTROL: a click on the name does open it);
 *   - a second star keeps the chosen order within the starred group; Unstar puts the order back;
 *   - Enter on a focused star toggles it, and focus stays on that agent's star after the repaint;
 *   - a refused save (the stub answers 500) puts the star back as it was;
 *   - on the narrowest tile the corner star does not overlap the unread badge, and in a list row it does not cover the
 *     name; at 375 x 667 on a touch screen it is at least 44 px.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-star-6719.js [shots-dir]
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const SHOTS = process.argv[2] || '';
const fail = [];
let RAN = 0;
const chk = (ok, label, extra) => {
  RAN += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function open(browser, eng, w, h, theme) {
  const touch = w < 700;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: touch, isMobile: touch && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.setInterval = () => 0;
    window.STAR_STORE = []; window.STAR_PUTS = []; window.STAR_REFUSE = false;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url, opts) => {
      if (String(url) === '/api/agent-stars') {
        if (opts && opts.method === 'PUT') {
          const body = JSON.parse(opts.body);
          window.STAR_PUTS.push(body);
          if (window.STAR_REFUSE) return enc({ error: 'we could not save that star' }, 500);
          window.STAR_STORE = window.STAR_STORE.filter((n) => n !== body.name);
          if (body.on) window.STAR_STORE.push(body.name);
          return enc({ names: window.STAR_STORE, ok: true });
        }
        return enc({ names: window.STAR_STORE, ok: true });
      }
      return enc({});
    };
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    const mk = (name, over) => ({ name, sessionName: name.toLowerCase(), running: false, state: 'stopped', role: null,
      profile: {}, dmUnread: 0, isGuide: false, ...over });
    LAST = [
      mk('Ada', { lastTalkedAt: '2026-10-20T12:00:00Z', dmUnread: 3 }),
      mk('Bea', { lastTalkedAt: '2026-10-20T11:00:00Z' }),
      mk('Cam', { lastTalkedAt: '2026-10-20T10:00:00Z' }),
      mk('Dee', { lastTalkedAt: '2026-10-20T09:00:00Z', dmUnread: 12 }),
    ];
    PROJECTS = [];
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    document.documentElement.setAttribute('data-layout', 'tabs');
    showTab('agents');
    BOARD_SEEN = true;
    BOARD_LAYOUT = 'grid';
    boardApplyVisibility(true);
    AGENT_SORT = 'talked';
    AGENT_STARS = new Set();
    repaintAgentOrder();
  });
  return { ctx, page, errs };
}

const order = (page, root) => page.evaluate((r) => [...document.querySelectorAll(r + ' [data-agent]')].map((x) => x.dataset.agent), root);
const star = (page, root, who) => page.evaluate(([r, w]) => {
  const b = [...document.querySelectorAll(r + ' [data-star]')].find((x) => x.dataset.star === w);
  if (!b) return null;
  const p = b.querySelector('path');
  return { label: b.getAttribute('aria-label'), on: b.classList.contains('on'), fill: getComputedStyle(p).fill, focused: document.activeElement === b };
}, [root, who]);

(async () => {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',');
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    for (const theme of ['light', 'dark']) {
      const t = `[${eng} ${theme}]`;
      const { ctx, page, errs } = await open(browser, eng, 1280, 900, theme);
      const counts = await page.evaluate(() => ({ tiles: document.querySelectorAll('#grid .acard').length,
        tileStars: document.querySelectorAll('#grid .acard > .astar').length, rows: document.querySelectorAll('#alist .lrow').length,
        rowStars: document.querySelectorAll('#alist .lrow .lname .astar').length }));
      chk(counts.tiles === 4 && counts.tileStars === 4 && counts.rows === 4 && counts.rowStars === 4, `${t} every tile and every list row has a star`, JSON.stringify(counts));
      const off = await star(page, '#grid', 'dee');
      chk(off && !off.on && off.label === 'Star Dee' && /none|transparent|rgba\(0, 0, 0, 0\)/.test(off.fill), `${t} a star starts as an outline, labelled "Star <name>"`, JSON.stringify(off));
      chk(JSON.stringify(await order(page, '#grid')) === JSON.stringify(['ada', 'bea', 'cam', 'dee']), `${t} CONTROL: the board's order before any star is Last talked to`, JSON.stringify(await order(page, '#grid')));

      // Star the last agent by clicking its tile star.
      await page.locator('#grid [data-star="dee"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 1);
      await page.waitForTimeout(50);
      const g1 = await order(page, '#grid'); const l1 = await order(page, '#alist');
      const on = await star(page, '#grid', 'dee');
      const opened = await page.evaluate(() => (typeof CURRENT !== 'undefined' && CURRENT ? CURRENT.sessionName : null));
      chk(g1[0] === 'dee' && l1[0] === 'dee', `${t} the starred agent moves first in the grid and the list`, JSON.stringify({ g1, l1 }));
      chk(on && on.on && on.label === 'Unstar Dee' && !/none|transparent|rgba\(0, 0, 0, 0\)/.test(on.fill), `${t} its star fills and reads "Unstar <name>"`, JSON.stringify(on));
      chk(JSON.stringify(await page.evaluate(() => window.STAR_PUTS)) === JSON.stringify([{ name: 'dee', on: true }]), `${t} one PUT with { name, on: true }`, JSON.stringify(await page.evaluate(() => window.STAR_PUTS)));
      chk(!opened, `${t} the star does not open the agent`, String(opened));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `star-${eng}-${theme}.png`) });

      // A second star: the starred group keeps the chosen order (Cam talked before Dee).
      await page.locator('#grid [data-star="cam"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 2);
      await page.waitForTimeout(50);
      const g2 = await order(page, '#grid');
      chk(JSON.stringify(g2) === JSON.stringify(['cam', 'dee', 'ada', 'bea']), `${t} two starred agents keep Last talked to among themselves, then the rest`, JSON.stringify(g2));

      // Keyboard: focus Cam's star and press Enter to unstar it; focus stays on Cam's star.
      await page.focus('#grid [data-star="cam"]');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.STAR_PUTS.length === 3);
      await page.waitForTimeout(50);
      const kb = await star(page, '#grid', 'cam');
      chk(kb && !kb.on && kb.focused, `${t} Enter on a focused star toggles it, and focus stays on that star`, JSON.stringify(kb));

      // Unstar Dee: the original order comes back.
      await page.locator('#grid [data-star="dee"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 4);
      await page.waitForTimeout(50);
      chk(JSON.stringify(await order(page, '#grid')) === JSON.stringify(['ada', 'bea', 'cam', 'dee']), `${t} Unstar puts the order back`, JSON.stringify(await order(page, '#grid')));

      // A refused save puts the star back.
      await page.evaluate(() => { window.STAR_REFUSE = true; });
      await page.locator('#grid [data-star="bea"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 5);
      await page.waitForTimeout(100);
      const refused = await star(page, '#grid', 'bea');
      chk(refused && !refused.on && (await order(page, '#grid'))[0] === 'ada', `${t} a refused save puts the star back`, JSON.stringify(refused));
      await page.evaluate(() => { window.STAR_REFUSE = false; });

      // CONTROL: a click on the name does open the agent, so the no-open arm above can fail.
      await page.locator('#grid [data-agent="bea"] .namego').click();
      await page.waitForTimeout(100);
      const nameOpened = await page.evaluate(() => (typeof CURRENT !== 'undefined' && CURRENT ? CURRENT.sessionName : null));
      chk(nameOpened === 'bea', `${t} CONTROL: a click on the name opens the agent`, String(nameOpened));
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }

    // Geometry: the narrowest tile, with an unread badge, and the list row; then a phone.
    for (const [w, h] of [[300, 900], [375, 667]]) {
      const t = `[${eng} ${w}x${h}]`;
      const { ctx, page, errs } = await open(browser, eng, w, h, 'light');
      const geo = await page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect();
        const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const tile = document.querySelector('#grid .acard[data-agent="dee"]');
        const s = r(tile.querySelector('.astar')); const badge = tile.querySelector('.dmbadge');
        const b = badge ? r(badge) : null;
        const tileGeo = { tileW: Math.round(r(tile).width), badge: !!b, badgeClear: b ? !hit(s, b) : null,
          inTile: s.right <= r(tile).right + 0.5 && s.top >= r(tile).top - 0.5, starW: Math.round(s.width), starH: Math.round(s.height) };
        // The list is hidden in the grid layout (its rectangles would all be zero, and "clear" would pass vacuously),
        // so it is measured in the list layout, and only a row star with a real size counts.
        BOARD_LAYOUT = 'list'; boardApplyVisibility(true); repaintAgentOrder();
        const row = document.querySelector('#alist .lrow[data-agent="dee"]');
        const rs = row ? r(row.querySelector('.lname .astar')) : null; const nm = row ? r(row.querySelector('.lname .namego')) : null;
        const sized = !!(rs && rs.width > 0 && nm && nm.width > 0);
        return { ...tileGeo, rowSized: sized, rowClear: sized ? !hit(rs, nm) : null, rowStarW: rs ? Math.round(rs.width) : null };
      });
      chk(geo.badge && geo.badgeClear === true && geo.inTile, `${t} the corner star is inside the tile and clear of the unread badge (tile ${geo.tileW}px)`, JSON.stringify(geo));
      chk(geo.rowSized && geo.rowClear === true, `${t} the list row's star is drawn and does not cover the name`, JSON.stringify(geo));
      if (w < 700) chk(geo.starW >= 44 && geo.starH >= 44, `${t} on a touch screen the star is at least 44 px`, JSON.stringify(geo));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `star-${eng}-${w}.png`) });
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    await browser.close();
  }
  console.log(`render-star-6719: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
