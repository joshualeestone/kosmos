'use strict';
// Browser-check-surface: MULTI_KOSMOS worldsw-onekosmos worldsw-fixed worldswOneKosmos
// (#2518) the distinctive web/index.html tokens this check asserts: one Kosmos per computer (kosmos#4815).
/* kosmos#4815 (Josh, #admin 2026-09-30 19:50): "I want to remove multiple Kosmoses ... I just want it commented out
 * so that it's not visible on anything." The structure stays behind one switch (MULTI_KOSMOS, default off).
 *
 * On a board with TWO Kosmoses, rendered through the SHIPPED worldswRender and computersFetch (the computers read
 * is stubbed), in the real page, both engines, light and dark:
 *   - one computer on the account: the top-left says that computer's name, has no chevron and no border, does
 *     not open, and no "Kosmoses" or "New Kosmos" is visible anywhere on the page;
 *   - not signed in (the route's { ok: false }): it says "This computer", the same way;
 *   - four computers: it names this one, opens, and the menu holds ONLY Your computers (no Kosmoses list, no New
 *     Kosmos, and no separator above the section, since nothing sits above it);
 *   - CONTROL, the answer this check must be able to give: with the switch back on (localStorage
 *     kosmos.multiKosmos = 1), the same board shows the Kosmoses list, New Kosmos and "Kosmos 1".
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-onekosmos-4815.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const playwright = require('playwright');
const ENGINES = ['chromium', 'webkit'];
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const DOMAIN = 'kosmosplus.example';
const ME = { name: 'studio-laptop', address: 'studio-laptop.' + DOMAIN, this: true, online: true };
const ANSWERS = {
  one: { ok: true, domain: DOMAIN, computers: [ME] },
  none: { ok: false },
  four: { ok: true, domain: DOMAIN, computers: [ME,
    { name: 'desk-mini', address: 'desk-mini.' + DOMAIN, this: false, online: true },
    { name: 'render-box', address: 'render-box.' + DOMAIN, this: false, online: true, updating: true },
    { name: 'garage-pc', address: 'garage-pc.' + DOMAIN, this: false, online: false }] },
};
const WORLDS = { worlds: [{ id: 'w1', name: 'Kosmos 1' }, { id: 'w2', name: 'Client work' }], activeWorldId: 'w1', bootedWorldId: 'w1' };

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    for (const theme of ['light', 'dark']) {
      for (const multi of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
        if (multi) await page.addInitScript(() => { try { localStorage.setItem('kosmos.multiKosmos', '1'); } catch {} });
        const HARNESS = /ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)|access control checks|Cross origin requests are only supported for HTTP|Not allowed to load local resource/;
        page.on('pageerror', (e) => { if (!HARNESS.test(e.message)) problems.push(`[${engine} ${theme}] pageerror: ${e.message}`); });
        await page.addInitScript((answers) => {
          window.setInterval = () => 0;
          window.__answers = answers; window.__which = 'one';
          const real = window.fetch;
          window.fetch = (url, opts) => {
            if (String(url).indexOf('/api/remote/computers') !== -1) {
              return Promise.resolve(new Response(JSON.stringify(window.__answers[window.__which]), { status: 200, headers: { 'content-type': 'application/json' } }));
            }
            return real(url, opts);
          };
        }, ANSWERS);
        await page.goto(PAGE);
        const t = `[${engine} ${theme}${multi ? ' switch ON' : ''}]`;

        /* Render the two-Kosmos board through the shipped functions, with one computers answer, then read it. */
        const read = (which) => page.evaluate(async ({ worlds, which }) => {
          const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
          window.__which = which;
          worldswClose();
          worldswRender(worlds, {});
          await computersFetch();
          const sw = document.getElementById('worldsw'), btn = document.getElementById('worldsw-btn');
          const chev = btn.querySelector('.worldsw-chev');
          const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
          const out = {
            name: document.getElementById('worldsw-name').textContent,
            chev: !!chev && getComputedStyle(chev).display !== 'none',
            border: getComputedStyle(btn).borderTopColor,
            listShown: vis('worldsw-list'), newShown: vis('worldsw-new'),
          };
          btn.click();
          await new Promise((r) => setTimeout(r, 50));
          out.opened = vis('worldsw-menu');
          out.listInMenu = vis('worldsw-list'); out.newInMenu = vis('worldsw-new'); out.computers = vis('worldsw-computers');
          out.sepAbove = getComputedStyle(document.getElementById('worldsw-computers')).borderTopWidth;
          // Every visible word on the page, menu open: "Kosmoses" (plural) and "New Kosmos" must be nowhere.
          out.plural = /Kosmoses|New Kosmos/.test(document.body.innerText);
          worldswClose();
          return out;
        }, { worlds: WORLDS, which });

        if (!multi) {
          const one = await read('one');
          ok(`${t} one computer: the top-left says its name`, one.name === 'studio-laptop', one.name);
          ok(`${t} one computer: no chevron, no border, nothing opens`, !one.chev && one.border === 'rgba(0, 0, 0, 0)' && !one.opened, JSON.stringify(one));
          ok(`${t} one computer: no Kosmoses list, no New Kosmos, no "Kosmoses" or "New Kosmos" on the page`, !one.listShown && !one.newShown && !one.plural, JSON.stringify(one));
          const none = await read('none');
          ok(`${t} not signed in: it says This computer, and does not open`, none.name === 'This computer' && !none.chev && !none.opened && !none.plural, JSON.stringify(none));
          const four = await read('four');
          ok(`${t} four computers: it names this one and opens`, four.name === 'studio-laptop' && four.chev && four.opened, JSON.stringify(four));
          ok(`${t} four computers: the menu holds only Your computers, with no separator above it`,
            four.computers && !four.listInMenu && !four.newInMenu && four.sepAbove === '0px' && !four.plural, JSON.stringify(four));
        } else {
          const c = await read('one');
          ok(`${t} CONTROL: with the switch on, the Kosmoses list, New Kosmos and "Kosmos 1" are back`,
            c.name === 'Kosmos 1' && c.opened && c.listInMenu && c.newInMenu && c.plural, JSON.stringify(c));
        }
        await page.close();
      }
    }
    await browser.close();
  }
  console.log(problems.length ? `FAIL ${problems.length}:\n  ${problems.join('\n  ')}` : 'all checks passed');
  console.log(`${pass}/${pass + problems.length} passed`);
  // 2 engines x 2 themes x (6 arms off + 1 control) = 28.
  process.exit(problems.length || pass + problems.length < 28 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
