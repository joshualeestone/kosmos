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
 * #3134-followup (Josh 6.72) extends this to the bubble rework, all also measured on
 * the real pjRoomRow output:
 *   (f) the agent NAME is INSIDE the bubble as `.msg-nm`, the FIRST child (top); the
 *       operator's OWN post carries no name;
 *   (g) the TIMESTAMP is INSIDE the bubble (`.msg-bd .msg-t`), the LAST child
 *       (bottom-right), on both bubbles;
 *   (h) the inline delivery receipt (`.delivery`, "Placed with X ...") is GONE;
 *   (i) the TAIL is a WING: the colored `::before` is anchored at a negative offset
 *       (agent=cream on the left, operator=blue on the right) and the `::after` is the
 *       thread-ground mask that carves the Option A curve. #3267: the wing now OVERLAPS
 *       the box (Option A geometry) and `--usermsg-tint` is SOLID, so the overlap cannot
 *       double-tint (the solid fill composites once by construction);
 *   (j) the agent name + agent avatar are click-to-open (`data-open-agent`), the
 *       operator's own avatar is not; and the avatar is bottom-aligned (flex-end).
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
  // Defensive srgb scaler: Chromium serializes a color-mix() result as
  // `color(srgb r g b [/ a])` with 0..1 components, and without scaling them
  // spread/blueLead collapse to ~0 and the arms pass VACUOUSLY. The agent color
  // is now a plain hex (#3260 removed the color-mix nudges) so this branch is
  // currently inert, but kept so any future color-mix color is scaled, not
  // passed vacuously; detect the srgb form and lift the components to 0..255.
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
        // #3134-followup (Josh 6.72): an AGENT bodyless post must ALSO draw no .msg-bd --
        // the bubble is gated on body content, not on the name (`hasBubble = bd`), so a
        // name+timestamp-only tinted box is never drawn. The agentRow finder below picks
        // the FIRST agent row (agentMsg, which has a body); this fourth row is checked
        // separately as agentEmptyRow.
        const agentEmptyMsg = { from: 'april', at: ts, text: '' };
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:0;width:640px;';
        host.innerHTML = pjRoomRow(opMsg, p) + pjRoomRow(agentMsg, p) + pjRoomRow(emptyMsg, p) + pjRoomRow(agentEmptyMsg, p);
        document.body.appendChild(host);
        const rows = Array.from(host.querySelectorAll('.msg'));
        const opRow = rows.find((r) => r.classList.contains('you') && r.querySelector('.msg-bd'));
        const agentRow = rows.find((r) => !r.classList.contains('you') && r.querySelector('.msg-bd'));
        const emptyRow = rows.find((r) => r.classList.contains('you') && !r.querySelector('.msg-bd'));
        const agentEmptyRow = rows.find((r) => !r.classList.contains('you') && !r.querySelector('.msg-bd'));
        const bg = (el) => (el ? getComputedStyle(el).backgroundColor : null);
        const out = {
          rowCount: rows.length,
          opBd: bg(opRow && opRow.querySelector('.msg-bd')),
          agentBd: bg(agentRow && agentRow.querySelector('.msg-bd')),
          // The bodyless row: it must be a .msg.you row that has NO .msg-bd at all.
          emptyRowIsYou: !!emptyRow,
          emptyRowHasBox: !!(emptyRow && emptyRow.querySelector('.msg-bd')),
          // #3134-followup (Josh 6.72): the bodyless AGENT row also draws NO .msg-bd.
          agentEmptyRowExists: !!agentEmptyRow,
          agentEmptyHasBox: !!(agentEmptyRow && agentEmptyRow.querySelector('.msg-bd')),
          agentHasYou: agentRow ? agentRow.classList.contains('you') : null,
          // #3260: the REAL pjRoomRow render no longer emits data-am on the agent
          // body box (agent messages are one fixed color); null confirms it.
          agentDataAm: (agentRow && agentRow.querySelector('.msg-bd')) ? agentRow.querySelector('.msg-bd').getAttribute('data-am') : null,
          // #3260: data-am is no longer emitted for any row, so this stays false as
          // a redundant control alongside agentDataAm === null (it would catch a
          // regression that re-added the attribute on the operator's own box).
          opHasDataAm: !!(opRow && opRow.querySelector('.msg-bd') && opRow.querySelector('.msg-bd').hasAttribute('data-am')),
          /* #3134-followup (Josh 6.72): name is now INSIDE the bubble as .msg-nm (top).
             The operator's OWN post still has NO name; an agent's keeps its name. */
          opHasName: !!(opRow && opRow.querySelector('.msg-bd .msg-nm')),
          agentHasName: !!(agentRow && agentRow.querySelector('.msg-bd .msg-nm')),
          agentNameText: (agentRow && agentRow.querySelector('.msg-bd .msg-nm')) ? agentRow.querySelector('.msg-bd .msg-nm').textContent : null,
          /* #3134-followup (Josh 6.72): the timestamp is now INSIDE the bubble at the
             bottom-right (.msg-bd .msg-t), on BOTH the agent and the operator bubble,
             and it is the LAST child of the bubble (after the body). */
          agentTimeInBubble: !!(agentRow && agentRow.querySelector('.msg-bd .msg-t')),
          opTimeInBubble: !!(opRow && opRow.querySelector('.msg-bd .msg-t')),
          agentTimeIsLast: (() => { const bd = agentRow && agentRow.querySelector('.msg-bd'); return !!(bd && bd.lastElementChild && bd.lastElementChild.classList.contains('msg-t')); })(),
          agentNameIsFirst: (() => { const bd = agentRow && agentRow.querySelector('.msg-bd'); return !!(bd && bd.firstElementChild && bd.firstElementChild.classList.contains('msg-nm')); })(),
          /* #3134-followup (Josh 6.72): the inline delivery receipt (".delivery") is
             gone from the room -- no "Placed with X ... could not be reached". */
          hasReceipt: !!host.querySelector('.delivery'),
          /* #3134-followup (Josh 6.72): the WING. The COLORED wing is ::before
             (background-color:inherit, so agent=cream, operator=blue), anchored at a
             negative left/right. #3267: the wing OVERLAPS the box (Option A geometry) and
             --usermsg-tint is SOLID, so the overlap composites once by construction (no
             double-tint). ::after is the --k-surface thread-ground MASK that carves the curve. */
          agentWing: (() => { const bd = agentRow && agentRow.querySelector('.msg-bd'); if (!bd) return null; const cs = getComputedStyle(bd, '::before'); return { on: cs.content !== 'none' && cs.content !== '', left: cs.left, bg: cs.backgroundColor }; })(),
          opWing: (() => { const bd = opRow && opRow.querySelector('.msg-bd'); if (!bd) return null; const cs = getComputedStyle(bd, '::before'); return { on: cs.content !== 'none' && cs.content !== '', right: cs.right, bg: cs.backgroundColor }; })(),
          agentMask: (() => { const bd = agentRow && agentRow.querySelector('.msg-bd'); if (!bd) return null; const cs = getComputedStyle(bd, '::after'); return { on: cs.content !== 'none' && cs.content !== '', bg: cs.backgroundColor }; })(),
          /* #3134-followup (Josh 6.72): the agent NAME and the agent AVATAR are
             click-to-open (data-open-agent = sessionName). The operator's OWN avatar is
             NOT (never a target). */
          agentNameOpen: (agentRow && agentRow.querySelector('.msg-nm')) ? agentRow.querySelector('.msg-nm').getAttribute('data-open-agent') : null,
          agentAvOpen: (agentRow && agentRow.querySelector('.msg-av')) ? agentRow.querySelector('.msg-av').getAttribute('data-open-agent') : null,
          opAvOpen: (opRow && opRow.querySelector('.msg-av')) ? opRow.querySelector('.msg-av').getAttribute('data-open-agent') : null,
          /* #3134-followup (Josh 6.72): the avatar is bottom-aligned with the bubble
             (.msg align-items: flex-end). */
          rowAlign: (() => { const r = agentRow; return r ? getComputedStyle(r).alignItems : null; })(),
          /* #3130: `.msg-bd` MUST own a stacking context (position:relative +
             z-index:0) or the tail's negative-z-index pseudo-elements (#3267:
             ::before wing z-index:-2, ::after mask z-index:-1) resolve against the
             ambient tree and `.thread`'s opaque ground paints OVER the whole tail --
             an invisible tail that every getComputedStyle-only tail assertion above
             still reads as present. This is the structural pin for that (a regression
             to z-index:auto reds it). */
          bdPos: (() => { const bd = agentRow && agentRow.querySelector('.msg-bd'); return bd ? getComputedStyle(bd).position : null; })(),
          bdZ: (() => { const bd = agentRow && agentRow.querySelector('.msg-bd'); return bd ? getComputedStyle(bd).zIndex : null; })(),
          /* #3134-followup (Josh 6.72): an operator post with a BODY but NO timestamp
             draws its bubble (body only) -- no name (operator side), and NO empty .msg-t
             timestamp element inside. Rendered in isolation so it does not disturb the
             three-row fixture above. */
          noTimeHasBody: (() => { const tmp = document.createElement('div'); tmp.innerHTML = pjRoomRow({ operator: true, at: null, text: 'placed everyone.' }, p); return !!tmp.querySelector('.msg-bd'); })(),
          noTimeHasTime: (() => { const tmp = document.createElement('div'); tmp.innerHTML = pjRoomRow({ operator: true, at: null, text: 'placed everyone.' }, p); return !!tmp.querySelector('.msg-t'); })(),
        };
        host.remove();
        return out;
      }, now());

      const t = `[${theme}]`;
      if (m.error) { chk(false, `${t} render`, m.error); await page.close(); continue; }

      // Positive controls: all four rows rendered, and the mine/theirs split is real.
      chk(m.rowCount === 4, `${t} all four fixture rows rendered`, `count=${m.rowCount}`);
      chk(m.agentHasYou === false, `${t} the agent row is NOT .you (mine/theirs split is real)`);
      // #3260 (Josh, 2026-09-18): agent messages are ONE fixed color -- the REAL
      // pjRoomRow render no longer emits data-am on any box. A regression re-adding
      // per-message variation would fail here.
      chk(m.agentDataAm === null, `${t} the real agent box carries NO data-am (one fixed color, #3260)`, `data-am=${m.agentDataAm}`);
      chk(m.opHasDataAm === false, `${t} the operator's own box carries NO data-am`, `opHasDataAm=${m.opHasDataAm}`);

      const op = parse(m.opBd);
      const ag = parse(m.agentBd);
      // (a) operator box filled.
      chk(op[3] > 0, `${t} the operator body box (.msg.you .msg-bd) carries a fill`, m.opBd);
      // (b) operator box is blue, not gray/surface.
      // #3267: --usermsg-tint is now SOLID (pre-composited over each theme ground) so the
      // Option A overlap wing cannot double-composite into a dark triangle. getComputedStyle
      // therefore returns the true PAINTED pixel (light rgb(232,235,245) lead 10, dark
      // rgb(20,28,47) lead 19), not the old translucent token whose raw blue read ~114 with the
      // alpha dropped. Recalibrated floor 8 cleanly separates the painted blue (>=10) from a
      // neutral gray (~0) and the warm agent cream (negative); the >=20 distinctness guard at (d)
      // is the strong separator and stays put.
      chk(blueLead(op) >= 8, `${t} the operator box is BLUE (blue channel leads)`, `${m.opBd} lead=${blueLead(op).toFixed(0)}`);
      // (c) agent box filled AND a warm cream (#2947), not the blue.
      chk(ag[3] > 0, `${t} the agent body box (.msg:not(.you) .msg-bd) carries a fill`, m.agentBd);
      chk(ag[0] >= ag[1] && ag[1] >= ag[2] && (ag[0] - ag[2]) >= 2 && blueLead(ag) < 20,
        `${t} the agent box is a warm cream (R>=G>=B), not a neutral gray or the blue`,
        `${m.agentBd} rgb=[${ag.slice(0, 3).map((x) => x.toFixed(1)).join(', ')}]`);
      // (d) the two are distinct (blue vs cream differ well beyond the alpha).
      chk(blueLead(op) - blueLead(ag) >= 20, `${t} the operator blue and agent cream are distinct`, `op=${m.opBd} agent=${m.agentBd}`);
      // (e) a bodyless OPERATOR row draws NO box.
      chk(m.emptyRowIsYou && !m.emptyRowHasBox, `${t} a bodyless operator row draws a .msg row but NO .msg-bd (no empty tinted box)`, `isYou=${m.emptyRowIsYou} hasBox=${m.emptyRowHasBox}`);
      // (e2) #3134-followup: a bodyless AGENT row ALSO draws NO box (bubble gated on body,
      // not name), so a name+timestamp-only tinted box is never drawn.
      chk(m.agentEmptyRowExists && !m.agentEmptyHasBox, `${t} a bodyless agent row draws a .msg row but NO .msg-bd (no name-only box)`, `exists=${m.agentEmptyRowExists} hasBox=${m.agentEmptyHasBox}`);

      // #3134-followup (Josh 6.72): name is INSIDE the bubble (.msg-nm) at the top. The
      // operator's OWN post shows NO name; an agent's keeps its name and it is the FIRST
      // child of the bubble ("me as the user doesn't have my name or 'you'", his rule).
      chk(m.opHasName === false, `${t} the operator's own post shows NO name`, `opHasName=${m.opHasName}`);
      chk(m.agentHasName === true, `${t} an agent's post keeps its name INSIDE the bubble`, `agentHasName=${m.agentHasName}`);
      chk(m.agentNameText === 'April', `${t} the in-bubble name is the agent's name`, `name=${m.agentNameText}`);
      chk(m.agentNameIsFirst === true, `${t} the name is the FIRST child of the bubble (top)`, `first=${m.agentNameIsFirst}`);
      // #3134-followup (Josh 6.72): the timestamp is INSIDE the bubble (bottom-right) on
      // both bubbles, and is the LAST child (under the body).
      chk(m.agentTimeInBubble === true, `${t} the agent timestamp is INSIDE the bubble`, `in=${m.agentTimeInBubble}`);
      chk(m.opTimeInBubble === true, `${t} the operator timestamp is INSIDE the bubble`, `in=${m.opTimeInBubble}`);
      chk(m.agentTimeIsLast === true, `${t} the timestamp is the LAST child of the bubble (bottom)`, `last=${m.agentTimeIsLast}`);
      // #3134-followup (Josh 6.72): the inline delivery receipt ("Placed with X ...") is GONE.
      chk(m.hasReceipt === false, `${t} no inline "placed with" delivery receipt in the room`, `hasReceipt=${m.hasReceipt}`);
      // #3134-followup (Josh 6.72): the WING. The COLORED wing is ::before, anchored at a
      // negative offset; #3267 it overlaps the box (Option A) with a SOLID tint so the fill
      // composites once and never doubles. agent on the LEFT (cream), operator on the RIGHT (blue).
      // The offset assertion below stays < 0 (the anchor is still negative); overlap is the
      // width extending back INTO the box, not a change of anchor sign.
      chk(!!(m.agentWing && m.agentWing.on) && parseInt(m.agentWing.left, 10) < 0,
        `${t} the agent wing (::before) sits outside the LEFT edge`, JSON.stringify(m.agentWing));
      chk(!!(m.opWing && m.opWing.on) && parseInt(m.opWing.right, 10) < 0,
        `${t} the operator wing (::before) sits outside the RIGHT edge`, JSON.stringify(m.opWing));
      // the agent wing inherits the warm cream, NOT blue; the operator wing is blue -- a
      // swap of the side rules reds one of these.
      const awing = parse(m.agentWing && m.agentWing.bg);
      chk(awing[0] >= awing[1] && awing[1] >= awing[2] && (awing[0] - awing[2]) >= 2 && blueLead(awing) < 20,
        `${t} the agent wing is the warm cream, not blue`, m.agentWing && m.agentWing.bg);
      const owing = parse(m.opWing && m.opWing.bg);
      // #3267: the wing inherits the SOLID --usermsg-tint (background-color: inherit), so it reads
      // the same painted blue as the box at (b) -- floor 8, same recalibration rationale.
      chk(blueLead(owing) >= 8, `${t} the operator wing is the blue user tint`, m.opWing && m.opWing.bg);
      // the ::after MASK carries the thread-ground fill (carving the wing to a point).
      const amask = parse(m.agentMask && m.agentMask.bg);
      chk(!!(m.agentMask && m.agentMask.on) && amask[3] > 0,
        `${t} the wing MASK (::after) carries the thread-ground fill`, m.agentMask && m.agentMask.bg);
      // the STRUCTURAL guard for the wing's visibility -- `.msg-bd` owns its own stacking
      // context so the negative-z-index wing (::before) and mask (::after) tuck behind THIS
      // bubble, not behind `.thread`.
      chk(m.bdPos === 'relative' && m.bdZ === '0',
        `${t} .msg-bd owns a stacking context (position:relative, z-index:0) so the wing is not hidden behind .thread`,
        `position=${m.bdPos} z-index=${m.bdZ}`);
      // #3134-followup (Josh 6.72): the agent name + agent avatar are click-to-open
      // (data-open-agent = sessionName); the operator's own avatar is NOT a target.
      chk(m.agentNameOpen === 'april', `${t} the agent name is click-to-open (data-open-agent)`, `open=${m.agentNameOpen}`);
      chk(m.agentAvOpen === 'april', `${t} the agent avatar is click-to-open (data-open-agent)`, `open=${m.agentAvOpen}`);
      chk(!m.opAvOpen, `${t} the operator's own avatar is NOT a click-to-open target`, `open=${m.opAvOpen}`);
      // #3134-followup (Josh 6.72): the avatar is bottom-aligned with the bubble.
      chk(m.rowAlign === 'flex-end', `${t} the avatar is bottom-aligned (.msg align-items: flex-end)`, `align=${m.rowAlign}`);
      // #3134-followup (Josh 6.72): an operator post with a body but NO timestamp draws
      // its bubble (body present) with no stray empty timestamp inside.
      chk(m.noTimeHasBody && !m.noTimeHasTime,
        `${t} an operator post with no timestamp draws the bubble but no empty timestamp`,
        `hasBody=${m.noTimeHasBody} hasTime=${m.noTimeHasTime}`);

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }

    /* #3134-followup (Josh 6.72): the WING NO-SEAM PIXEL ORACLE. The computed-style arms
       above verify the wing's MECHANISM (::before colored + negative anchor, ::after mask);
       they cannot see the COMPOSITED OUTCOME. #3130's tail LOOKED right and still
       double-tinted the then-translucent user bubble into a "colliding triangle" -- a defect
       invisible to getComputedStyle and to the eye on a quick look, caught only by reading
       pixels. #3267 rebuilt the tail to the Option A OVERLAP geometry, which would re-introduce
       exactly that double-composite on a translucent fill -- so --usermsg-tint was made SOLID,
       and this oracle is what proves the overlap composites once. So: render a real user bubble
       VISIBLE, screenshot it, decode the PNG in-browser via a canvas (no node PNG dep needed),
       and assert no pixel in the wing region is more blue than the bubble body (a double
       composite would read a shade bluer). Light theme, where a seam is hardest to see by eye
       -- the case the human check is weakest on. */
    const pxPage = await browser.newPage({ viewport: { width: 760, height: 400 }, colorScheme: 'light' });
    try {
      await pxPage.addInitScript(() => {
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      });
      await pxPage.goto(PAGE);
      await pxPage.evaluate((ts) => {
        const p = { agents: [] };
        const host = document.createElement('div');
        host.className = 'thread'; host.setAttribute('data-shot', '1');
        host.style.cssText = 'position:fixed;left:0;top:0;width:760px;height:400px;z-index:99999;';
        host.innerHTML = pjRoomRow({ operator: true, at: ts, text: 'can everyone enter a task of 100 character max, please and thanks.' }, p);
        document.body.appendChild(host);
      }, now());
      await pxPage.waitForTimeout(120);
      const box = await pxPage.evaluate(() => {
        const bd = document.querySelector('.thread[data-shot="1"] .msg.you .msg-bd');
        const r = bd.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      });
      const shot = await pxPage.screenshot();
      const px = await pxPage.evaluate(async ({ url, box }) => {
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = url; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        const at = (x, y) => { const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]]; };
        const blueLead = (rgb) => rgb[2] - Math.max(rgb[0], rgb[1]);
        const bodyLead = blueLead(at(box.x + box.w * 0.5, box.y + box.h * 0.5));
        let maxWingLead = -999;
        // #3267: this samples the OPERATOR bubble (.msg.you), whose tail is on the RIGHT: ::before
        // wing is right:-8/width:20/height:20 (spans box.right-12 to box.right+8, overlapping the
        // body from box.right-12 to box.right) and the ::after mask is right:-14/width:14/height:22
        // (spans box.right to box.right+14). So the footprint is box.right-14..box.right+14
        // horizontally (the -14 low bound over-covers the overlap/seam side by 2px) and
        // box.bottom-22..box.bottom vertically. Sample the whole footprint: dx<0 is the body/overlap
        // (where a double-tint seam would show, since the wing overlaps back INTO the box), dx>0 is
        // the outward wing + mask.
        for (let dx = -14; dx <= 14; dx++) for (let dy = -22; dy <= 3; dy++) {
          const lead = blueLead(at(box.right + dx, box.bottom + dy));
          if (lead > maxWingLead) maxWingLead = lead;
        }
        return { bodyLead: Math.round(bodyLead), maxWingLead: Math.round(maxWingLead) };
      }, { url: 'data:image/png;base64,' + shot.toString('base64'), box });
      // A single-composite wing matches the body; a double-tint seam reads several points
      // bluer. Allow a small anti-aliasing margin.
      chk(px.maxWingLead <= px.bodyLead + 4,
        `[pixel] the wing has no double-tint seam on the user bubble`,
        `bodyLead=${px.bodyLead} maxWingLead=${px.maxWingLead}`);
    } finally {
      await pxPage.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
