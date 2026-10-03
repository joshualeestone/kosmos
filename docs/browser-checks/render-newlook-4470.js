// Browser-check-surface: look-toggle look-row tsk-tile tsk-list d-talk-box d-dmthread
'use strict';
/**
 * The new look's hidden switch (#4470, Josh 2026-09-28), on a real board in a real browser.
 *
 * What this pins, and why each line can fail:
 *  - with nothing stored, the page has no data-look attribute and today's page colour
 *    (so the switch being there changes nothing until somebody turns it on),
 *  - Settings > Advanced has "Try the new look", a switch reading Off,
 *  - turning it on repaints at once (white page in light, black in dark) and the switch reads On,
 *  - a reload keeps it (the head script applies it before paint), and turning it off and
 *    reloading gives today's page back,
 *  - the project page with the look on: Tasks moved into the left box between Members and Files and
 *    the crumb row moved FIRST into the conversation header (so the keyboard meets them where the eye
 *    does), after a fresh open, a direct URL load and a live toggle; two columns when wide; plain member
 *    rows (a working one too) with a state word the remove minus never covers; compact task rows ("#n",
 *    the claim line kept, parts with hollow/filled dots, "Part of" on top) sharing the members' right
 *    edge; sentence-case headings; bubbles and composer greys (also in chosen Dark on a light machine);
 *    tabs marked by ink and weight; the consolidated layout keeping today's arrangement and back again,
 *  - with it off: every placement back where today has it, no state word, today's underline,
 *  - the Agents page's inks clearing 4.5:1 on the new grounds,
 *  - the Agents page in the new look: the plain idle card and the Agents tile lose their border, New agent is a
 *    40px round grey button, a pressed Messages filter still looks pressed; the working card's stroke and the
 *    current view's gold are the same as with the look off; Issue, Question and could-not-read cards keep their
 *    strokes (the could-not-read dash at least 1.5:1 off its ground, measured by EDGE_RATIO); the Messages filter rests on the grey ground and keeps its width under the pointer; a board note is
 *    the grey box while a could-not-read note keeps its solid border (and a note in a project page keeps today's
 *    look); and with the look off, today's bordered card, tile and New agent tile (the control),
 *  - an agent's page in the new look (DM_LOOK): the conversation on the page's ground, your message grey, an agent's
 *    with no bubble, the composer a grey pill with no stroke; with the look off, today's (the control),
 *  - an agent's left column in the new look (DLEFT_LOOK): one grey box with 28px corners, the open section a tile in the
 *    page's ground and the rest flat, no edge and no gold; Files with no card under a hairline and a sentence-case
 *    heading; 300 to 380px wide on a desktop; the Profile boxes with no edge and 28px corners and sentence-case field
 *    labels; with the look off, today's (the control),
 *  - the Tasks page in the new look (tasksLook): a plain tile and the task list lose their border and take 16px corners;
 *    Needs Your Decision holding tasks keeps a red edge (red in both looks; its grey half is remapped) and a filtering
 *    tile its gold; at zero it is drawn like the others; a tile under the pointer shows its border;
 *    with the look off, today's bordered tiles and list with 12px corners,
 *  - the Agents LIST in the new look (listLook): a plain row with no border, 16px corners and its name button left;
 *    a border under the pointer with the ground unchanged; a needs-you row's red and a could-not-read row's dash
 *    you can see (1.5:1); and against the look off, today's state wash, red and dash, and today's bordered row
 *    with a centred name (the control),
 *  - light, dark and 390 wide, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-newlook-4470.js [shots-dir]            # headed
 *   HEADED=0 node docs/browser-checks/render-newlook-4470.js [shots-dir]   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-newlook-bc-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-newlook-bc-' + t)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');

const SHOTS = process.argv[2] || null;
const fail = [];
let ran = 0;
function chk(ok, label, extra) {
  ran += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* Today's page colour, per theme, read from the stylesheet's own --k-bg rather than typed here,
   so a later change to today's colours does not make this check lie. */
const PAGE_STATE = `(() => ({
  look: document.documentElement.getAttribute('data-look'),
  kbg: getComputedStyle(document.documentElement).getPropertyValue('--k-bg').trim().toLowerCase(),
  sw: (document.getElementById('look-toggle') || {}).getAttribute ? document.getElementById('look-toggle').getAttribute('aria-checked') : 'absent',
  wide: document.documentElement.scrollWidth > window.innerWidth,
}))()`;

/* Where the Tasks column is: which cards the left box holds in order, whether Tasks is the last
   child of .pj3 (today's markup), and how many grid columns .pj3 lays out. */
const TASKS_PLACE = `(() => {
  const split = document.querySelector('#pj-one-view .pj3 > .pjsplit');
  const pj3 = split.parentElement;
  const order = [...split.children].map((c) => c.classList.contains('pjcard-members') ? 'members' : c.classList.contains('pjcard-files') ? 'files' : c.matches('aside.pjcol') ? 'tasks' : null).filter(Boolean).join(',');
  const last = pj3.lastElementChild;
  return { order, tasksLast: !!last && last.matches('aside.pjcol:not(.pjsplit)'), cols: getComputedStyle(pj3).gridTemplateColumns.split(' ').length };
})()`;

/* The first member row's state word: whether it is rendered visibly, and its text. */
const MEMBER_WORD = `(() => {
  const el = document.querySelector('#pj-one-agents .pj-member .pj-member-st');
  if (!el) return { shown: false, text: '', present: false };
  const r = el.getBoundingClientRect();
  return { shown: getComputedStyle(el).display !== 'none' && r.width > 0, text: el.textContent.trim(), present: true };
})()`;

/* Where the back-and-crumb row is, and whether the "Projects" root and the h2 name show. */
const HEAD_PLACE = `(() => {
  const row = document.querySelector('#pj-one-view .pj-crumbrow');
  const root = document.getElementById('pj-crumb-root');
  const name = document.getElementById('pj-one-name');
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 2;
  return { inMid: !!row && !!row.closest('.pjmidhead'), first: !!row && row.parentElement.firstElementChild === row, aboveCols: !!row && row.parentElement.id === 'pj-one-view',
    rootShown: vis(root), nameInDom: !!name && name.textContent.trim().length > 0, nameShown: vis(name) };
})()`;
/* The current top tab's underline colour and the text colour of a current and a non-current tab. */
const TABS = `(() => {
  const on = document.querySelector('.apphead .tab.on');
  const off = document.querySelector('.apphead .tab:not(.on)');
  return { onUnderline: on ? getComputedStyle(on).borderBottomColor : 'absent', onColor: on ? getComputedStyle(on).color : '', offColor: off ? getComputedStyle(off).color : '',
    onWeight: on ? Number(getComputedStyle(on).fontWeight) : 0, offWeight: off ? Number(getComputedStyle(off).fontWeight) : 0 };
})()`;
const GREY_OF = { light: 'rgb(245, 245, 247)', dark: 'rgb(44, 44, 46)' };
/* The fill the room paints for your message and for an agent's, read from two sample bubbles put
   in the thread for the measurement and removed after (no agent can post in this sandbox). */
const BUBBLES = `(() => {
  const room = document.getElementById('pj-room');
  const mk = (you) => { const m = document.createElement('div'); m.className = 'msg' + (you ? ' you' : ''); m.innerHTML = '<div class="msg-b"><div class="msg-bd">x</div></div>'; room.appendChild(m); return m; };
  const a = mk(true), b = mk(false);
  const out = { you: getComputedStyle(a.querySelector('.msg-bd')).backgroundColor, agent: getComputedStyle(b.querySelector('.msg-bd')).backgroundColor };
  a.remove(); b.remove();
  return out;
})()`;
/* #4470, an agent's page: its conversation read off the DM's own elements (they exist, hidden, before any agent is
   opened, and computed style still answers): the talk box's ground, a hand-made message of yours and of an agent's,
   and the composer box (in .dmbar). Messages are removed after. */
const DM_LOOK = `(() => {
  const th = document.getElementById('d-dmthread'), box = document.getElementById('d-talk-box');
  const cb = document.querySelector('#d-talk-box .dmbar.composerbox');   // one element with both classes (round 1)
  if (!th || !box || !cb) return { found: false };
  /* Read with the panel shown (round 2: a pseudo-element under a hidden subtree may not answer), then put it back. */
  const panel = document.getElementById('panel-detail'); const wasHidden = panel ? panel.hidden : false; if (panel) panel.hidden = false;
  try {
  const mk = (you) => { const m = document.createElement('div'); m.className = 'msg' + (you ? ' you' : ''); m.innerHTML = '<div class="msg-b"><div class="msg-bd">x</div></div>'; th.appendChild(m); return m; };
  const a = mk(true), b = mk(false);
  try {
  const cs = getComputedStyle(cb);
  const out = { found: true, box: getComputedStyle(box).backgroundColor, you: getComputedStyle(a.querySelector('.msg-bd')).backgroundColor,
    agent: getComputedStyle(b.querySelector('.msg-bd')).backgroundColor, tail: getComputedStyle(b.querySelector('.msg-bd'), '::after').backgroundColor,
    composer: cs.backgroundColor, composerBorderW: cs.borderTopWidth, composerRadius: cs.borderTopLeftRadius };
  return out;
  } finally { a.remove(); b.remove(); }
  } finally { if (panel) panel.hidden = wasHidden; }
})()`;
/* #4470, an agent's page, slice 2: its left column, read with the panel shown and put back as DM_LOOK does: the
   column's ground and corners, the open section button and a closed one (ground, edge, ink), the Files section's
   ground and top hairline, its heading's case and spacing, and the column's width. */
const DLEFT_LOOK = `(() => {
  const left = document.querySelector('#panel-detail .dleft'), files = document.getElementById('d-files'), head = document.getElementById('d-files-h');
  const on = document.querySelector('#d-nav button.on:not(.dnav-swarm)'), off = document.querySelector('#d-nav button:not(.on):not(.dnav-swarm):not([hidden])');
  if (!left || !files || !head || !on || !off) return { found: false };
  const panel = document.getElementById('panel-detail'); const wasHidden = panel ? panel.hidden : false; if (panel) panel.hidden = false;
  const filesHidden = files.hidden; files.hidden = false;
  try {
    const L = getComputedStyle(left), F = getComputedStyle(files), H = getComputedStyle(head), O = getComputedStyle(on), X = getComputedStyle(off);
    return { found: true, ground: L.backgroundColor, radius: L.borderTopLeftRadius, width: Math.round(left.getBoundingClientRect().width),
      onBg: O.backgroundColor, onEdge: O.borderTopColor, onInk: O.color, offBg: X.backgroundColor, offEdge: X.borderTopColor, offInk: X.color,
      filesBg: F.backgroundColor, filesRule: F.borderTopWidth, headCase: H.textTransform, headSpacing: H.letterSpacing,
      padL: L.paddingLeft, talkOpen: !document.getElementById('d-sec-talk').hidden,
      /* Slice 3: a Profile box and its first field label (computed style answers under the hidden section). */
      ...(() => { const bx = document.querySelector('#d-sec-profile .dbox'), lb = bx && bx.querySelector('.flabel');
        if (!bx || !lb) return { boxFound: false };
        const B = getComputedStyle(bx), Lb = getComputedStyle(lb), hd = document.querySelector('#d-sec-model .dbox .dlab');
        return { boxFound: true, boxEdge: B.borderTopColor, boxRadius: B.borderTopLeftRadius, labelCase: Lb.textTransform, labelSpacing: Lb.letterSpacing,
          headCase2: hd ? getComputedStyle(hd).textTransform : 'absent',
          /* Round 1: the box rule reached the conversation's box too; it must keep today's square edge (#3414). */
          talkRadius: getComputedStyle(document.getElementById('d-talk-box')).borderTopLeftRadius }; })(),
      cut: [...document.querySelectorAll('#d-nav button:not([hidden]) .dnav-lab')].filter((l) => l.scrollWidth > l.clientWidth).map((l) => l.textContent.trim()) };
  } finally { files.hidden = filesHidden; if (panel) panel.hidden = wasHidden; }
})()`;
/* Each member row's ground: colour and image, and whether it is a working row. */
/* #4765: the working pulse runs on the row's ::before layer now, so "no pulse" is read there too: no layer at all
   (content none) and no animation. A pulse the box itself does not carry is still a pulse on screen. */
const ROW_GROUNDS = `[...document.querySelectorAll('#pj-one-agents .pj-member')].map((m) => ({ working: m.classList.contains('pjm-working'), bg: getComputedStyle(m).backgroundColor, img: getComputedStyle(m).backgroundImage, layer: getComputedStyle(m, '::before').content, layerAnim: getComputedStyle(m, '::before').animationName, anim: getComputedStyle(m).animationName }))`;
/* The left box's task rows: how many, how many still draw a card border, whether the number reads
   a hash sign and the number (the word hidden, the hash drawn) and whether an assigned row's claim line is visible. */
const TASK_ROWS = `(() => {
  const cards = [...document.querySelectorAll('#pj-one-view .pjsplit .tkcard')];
  const first = cards.find((c) => c.querySelector('.tkcard-who b'));
  const claim = first && first.querySelector('.tksay, .tkunk');
  const n = cards[0] && cards[0].querySelector('.tkcard-n');
  return { rows: cards.length,
    boxed: cards.filter((c) => parseFloat(getComputedStyle(c).borderTopWidth) > 0).length,
    hashShown: !!n && getComputedStyle(cards[0], '::before').content.startsWith('"#' + cards[0].dataset.task + '"') && parseFloat(getComputedStyle(cards[0], '::before').fontSize) > 10,
    /* clipped like .vh, never a zero font size: the "Task n" text must stay readable by a screen reader */
    wordHidden: !!n && getComputedStyle(n).position === 'absolute' && getComputedStyle(n).clipPath === 'inset(50%)' && parseFloat(getComputedStyle(n).fontSize) > 0 && n.textContent.startsWith('Task ' + cards[0].dataset.task),
    claimShown: !!claim && getComputedStyle(claim).display !== 'none' && claim.getBoundingClientRect().height > 0 };
})()`;
/* A left-box task row that says "Part of #N": is its line drawn above the row's title? */
const PART_OF = `(() => {
  const po = document.querySelector('#pj-one-view .pjsplit .tkcard .tkcard-part-of');
  if (!po) return { found: false };
  const t = po.closest('.tkcard').querySelector('.tkcard-t');
  return { found: true, above: po.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1, text: po.textContent.trim() };
})()`;
/* The contrast of the text tokens on the ground tokens as the page resolves them right now. Each
   token is resolved by painting it on a probe element, so a var() chain resolves as the page does. */
const TOKEN_CONTRAST = `(() => {
  const probe = document.createElement('span'); document.body.appendChild(probe);
  const rgb = (v, prop) => { probe.style[prop] = 'var(' + v + ')'; const m = getComputedStyle(probe)[prop].match(/[0-9.]+/g).map(Number); return m; };
  const lum = (c) => { const f = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const pairs = [];
  for (const ink of ['--k-ink', '--k-ink-2', '--label', '--label-2', '--nl-ink-3']) for (const ground of ['--k-bg', '--k-surface']) {
    pairs.push({ ink, ground, ratio: ratio(rgb(ink, 'color'), rgb(ground, 'backgroundColor')) });
  }
  probe.remove();
  return { pairs, wide: document.documentElement.scrollWidth > window.innerWidth };
})()`;
/* The left box's task split into parts: visible avatars left in its part lines, and whether the held part's
   dot is filled and the "Nobody yet" part's dot hollow. */
const PARTS = `(() => {
  const row = [...document.querySelectorAll('#pj-one-view .pjsplit .tkcard')].find((c) => c.querySelector('.tkcard-parts'));
  if (!row) return { found: false };
  const dot = (el) => { if (!el) return 'absent'; const b = getComputedStyle(el.querySelector('b'), '::before'); return b.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 'filled' : (b.boxShadow && b.boxShadow !== 'none' ? 'hollow' : 'none'); };
  return { found: true, avatars: [...row.querySelectorAll('.tkcard-part .lav')].filter((a) => a.getClientRects().length).length,
    held: dot(row.querySelector('.tkcard-part:not(.none)')), nobody: dot(row.querySelector('.tkcard-part.none')) };
})()`;
/* #4470, the Tasks page in the new look: a plain tile and the task list lose their border and take 16px corners; a
   Needs Your Decision tile holding tasks keeps its red edge and a filtering tile its gold (set by hand on the page's
   own tiles, then put back, since the fixture's counts are what they are). Reads, then returns to the Agents tab. */
async function tasksLook(page) {
  await page.mouse.move(1, 1);   // nothing under the pointer when the resting borders are read (round 4)
  await page.evaluate(() => showTab('tasks'));
  await page.waitForSelector('#panel-tasks .tsk-tile', { state: 'visible', timeout: 8000 }).catch(() => {});
  const out = await page.evaluate(() => {
    /* A computed colour as 0-255 channels, from either serialisation: rgb()/rgba(), or color(srgb r g b) with 0-1
       channels, which is what a color-mix() computes to (round 2). null for anything else, so an arm fails loudly. */
    const rgb = (c) => {
      let m = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(c);
      if (m) return [+m[1], +m[2], +m[3]];
      m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);
      return m ? [m[1] * 255, m[2] * 255, m[3] * 255] : null;
    };
    /* Red: red well above both, and green and blue close together (round 3: dark gold #d6a62e is red-dominant too, but
       its green sits far above its blue; the real red mixes have |G - B| under 7, the golds over 80). */
    const isRed = (c) => { const v = rgb(c); return !!v && v[0] > v[1] + 40 && v[0] > v[2] + 40 && Math.abs(v[1] - v[2]) < 30; };
    const isGold = (c) => { const v = rgb(c); return !!v && v[0] > v[2] + 40 && v[1] > v[2] + 20; };
    const tiles = [...document.querySelectorAll('#panel-tasks .tsk-tile')];
    const plain = tiles.find((t) => t.dataset.tile !== 'decision' && t.getAttribute('aria-pressed') !== 'true');
    const dec = tiles.find((t) => t.dataset.tile === 'decision');
    const list = document.querySelector('#panel-tasks .tsk-list');
    if (!plain || !dec) return { found: false, tiles: tiles.length };
    const r = { found: true, plain: getComputedStyle(plain).borderTopColor, radius: getComputedStyle(plain).borderTopLeftRadius,
      list: list ? getComputedStyle(list).borderTopColor : 'absent', listRadius: list ? getComputedStyle(list).borderTopLeftRadius : 'absent' };
    const n0 = dec.getAttribute('data-n');
    try {
      dec.setAttribute('data-n', '2'); r.decision = getComputedStyle(dec).borderTopColor;
      dec.setAttribute('data-n', '0'); r.decisionZero = getComputedStyle(dec).borderTopColor;   // #3949: a zero tile is drawn like the others
    } finally { if (n0 === null) dec.removeAttribute('data-n'); else dec.setAttribute('data-n', n0); }
    r.decisionRed = isRed(r.decision);
    const p0 = plain.getAttribute('aria-pressed');
    try { plain.setAttribute('aria-pressed', 'true'); r.pressed = getComputedStyle(plain).borderTopColor; }
    finally { if (p0 === null) plain.removeAttribute('aria-pressed'); else plain.setAttribute('aria-pressed', p0); }
    r.pressedGold = isGold(r.pressed);
    /* Negative controls, read off the page (round 3): the filtering gold, the closest wrong answer, is not red, and a
       visible plain border (look off) is not red either; each makes the red test show it can say no. */
    r.goldNotRed = !isRed(r.pressed);
    r.plainNotRed = r.plain === 'rgba(0, 0, 0, 0)' ? null : !isRed(r.plain);
    return r;
  });
  if (out.found) {   // under the pointer the border comes back (the tiles are filters, i.e. controls)
    await page.hover('#panel-tasks .tsk-tile:not([data-tile="decision"]):not([aria-pressed="true"])'); await page.waitForTimeout(150);
    /* Read the tile the pointer is actually on; a miss is reported as a miss, never as some other element's colour. */
    out.hover = await page.evaluate(() => { const h = document.querySelector('#panel-tasks .tsk-tile:not([data-tile="decision"]):not([aria-pressed="true"]):hover'); return h ? getComputedStyle(h).borderTopColor : 'missed'; });
    await page.mouse.move(1, 1);
  }
  await page.evaluate(() => showTab('agents'));
  await page.waitForTimeout(300);
  return out;
}
/* The list view (#4470's next page): switch the Agents board to the list, read the plain idle row (and the same
   row under the pointer), then switch back to the grid so the later arms read the cards. */
async function listLook(page) {
  const btn = await page.$('#boardbar .vt[data-layout="list"]');
  if (!btn) return { found: false, why: 'no list button' };
  await btn.click();
  await page.waitForSelector('#alist .lrow', { timeout: 8000 }).catch(() => {});
  const read = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#alist .lrow')];
    const idle = rows.find((r) => !['working', 'attn', 'unk', 'off'].some((c) => r.classList.contains(c)));
    if (!idle) return { found: false, why: 'no plain row', rows: rows.length };
    const cs = getComputedStyle(idle);
    const nm = idle.querySelector('.lname .namego');
    return { found: true, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, groundImg: cs.backgroundImage, groundColor: cs.backgroundColor, nameAlign: nm ? getComputedStyle(nm).textAlign : 'absent' };
  });
  const rest = await read();
  let hover = null, hoverGround = null;
  if (rest.found) {
    await page.hover('#alist .lrow:not(.working):not(.attn):not(.unk):not(.off)'); await page.waitForTimeout(150);
    const h = await read(); hover = h.border; hoverGround = h.groundImg + ' | ' + h.groundColor; await page.mouse.move(1, 1);
  }
  /* The strokes that mean something, on rows drawn by hand (the fixture has no needs-you or could-not-read agent). */
  const strokes = await page.evaluate((ratioFn) => {
    const l = document.getElementById('alist'); if (!l) return null;
    const out = {};
    for (const c of ['attn', 'unk']) {
      const d = document.createElement('div'); d.className = 'lrow ' + c; d.textContent = 'x'; l.append(d);
      const cs = getComputedStyle(d); out[c] = { color: cs.borderTopColor, style: cs.borderTopStyle };
      out[c].ratio = new Function(`return (${ratioFn})`)()(d);
      d.remove();
    }
    return out;
  }, EDGE_RATIO);
  const grid = await page.$('#boardbar .vt[data-layout="grid"]');
  if (grid) { await grid.click(); await page.waitForTimeout(300); }
  return { ...rest, hover, hoverGround, strokes };
}
/* How far an element's top edge stands off its own ground (surface, then any state wash, then the edge; all may be
   translucent), as a contrast ratio. Evaluated in the page. 1.5:1 is the floor the dash arms ask: under WCAG's 3:1
   for indicators, which is acceptable here because the dash is never the only sign (each state also has its glyph
   and its words); the floor exists to catch a dash that has vanished (1.04:1 was measured before #4470's fix). */
const EDGE_RATIO = `(el) => {
  const cs = getComputedStyle(el);
  /* Only rgb()/rgba() is read (0-255 channels). Anything else (color(srgb ...), oklch) would be misread as near
     black and could pass falsely, so it returns 0, which fails every floor. */
  if (![cs.backgroundColor, cs.borderTopColor].every((v) => /^rgba?\\(/.test(v))) return 0;
  const rgba = (v) => { const m = v.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const wash = (cs.backgroundImage.match(/rgba?\\([^)]*\\)/) || [null])[0];
  let ground = rgba(cs.backgroundColor); if (wash) ground = over(rgba(wash), ground);
  const edge = over(rgba(cs.borderTopColor), ground);
  const [hi, lo] = [lum(edge), lum(ground)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}`;
const COMPOSER_BG = `getComputedStyle(document.querySelector('#pj-one-view .pjmid .composer .composerbox')).backgroundColor`;
/* The Agents page in the new look: the idle and the working card's border, the Agents tile's border, the New
   agent button's round, the current view segment's ground, and the page's own ground. */
const AGENTS_LOOK = `(() => {
  const cards = [...document.querySelectorAll('#grid .acard')];
  const STATES = ['working', 'attn', 'question', 'unk', 'off'];
  const card = (cls) => cls === 'idle' ? cards.find((c) => !STATES.some((s) => c.classList.contains(s))) : cards.find((c) => c.classList.contains(cls));
  const bc = (el) => el ? getComputedStyle(el).borderTopColor : 'absent';
  const plus = document.querySelector('#new-agent .plus'), on = document.querySelector('#boardbar .vt.on');
  const agentsTile = document.getElementById('st-agents') && document.getElementById('st-agents').closest('.stat');
  const p = plus ? getComputedStyle(plus) : null;
  const idleCard = card('idle');
  return { idle: bc(idleCard), radius: idleCard ? getComputedStyle(idleCard).borderTopLeftRadius : 'absent', working: bc(card('working')), tile: bc(agentsTile),
    plus: p ? { w: plus.getBoundingClientRect().width, round: p.borderRadius, bg: p.backgroundColor } : null,
    seg: on ? getComputedStyle(on).backgroundColor : 'absent', page: getComputedStyle(document.body).backgroundColor };
})()`;

(async () => {
  let server, browser;
  try {
    fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' }),
      fleet.agent('bo', { state: 'working', displayName: 'Bo', role: 'a builder' })]);
    const proj = projects.create({ name: 'Billing' });
    projects.addAgent(proj.id, 'ada', null);
    projects.addAgent(proj.id, 'bo', null);
    const tasks = require('../../engine/tasks');
    const t1 = tasks.create(proj.id, { sentence: 'Plan the launch week', who: 'ada' });
    tasks.create(proj.id, { sentence: 'Book the venue', who: 'ada', parent: t1.number });
    tasks.create(proj.id, { sentence: 'Order the paper' });
    /* Three more, then a late subtask of #1: the column shows the newest five, so #1 drops out and
       its subtask has to say "Part of #1" on its own. */
    for (const w of ['Draft the menu', 'Call the florist', 'Print the badges']) tasks.create(proj.id, { sentence: w });
    tasks.create(proj.id, { sentence: 'Send the reminders', who: 'bo', parent: t1.number });
    /* A task split into two parts, one held by Ada and one by nobody. */
    const split = tasks.create(proj.id, { sentence: 'Set up the room', who: 'ada' });
    tasks.addPart(proj.id, split.number, { sentence: 'Chairs' });
    server = await srv.start(0);
    const URL = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: process.env.HEADED === '0' });
    const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
    const openAdvanced = async (page) => {
      await page.evaluate(() => { showTab('settings'); });
      await page.click('[data-go="advanced"]');
      await page.waitForSelector('#look-toggle:not([hidden])', { timeout: 8000 });
    };
    const NEW = { light: '#ffffff', dark: '#000000' };
    for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
      const tag = `[${theme} ${width}]`;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      const before = await page.evaluate(PAGE_STATE);
      const dmBefore = await page.evaluate(DM_LOOK);   // today's DM, before the switch is ever touched (the off control's baseline)
      const dlBefore = await page.evaluate(DLEFT_LOOK);   // and today's left column, for the same control
      chk(before.look === null, `${tag} nothing stored: no data-look attribute`, JSON.stringify(before));
      chk(before.kbg && before.kbg !== NEW[theme], `${tag} nothing stored: today's page colour, not the new look's`, before.kbg);

      await openAdvanced(page);
      const label = await page.textContent('#look-row b');
      chk(label === 'Try the new look', `${tag} Advanced has "Try the new look"`, label);
      chk((await page.evaluate(PAGE_STATE)).sw === 'false', `${tag} the switch reads Off`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `newlook-off-${theme}-${width}.png`) }); }

      await page.click('#look-toggle');
      const on = await page.evaluate(PAGE_STATE);
      chk(on.look === 'new' && on.sw === 'true', `${tag} On sets the new look and the switch reads On`, JSON.stringify(on));
      chk(on.kbg === NEW[theme], `${tag} On repaints the page ${NEW[theme]}`, on.kbg);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `newlook-on-${theme}-${width}.png`) });
      await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, proj.id);
      await page.waitForSelector('#pj-one-view:not([hidden])', { timeout: 8000 });
      const pjOn = await page.evaluate(TASKS_PLACE);
      chk(pjOn.order === 'members,tasks,files', `${tag} On: Tasks sits in the left box between Members and Files`, JSON.stringify(pjOn));
      chk(width < 1088 ? pjOn.cols === 1 : pjOn.cols === 2, `${tag} On: the project page is ${width < 1088 ? 'one column (narrow)' : 'two columns'}`, JSON.stringify(pjOn));
      await page.waitForSelector('#pj-one-agents .pj-member', { timeout: 8000 });
      const stOn = await page.evaluate(MEMBER_WORD);
      chk(stOn.shown && stOn.text.length > 0, `${tag} On: a member row shows its state word`, JSON.stringify(stOn));
      if (width >= 1088) {
        /* Hovering a member row to read its state keeps the word: only the remove minus hides it. */
        await page.hover('#pj-one-agents .pj-member .pj-member-b b');
        const hoverWord = await page.evaluate(`getComputedStyle(document.querySelector('#pj-one-agents .pj-member .pj-member-st')).visibility`);
        const lane = await page.evaluate(`(() => {
          const row = document.querySelector('#pj-one-agents .pj-member');
          const w = row.querySelector('.pj-member-st').getBoundingClientRect();
          const m = row.querySelector('.pj-minus'); const r = m ? m.getBoundingClientRect() : null;
          /* each row's CONTENT edge (its box less its right padding): the lane the minus sits in is outside it */
          const edge = (el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight);
          const card = document.querySelector('#pj-one-view .pjsplit .tkcard');
          return { minusShown: !!m && getComputedStyle(m).opacity === '1', overlap: !!r && r.left < w.right && r.right > w.left,
            wordRight: Math.round(w.right), memberEdge: Math.round(edge(row)), taskRight: card ? Math.round(edge(card)) : null };
        })()`);
        chk(hoverWord === 'visible' && lane.minusShown && !lane.overlap, `${tag} On: hovering a member row shows the remove minus beside its state word, never on it`, JSON.stringify({ hoverWord, ...lane }));
        chk(lane.taskRight !== null && Math.abs(lane.memberEdge - lane.taskRight) <= 1 && Math.abs(lane.wordRight - lane.memberEdge) <= 1,
          `${tag} On: member states end at the row's edge, and member and task rows share one right edge`, JSON.stringify(lane));
      }
      await page.mouse.move(0, 0);
      const rows = await page.evaluate(ROW_GROUNDS);
      chk(rows.length >= 2 && rows.some((r) => r.working) && rows.every((r) => r.bg === 'rgba(0, 0, 0, 0)' && r.img === 'none' && r.anim === 'none' && r.layerAnim === 'none' && (r.layer === 'none' || r.layer === 'normal')),
        `${tag} On: every member row is plain, a working one too (no wash, no pulse)`, JSON.stringify(rows));
      if (width >= 1088) {   // a phone width shows the tabs as a menu, with its own current-row style
        const tabs = await page.evaluate(TABS);
        chk(tabs.onUnderline === 'rgba(0, 0, 0, 0)' && tabs.onColor !== tabs.offColor && tabs.onWeight > tabs.offWeight, `${tag} On: the current tab is marked by ink and weight, not an underline`, JSON.stringify(tabs));
      }
      const dmOn = await page.evaluate(DM_LOOK);
      const bub = await page.evaluate(BUBBLES);
      const PAGE_OF = { light: 'rgb(255, 255, 255)', dark: 'rgb(0, 0, 0)' };
      chk(bub.you === GREY_OF[theme] && bub.agent === PAGE_OF[theme], `${tag} On: your message is grey, an agent's is the page's own ground (no bubble)`, JSON.stringify(bub));
      chk(dmOn.found && dmOn.box === PAGE_OF[theme] && dmOn.you === GREY_OF[theme] && dmOn.agent === PAGE_OF[theme] && dmOn.tail === PAGE_OF[theme],
        `${tag} On, an agent's page: the conversation on the page's ground, your message grey, an agent's with no bubble`, JSON.stringify(dmOn));
      chk(dmOn.found && dmOn.composer === GREY_OF[theme] && dmOn.composerBorderW === '0px' && dmOn.composerRadius === '24px',
        `${tag} On, an agent's page: the composer is the grey pill with no stroke`, JSON.stringify(dmOn));
      const dlOn = await page.evaluate(DLEFT_LOOK);
      const CLEAR = 'rgba(0, 0, 0, 0)';
      if (width > 640) {   // up to 40rem with the chat open is the phone chat, read at 375 below
        chk(dlOn.found && dlOn.ground === GREY_OF[theme] && dlOn.radius === '28px',
          `${tag} On, an agent's page: the left column is the one grey box with 28px corners`, JSON.stringify(dlOn));
        chk(dlOn.found && dlOn.onBg === PAGE_OF[theme] && dlOn.onEdge === CLEAR && dlOn.offBg === CLEAR && dlOn.offEdge === CLEAR && dlOn.onInk !== dlOn.offInk,
          `${tag} On, an agent's page: the open section is a tile in the page's ground, the others lie flat, no edge and no gold, the open one in a different ink`, JSON.stringify(dlOn));
      }
      chk(dlOn.found && dlOn.filesBg === CLEAR && dlOn.filesRule === '1px' && dlOn.headCase === 'none' && (dlOn.headSpacing === 'normal' || dlOn.headSpacing === '0px'),
        `${tag} On, an agent's page: Files has no card, a hairline above it, and a sentence-case heading`, JSON.stringify(dlOn));
      if (width >= 1088) chk(dlOn.found && dlOn.width >= 300 && dlOn.width <= 380, `${tag} On, an agent's page: the left column is the project page's 300 to 380px`, JSON.stringify(dlOn));
      chk(dlOn.found && dlOn.cut.length === 0, `${tag} On, an agent's page: no section button's label is cut off`, JSON.stringify(dlOn));
      chk(dlOn.boxFound && dlOn.boxEdge === CLEAR && dlOn.boxRadius === '28px' && dlOn.labelCase === 'none' && (dlOn.labelSpacing === 'normal' || dlOn.labelSpacing === '0px'),
        `${tag} On, an agent's Profile: its boxes have no edge and 28px corners, its field labels are sentence case`, JSON.stringify(dlOn));
      chk(dlOn.boxFound && dlOn.headCase2 === 'none' && dlOn.talkRadius === '0px',
        `${tag} On, an agent's AI Settings: box headings sentence case, and the conversation's box still square`, JSON.stringify(dlOn));
      /* Round 1: between 56rem and 68rem the column was still 220px, which inside the box's padding left the file names
         a few letters each; and the phone chat, sized to the pixel, lost 56px of its nav row to the box. Both read here. */
      const atWidth = async (w) => { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150); return page.evaluate(DLEFT_LOOK); };
      if (width === 1280) {
        const dl1000 = await atWidth(1000);
        chk(dl1000.found && dl1000.width >= 300 && dl1000.cut.length === 0, `${tag} On, an agent's page at 1000 wide: the wide column, and no label cut off`, JSON.stringify(dl1000));
        await atWidth(width);
      } else {
        const dl375 = await atWidth(375);
        chk(dl375.found && dl375.talkOpen && dl375.ground === 'rgba(0, 0, 0, 0)' && dl375.padL === '0px' && dl375.onBg === GREY_OF[theme] && dl375.cut.length === 0,
          `${tag} On, the phone chat at 375: today's column geometry (no box, no padding), the open section a grey tile, no label cut off`, JSON.stringify(dl375));
        await atWidth(width);
      }
      const tk = await page.evaluate(TASK_ROWS);
      chk(tk.rows >= 3 && tk.boxed === 0 && tk.hashShown && tk.wordHidden && tk.claimShown,
        `${tag} On: tasks are compact rows (the number with a hash sign, no box), and the agent's claim line still shows`, JSON.stringify(tk));
      const labs = await page.evaluate(`[...document.querySelectorAll('#pj-one-view .pjsplit .dlab')].filter((h) => h.getClientRects().length).map((h) => getComputedStyle(h).textTransform)`);
      chk(labs.length >= 3 && labs.every((x) => x === 'none'), `${tag} On: the left box's headings are sentence case`, JSON.stringify(labs));
      const parts = await page.evaluate(PARTS);
      chk(parts.found && parts.avatars === 0 && parts.held === 'filled' && parts.nobody === 'hollow',
        `${tag} On: a task in parts shows each part with a dot (hollow for the part nobody holds), no avatars`, JSON.stringify(parts));
      const partOf = await page.evaluate(PART_OF);
      chk(partOf.found && partOf.above, `${tag} On: a subtask's "Part of" line sits above its title, as it reads`, JSON.stringify(partOf));
      const hdOn = await page.evaluate(HEAD_PLACE);
      chk(hdOn.inMid && hdOn.first && hdOn.rootShown && hdOn.nameInDom && !hdOn.nameShown, `${tag} On: back and "Projects / name" head the conversation; the h2 stays for screen readers, visually hidden`, JSON.stringify(hdOn));
      chk(!(await page.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)), `${tag} On: the project page has no sideways scroll`);
      /* Turning it off LIVE, on the open project page (no reload): lookToggleClick must move both back. */
      await page.evaluate(() => lookToggleClick());
      const liveOff = { look: await page.evaluate(`document.documentElement.getAttribute('data-look')`), ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
      chk(liveOff.look === null && liveOff.tasksLast && liveOff.aboveCols, `${tag} Off live on the project page: Tasks and the crumb row go back at once`, JSON.stringify(liveOff));
      await page.evaluate(() => lookToggleClick());
      if (width >= 1088) {
        /* The consolidated layout with the look on keeps today's ARRANGEMENT: placeLook puts Tasks back
           at the end of .pj3 and the crumb row out of the conversation header, which the consolidated
           grid places by position. Then back to tabs, where both move in again. */
        await page.evaluate((id) => { applyLayout('consolidated', true); showTab('projects'); openProject(id); }, proj.id);
        await page.waitForTimeout(800);
        const cons = { cons: await page.evaluate(`document.body.classList.contains('consolidated')`), ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
        chk(cons.cons && cons.tasksLast && !cons.inMid && !(await page.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)),
          `${tag} On + consolidated layout: Tasks at the end of the columns and the crumb out of the header, as today`, JSON.stringify(cons));
        await page.evaluate((id) => { applyLayout('tabs', true); showTab('projects'); openProject(id); }, proj.id);
        await page.waitForTimeout(800);
        const tabsAgain = { cons: await page.evaluate(`document.body.classList.contains('consolidated')`), ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
        chk(!tabsAgain.cons && tabsAgain.order === 'members,tasks,files' && tabsAgain.inMid && tabsAgain.first, `${tag} On, back to tabs: Tasks and the header move in again`, JSON.stringify(tabsAgain));
      }
      const GREY = { light: 'rgb(245, 245, 247)', dark: 'rgb(44, 44, 46)' };
      const cb = await page.evaluate(COMPOSER_BG);
      chk(cb === GREY[theme], `${tag} On: the composer is the drawing's grey`, cb);
      if (theme === 'light' && width === 1280) {
        /* Chosen Dark on a light machine: the generated forced-dark composer rules sit later in the
           sheet than the new look's, so this is the arm where a tie would go the wrong way. */
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const cbForced = await page.evaluate(COMPOSER_BG);
        chk(cbForced === GREY.dark, `${tag} On + chosen Dark: the composer is the dark grey`, cbForced);
        const bubForced = await page.evaluate(BUBBLES);
        chk(bubForced.you === GREY_OF.dark && bubForced.agent === 'rgb(0, 0, 0)', `${tag} On + chosen Dark: your message is dark grey, an agent's is the black ground`, JSON.stringify(bubForced));
        const dmForced = await page.evaluate(DM_LOOK);   // the generated forced-dark rules sit later in the sheet (round 1)
        chk(dmForced.found && dmForced.box === 'rgb(0, 0, 0)' && dmForced.you === GREY_OF.dark && dmForced.agent === 'rgb(0, 0, 0)' && dmForced.tail === 'rgb(0, 0, 0)' && dmForced.composer === GREY_OF.dark,
          `${tag} On + chosen Dark: an agent's page has the black ground, dark-grey own messages and composer`, JSON.stringify(dmForced));
        const dlForced = await page.evaluate(DLEFT_LOOK);
        chk(dlForced.found && dlForced.ground === GREY_OF.dark && dlForced.onBg === 'rgb(0, 0, 0)',
          `${tag} On + chosen Dark: an agent's left column is the dark grey box, the open section a black tile`, JSON.stringify(dlForced));
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `newlook-project-${theme}-${width}.png`) });

      /* A page the new look has NOT been designed for yet still takes its colour tokens. The Agents
         page must stay readable: the new ink on the new surfaces clears 4.5:1, and nothing overflows. */
      await page.evaluate(() => showTab('agents'));
      await page.waitForTimeout(600);
      const ag = await page.evaluate(TOKEN_CONTRAST);
      chk(ag.pairs.every((x) => x.ratio >= 4.5) && !ag.wide, `${tag} On, Agents page: the new ink clears 4.5:1 on the new grounds, no sideways scroll`, JSON.stringify(ag));
      /* The rule under the header goes on every page of the tab layout, not only the project. */
      const agRule = await page.evaluate(() => getComputedStyle(document.querySelector('body > .apphead')).borderBottomColor);
      chk(agRule === 'rgba(0, 0, 0, 0)', `${tag} On, Agents page: no rule under the header`, agRule);
      /* The Agents page designed in the new look: the plain idle card loses its border and takes the 24px corners,
         the working card keeps its green stroke (state owns the stroke), the inert tiles lose their box even on
         hover, New agent is a 40px round grey button, and board notices are the grey box, with a could-not-read
         notice keeping its solid border. The current view stays gold (compared with the look off, below). */
      await page.evaluate(() => { const g = document.querySelector('#boardbar .vt[data-layout="grid"]'); if (g && !g.classList.contains('on')) g.click(); });
      await page.waitForTimeout(400);
      const agOn = await page.evaluate(AGENTS_LOOK);
      chk(agOn.idle === 'rgba(0, 0, 0, 0)' && agOn.working !== 'rgba(0, 0, 0, 0)' && agOn.working !== 'absent',
        `${tag} On, Agents page: the idle card has no border, the working card keeps its stroke`, JSON.stringify(agOn));
      chk(agOn.tile === 'rgba(0, 0, 0, 0)', `${tag} On, Agents page: the Agents tile has no box`, JSON.stringify(agOn));
      chk(agOn.radius === '24px', `${tag} On, Agents page: the idle card has the project page's 24px corners`, agOn.radius);
      /* An inert tile shows no box under the pointer either. */
      await page.hover('#st-agents');
      const tileHover = await page.evaluate(() => getComputedStyle(document.getElementById('st-agents').closest('.stat')).borderTopColor);
      await page.mouse.move(0, 0);
      chk(tileHover === 'rgba(0, 0, 0, 0)', `${tag} On, Agents page: the Agents tile shows no box under the pointer`, tileHover);
      /* Every stroke that means something survives the plain-card rule: Issue, Question and could-not-read (dashed).
         The fixture has none of these, so each is drawn by hand into the grid for the read and removed after. */
      const strokes = await page.evaluate((ratioFn) => {
        const g = document.getElementById('grid'); if (!g) return { found: false };
        const out = { found: true };
        for (const c of ['attn', 'question', 'unk']) {
          const d = document.createElement('div'); d.className = 'acard ' + c; d.textContent = 'x'; g.append(d);
          const cs = getComputedStyle(d); out[c] = { color: cs.borderTopColor, style: cs.borderTopStyle, ratio: new Function(`return (${ratioFn})`)()(d) }; d.remove();
        }
        return out;
      }, EDGE_RATIO);
      chk(strokes.found && ['attn', 'question', 'unk'].every((c) => strokes[c].color !== 'rgba(0, 0, 0, 0)') && strokes.unk.style === 'dashed' && strokes.unk.ratio >= 1.5,
        `${tag} On, Agents page: Issue, Question and could-not-read cards keep their strokes (a could-not-read dash you can see, 1.5:1 or more)`, JSON.stringify(strokes));
      /* The Messages filter is a control: at rest it keeps the soft grey ground (its "you can press this", which a
         touch screen needs), and hovering it does not change its width (nothing in the row jumps). Shown by hand for
         the read, since the fixture has no unread messages, then hidden again. */
      /* The page's 5-second poll re-hides this tile (no unread messages), so it can land between steps: each attempt
         shows the tile, moves the pointer onto it and reads it at once, and a read that finds it hidden again tries
         once more rather than waiting on a hidden element. */
      const dmWas = await page.evaluate(() => { const t = document.getElementById('st-dm-tile'); return t ? t.hidden : null; });
      let dm = { found: dmWas !== null }, dmHoverW = null;
      for (let attempt = 0; dm.found && attempt < 3 && dmHoverW === null; attempt++) {
        dm = await page.evaluate(() => {
          const t = document.getElementById('st-dm-tile'); t.hidden = false;
          const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
          return { found: true, bg: cs.backgroundColor, border: cs.borderTopColor, w: Math.round(r.width), x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.move(dm.x, dm.y);
        const under = await page.evaluate(() => { const t = document.getElementById('st-dm-tile');
          return t.hidden ? null : { w: Math.round(t.getBoundingClientRect().width), hovered: t.matches(':hover') }; });
        if (under && under.hovered) dmHoverW = under.w;
        await page.mouse.move(0, 0);
      }
      if (dm.found) await page.evaluate((was) => { document.getElementById('st-dm-tile').hidden = was; }, dmWas);
      chk(dm.found && dm.bg === GREY_OF[theme] && dm.border === 'rgba(0, 0, 0, 0)' && dmHoverW === dm.w,
        `${tag} On, Agents page: the Messages filter rests on the grey ground and keeps its width under the pointer`, JSON.stringify({ ...dm, dmHoverW }));
      /* Board notices, drawn by hand into the grid for the read and removed after: an empty-slot note has no border,
         a could-not-read note (.boardfail) keeps a solid, visible one. */
      const notes = await page.evaluate(() => {
        const g = document.getElementById('grid'); if (!g) return { found: false };
        const a = document.createElement('div'); a.className = 'pj-empty'; a.textContent = 'x';
        const b = document.createElement('div'); b.className = 'pj-empty boardfail'; b.textContent = 'x';
        g.append(a, b);
        const ca = getComputedStyle(a), cb = getComputedStyle(b);
        const out = { found: true, empty: ca.borderTopColor, fail: cb.borderTopColor, failStyle: cb.borderTopStyle, ground: ca.backgroundColor, radius: ca.borderTopLeftRadius };
        a.remove(); b.remove();
        /* The same empty note inside a project page keeps today's look (its column is already the grey box). */
        const pv = document.getElementById('pj-one-view');
        if (pv) { const c = document.createElement('div'); c.className = 'pj-empty'; c.textContent = 'x'; pv.append(c);
          const cc = getComputedStyle(c); out.inProject = { ground: cc.backgroundColor, border: cc.borderTopColor }; c.remove(); }
        return out;
      });
      chk(notes.found && notes.empty === 'rgba(0, 0, 0, 0)' && notes.fail !== 'rgba(0, 0, 0, 0)' && notes.failStyle === 'solid' && notes.ground === GREY_OF[theme] && notes.radius === '28px',
        `${tag} On, Agents page: a board note is the grey box; a could-not-read note keeps its solid border`, JSON.stringify(notes));
      chk(notes.inProject && notes.inProject.ground !== GREY_OF[theme] && notes.inProject.border !== 'rgba(0, 0, 0, 0)',
        `${tag} On: an empty note inside a project page keeps today's look, not a grey box inside the grey box`, JSON.stringify(notes.inProject));
      chk(agOn.plus && Math.round(agOn.plus.w) === 40 && agOn.plus.round === '50%' && agOn.plus.bg === GREY_OF[theme],
        `${tag} On, Agents page: New agent is a 40px round grey button`, JSON.stringify(agOn.plus));
      /* A pressed filter tile (the Messages filter) must still look pressed: the no-box rule skips a pressed tile.
         The fixture has no unread messages, so the tile is shown and pressed by hand for the read, then restored. */
      const pressed = await page.evaluate(() => {
        const t = document.getElementById('st-dm-tile'); if (!t) return { found: false };
        const was = { hidden: t.hidden, pressed: t.getAttribute('aria-pressed') };
        t.hidden = false; t.setAttribute('aria-pressed', 'true');
        const cs = getComputedStyle(t), out = { found: true, bg: cs.backgroundColor, border: cs.borderTopColor };
        t.hidden = was.hidden; t.setAttribute('aria-pressed', was.pressed || 'false');
        return out;
      });
      chk(pressed.found && pressed.bg !== 'rgba(0, 0, 0, 0)' && pressed.border !== 'rgba(0, 0, 0, 0)',
        `${tag} On, Agents page: a pressed Messages filter still shows its pressed ground and border`, JSON.stringify(pressed));
      const listOn = await listLook(page);
      chk(listOn.found && listOn.border === 'rgba(0, 0, 0, 0)' && listOn.radius === '16px' && ['left', 'start'].includes(listOn.nameAlign),
        `${tag} On, Agents list: a plain row loses its border, takes 16px corners, and its name sits left`, JSON.stringify(listOn));
      chk(listOn.found && listOn.hoverGround === listOn.groundImg + ' | ' + listOn.groundColor, `${tag} On, Agents list: the ground (the state) does not change under the pointer`,
        JSON.stringify({ rest: listOn.groundImg + ' | ' + listOn.groundColor, hover: listOn.hoverGround }));
      chk(listOn.strokes && listOn.strokes.attn.color !== 'rgba(0, 0, 0, 0)' && listOn.strokes.unk.style === 'dashed' && listOn.strokes.unk.ratio >= 1.5,
        `${tag} On, Agents list: a needs-you row keeps its edge, a could-not-read row a dash you can see (1.5:1 or more off its ground)`, JSON.stringify(listOn.strokes));
      chk(listOn.found && listOn.hover && listOn.hover !== 'rgba(0, 0, 0, 0)',
        `${tag} On, Agents list: a row under the pointer shows its border (a sign it opens)`, JSON.stringify(listOn));
      const tkOn = await tasksLook(page);
      chk(tkOn.found && tkOn.plain === 'rgba(0, 0, 0, 0)' && tkOn.radius === '16px' && tkOn.list === 'rgba(0, 0, 0, 0)' && tkOn.listRadius === '16px',
        `${tag} On, Tasks: a plain tile and the task list lose their border and take 16px corners`, JSON.stringify(tkOn));
      chk(tkOn.found && tkOn.decisionRed && tkOn.pressedGold && tkOn.goldNotRed,
        `${tag} On, Tasks: Needs Your Decision holding tasks keeps its red edge, a filtering tile its gold`, JSON.stringify(tkOn));
      chk(tkOn.found && tkOn.decisionZero === 'rgba(0, 0, 0, 0)' && tkOn.hover && tkOn.hover !== 'missed' && tkOn.hover !== 'rgba(0, 0, 0, 0)',
        `${tag} On, Tasks: Needs Your Decision at zero is drawn like the others (no border), and a tile under the pointer shows its border`, JSON.stringify(tkOn));

      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const kept = await page.evaluate(PAGE_STATE);
      chk(kept.look === 'new' && kept.kbg === NEW[theme], `${tag} a reload keeps the new look`, JSON.stringify(kept));
      /* A load straight onto the project with the look on: the layout paint (applyLayout ->
         placeProjectHead) lands AFTER the boot showTab, so this is where the header could be put
         back above the columns. Settle past it before reading. */
      await page.goto(URL + '/?tab=projects&project=' + encodeURIComponent(proj.id), { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await page.waitForSelector('#pj-one-view:not([hidden])', { timeout: 8000 });
      await page.waitForTimeout(1500);
      const direct = { ...(await page.evaluate(TASKS_PLACE)), ...(await page.evaluate(HEAD_PLACE)) };
      chk(direct.order === 'members,tasks,files' && direct.inMid && direct.first, `${tag} On, loaded straight onto the project: Tasks in the left box and the header in the conversation`, JSON.stringify(direct));

      await openAdvanced(page);
      chk((await page.evaluate(PAGE_STATE)).sw === 'true', `${tag} after a reload the switch still reads On`);
      await page.click('#look-toggle');
      await page.reload({ waitUntil: 'networkidle' });
      await clearFirstRun(page);
      const back = await page.evaluate(PAGE_STATE);
      await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, proj.id);
      await page.waitForSelector('#pj-one-agents .pj-member', { timeout: 8000 });
      const pjOff = await page.evaluate(TASKS_PLACE);   // read with the project OPEN, where a stuck move would show
      const stOff = await page.evaluate(MEMBER_WORD);
      const hdOff = await page.evaluate(HEAD_PLACE);
      chk(hdOff.aboveCols && !hdOff.rootShown && hdOff.nameShown, `${tag} Off: the crumb row is back above the columns, no "Projects" root, the name shows`, JSON.stringify(hdOff));
      chk(!stOff.shown, `${tag} Off: the member row prints no state word, as today (#3212)`, JSON.stringify(stOff));
      chk(pjOff.order === 'members,files' && pjOff.tasksLast, `${tag} Off: Tasks is back at the end of the project page, as today`, JSON.stringify(pjOff));
      chk(back.look === null && back.kbg === before.kbg, `${tag} Off and a reload give today's page back`, JSON.stringify(back));
      /* Control for the Agents arms: with the look off, the idle card keeps its border and New agent has no round. */
      await page.evaluate(() => showTab('agents'));
      await page.waitForTimeout(600);
      const agOff = await page.evaluate(AGENTS_LOOK);
      chk(agOff.idle !== 'rgba(0, 0, 0, 0)' && agOff.idle !== 'absent' && agOff.tile !== 'rgba(0, 0, 0, 0)' && agOff.plus && agOff.plus.round !== '50%',
        `${tag} Off, Agents page: today's bordered idle card, Agents tile and New agent tile`, JSON.stringify(agOff));
      /* Control for the agent-page arms: with the look off, today's conversation (the surface behind it, a tinted bubble of
         yours, a bordered composer box with 12px corners). */
      const dmOff = await page.evaluate(DM_LOOK);
      /* Equal to the before-switch reading, AND today's values pinned where today differs from the look (round 2: two
         readings of the same leak would be equal): your bubble not the look's grey, an agent's not the bare page,
         the composer bordered with 12px corners. */
      chk(dmOff.found && dmBefore.found && JSON.stringify(dmOff) === JSON.stringify(dmBefore) && dmOff.you !== GREY_OF[theme] && dmOff.agent !== PAGE_OF[theme]
        && dmOff.composerBorderW !== '0px' && dmOff.composerRadius === '12px',
        `${tag} Off, an agent's page: exactly today's conversation and bordered composer, as before the switch was touched (the control)`, JSON.stringify({ off: dmOff, before: dmBefore }));
      const dlOff = await page.evaluate(DLEFT_LOOK);
      /* Equal to the before-switch reading AND today's values pinned: the open button's gold edge, a closed one's
         edge, and FILES in capitals. */
      chk(dlOff.found && dlBefore.found && JSON.stringify(dlOff) === JSON.stringify(dlBefore) && dlOff.onEdge !== 'rgba(0, 0, 0, 0)' && dlOff.offEdge !== 'rgba(0, 0, 0, 0)'
        && dlOff.headCase === 'uppercase' && dlOff.ground !== GREY_OF[theme] && dlOff.boxEdge !== 'rgba(0, 0, 0, 0)' && dlOff.labelCase === 'uppercase' && dlOff.headCase2 === 'uppercase',
        `${tag} Off, an agent's page: exactly today's left column (edged buttons, FILES in capitals), as before the switch was touched (the control)`, JSON.stringify({ off: dlOff, before: dlBefore }));
      const listOff = await listLook(page);
      chk(listOff.found && listOff.border !== 'rgba(0, 0, 0, 0)' && listOff.radius === '12px' && listOff.nameAlign === 'center',
        `${tag} Off, Agents list: today's bordered row with 12px corners and today's centred name button`, JSON.stringify(listOff));
      const tkOff = await tasksLook(page);
      chk(tkOff.found && tkOff.plain !== 'rgba(0, 0, 0, 0)' && tkOff.radius === '12px' && tkOff.list !== 'rgba(0, 0, 0, 0)' && tkOff.listRadius === '12px',
        `${tag} Off, Tasks: today's bordered tiles and task list with 12px corners (the control)`, JSON.stringify(tkOff));
      /* The decision edge is mixed from the danger red and the rule grey, and the new look remaps that grey, so it is
         not byte-identical across looks (round 1); what must hold in both is that it reads red. */
      chk(tkOn.found && tkOff.found && tkOn.decisionRed && tkOff.decisionRed && tkOff.plainNotRed === true && tkOff.goldNotRed,
        `${tag} the Needs Your Decision edge reads red with the look on and off`, JSON.stringify({ on: tkOn.decision, off: tkOff.decision }));
      /* The new look remaps the colour tokens (its surface and rule greys differ from today's), so the row's own
         colour and the dash's colour are the new look's, not today's. What must NOT change is the state wash laid
         over the surface, and the needs-you red, which is a fixed colour in both looks. */
      chk(listOn.found && listOff.found && listOn.groundImg === listOff.groundImg && listOn.groundImg !== 'none' && /^rgb\(/.test(listOn.groundColor),   // rgb(), never rgba(): an opaque surface
        `${tag} the plain row keeps today's state wash with the look on, on an opaque surface (only its border goes)`, JSON.stringify({ on: [listOn.groundImg, listOn.groundColor], off: [listOff.groundImg, listOff.groundColor] }));
      chk(listOn.strokes && listOff.strokes && listOn.strokes.attn.color === listOff.strokes.attn.color && listOn.strokes.unk.style === listOff.strokes.unk.style,
        `${tag} the needs-you edge is today's red, and the could-not-read edge still dashed, with the look on`, JSON.stringify({ on: listOn.strokes, off: listOff.strokes }));
      /* What the new look must NOT change, compared on the same board: the working card's stroke (state owns the
         stroke) and the current view's gold (Josh 2026-08-17: selected is gold). */
      chk(agOn.working === agOff.working, `${tag} the working card's stroke is the same with the look on as off`, JSON.stringify({ on: agOn.working, off: agOff.working }));
      chk(agOn.seg === agOff.seg && agOff.seg !== 'rgba(0, 0, 0, 0)', `${tag} the current view's fill is today's gold with the look on`, JSON.stringify({ on: agOn.seg, off: agOff.seg }));
      if (width >= 1088) {
        const tabsOff = await page.evaluate(TABS);
        chk(tabsOff.onUnderline !== 'rgba(0, 0, 0, 0)' && tabsOff.onUnderline !== 'absent', `${tag} Off: today's gold underline marks the current tab`, JSON.stringify(tabsOff));
      }
      chk(!back.wide, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await ctx.close();
    }
  } catch (e) {
    chk(false, 'the check ran to the end', e && e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
    fleet.restore && fleet.restore();
    for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n${ran - fail.length}/${ran} passed`);
  process.exit(fail.length || ran < 149 ? 1 : 0);   // a full run makes 164 (three passes with 7 list arms each); a skipped pass must fail
})();
