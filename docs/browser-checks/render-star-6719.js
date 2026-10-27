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
 *   - a refused save (the stub answers a passing 503) puts the star back as it was;
 *   - all three tile paths (running, not running, waiting at a trust prompt) carry the star; on a card with a question
 *     to answer, the star stars and neither answers nor opens (CONTROL: a click elsewhere on that card answers);
 *   - a list repaint (as the 5 s poll does) keeps a focused star focused; a refused save says so;
 *   - on the narrowest tile the corner star does not overlap the unread badge, and in a list row it does not cover a
 *     long name; at 375 x 667 on a touch screen it is at least 44 px; on an upright tablet (touch, 768 x 1024) a
 *     running tile's long name does not run under it; in the consolidated rail it clears the row's unread badge and
 *     the title line under the name; on a touch screen its tap area is 44 x 44, inside its own row, and clear of the
 *     title's visible end and the unread badge;
 *   - a filled star is at least 3:1 on every tile and row ground in both themes (CONTROL: the brand gold is not).
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

async function open(browser, eng, w, h, theme, touchArg, dsf) {
  const touch = typeof touchArg === 'boolean' ? touchArg : w < 700;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: touch, isMobile: touch && eng === 'chromium', deviceScaleFactor: dsf || 1 });
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
          if (window.STAR_REFUSE) return enc({ error: 'unavailable' }, 503);   // a passing fault: the try-again line (review 10)
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
      // A long name, so the "does not cover the name" arms can fail; and the most unread, for the badge arms.
      // A long role too, so the rail's title line runs into the star's column and the touch arm's title test can fail.
      { ...mk('Dee', { lastTalkedAt: '2026-10-20T09:00:00Z', dmUnread: 120, role: 'Research coordinator for every project we run' }), name: 'Delphine Montgomery-Ashworth' },   // "99+", the widest badge
      // A running agent with a question to answer (its card carries data-answer), long-named for the tablet arm.
      { ...mk('Eve', { lastTalkedAt: '2026-10-20T08:00:00Z', running: true, state: 'needs_you', isNamedOurs: true, because: 'Which domain?' }),
        name: 'Evangeline Rutherford-Blackwood' },
      // Waiting at a workspace-trust prompt: the third tile path.
      mk('Fin', { lastTalkedAt: '2026-10-20T07:00:00Z', needsTrust: true, state: 'needs_trust' }),
    ];
    window.ANSWERED = [];
    window.pjAnswerFrom = (who) => { window.ANSWERED.push(who); };
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
        rowStars: document.querySelectorAll('#alist .lrow .lname .astar').length,
        paths: { running: !!document.querySelector('#grid .acard:not(.notrunning)[data-agent="eve"] > .astar'),
          off: !!document.querySelector('#grid .acard.off.notrunning[data-agent="ada"] > .astar'),
          trust: !!document.querySelector('#grid .acard.needstrust[data-agent="fin"] > .astar') } }));
      chk(counts.tiles === 6 && counts.tileStars === 6 && counts.rows === 6 && counts.rowStars === 6, `${t} every tile and every list row has a star`, JSON.stringify(counts));
      chk(counts.paths.running && counts.paths.off && counts.paths.trust, `${t} all three tile paths carry it (running, not running, trust prompt)`, JSON.stringify(counts.paths));
      const off = await star(page, '#grid', 'dee');
      chk(off && !off.on && off.label === 'Star Delphine Montgomery-Ashworth' && /none|transparent|rgba\(0, 0, 0, 0\)/.test(off.fill), `${t} a star starts as an outline, labelled "Star <name>"`, JSON.stringify(off));
      const START = ['ada', 'bea', 'cam', 'dee', 'eve', 'fin'];
      chk(JSON.stringify(await order(page, '#grid')) === JSON.stringify(START), `${t} CONTROL: the board's order before any star is Last talked to`, JSON.stringify(await order(page, '#grid')));

      // Star the last agent by clicking its tile star.
      await page.locator('#grid [data-star="dee"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 1);
      await page.waitForTimeout(50);
      const g1 = await order(page, '#grid'); const l1 = await order(page, '#alist');
      const on = await star(page, '#grid', 'dee');
      const opened = await page.evaluate(() => (typeof CURRENT !== 'undefined' && CURRENT ? CURRENT.sessionName : null));
      chk(g1[0] === 'dee' && l1[0] === 'dee', `${t} the starred agent moves first in the grid and the list`, JSON.stringify({ g1, l1 }));
      chk(on && on.on && on.label === 'Unstar Delphine Montgomery-Ashworth' && !/none|transparent|rgba\(0, 0, 0, 0\)/.test(on.fill), `${t} its star fills and reads "Unstar <name>"`, JSON.stringify(on));
      chk(JSON.stringify(await page.evaluate(() => window.STAR_PUTS)) === JSON.stringify([{ name: 'dee', on: true }]), `${t} one PUT with { name, on: true }`, JSON.stringify(await page.evaluate(() => window.STAR_PUTS)));
      chk(!opened, `${t} the star does not open the agent`, String(opened));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `star-${eng}-${theme}.png`) });

      // A second star: the starred group keeps the chosen order (Cam talked before Dee).
      await page.locator('#grid [data-star="cam"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 2);
      await page.waitForTimeout(50);
      const g2 = await order(page, '#grid');
      chk(JSON.stringify(g2) === JSON.stringify(['cam', 'dee', 'ada', 'bea', 'eve', 'fin']), `${t} two starred agents keep Last talked to among themselves, then the rest`, JSON.stringify(g2));

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
      chk(JSON.stringify(await order(page, '#grid')) === JSON.stringify(START), `${t} Unstar puts the order back`, JSON.stringify(await order(page, '#grid')));

      // A star on a card with a question: it stars, and neither answers nor opens.
      await page.locator('#grid [data-star="eve"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 5);
      await page.waitForTimeout(50);
      const ans = await page.evaluate(() => ({ answered: window.ANSWERED.slice(), opened: typeof CURRENT !== 'undefined' && CURRENT ? CURRENT.sessionName : null,
        first: [...document.querySelectorAll('#grid [data-agent]')][0].dataset.agent }));
      chk(ans.answered.length === 0 && !ans.opened && ans.first === 'eve', `${t} a star on a card with a question stars it and neither answers nor opens`, JSON.stringify(ans));
      await page.locator('#grid [data-star="eve"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 6);
      // CONTROL: a click elsewhere on that card does answer, so the arm above can fail.
      await page.locator('#grid .acard[data-agent="eve"] .agauge').click();   // the avatar: always drawn, never empty
      await page.waitForTimeout(50);
      chk(JSON.stringify(await page.evaluate(() => window.ANSWERED)) === JSON.stringify(['eve']), `${t} CONTROL: a click elsewhere on that card answers`, JSON.stringify(await page.evaluate(() => window.ANSWERED)));

      // A list repaint, as the 5 s poll does, keeps a focused star focused.
      // In the list layout, where the list is on screen (a hidden list's star cannot take focus at all).
      await page.evaluate(() => { BOARD_LAYOUT = 'list'; boardApplyVisibility(true); repaintAgentOrder(); });
      await page.focus('#alist [data-star="cam"]');
      const kept = await page.evaluate(() => {
        const before = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.star : null;
        paintAgentList(); const a = document.activeElement;
        return { before, star: a && a.dataset ? a.dataset.star : null, inList: !!(a && a.closest && a.closest('#alist')) };
      });
      // Review 8: and it does not scroll the page back to that star. The person scrolled away after pressing it; the
      // poll's repaint must leave the page where they put it. CONTROL: the page did scroll, so the arm can fail.
      const scroll = await page.evaluate(() => {
        document.body.style.minHeight = '4000px';
        window.scrollTo(0, 0);
        document.querySelector('#alist [data-star="cam"]').focus({ preventScroll: true });
        window.scrollTo(0, 2000);
        const moved = window.scrollY;
        paintAgentList();
        const a = document.activeElement;
        return { moved, after: window.scrollY, star: a && a.dataset ? a.dataset.star : null };
      });
      await page.evaluate(() => { document.body.style.minHeight = ''; window.scrollTo(0, 0); });
      chk(scroll.moved > 0 && scroll.after === scroll.moved && scroll.star === 'cam', `${t} that repaint does not scroll the page back to the star (CONTROL: the page had scrolled)`, JSON.stringify(scroll));
      await page.evaluate(() => { BOARD_LAYOUT = 'grid'; boardApplyVisibility(true); repaintAgentOrder(); });
      chk(kept.before === 'cam' && kept.star === 'cam' && kept.inList, `${t} a list repaint (the poll's) keeps a focused star focused (CONTROL: it had focus before)`, JSON.stringify(kept));

      // A refused save puts the star back.
      await page.evaluate(() => { window.STAR_REFUSE = true; });
      await page.locator('#grid [data-star="bea"]').click();
      await page.waitForFunction(() => window.STAR_PUTS.length === 7);
      await page.waitForTimeout(100);
      const refused = await star(page, '#grid', 'bea');
      const said = await page.evaluate(() => { const m = document.getElementById('board-msg'); return { text: m ? m.textContent : '', shown: !!(m && !m.hidden && m.getClientRects().length > 0) }; });
      chk(refused && !refused.on && (await order(page, '#grid'))[0] === 'ada', `${t} a refused save puts the star back`, JSON.stringify(refused));
      chk(/could not be saved/.test(said.text) && said.shown, `${t} a refused save says so, on screen (not only in the text)`, JSON.stringify(said));
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
    // The narrowest tile with a mouse (the 36 px star) and with touch (44 px), and a phone.
    for (const [w, h, touch] of [[300, 900, false], [300, 900, true], [375, 667, true]]) {
      const t = `[${eng} ${w}x${h} ${touch ? 'touch' : 'mouse'}]`;
      const { ctx, page, errs } = await open(browser, eng, w, h, 'light', touch);
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
      if (touch) chk(geo.starW >= 44 && geo.starH >= 44, `${t} on a touch screen the star is at least 44 px`, JSON.stringify(geo));
      else chk(geo.starW === 36, `${t} CONTROL: with a mouse it is the 36 px star, so the badge arm measured that size`, JSON.stringify(geo));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `star-${eng}-${w}-${touch ? 'touch' : 'mouse'}.png`) });
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    // An upright tablet: a running tile lays out sideways with the name at its top right, under the corner star's row.
    {
      const t = `[${eng} 768x1024 tablet]`;
      const { ctx, page, errs } = await open(browser, eng, 768, 1024, 'light', true);   // a tablet is a touch screen
      const tab = await page.evaluate(() => {
        const tile = document.querySelector('#grid .acard[data-agent="eve"]');
        const r = (el) => el.getBoundingClientRect();
        const s = r(tile.querySelector('.astar')); const nm = r(tile.querySelector('.aname .namego'));
        const hit = !(s.right <= nm.left || nm.right <= s.left || s.bottom <= nm.top || nm.bottom <= s.top);
        return { sideways: getComputedStyle(tile.querySelector('.aname')).gridArea.startsWith('n'), clear: !hit, starW: Math.round(s.width) };
      });
      if (tab.sideways) chk(tab.clear, `${t} a running tile's long name does not run under the star`, JSON.stringify(tab));
      else console.log(`NOTE  ${t} this engine did not apply the upright-tablet layout (no coarse pointer here), so its arm did not run`);
      if (eng === 'chromium') chk(tab.sideways, `${t} CONTROL: chromium applies the upright-tablet layout, so the arm above ran`, JSON.stringify(tab));
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    // Review 13: a filled star is a glyph, so it needs 3:1 on every ground it sits on: the plain, working and needs-you
    // tiles and the list row, in both themes. The grounds are composited from the page's own tokens. CONTROL: the
    // brand gold measured the same way fails in light, so the instrument can return the dangerous answer.
    // #7339: the star is FILLED with --gold-bright (Josh: "the brightest gold that we have") and its EDGE is the button's
    // colour. The 3:1 is the edge's job, so `edge` below is what is measured; the fill is checked to be --gold-bright.
    // #7339 review 1: 'forced-dark' is the in-app Dark setting (data-theme="dark" on a light system), which has its own rule.
    for (const theme of ['light', 'dark', 'forced-dark']) {
      const t = `[${eng} ${theme} filled-star contrast]`;
      const { ctx, page, errs } = await open(browser, eng, 1280, 900, theme === 'forced-dark' ? 'light' : theme);
      if (theme === 'forced-dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      const c = await page.evaluate(() => {
        const st = document.querySelector('#grid .astar');
        if (!st) return { star: false };
        st.classList.add('on');
        const rgb = (v) => { const m = String(v).match(/[\d.]+/g); return m ? m.map(Number) : null; };
        const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        const probe = document.createElement('i'); document.body.appendChild(probe);
        const resolve = (v) => { probe.style.color = v; return rgb(getComputedStyle(probe).color); };
        const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const over = (bg, wash) => (wash && wash.length === 4 ? bg.map((v, i) => v * (1 - wash[3]) + wash[i] * wash[3]) : bg);
        const surface = resolve(css('--k-surface'));
        const grounds = { plain: surface, working: over(surface, resolve(css('--wash-working'))), attn: over(surface, resolve(css('--wash-attn'))), row: over(surface, [120, 120, 128, 0.07]) };
        const edge = rgb(getComputedStyle(st).color); const brand = resolve(css('--gold-deep'));
        const ps = getComputedStyle(st.querySelector('svg path'));
        const fill = rgb(ps.fill); const bright = resolve(css('--gold-bright'));
        // The edge is what is DRAWN: the path's own stroke, which must be the button's colour and actually painted.
        const stroke = rgb(ps.stroke); const strokeW = parseFloat(ps.strokeWidth);
        const drawn = !!stroke && stroke.slice(0, 3).join() === edge.slice(0, 3).join() && strokeW > 0;
        const out = { star: true, edge, stroke, strokeW, drawn, fill, brightFill: !!fill && !!bright && fill.slice(0, 3).join() === bright.slice(0, 3).join(), min: Infinity, brandMin: Infinity, by: {} };
        for (const [k, g] of Object.entries(grounds)) { const r = ratio(edge, g); out.by[k] = +r.toFixed(2); out.min = Math.min(out.min, r); out.brandMin = Math.min(out.brandMin, ratio(brand, g)); }
        out.min = +out.min.toFixed(2); out.brandMin = +out.brandMin.toFixed(2);
        probe.remove(); st.classList.remove('on');
        return out;
      });
      chk(c.star && c.brightFill, `${t} #7339: the filled star is filled with --gold-bright, the brightest gold`, JSON.stringify(c));
      chk(c.star && c.drawn, `${t} #7339: the edge is drawn, the path's stroke in the button's colour`, JSON.stringify(c));
      chk(c.star && c.min >= 3, `${t} the filled star's edge is at least 3:1 on every tile and row ground`, JSON.stringify(c));
      if (theme === 'light') chk(c.star && c.brandMin < 3, `${t} CONTROL: the brand gold measured the same way is under 3:1 here`, JSON.stringify(c));
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    // #7339 reviews 1 and 2: the edge as DRAWN, not as declared. EVERY star is photographed starred, on its own tile
    // or row (plain, working, needs-you), at rest and hovered, in the grid (18px) and the consolidated rail (15px),
    // on 1x, 1.5x and 2x screens. The ground is read inside the star's own button (1px around the icon), so a hover
    // tint is what the edge is measured against. Each star's outline (star pixels touching the ground) must have a
    // pixel of 3:1 or more within one device pixel on at least 80% of it: the outermost pixel is always part-blended,
    // so it alone is never the measure. CONTROLS: the same star with no edge fails, and a 1-unit icon-space edge
    // (review 1's blocker) fails at 1x, so the instrument can return the dangerous answer.
    const scoreStar = async (page, loc) => {
      const png = await loc.screenshot({ padding: 1 }).catch(() => null);
      if (!png) return null;
      return page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height, px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const lum = ([r, gg, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const ground = px(0, 0); const isStar = (x, y) => ratio(px(x, y), ground) > 1.15;
        let outline = 0, strong = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          if (!isStar(x, y)) continue;
          if (isStar(x - 1, y) && isStar(x + 1, y) && isStar(x, y - 1) && isStar(x, y + 1)) continue;
          outline++;
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = ratio(px(x + dx, y + dy), ground) >= 3;
          if (near) strong++;
        }
        return { outline, share: outline ? +(strong / outline).toFixed(2) : 0 };
      }, png.toString('base64'));
    };
    for (const dsf of [1, 1.5, 2]) {
      for (const where of ['grid', 'rail']) {
        const t = `[${eng} light ${dsf}x ${where} drawn edge]`;
        const { ctx, page, errs } = await open(browser, eng, 1280, 900, 'light', false, dsf);
        const sel = await page.evaluate((where) => {
          if (where === 'rail') { document.documentElement.setAttribute('data-layout', 'consolidated'); showTab('projects'); repaintAgentOrder(); }
          const stars = [...document.querySelectorAll(where === 'rail' ? '#alist .lrow .lname .astar' : '#grid .acard > .astar')];
          stars.forEach((s, k) => { s.classList.add('on'); s.setAttribute('data-px', String(k)); });
          return stars.map((s, k) => ({ k, ground: (s.closest('.acard, .lrow') || {}).className || '' }));
        }, where);
        chk(sel.length >= 3, `${t} CONTROL: at least three stars to measure`, JSON.stringify(sel.length));
        const fails = []; let measured = 0;
        for (const { k, ground } of sel) {
          const loc = page.locator(`[data-px="${k}"] svg`);
          for (const hover of [false, true]) {
            if (hover) await page.locator(`[data-px="${k}"]`).hover().catch(() => {}); else await page.mouse.move(1, 1);
            const r = await scoreStar(page, loc);
            if (!r || !r.outline) continue;
            measured++;
            if (r.share < 0.8) fails.push(`${k}${hover ? ' hovered' : ''} (${ground.replace(/\s+/g, '.')}): ${r.share}`);
          }
        }
        await page.mouse.move(1, 1);
        chk(measured >= 6 && fails.length === 0, `${t} every starred star, at rest and hovered, has a 3:1 edge on 80% of its outline`, `measured ${measured}; ${fails.join(' | ') || 'none under'}`);
        if (where === 'grid') {
          const first = page.locator('[data-px="0"] svg');
          await page.evaluate(() => { const p = document.querySelector('[data-px="0"] svg path'); if (p) p.style.stroke = 'none'; });
          const bare = await scoreStar(page, first);
          chk(!!bare && bare.outline > 0 && bare.share < 0.8, `${t} CONTROL: the same star with no edge fails this measure`, JSON.stringify(bare));
          if (dsf === 1) {
            await page.evaluate(() => { const p = document.querySelector('[data-px="0"] svg path'); if (p) { p.style.stroke = ''; p.style.vectorEffect = 'none'; p.style.strokeWidth = '1'; } });
            const thin = await scoreStar(page, first);
            chk(!!thin && thin.outline > 0 && thin.share < 0.8, `${t} CONTROL: a 1-unit icon-space edge (review 1) fails this measure`, JSON.stringify(thin));
          }
          if (dsf === 2) {
            const w = await page.evaluate(() => { const p = document.querySelector('[data-px="1"] svg path'); return p ? getComputedStyle(p).strokeWidth : ''; });
            chk(w === '0.75px', `${t} a 2x screen draws the thin .75px edge`, w);
          }
        }
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
    }
    // Dark edges, both dark paths: the edge is --gold-bright (the old --gold-deep is what Josh called dingy).
    for (const theme of ['dark', 'forced-dark']) {
      const t = `[${eng} ${theme} edge colour]`;
      const { ctx, page, errs } = await open(browser, eng, 1280, 900, theme === 'forced-dark' ? 'light' : theme);
      const r = await page.evaluate((theme) => {
        if (theme === 'forced-dark') document.documentElement.setAttribute('data-theme', 'dark');
        const st = document.querySelector('#grid .astar'); if (!st) return null; st.classList.add('on');
        const probe = document.createElement('i'); document.body.appendChild(probe);
        probe.style.color = 'var(--gold-bright)'; const bright = getComputedStyle(probe).color; probe.remove();
        return { edge: getComputedStyle(st).color, bright };
      }, theme);
      chk(!!r && r.edge === r.bright, `${t} the starred star's edge is --gold-bright`, JSON.stringify(r));
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    // High contrast (forced colors): the fill gives way to the system colour, as before #7339. Chromium emulates it.
    if (eng === 'chromium') {
      const t = `[${eng} forced colors]`;
      const { ctx, page, errs } = await open(browser, eng, 1280, 900, 'light');
      await page.emulateMedia({ forcedColors: 'active' });
      const r = await page.evaluate(() => { const st = document.querySelector('#grid .astar'); if (!st) return null; st.classList.add('on');
        return { fill: getComputedStyle(st.querySelector('svg path')).fill, color: getComputedStyle(st).color }; });
      chk(!!r && r.fill === r.color, `${t} the starred star is filled with the system colour`, JSON.stringify(r));
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    // The consolidated rail: name and title stack in one column, and the unread badge hangs off the row's corner.
    {
      const t = `[${eng} consolidated rail]`;
      const { ctx, page, errs } = await open(browser, eng, 1280, 900, 'light');
      const rail = await page.evaluate(() => {
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');
        repaintAgentOrder();
        const row = document.querySelector('#alist .lrow[data-agent="dee"]');
        if (!row) return { row: false };
        const r = (el) => (el ? el.getBoundingClientRect() : null);
        const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const s = r(row.querySelector('.lname .astar')); const b = r(row.querySelector(':scope > .dmbadge'));
        // The VISIBLE name is the name cell's own box (its text is clipped there); the button inside can run on under
        // the star unseen, and a press there reaches the star, which is on top.
        const title = r(row.querySelector('.ltitle')); const nm = r(row.querySelector('.lname > b'));
        return { row: true, cons: document.body.classList.contains('consolidated'), sized: !!(s && s.width > 0), badge: !!b,
          badgeClear: b ? !hit(s, b) : null, titleClear: title && title.width > 0 ? !hit(s, title) : null, nameClear: nm ? !hit(s, nm) : null,
          // The boxes themselves, so a failure says by how much and on which axis, not only that they touch.
          starBox: s && [s.left, s.top, s.right, s.bottom].map(Math.round), badgeBox: b && [b.left, b.top, b.right, b.bottom].map(Math.round),
          rowBox: [r(row).left, r(row).top, r(row).right, r(row).bottom].map(Math.round) };
      });
      chk(rail.row && rail.cons && rail.sized, `${t} CONTROL: the rail is drawn, consolidated, with a star`, JSON.stringify(rail));
      chk(rail.badge && rail.badgeClear === true, `${t} the star clears the row's unread badge`, JSON.stringify(rail));
      chk(rail.titleClear === true && rail.nameClear === true, `${t} the star clears the long name and the title line under it`, JSON.stringify(rail));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `star-${eng}-rail.png`) });
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    // Review 12: a touch tablet held sideways opens on the rail, so on a coarse pointer the rail star takes a tap a
    // little outside its drawn 26 x 20 box (an invisible 44px hit area), kept inside its own row (review 13).
    {
      const t = `[${eng} consolidated rail, touch]`;
      const { ctx, page, errs } = await open(browser, eng, 1280, 900, 'light', true);
      const hit = await page.evaluate(() => {
        document.documentElement.setAttribute('data-layout', 'consolidated');
        showTab('projects');
        repaintAgentOrder();
        const s = document.querySelector('#alist .lrow[data-agent="dee"] .lname .astar');
        if (!s) return { star: false };
        const b = s.getBoundingClientRect(); const cx = b.left + b.width / 2;
        const row = s.closest('.lrow').getBoundingClientRect();
        const at = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest && e.closest('.astar') === s); };
        // Review 13: scan the whole hit area, so a miss says by how much. Down the star's centre line and across its middle.
        let top = null, bottom = null, left = null, right = null;
        for (let y = Math.floor(row.top) - 20; y <= Math.ceil(row.bottom) + 20; y++) if (at(cx, y)) { if (top === null) top = y; bottom = y; }
        const cy = top === null ? b.top + b.height / 2 : (top + bottom) / 2;
        for (let x = Math.floor(b.left) - 30; x <= Math.ceil(b.right) + 30; x++) if (at(x, cy)) { if (left === null) left = x; right = x; }
        // The title's visible end (its content box: a long title is clipped there with an ellipsis, while its text range
        // runs on past the row) must not be under the hit area, or a tap there stars instead of opening. CONTROL: with
        // the title's padding cut to 44px (the middle of the area, 22 to 66px in), the same probe does land on the star,
        // so this can fail (review 14; review 15: at 0px the probe sat right of the area and the control could not pass).
        const tt = s.closest('.lrow').querySelector('.ltitle');
        const titleEndAt = () => { const r = tt.getBoundingClientRect(); const cs = getComputedStyle(tt);
          return { x: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) - 1, y: r.top + r.height / 2 }; };
        let titleUnder = null, titleUnderUnpadded = null, titleClipped = null;
        if (tt) {
          titleClipped = tt.scrollWidth > tt.clientWidth;
          const e1 = titleEndAt(); titleUnder = at(e1.x, e1.y);
          tt.style.paddingRight = '44px'; const e0 = titleEndAt(); titleUnderUnpadded = at(e0.x, e0.y); tt.style.paddingRight = '';
        }
        // The "99+" badge takes no taps, so a hit area over it would star the agent when the badge is pressed.
        const bd = s.closest('.lrow').querySelector(':scope > .dmbadge');
        const bb = bd && bd.getBoundingClientRect();
        const badgeUnder = bb && bb.width > 0 ? at(bb.left + 1, bb.top + bb.height / 2) || at(bb.left + 1, cy) : null;
        return { star: true, coarse: matchMedia('(pointer: coarse)').matches, drawn: [Math.round(b.width), Math.round(b.height)],
          span: top === null ? null : [bottom - top + 1, right - left + 1], area: top === null ? null : [left, top, right, bottom],
          rowBox: [row.left, row.top, row.right, row.bottom].map(Math.round),
          titleClipped, titleUnder, titleUnderUnpadded, badgeUnder, badgeBox: bb && [bb.left, bb.top, bb.right, bb.bottom].map(Math.round),
          far: at(cx, b.bottom + 30) };
      });
      if (hit.coarse) {
        chk(hit.star && hit.span && hit.span[0] >= 44 && hit.span[1] >= 44, `${t} the rail star's tap area is at least 44 x 44`, JSON.stringify(hit));
        chk(hit.star && hit.area && hit.area[1] >= hit.rowBox[1] && hit.area[3] < hit.rowBox[3], `${t} the tap area stays inside its own row (a tap on the row above opens that agent)`, JSON.stringify(hit));
        chk(hit.star && hit.titleClipped === true, `${t} CONTROL: the long title is clipped, so it runs to its visible edge`, JSON.stringify(hit));
        chk(hit.star && hit.titleUnder === false, `${t} the title's visible end is not under the tap area (a tap there opens the agent)`, JSON.stringify(hit));
        chk(hit.star && hit.titleUnderUnpadded === true, `${t} CONTROL: with its padding cut to 44px the title's end IS under the tap area, so the test above can fail`, JSON.stringify(hit));
        chk(hit.star && hit.badgeUnder === false, `${t} the tap area ends short of the unread badge`, JSON.stringify(hit));
        chk(hit.star && !hit.far, `${t} CONTROL: a tap 30px below the star does not reach it`, JSON.stringify(hit));
      }
      else console.log(`NOTE  ${t} this engine reports no coarse pointer here, so the touch arm did not run`);
      if (eng === 'chromium') chk(hit.coarse === true, `${t} CONTROL: chromium reports a coarse pointer, so the arm above ran`, JSON.stringify(hit));
      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await ctx.close();
    }
    await browser.close();
  }
  console.log(`render-star-6719: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
