'use strict';

/**
 * kosmos#2806 (asks 1 + 2): in the PROJECT ROOM, the person's OWN message body
 * wears a light royal-blue box and an AGENT's wears a light gray box -- the same
 * two tokens the DM view already uses (--usermsg-tint / --k-sunk), now reaching the
 * room's `.msg` rows via a `.msg-bd` wrapper around the message body.
 *
 * Josh, 2026-09-11 (testing 0.6.56), on the room screenshot: "we didn't implement
 * the light blue background for my messages ... for the agents let's put in a light
 * gray box for them." #2805 gave the DM (`.dm-b`) its gray; the room uses a
 * different class (`.msg-b`) that had neither color, so both are new here.
 *
 * WHAT IT MEASURES (a relationship, not a literal rgba, so Josh can retune either
 * color and this stays green):
 *   (a) the operator body box (.msg.you .msg-bd) is FILLED (not transparent);
 *   (b) it is BLUE (blue channel dominant), not gray or the surface;
 *   (c) the agent body box (.msg:not(.you) .msg-bd) is FILLED and a warm cream
 *       (R>=G>=B), not a neutral gray or the blue (#2947);
 *   (d) the two boxes are DISTINCT from each other;
 *   (e) a BODYLESS row (no words, no cards) draws a `.msg` row but NO `.msg-bd`
 *       -- so there is no empty tinted box.
 *
 * It renders REAL pjRoomRow output (never a copy) into the loaded page, so the
 * `:root` color tokens and the `.msg-bd` rules apply exactly as shipped. DOM +
 * computed-style only, so headless and headed agree.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-room-msgbox-2806.js
 *
 * HEADED by default (like its siblings). HEADED=0 on a machine with no console.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

/* rgb/rgba string -> [r,g,b,a]. "transparent" and rgba(...,0) both give a=0. */
function parse(c) {
  if (!c || c === 'transparent') return [0, 0, 0, 0];
  // #2947: Chromium serializes a color-mix() result (the per-message cream
  // shade, .msg-bd[data-am]) as `color(srgb r g b [/ a])` with 0..1 components.
  // Without scaling them, spread/blueLead collapse to ~0 and the arms pass
  // VACUOUSLY; detect the srgb form and lift the three components to 0..255.
  const srgb = /^color\(\s*srgb\b/i.test(c);
  const n = (c.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return [0, 0, 0, 0];
  const s = srgb ? 255 : 1;
  return [n[0] * s, n[1] * s, n[2] * s, n.length > 3 ? n[3] : 1];
}
/* Channel spread of an rgb triple -- 0 for a perfect gray. */
function spread(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]); }
/* How much the blue channel leads the larger of red/green -- positive and large
   for the royal blue, ~0 (or negative) for a neutral gray. */
function blueLead(rgb) { return rgb[2] - Math.max(rgb[0], rgb[1]); }

const now = () => new Date().toISOString();

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADED === '0',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        // Loaded over file://, so the page's own /api/* polls cannot resolve.
        // That is this harness's condition (no server), not a page defect.
        if (/ERR_FILE_NOT_FOUND|URL scheme "file" is not supported/.test(m.text())) return;
        errs.push('console ' + m.text());
      });
      // Refuse the app's 5s polls so they neither race the render nor fill the
      // console against file:// (same posture as render-agent-msg-gray-2805.js).
      await page.addInitScript(() => {
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      });
      await page.goto(PAGE);

      const m = await page.evaluate((ts) => {
        if (typeof pjRoomRow !== 'function') return { error: 'pjRoomRow is not a function' };
        const p = { agents: [{ sessionName: 'april', name: 'April' }] };
        const opMsg = { operator: true, at: ts, text: 'moving everyone to the new account now.' };
        const agentMsg = { from: 'april', at: ts, text: 'on it, board cleared.' };
        // A row with no words and no files: the body is empty, so no .msg-bd.
        const emptyMsg = { operator: true, at: ts, text: '' };
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:0;width:640px;';
        host.innerHTML = pjRoomRow(opMsg, p) + pjRoomRow(agentMsg, p) + pjRoomRow(emptyMsg, p);
        document.body.appendChild(host);
        const rows = Array.from(host.querySelectorAll('.msg'));
        const opRow = rows.find((r) => r.classList.contains('you') && r.querySelector('.msg-bd'));
        const agentRow = rows.find((r) => !r.classList.contains('you'));
        const emptyRow = rows.find((r) => r.classList.contains('you') && !r.querySelector('.msg-bd'));
        const bg = (el) => (el ? getComputedStyle(el).backgroundColor : null);
        const out = {
          rowCount: rows.length,
          opBd: bg(opRow && opRow.querySelector('.msg-bd')),
          agentBd: bg(agentRow && agentRow.querySelector('.msg-bd')),
          // The bodyless row: it must be a .msg.you row that has NO .msg-bd at all.
          emptyRowIsYou: !!emptyRow,
          emptyRowHasBox: !!(emptyRow && emptyRow.querySelector('.msg-bd')),
          agentHasYou: agentRow ? agentRow.classList.contains('you') : null,
        };
        host.remove();
        return out;
      }, now());

      const t = `[${theme}]`;
      if (m.error) { chk(false, `${t} render`, m.error); await page.close(); continue; }

      // Positive controls: all three rows rendered, and the mine/theirs split is real.
      chk(m.rowCount === 3, `${t} all three fixture rows rendered`, `count=${m.rowCount}`);
      chk(m.agentHasYou === false, `${t} the agent row is NOT .you (mine/theirs split is real)`);

      const op = parse(m.opBd);
      const ag = parse(m.agentBd);
      // (a) operator box filled.
      chk(op[3] > 0, `${t} the operator body box (.msg.you .msg-bd) carries a fill`, m.opBd);
      // (b) operator box is blue, not gray/surface.
      chk(blueLead(op) >= 20, `${t} the operator box is BLUE (blue channel leads)`, `${m.opBd} lead=${blueLead(op).toFixed(0)}`);
      // (c) agent box filled AND a warm cream (#2947), not the blue.
      chk(ag[3] > 0, `${t} the agent body box (.msg:not(.you) .msg-bd) carries a fill`, m.agentBd);
      chk(ag[0] >= ag[1] && ag[1] >= ag[2] && (ag[0] - ag[2]) >= 2 && blueLead(ag) < 20,
        `${t} the agent box is a warm cream (R>=G>=B), not a neutral gray or the blue`,
        `${m.agentBd} rgb=[${ag.slice(0, 3).map((x) => x.toFixed(1)).join(', ')}]`);
      // (d) the two are distinct (blue vs gray differ well beyond the alpha).
      chk(blueLead(op) - blueLead(ag) >= 20, `${t} the operator blue and agent gray are distinct`, `op=${m.opBd} agent=${m.agentBd}`);
      // (e) a bodyless row draws NO box.
      chk(m.emptyRowIsYou && !m.emptyRowHasBox, `${t} a bodyless row draws a .msg row but NO .msg-bd (no empty tinted box)`, `isYou=${m.emptyRowIsYou} hasBox=${m.emptyRowHasBox}`);

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
