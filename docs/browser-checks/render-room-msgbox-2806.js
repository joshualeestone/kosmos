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
        // msg-avatar-baseline (Josh 2026-09-19): give the agent row an id so pjReactions emits
        // its (empty) .rxns reaction row, the exact resting case the avatar-baseline fix targets.
        // Without an id, pjReactions returns '' and the reaction-geometry assertions below are
        // vacuous (no .rxns to reserve height, no .rxn-quick to anchor).
        const agentMsg = { id: 'm-agent-1', from: 'april', at: ts, text: 'on it, board cleared.' };
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
          /* msg-avatar-baseline (Josh 2026-09-19): the avatar sits ON the bubble's bottom
             baseline (not below a reserved empty-reaction strip), and the hover reaction
             popout (.rxn-quick, opacity:0 at rest but measurable) anchors to the bubble's
             RIGHT edge, not the full column width. pjRoomRow emits an (empty) .rxns row for
             every message, so a regression that lets the empty row reserve height, or that
             un-anchors the popout from the shrink-wrapped agent body, moves these deltas off ~0. */
          avatarVsBubbleBottom: (() => { const r = agentRow; if (!r) return null; const av = r.querySelector('.msg-av'); const bd = r.querySelector('.msg-bd'); if (!av || !bd) return null; return Math.round(av.getBoundingClientRect().bottom - bd.getBoundingClientRect().bottom); })(),
          popoutVsBubbleRight: (() => { const r = agentRow; if (!r) return null; const q = r.querySelector('.rxn-quick'); const bd = r.querySelector('.msg-bd'); if (!q || !bd) return null; return Math.round(q.getBoundingClientRect().right - bd.getBoundingClientRect().right); })(),
          /* #3134-followup (Josh 6.72): an operator post with a BODY but NO timestamp
             draws its bubble (body only) -- no name (operator side), and NO empty .msg-t
             timestamp element inside. Rendered in isolation so it does not disturb the
             three-row fixture above. */
          noTimeHasBody: (() => { const tmp = document.createElement('div'); tmp.innerHTML = pjRoomRow({ operator: true, at: null, text: 'placed everyone.' }, p); return !!tmp.querySelector('.msg-bd'); })(),
          noTimeHasTime: (() => { const tmp = document.createElement('div'); tmp.innerHTML = pjRoomRow({ operator: true, at: null, text: 'placed everyone.' }, p); return !!tmp.querySelector('.msg-t'); })(),
          /* #3340 (Josh 6.83): the message body TEXT. Dark -> #fff, light -> the dark ink.
             Read the agent bubble's body paragraph. */
          msgTextColor: (() => { const el = agentRow && agentRow.querySelector('.msg-bd p'); return el ? getComputedStyle(el).color : null; })(),
          /* #3340: the TAB-view dialogue GROUND (.thread) AND the sticky .composer, which is
             blacked in lockstep so the flat area has no lighter band at the bottom (#3267 tied
             them). Measure both in the real `.pjmid` nesting -- a bare `.thread` inherits the page
             ground and would not exercise the #000 rule. Dark -> both #000, light -> the surface. */
          tabGrounds: (() => {
            const wrap = document.createElement('div'); wrap.className = 'pjmid';
            const th = document.createElement('div'); th.className = 'thread';
            th.innerHTML = pjRoomRow(agentMsg, p);
            const co = document.createElement('div'); co.className = 'composer';
            wrap.appendChild(th); wrap.appendChild(co); document.body.appendChild(wrap);
            const out = { thread: getComputedStyle(th).backgroundColor, composer: getComputedStyle(co).backgroundColor };
            wrap.remove(); return out;
          })(),
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
      // (c) agent box filled AND its own tone. LIGHT (#2947): a warm cream, R>=G>=B.
      // DARK (#3340, Josh 6.83): the agent bubble moved to a COOL near-neutral dark
      // gray (#252529 = rgb 37,37,41), so the warm-cream R>=G>=B shape is a light-mode
      // claim now. In dark, assert it stays near-neutral (small spread), dark, and NOT
      // the user's blue -- the distinctness arm (d) is the strong blue/agent separator.
      chk(ag[3] > 0, `${t} the agent body box (.msg:not(.you) .msg-bd) carries a fill`, m.agentBd);
      const agentToneOk = theme === 'dark'
        ? (spread(ag) <= 20 && blueLead(ag) < 20 && blueLead(ag) >= -2 && Math.max(ag[0], ag[1], ag[2]) <= 80)
        : (ag[0] >= ag[1] && ag[1] >= ag[2] && (ag[0] - ag[2]) >= 2 && blueLead(ag) < 20);
      chk(agentToneOk,
        `${t} the agent box is its own tone (warm cream in light, cool dark gray in dark), not the blue`,
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
      // The wing inherits the agent box fill (background-color: inherit), so it tracks
      // the same tone: warm cream in light, cool dark gray in dark (#3340).
      const awingToneOk = theme === 'dark'
        ? (spread(awing) <= 20 && blueLead(awing) < 20 && blueLead(awing) >= -2 && Math.max(awing[0], awing[1], awing[2]) <= 80)
        : (awing[0] >= awing[1] && awing[1] >= awing[2] && (awing[0] - awing[2]) >= 2 && blueLead(awing) < 20);
      chk(awingToneOk,
        `${t} the agent wing inherits the agent tone (warm cream in light, cool dark gray in dark), not blue`, m.agentWing && m.agentWing.bg);
      const owing = parse(m.opWing && m.opWing.bg);
      // #3267: the wing inherits the SOLID --usermsg-tint (background-color: inherit), so it reads
      // the same painted blue as the box at (b) -- floor 8, same recalibration rationale.
      chk(blueLead(owing) >= 8, `${t} the operator wing is the blue user tint`, m.opWing && m.opWing.bg);
      // the ::after MASK carries the thread-ground fill (carving the wing to a point).
      const amask = parse(m.agentMask && m.agentMask.bg);
      chk(!!(m.agentMask && m.agentMask.on) && amask[3] > 0,
        `${t} the wing MASK (::after) carries the thread-ground fill`, m.agentMask && m.agentMask.bg);
      // #3340 (Josh 6.83): the three night-mode-only recolors Josh specified for the room,
      // pinned by CONTENT so a future deletion of any of them reds here (not just via the gate
      // trailer). Dark: message text -> #fff, dialogue ground -> #000, and the tail mask FOLLOWS
      // the ground to #000 (else a #17191c seam shows behind the wing on black). Light is the
      // control -- text stays the dark ink, ground stays the light surface, so the dark arms are
      // demonstrably not vacuous.
      const msgTxt = parse(m.msgTextColor);
      const grd = parse(m.tabGrounds && m.tabGrounds.thread);
      const comp = parse(m.tabGrounds && m.tabGrounds.composer);
      if (theme === 'dark') {
        chk(msgTxt[0] >= 240 && msgTxt[1] >= 240 && msgTxt[2] >= 240,
          `${t} the message text is white (#3340)`, m.msgTextColor);
        chk(grd[3] > 0 && grd[0] <= 8 && grd[1] <= 8 && grd[2] <= 8,
          `${t} the room dialogue ground is black (#3340)`, m.tabGrounds && m.tabGrounds.thread);
        chk(comp[3] > 0 && comp[0] <= 8 && comp[1] <= 8 && comp[2] <= 8,
          `${t} the composer follows the ground to black -- no lighter band (#3340)`, m.tabGrounds && m.tabGrounds.composer);
        chk(amask[0] <= 8 && amask[1] <= 8 && amask[2] <= 8,
          `${t} the tail mask follows the ground to black (#3340, no seam on #000)`, m.agentMask && m.agentMask.bg);
      } else {
        chk(msgTxt[3] > 0 && msgTxt[0] <= 90 && msgTxt[1] <= 90 && msgTxt[2] <= 90,
          `${t} the message text is the dark ink (control: the dark #fff arm is not vacuous)`, m.msgTextColor);
        chk(grd[0] >= 200 && grd[1] >= 200 && grd[2] >= 200,
          `${t} the room dialogue ground is the light surface (control: the dark #000 arm is not vacuous)`, m.tabGrounds && m.tabGrounds.thread);
      }
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
      // msg-avatar-baseline (Josh 2026-09-19): the avatar sits ON the bubble bottom baseline
      // (the empty reaction row reserves no height) and the hover popout anchors to the bubble
      // right edge (the agent body shrink-wraps). ~0 delta both; a regression moves them off.
      chk(m.avatarVsBubbleBottom !== null && Math.abs(m.avatarVsBubbleBottom) <= 2,
        `${t} the avatar sits on the bubble's bottom baseline (empty reaction row reserves no height)`, `avatar-vs-bubble-bottom=${m.avatarVsBubbleBottom}px`);
      chk(m.popoutVsBubbleRight !== null && Math.abs(m.popoutVsBubbleRight) <= 2,
        `${t} the hover reaction popout anchors to the bubble's right edge`, `popout-vs-bubble-right=${m.popoutVsBubbleRight}px`);
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

    /* #3340 (Josh 6.83): the CONSOLIDATED ("One screen") layout ground. #980 merges the thread
       into its .pj3 > .pjmid parent (the thread is background:none there), and #3267 tied the
       composer to that one ground. So the dark #000 must land on the MERGED surface
       (.pj3 > .pjmid + .composer) with the thread left transparent -- never a black thread box
       seamed against a lighter panel. Three scenarios, each entering the real layout state
       (data-layout + body.consolidated at >=960px) and reading the real computed grounds:
         - light (control): the ground is the light surface, so the dark #000 arm is not vacuous.
         - dark: the merged panel + composer are #000, the thread transparent.
         - dark + body.plus-active: the Kosmos Plus navy paid theme is EXCLUDED, so its dialogue
           ground stays its own navy (NOT #000) -- the regression guard for the paid tier. */
    for (const sc of [{ theme: 'light', plus: false }, { theme: 'dark', plus: false }, { theme: 'dark', plus: true }]) {
      const consPage = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: sc.theme });
      try {
        await consPage.addInitScript(() => {
          window.setInterval = () => 0;
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.fetch = async () => enc({});
        });
        await consPage.goto(PAGE);
        const cons = await consPage.evaluate(({ ts, plus }) => {
          document.documentElement.setAttribute('data-layout', 'consolidated');
          document.body.classList.add('consolidated');
          if (plus) document.body.classList.add('plus-active');
          const p = { agents: [{ sessionName: 'april', name: 'April' }] };
          const pj3 = document.createElement('div'); pj3.className = 'pj3';
          const pjmid = document.createElement('div'); pjmid.className = 'pjmid';
          const thread = document.createElement('div'); thread.className = 'thread';
          thread.innerHTML = pjRoomRow({ from: 'april', at: ts, text: 'on it, board cleared.' }, p);
          const composer = document.createElement('div'); composer.className = 'composer';
          pjmid.appendChild(thread); pjmid.appendChild(composer); pj3.appendChild(pjmid);
          document.body.appendChild(pj3);
          const cs = getComputedStyle;
          const out = { pjmidBg: cs(pjmid).backgroundColor, composerBg: cs(composer).backgroundColor, threadBg: cs(thread).backgroundColor };
          pj3.remove(); document.body.classList.remove('plus-active');
          return out;
        }, { ts: now(), plus: sc.plus });
        const pj = parse(cons.pjmidBg); const co = parse(cons.composerBg); const th = parse(cons.threadBg);
        const isBlack = (c) => c[3] > 0 && c[0] <= 8 && c[1] <= 8 && c[2] <= 8;
        if (sc.plus) {
          chk(!isBlack(pj), `[dark/consolidated/plus] the Plus navy dialogue ground is NOT blacked (#3340 excludes body.plus-active)`, cons.pjmidBg);
        } else if (sc.theme === 'dark') {
          chk(isBlack(pj), `[dark/consolidated] the merged dialogue ground (.pj3 > .pjmid) is black (#3340)`, cons.pjmidBg);
          chk(isBlack(co), `[dark/consolidated] the composer follows the ground to black (#3267 lockstep)`, cons.composerBg);
          chk(th[3] === 0, `[dark/consolidated] the thread stays transparent (merges into the black panel, no floating box)`, cons.threadBg);
        } else {
          chk(pj[0] >= 200 && pj[1] >= 200 && pj[2] >= 200, `[light/consolidated] the merged ground is the light surface (control: the dark #000 arm is not vacuous)`, cons.pjmidBg);
        }
      } finally {
        await consPage.close();
      }
    }

    /* #3493 (Josh, 2026-09-23): the TAB-view conversation column (.pjcol.pjmid) left its
       var(--k-surface) fill (#17191c in dark) as a gray seam around the blacked thread and
       composer. It is now blacked to #000 in dark, matching the consolidated view. The gray comes
       from the .pjcol BASE rule, so the fixture must carry BOTH classes (a bare .pjmid would never
       show it and the arm would pass vacuously). Three scenarios, no consolidated layout:
         - light (control): the column is the light surface, so the dark #000 arm is not vacuous.
         - dark: the column is #000 -- one uniform ground, no gray seam.
         - dark + body.plus-active: the paid Plus tier is EXCLUDED (:not(.plus-active)), so its
           navy column is NOT blacked -- the regression guard mirroring the four rules below. */
    for (const sc of [{ theme: 'light', plus: false }, { theme: 'dark', plus: false }, { theme: 'dark', plus: true }]) {
      const tabPage = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: sc.theme });
      try {
        await tabPage.addInitScript(() => {
          window.setInterval = () => 0;
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.fetch = async () => enc({});
        });
        await tabPage.goto(PAGE);
        const tv = await tabPage.evaluate(({ ts, plus }) => {
          document.body.classList.remove('consolidated');
          document.documentElement.removeAttribute('data-layout');
          if (plus) document.body.classList.add('plus-active');
          const p = { agents: [{ sessionName: 'april', name: 'April' }] };
          const pjmid = document.createElement('div'); pjmid.className = 'pjcol pjmid';
          const thread = document.createElement('div'); thread.className = 'thread';
          thread.innerHTML = pjRoomRow({ from: 'april', at: ts, text: 'on it.' }, p);
          const composer = document.createElement('div'); composer.className = 'composer';
          pjmid.appendChild(thread); pjmid.appendChild(composer); document.body.appendChild(pjmid);
          const out = { pjmidBg: getComputedStyle(pjmid).backgroundColor };
          pjmid.remove(); document.body.classList.remove('plus-active');
          return out;
        }, { ts: now(), plus: sc.plus });
        const pj = parse(tv.pjmidBg);
        const isBlack = (c) => c[3] > 0 && c[0] <= 8 && c[1] <= 8 && c[2] <= 8;
        if (sc.plus) {
          chk(!isBlack(pj), `[dark/tab/plus] the Plus navy column (.pjcol.pjmid) is NOT blacked (:not(.plus-active) holds) (#3493)`, tv.pjmidBg);
        } else if (sc.theme === 'dark') {
          chk(isBlack(pj), `[dark/tab] the conversation column (.pjcol.pjmid) is black -- no gray seam around the dialogue (#3493)`, tv.pjmidBg);
        } else {
          chk(pj[0] >= 200 && pj[1] >= 200 && pj[2] >= 200, `[light/tab] the column is the light surface (control: the dark #000 arm is not vacuous) (#3493)`, tv.pjmidBg);
        }
      } finally {
        await tabPage.close();
      }
    }

    /* #3340: the TAB-view Plus exclusion, the common code path. All four tab night-mode rules
       (.msg text, .thread ground, .composer, .msg-bd::after mask) carry :not(.plus-active); this
       arm proves the guard by entering dark + body.plus-active WITHOUT the consolidated layout and
       confirming NONE of them blacked the Kosmos Plus navy dialogue (a dropped guard would turn the
       paid tier's navy tab black -- the regression this pins). */
    const tabPlusPage = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: 'dark' });
    try {
      await tabPlusPage.addInitScript(() => {
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      });
      await tabPlusPage.goto(PAGE);
      const tp = await tabPlusPage.evaluate((ts) => {
        document.body.classList.add('plus-active');
        const p = { agents: [{ sessionName: 'april', name: 'April' }] };
        const wrap = document.createElement('div'); wrap.className = 'pjmid';
        const thread = document.createElement('div'); thread.className = 'thread';
        thread.innerHTML = pjRoomRow({ id: 'm-a', from: 'april', at: ts, text: 'on it.' }, p);
        const composer = document.createElement('div'); composer.className = 'composer';
        wrap.appendChild(thread); wrap.appendChild(composer); document.body.appendChild(wrap);
        const cs = getComputedStyle;
        const bd = thread.querySelector('.msg:not(.you) .msg-bd');
        const pEl = thread.querySelector('.msg-bd p');
        const out = {
          threadBg: cs(thread).backgroundColor,
          composerBg: cs(composer).backgroundColor,
          textColor: pEl ? cs(pEl).color : null,
          maskBg: bd ? cs(bd, '::after').backgroundColor : null,
        };
        wrap.remove(); document.body.classList.remove('plus-active');
        return out;
      }, now());
      const isBlack = (s) => { const c = parse(s); return c[3] > 0 && c[0] <= 8 && c[1] <= 8 && c[2] <= 8; };
      const isWhite = (s) => { const c = parse(s); return c[0] >= 240 && c[1] >= 240 && c[2] >= 240; };
      chk(!isBlack(tp.threadBg), `[dark/tab/plus] the Plus navy thread ground is NOT blacked (:not(.plus-active) holds)`, tp.threadBg);
      chk(!isBlack(tp.composerBg), `[dark/tab/plus] the Plus navy composer is NOT blacked`, tp.composerBg);
      chk(!isWhite(tp.textColor), `[dark/tab/plus] the Plus message text is NOT forced white`, tp.textColor);
      chk(!isBlack(tp.maskBg), `[dark/tab/plus] the Plus tail mask is NOT blacked`, tp.maskBg);
    } finally {
      await tabPlusPage.close();
    }

    /* #3361 (Josh, 2026-09-21 small-size QA): at NARROW widths a message bubble must not grow into
       the OPPOSITE side's avatar column (user msgs reaching left into the agent-avatar column, agent
       msgs reaching right into the user-avatar column). The row reserves the near avatar+gap (34+14)
       before the body; #3340-followup mirrors that gutter on the FAR side so the bubble stops short
       of the opposite column at every width. Render a deliberately NARROW host (360px), where the
       78ch max-width no longer binds and the bubble would otherwise reach the far edge, and assert
       BOTH bubbles leave a >=47px far gutter (the ~48px opposite avatar column) while the bubble is
       still WIDE (control: the cap is doing real work, not passing on a short message that never
       reached the column). The wide-width look is covered by the 640/760/1400 fixtures above, which
       the far gutter leaves unchanged because 78ch binds first there. */
    const narrowPage = await browser.newPage({ viewport: { width: 420, height: 900 }, colorScheme: 'light' });
    try {
      await narrowPage.addInitScript(() => {
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      });
      await narrowPage.goto(PAGE);
      const nar = await narrowPage.evaluate((ts) => {
        const p = { agents: [{ sessionName: 'april', name: 'April' }] };
        const long = 'this is a deliberately long message so the bubble fills the whole available width at a narrow window and would reach the far edge if it were not capped short of the opposite avatar column.';
        const host = document.createElement('div');
        host.className = 'thread';
        host.style.cssText = 'position:absolute;left:0;top:0;width:360px;';
        host.innerHTML = pjRoomRow({ from: 'april', at: ts, text: long }, p)
          + pjRoomRow({ operator: true, at: ts, text: long }, p);
        document.body.appendChild(host);
        const rows = Array.from(host.querySelectorAll('.msg'));
        const agentRow = rows.find((r) => !r.classList.contains('you') && r.querySelector('.msg-bd'));
        const opRow = rows.find((r) => r.classList.contains('you') && r.querySelector('.msg-bd'));
        const rr = (el) => el.getBoundingClientRect();
        const aRow = rr(agentRow), aBd = rr(agentRow.querySelector('.msg-bd'));
        const oRow = rr(opRow), oBd = rr(opRow.querySelector('.msg-bd'));
        const out = {
          // agent avatar is on the LEFT, so the OPPOSITE (user) column is the RIGHT: far gutter = row.right - bubble.right
          agentFarGap: Math.round(aRow.right - aBd.right),
          agentNearGap: Math.round(aBd.left - aRow.left),
          agentBdW: Math.round(aBd.width),
          // operator avatar is on the RIGHT, so the OPPOSITE (agent) column is the LEFT: far gutter = bubble.left - row.left
          opFarGap: Math.round(oBd.left - oRow.left),
          opNearGap: Math.round(oRow.right - oBd.right),
          opBdW: Math.round(oBd.width),
          hostW: Math.round(aRow.width),
        };
        host.remove();
        return out;
      }, now());
      const GUT = 47; // 34 avatar + 14 gap, minus 1px rounding tolerance
      chk(nar.agentFarGap >= GUT, `[narrow] the agent bubble clears the opposite (right) avatar column`, `farGap=${nar.agentFarGap}px (need >=${GUT})`);
      chk(nar.opFarGap >= GUT, `[narrow] the operator bubble clears the opposite (left) avatar column`, `farGap=${nar.opFarGap}px (need >=${GUT})`);
      // Non-vacuous control: the cap is engaging on a WIDE bubble at 360px (without the far gutter it
      // would have reached the far edge). A short bubble that never reached the column would pass the
      // gutter arms vacuously; requiring width >=180 rules that out.
      chk(nar.agentBdW >= 180, `[narrow] the agent bubble is wide (control: the cap is doing work, not a short message)`, `bubbleW=${nar.agentBdW}px at host ${nar.hostW}px, nearGap=${nar.agentNearGap}px`);
      chk(nar.opBdW >= 180, `[narrow] the operator bubble is wide (control: the cap is doing work)`, `bubbleW=${nar.opBdW}px at host ${nar.hostW}px, nearGap=${nar.opNearGap}px`);
      // CLAUDE.md convention #5: the CSS far gutter is `calc(34px + 14px)`, a by-VALUE duplicate of
      // the .msg-av width and the .msg gap. Pin the three equal at runtime: the near gutter IS
      // avatar+gap (the row lays out [avatar][gap][body]), so asserting far == near catches any
      // future change to the avatar size or the row gap that is not mirrored into the margin literal.
      chk(Math.abs(nar.agentFarGap - nar.agentNearGap) <= 1, `[narrow] the agent far gutter equals the near avatar+gap (convention #5 pin: margin literal == the row's real avatar+gap)`, `far=${nar.agentFarGap} near=${nar.agentNearGap}`);
      chk(Math.abs(nar.opFarGap - nar.opNearGap) <= 1, `[narrow] the operator far gutter equals the near avatar+gap`, `far=${nar.opFarGap} near=${nar.opNearGap}`);
    } finally {
      await narrowPage.close();
    }

    /* #718 mobile (Josh, 2026-09-24): on a PHONE the room (#pj-room) runs a leaner row, a 28px
       avatar (the 14px gap stays, or the tail mask paints over the avatar), so the bubble is not squeezed to a column of words (measured 167px at
       375 before). #3361's rule must still hold THERE: the far gutter equals the near avatar+gap.
       The arms above render into a detached .thread, which the #pj-room-scoped phone rules never
       reach, so they cannot see this; this arm renders the REAL rows inside the REAL #pj-room at
       375px wide. */
    const phonePage = await browser.newPage({ viewport: { width: 375, height: 800 }, colorScheme: 'light', hasTouch: true, isMobile: true });
    try {
      await phonePage.addInitScript(() => {
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      });
      await phonePage.goto(PAGE);
      // Conversation first on a phone, in the DOM (reading order == tab order, #1017), and back
      // after Members/Files once the window is wider than a phone.
      const order = () => phonePage.evaluate(() => [...document.querySelector('.pj3').children].map((c) => c.classList.contains('pjmid') ? 'room' : (c.classList.contains('pjsplit') ? 'members-files' : 'other')).join(','));
      const o375 = await order();
      chk(o375.startsWith('room,'), `[phone] the conversation is first in the DOM at 375px`, o375);
      await phonePage.setViewportSize({ width: 800, height: 800 });
      await phonePage.waitForTimeout(100);
      const o800 = await order();
      chk(o800.startsWith('members-files,room'), `[wide] wider than a phone, it goes back after Members/Files`, o800);
      await phonePage.setViewportSize({ width: 375, height: 800 });
      await phonePage.waitForTimeout(100);
      const ph = await phonePage.evaluate((ts) => {
        const p = { agents: [{ sessionName: 'april', name: 'April' }] };
        const long = 'this is a deliberately long message so the bubble fills the whole available width on a phone and would reach the far edge if it were not capped short of the opposite avatar column.';
        const room = document.getElementById('pj-room');
        document.body.appendChild(room);
        // Real taps: the first-run overlay (not part of the room) would intercept them.
        const fr = document.getElementById('firstrun'); if (fr) fr.remove();
        // The thread's real max-height and overflow stay (only width is set): the reaction bar's
        // clipping against that scroll box is part of what is measured.
        room.style.cssText = 'position:absolute;left:0;top:0;width:297px;z-index:50;';
        room.hidden = false;
        const longName = 'Henderson-Lease-Review-2026-signed-countersigned-final-FINAL-v7-with-exhibits-A-through-F-and-landlord-comments-inline.pdf';
        room.innerHTML = pjRoomRow({ from: 'april', at: ts, text: long, id: 'm1' }, p) + pjRoomRow({ operator: true, at: ts, text: long, id: 'm2' }, p)
          + pjRoomRow({ operator: true, at: ts, text: 'Here is the signed copy.', id: 'm3',
            attachments: [{ id: 'a1', name: longName, type: 'application/pdf', size: 912345, kind: 'pdf', url: '/api/attachment/a1' }] }, p);
        const rows = Array.from(room.querySelectorAll('.msg'));
        const a = rows.find((r) => !r.classList.contains('you') && r.querySelector('.msg-bd'));
        const o = rows.find((r) => r.classList.contains('you') && r.querySelector('.msg-bd'));
        const rr = (el) => el.getBoundingClientRect();
        const aR = rr(a), aB = rr(a.querySelector('.msg-bd')), oR = rr(o), oB = rr(o.querySelector('.msg-bd'));
        return { aFar: Math.round(aR.right - aB.right), aNear: Math.round(aB.left - aR.left), aW: Math.round(aB.width),
          oFar: Math.round(oB.left - oR.left), oNear: Math.round(oR.right - oB.right), oW: Math.round(oB.width),
          av: Math.round(rr(a.querySelector('.msg-av')).width),
          // a 120-character file name on the person's OWN post stays inside the ROOM. Measured
          // against the room, not the bubble: without the fix the bubble grows WITH the card, so
          // "card inside bubble" stays true while both hang off the left edge.
          attIn: (() => { const row = room.querySelectorAll('.msg')[2]; const att = row && row.querySelector('.att'); const bd = row && row.querySelector('.msg-bd');
            if (!att || !bd) return 'no card'; const A = rr(att), B = rr(bd), R = rr(room);
            return (A.left >= R.left && B.left >= R.left && A.right <= R.right + 1) ? 'inside' : ('card left=' + Math.round(A.left) + ' bubble left=' + Math.round(B.left) + ' room left=' + Math.round(R.left)); })(),
          opMaskClear: (() => { const bd = o.querySelector('.msg-bd'); const cs = getComputedStyle(bd, '::after');
            const maskRight = rr(bd).right - parseFloat(cs.right); return Math.round(rr(o.querySelector('.msg-av')).left - maskRight); })(),
          // the tail's ground mask (::after) must stop short of the avatar: mask left edge vs avatar right edge
          maskClear: (() => { const bd = a.querySelector('.msg-bd'); const cs = getComputedStyle(bd, '::after');
            const maskLeft = rr(bd).left + parseFloat(cs.left); return Math.round(maskLeft - rr(a.querySelector('.msg-av')).right); })() };
      }, now());
      chk(ph.av === 28, `[phone] the room avatar is 28px on a phone`, `avatar=${ph.av}px`);
      chk(Math.abs(ph.aFar - ph.aNear) <= 1 && ph.aNear <= 43, `[phone] the agent far gutter equals the near avatar+gap (#3361 on a phone)`, `far=${ph.aFar} near=${ph.aNear}`);
      chk(Math.abs(ph.oFar - ph.oNear) <= 1 && ph.oNear <= 43, `[phone] the operator far gutter equals the near avatar+gap`, `far=${ph.oFar} near=${ph.oNear}`);
      chk(ph.maskClear >= 0, `[phone] the bubble tail's ground mask stops short of the avatar (it would paint over it)`, `clearance=${ph.maskClear}px`);
      // 190: in this 297px room the desktop row (34px avatar, 16px thread padding, 48px far
      // gutter) leaves about 169px, which fails this; the phone row leaves 199px.
      chk(ph.attIn === 'inside', `[phone] a 120-character file name on your own post stays inside the room`, ph.attIn);
      chk(ph.opMaskClear >= 0, `[phone] the operator tail mask stops short of its avatar`, `clearance=${ph.opMaskClear}px`);
      chk(ph.aW >= 190 && ph.oW >= 190, `[phone] both bubbles are wide on a phone`, `agent=${ph.aW}px operator=${ph.oW}px`);
      // Tap to react (a touchscreen has no hover). Real taps, in a touch context.
      const bar = () => phonePage.evaluate(() => {
        const r = document.querySelector('#pj-room .msg.rxn-show'); const q = document.querySelector('#pj-room .msg .rxn-quick');
        return { shown: document.querySelectorAll('#pj-room .msg.rxn-show').length, op: r ? getComputedStyle(r.querySelector('.rxn-quick')).opacity : (q ? getComputedStyle(q).opacity : null),
          hoverNone: matchMedia('(hover: none)').matches };
      });
      const firstBody = phonePage.locator('#pj-room .msg .msg-bd p').first();
      await firstBody.tap();
      await phonePage.waitForTimeout(300);   // the bar fades in over .12s
      const t1 = await bar();
      chk(t1.hoverNone && t1.shown === 1 && t1.op === '1', `[phone/touch] a tap on a message shows its add-reaction bar`, JSON.stringify(t1));
      // The first post's bar sits above its bubble: it must not be cut by the thread's top edge.
      const clip = await phonePage.evaluate(() => {
        const q = document.querySelector('#pj-room .msg.rxn-show .rxn-quick'); const room = document.getElementById('pj-room');
        if (!q) return { error: 'no open bar' };
        const Q = q.getBoundingClientRect(), R = room.getBoundingClientRect();
        return { barTop: Math.round(Q.top), roomTop: Math.round(R.top + parseFloat(getComputedStyle(room).borderTopWidth)), barLeft: Math.round(Q.left), roomLeft: Math.round(R.left) };
      });
      chk(!clip.error && clip.barTop >= clip.roomTop && clip.barLeft >= clip.roomLeft, `[phone/touch] the first post's bar is not clipped by the thread`, JSON.stringify(clip));
      await firstBody.tap();
      await phonePage.waitForTimeout(300);
      const t2 = await bar();
      chk(t2.shown === 0 && t2.op === '0', `[phone/touch] a second tap closes it (no sticky-hover reveal)`, JSON.stringify(t2));
      await phonePage.locator('#pj-room .att').first().tap().catch(() => {});
      await phonePage.waitForTimeout(300);
      const t3 = await bar();
      chk(t3.shown === 0, `[phone/touch] a tap on a file card does not toggle the bar`, JSON.stringify(t3));
    } finally {
      await phonePage.close();
    }
    const hoverPage = await browser.newPage({ viewport: { width: 375, height: 800 }, colorScheme: 'light' });
    try {
      await hoverPage.addInitScript(() => {
        window.setInterval = () => 0;
        window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      });
      await hoverPage.goto(PAGE);
      await hoverPage.evaluate((ts) => {
        const room = document.getElementById('pj-room'); document.body.appendChild(room);
        const fr = document.getElementById('firstrun'); if (fr) fr.remove();
        room.style.cssText = 'position:absolute;left:0;top:0;width:297px;max-height:none;z-index:50;'; room.hidden = false;
        room.innerHTML = pjRoomRow({ from: 'april', at: ts, text: 'hello there', id: 'h1' }, { agents: [{ sessionName: 'april', name: 'April' }] });
      }, now());
      await hoverPage.locator('#pj-room .msg .msg-bd p').first().click();
      const hv = await hoverPage.evaluate(() => ({ hoverNone: matchMedia('(hover: none)').matches, shown: document.querySelectorAll('#pj-room .msg.rxn-show').length }));
      chk(!hv.hoverNone && hv.shown === 0, `[hover] with a mouse a click toggles nothing (hover reveals the bar there)`, JSON.stringify(hv));
    } finally {
      await hoverPage.close();
    }

    /* #3361 (WARNING 2 from iter-1 review): the fix's claim is that at GENUINELY WIDE widths the
       78ch max-width binds first, so the far gutter is slack and the approved wide look is UNCHANGED
       (only narrow widths get capped). Prove it: at a 1200px row the 78ch bubble plus both gutters
       fits with room to spare, so the far gutter is far larger than the 48px margin (the margin is
       not the binding constraint) and the bubble is the same 78ch-capped width it was before this
       change. If the margin ever became the binding constraint at wide widths (a regression that
       narrowed the wide look), agentFarGap would collapse toward 48 and this reds. */
    const widePage = await browser.newPage({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' });
    try {
      await widePage.addInitScript(() => {
        window.setInterval = () => 0;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      });
      await widePage.goto(PAGE);
      const wide = await widePage.evaluate((ts) => {
        const p = { agents: [{ sessionName: 'april', name: 'April' }] };
        const long = 'this is a deliberately long message so the bubble grows to its 78ch cap at a wide window, where the far gutter should be slack and the wide look unchanged.';
        const host = document.createElement('div');
        host.className = 'thread';
        host.style.cssText = 'position:absolute;left:0;top:0;width:1200px;';
        host.innerHTML = pjRoomRow({ from: 'april', at: ts, text: long }, p)
          + pjRoomRow({ operator: true, at: ts, text: long }, p);
        document.body.appendChild(host);
        const rows = Array.from(host.querySelectorAll('.msg'));
        const agentRow = rows.find((r) => !r.classList.contains('you') && r.querySelector('.msg-bd'));
        const opRow = rows.find((r) => r.classList.contains('you') && r.querySelector('.msg-bd'));
        const rr = (el) => el.getBoundingClientRect();
        const aRow = rr(agentRow), aBd = rr(agentRow.querySelector('.msg-bd'));
        const oRow = rr(opRow), oBd = rr(opRow.querySelector('.msg-bd'));
        const out = {
          agentFarGap: Math.round(aRow.right - aBd.right),
          opFarGap: Math.round(oBd.left - oRow.left),
          agentBdW: Math.round(aBd.width),
          rowW: Math.round(aRow.width),
        };
        host.remove();
        return out;
      }, now());
      // The margin (48px) is NOT the binding constraint at 1200px: 78ch binds, so the far gutter is
      // far larger than 48. >=100 cleanly separates "78ch binds (slack margin)" from "margin binds".
      chk(wide.agentFarGap >= 100, `[wide] at 1200px the agent bubble is capped by 78ch, not the 48px gutter (margin slack -> wide look unchanged)`, `farGap=${wide.agentFarGap}px`);
      chk(wide.opFarGap >= 100, `[wide] at 1200px the operator bubble is capped by 78ch, not the 48px gutter`, `farGap=${wide.opFarGap}px`);
      // Control: the bubble is the 78ch cap, NOT stretched to fill the ~1104px available (which is what
      // it would do if only the margin bound). A capped-by-78ch bubble stays well under the row width.
      chk(wide.agentBdW >= 300 && wide.agentBdW < wide.rowW - 300, `[wide] the wide bubble is the 78ch cap, not stretched to the far gutter`, `bubbleW=${wide.agentBdW}px at row ${wide.rowW}px`);
    } finally {
      await widePage.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
