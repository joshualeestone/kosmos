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
 *   (i) the TAIL is a WING: the colored `::before` sits OUTSIDE the box (negative
 *       offset, agent=cream on the left, operator=blue on the right) so a translucent
 *       fill never double-tints, and the `::after` is the thread-ground mask;
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
          // #2947: the data-am the REAL pjRoomRow render emitted on the agent
          // body box, so the room path never drops it or produces NaN/out-of-range.
          agentDataAm: (agentRow && agentRow.querySelector('.msg-bd')) ? agentRow.querySelector('.msg-bd').getAttribute('data-am') : null,
          // The operator's own box must NOT carry data-am (emitted only for !isOp).
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
          /* #3134-followup (Josh 6.72): the WING. The COLORED wing is now ::before
             (background-color:inherit, so agent=cream, operator=blue), drawn OUTSIDE the
             bubble box (negative left/right) so a translucent fill composites once and
             never double-tints. ::after is the --k-bg thread-ground MASK that carves it. */
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
             z-index:0) or the tail's z-index:-1 resolves against the ambient tree
             and `.thread`'s opaque ground paints OVER the whole nub -- an invisible
             tail that every getComputedStyle-only tail assertion above still reads
             as present. This is the structural pin for that (a regression to
             z-index:auto reds it). */
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

      // Positive controls: all three rows rendered, and the mine/theirs split is real.
      chk(m.rowCount === 3, `${t} all three fixture rows rendered`, `count=${m.rowCount}`);
      chk(m.agentHasYou === false, `${t} the agent row is NOT .you (mine/theirs split is real)`);
      // #2947: the REAL pjRoomRow render emits a valid data-am (0..4) on the agent
      // box and NONE on the operator's own box.
      chk(/^[0-4]$/.test(m.agentDataAm || ''), `${t} the real agent box carries a valid data-am (0..4)`, `data-am=${m.agentDataAm}`);
      chk(m.opHasDataAm === false, `${t} the operator's own box carries NO data-am`, `opHasDataAm=${m.opHasDataAm}`);

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
      // (d) the two are distinct (blue vs cream differ well beyond the alpha).
      chk(blueLead(op) - blueLead(ag) >= 20, `${t} the operator blue and agent cream are distinct`, `op=${m.opBd} agent=${m.agentBd}`);
      // (e) a bodyless row draws NO box.
      chk(m.emptyRowIsYou && !m.emptyRowHasBox, `${t} a bodyless row draws a .msg row but NO .msg-bd (no empty tinted box)`, `isYou=${m.emptyRowIsYou} hasBox=${m.emptyRowHasBox}`);

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
      // #3134-followup (Josh 6.72): the WING. The COLORED wing is ::before, drawn OUTSIDE
      // the box (negative offset) so a translucent fill composites once and never doubles;
      // agent on the LEFT (cream), operator on the RIGHT (blue).
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
      chk(blueLead(owing) >= 20, `${t} the operator wing is the blue user tint`, m.opWing && m.opWing.bg);
      // the ::after MASK carries the thread-ground fill (carving the wing to a point).
      const amask = parse(m.agentMask && m.agentMask.bg);
      chk(!!(m.agentMask && m.agentMask.on) && amask[3] > 0,
        `${t} the wing MASK (::after) carries the thread-ground fill`, m.agentMask && m.agentMask.bg);
      // the STRUCTURAL guard for the wing's visibility -- `.msg-bd` owns its own stacking
      // context so the z-index:-1 wing tucks behind THIS bubble, not behind `.thread`.
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
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
