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
 *  - the Projects list in the new look (projectsLook): tiles without a box (the Issue tile keeps its red), Add Project a
 *    round grey button, plain cards without border or shadow (24px corners) that show today's hover border and lift and
 *    today's keyboard focus ring, a needs-you card's red edge, the current view's gold and a plain roadmap row unchanged;
 *    on a touch phone at 320, 360, 390, 480 and 520, Add Project clear of the sort and the toggle (#718); with the look off, today's
 *    card, tile and dashed tile (the control),
 *  - a project's Documents in the new look (docsLook): back is the round chevron, the text link hidden, and it returns
 *    to the project; the switch is a grey pill with today's gold choice; with the look off, today's link and switch,
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
 *  - Settings in the new look (SETTINGS_LOOK): the nav a grey box with flat items, the current one a page tile (on a
 *    phone the scroller stays, the current item a grey tile); boxes with no edge and 28px corners and sentence-case
 *    labels; with the look off, today's (the control),
 *  - the controls in the new look (CTRL_LOOK): a plain button a pill in the page's ground with no edge, the main one a
 *    pill keeping its fill, a danger one keeping its edge; with the look off, today's (the control),
 *  - the phone slice (PHONE_LOOK): an agent message's avatar at the top, New task a pill, and on a phone the project's
 *    gear on the crumb's line inside the page; with the look off, today's foot-aligned avatar and New task (the control),
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
/* #4470, Settings in the new look: the section nav's ground and corners, the current item and another (ground, edge),
   a box's edge and corners and its first field label's case. Read with the panel shown and put back. */
const SETTINGS_LOOK = `(() => {
  const nav = document.getElementById('s-nav'), panel = document.getElementById('panel-settings');
  if (!nav || !panel) return { found: false };
  const wasHidden = panel.hidden; panel.hidden = false;
  try {
    const on = nav.querySelector('button.on'), off = nav.querySelector('button:not(.on):not([hidden])');
    const box = panel.querySelector('.dbox'), lab = panel.querySelector('.dbox .flabel');
    if (!on || !off || !box || !lab) return { found: false, on: !!on, off: !!off, box: !!box, lab: !!lab };
    const N = getComputedStyle(nav), O = getComputedStyle(on), X = getComputedStyle(off), B = getComputedStyle(box), L = getComputedStyle(lab);
    const out = { found: true, navBg: N.backgroundColor, navRadius: N.borderTopLeftRadius, onBg: O.backgroundColor, onEdge: O.borderTopColor,
      offBg: X.backgroundColor, offEdge: X.borderTopColor, boxEdge: B.borderTopColor, boxRadius: B.borderTopLeftRadius, labelCase: L.textTransform,
      navW: Math.round(nav.getBoundingClientRect().width), vw: innerWidth, sw: document.documentElement.scrollWidth };
    /* Round 1: the needs-you dot on the current item (the dark red was tuned for the gold), and the Kosmos+ section,
       which repaints the page navy (body.plus-active) and must keep today's chrome. Both set here and put back. */
    /* The dot is drawn only on the Kosmos+ item (the only one that carries one), so that item is made current with its
       dot on for the read; with no dot element the read says 'absent' rather than reading the button's own ground. */
    const plusBtn = nav.querySelector('button[data-go="plus"]'), dot = plusBtn && plusBtn.querySelector('.dot');
    if (!dot) out.dotBg = 'absent';
    else {
      const wasOn = plusBtn.classList.contains('on'), hadDot = plusBtn.hasAttribute('data-dot');
      on.classList.remove('on'); plusBtn.classList.add('on'); plusBtn.setAttribute('data-dot', '');
      out.dotBg = getComputedStyle(dot).backgroundColor;
      if (!wasOn) plusBtn.classList.remove('on'); if (!hadDot) plusBtn.removeAttribute('data-dot'); on.classList.add('on');
    }
    const hadPlus = document.body.classList.contains('plus-active'); document.body.classList.add('plus-active');
    out.plusNavBg = getComputedStyle(nav).backgroundColor; out.plusOnEdge = getComputedStyle(on).borderTopColor;
    if (!hadPlus) document.body.classList.remove('plus-active');
    return out;
  } finally { panel.hidden = wasHidden; }
})()`;
/* #4470, the controls in the new look: a plain button (Change picture), the main one (Settings' Save your name) and a
   danger one (Remove this agent), read with both panels shown and put back. */
const CTRL_LOOK = `(() => {
  const pd = document.getElementById('panel-detail'), ps = document.getElementById('panel-settings');
  const plain = document.getElementById('d-file-btn'), main = document.getElementById('you-name-save'), danger = document.getElementById('d-remove-start');
  if (!pd || !ps || !plain || !main || !danger) return { found: false, plain: !!plain, main: !!main, danger: !!danger };
  const h1 = pd.hidden, h2 = ps.hidden; pd.hidden = false; ps.hidden = false;
  /* Round 1: Remove this agent sits outside any box, so it could not show the danger rule; a danger button is made inside
     a Settings box for the read (as Settings' community rows build theirs) and removed after. Check for Update is the
     quiet button. */
  const box = ps.querySelector('.dbox'), quiet = document.getElementById('upd-btn');
  const made = document.createElement('button'); made.className = 'btn danger-btn'; made.type = 'button'; made.textContent = 'x';
  if (box) box.appendChild(made);
  try {
    const P = getComputedStyle(plain), M = getComputedStyle(main), D = getComputedStyle(made), Q = quiet ? getComputedStyle(quiet) : null;
    return { found: !!box && !!quiet, plainBg: P.backgroundColor, plainEdge: P.borderTopColor, plainRadius: P.borderTopLeftRadius, plainShadow: P.boxShadow,
      mainBg: M.backgroundColor, mainRadius: M.borderTopLeftRadius, dangerEdge: D.borderTopColor, dangerRadius: D.borderTopLeftRadius,
      quietBg: Q && Q.backgroundColor, quietEdge: Q && Q.borderTopColor, quietRadius: Q && Q.borderTopLeftRadius,
      /* Round 3: a disabled plain button (Change & Restart, disabled until a model is picked) as an outlined pill. */
      ...(() => { const d = document.getElementById('d-model-go'); if (!d) return { disabledFound: false };
        const was = d.disabled; d.disabled = true; const D2 = getComputedStyle(d);
        const r = { disabledFound: true, disabledBg: D2.backgroundColor, disabledEdge: D2.borderTopColor }; d.disabled = was; return r; })(),
      outsideDangerEdge: getComputedStyle(danger).borderTopColor, plainFocus: (() => {
        /* Round 2: with the edge gone the focus ring is the pill's only cue beyond its label; focused as a keyboard
           would focus it, read, and let go. */
        const sec = plain.closest('.dsec'), secHidden = sec ? sec.hidden : false; if (sec) sec.hidden = false;
        const was = document.activeElement; plain.focus({ focusVisible: true });
        const o = document.activeElement === plain ? getComputedStyle(plain).outlineStyle : 'not focused';
        plain.blur(); if (was && was.focus) was.focus(); if (sec) sec.hidden = secHidden; return o; })() };
  } finally { made.remove(); pd.hidden = h1; ps.hidden = h2; }
})()`;
/* #4470, the phone slice, measured as drawn (round 1: a property read is not a position). In each thread (the room and
   the DM, shown for the read), an agent's message and one of yours are made with a two-line body: an agent's avatar
   top against its name's top (the avatar at the top), yours against the body's bottom (the foot). While the project
   page is shown: whether the gear shares the crumb's line, its right edge and its row's right margin (the touch tap
   area needs 4px; a plain viewport cannot show the overflow itself), and the same with a long project name. New
   task's corners. Everything made is removed and every panel put back. */
const PHONE_LOOK = `(() => {
  const out = { found: true, vw: innerWidth };
  const nt = document.getElementById('tsk-new'); if (!nt) return { found: false };
  out.newTaskRadius = getComputedStyle(nt).borderTopLeftRadius;
  const one = (threadId, panelId) => {
    const th = document.getElementById(threadId), panel = document.getElementById(panelId); if (!th || !panel) return null;
    const hid = panel.hidden; panel.hidden = false; const sec = th.closest('.dsec'), sh = sec ? sec.hidden : false; if (sec) sec.hidden = false;
    const mk = (you) => { const m = document.createElement('div'); m.className = 'msg' + (you ? ' you' : '');
      m.innerHTML = '<div class="msg-av">A</div><div class="msg-b"><div class="msg-bd"><div class="msg-who">Ada</div>one<br>two<br>three</div></div>'; th.appendChild(m); return m; };
    const a = mk(false), y = mk(true);
    try {
      const ab = a.querySelector('.msg-av').getBoundingClientRect(), an = a.querySelector('.msg-b').getBoundingClientRect();
      const yb = y.querySelector('.msg-av').getBoundingClientRect(), yn = y.querySelector('.msg-b').getBoundingClientRect();
      return { agentAvTopOff: Math.round(ab.top - an.top), yourAvBottomOff: Math.round(yn.bottom - yb.bottom), tall: Math.round(an.height) };
    } finally { a.remove(); y.remove(); if (sec) sec.hidden = sh; panel.hidden = hid; }
  };
  out.room = one('pj-room', 'panel-projects'); out.dm = one('d-dmthread', 'panel-detail');
  const cog = document.getElementById('pj-settings-link'), crumb = document.querySelector('#pj-one-view .pj-crumbrow');
  const shown = !!cog && !!crumb && cog.getClientRects().length > 0 && crumb.getClientRects().length > 0;
  const line = () => { const cb = cog.getBoundingClientRect(), rb = crumb.getBoundingClientRect(); return { on: cb.top < rb.bottom && cb.bottom > rb.top, right: Math.round(cb.right), sw: document.documentElement.scrollWidth }; };
  if (!shown) out.cog = 'hidden';
  else {
    out.cog = line(); out.cogRowMarginRight = getComputedStyle(cog.closest('.pjtitle-row')).marginRight;
    const cur = document.querySelector('#pj-one-view .pj-crumb-cur');
    if (cur) { const was = cur.textContent; cur.textContent = 'A project with a much longer name than this page usually shows'; out.cogLong = line(); cur.textContent = was; }
  }
  return out;
})()`;
/* #4470, Create an agent in the new look: a resting option card's edge, a chosen card's edge (one radio checked for
   the read, then put back), and Continue's corners. Read with the panel and its role step shown, then put back. */
const CREATE_LOOK = `(() => {
  const panel = document.getElementById('panel-create'), step = document.getElementById('cstep-role'), go = document.getElementById('role-next');
  const cards = panel ? [...panel.querySelectorAll('#cstep-role .pick2')] : [];
  if (!panel || !step || !go || cards.length < 2) return { found: false, cards: cards.length };
  const ph = panel.hidden, sh = step.hidden; panel.hidden = false; step.hidden = false;
  const hid = cards.map((c) => c.hidden); cards.forEach((c) => { c.hidden = false; });
  const radios = cards.map((c) => c.querySelector('input')), was = radios.map((r) => r && r.checked);
  try {
    radios.forEach((r) => { if (r) r.checked = false; }); if (radios[0]) radios[0].checked = true;
    const kind = document.querySelector('#cstep-kind .nak-btn'), team = document.getElementById('team-seeded-go'), create = document.getElementById('create-go');
    return { found: true, chosenEdge: getComputedStyle(cards[0]).borderTopColor, restEdge: getComputedStyle(cards[1]).borderTopColor,
      restHovered: cards[1].matches(':hover'), continueRadius: getComputedStyle(go).borderTopLeftRadius,
      /* Round 1: the kind picker's cards, and Team's and Create's main buttons (Team matches Single, #4935). */
      kindEdge: kind ? getComputedStyle(kind).borderTopColor : 'absent', teamRadius: team ? getComputedStyle(team).borderTopLeftRadius : 'absent',
      createRadius: create ? getComputedStyle(create).borderTopLeftRadius : 'absent',
      /* Round 2: a small inline gold button takes the pill too (every button in the look is one). */
      inlineRadius: (() => { const b = document.getElementById('orgchart-preview'); return b ? getComputedStyle(b).borderTopLeftRadius : 'absent'; })(),
      /* Round 3: a plain button beside a gold one takes the same pill (one shape per row). */
      plainRadius: (() => { const b = document.getElementById('orgchart-edit'); return b ? getComputedStyle(b).borderTopLeftRadius : 'absent'; })() };
  } finally { radios.forEach((r, i) => { if (r) r.checked = was[i]; }); cards.forEach((c, i) => { c.hidden = hid[i]; }); step.hidden = sh; panel.hidden = ph; }
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
/* #4470, the Projects list in the new look (the Agents page's language): the count tiles lose their box, Add Project
   is a 40px round grey button, a plain project card loses its border and shadow and takes 24px corners, and keeps
   today's border under the pointer; a needs-you card keeps its red edge (drawn by hand, since the fixture's project
   has no issue, then removed); the current view's fill. Reads on the grid, then returns to the Agents tab. */
async function projectsLook(page) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => { showTab('projects'); pjView('list'); });
  // A timeout is swallowed on purpose: the read below then returns found: false, which reds every Projects arm.
  await page.waitForSelector('#pj-list .pj-row', { state: 'visible', timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { const g = document.querySelector('#pj-list-view .vt[data-layout="grid"]'); if (g && g.getAttribute('aria-pressed') !== 'true') g.click(); });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const card = document.querySelector('#pj-list.asgrid .pj-row:not(.attn)');
    const tile = document.getElementById('st-pj') && document.getElementById('st-pj').closest('.stat');
    const plus = document.querySelector('#pj-new .plus'), on = document.querySelector('#pj-list-view .vt.on');
    if (!card || !tile || !plus) return { found: false, card: !!card, tile: !!tile, plus: !!plus };
    const cs = getComputedStyle(card), ps = getComputedStyle(plus), ts = getComputedStyle(tile);
    const r = { found: true, card: cs.borderTopColor, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius,
      tile: ts.borderTopColor, tileBg: ts.backgroundColor, newBorder: getComputedStyle(document.getElementById('pj-new')).borderTopStyle,
      plus: { w: Math.round(plus.getBoundingClientRect().width), round: ps.borderRadius, bg: ps.backgroundColor },
      seg: on ? getComputedStyle(on).backgroundColor : 'absent' };
    /* The Issue and Messages tiles are hidden on this fixture: shown for the read, then hidden again. */
    const shown = (id) => { const t = document.getElementById(id); if (!t) return null; const was = t.hidden; t.hidden = false;
      try { const c = getComputedStyle(t); return { border: c.borderTopColor, bg: c.backgroundColor }; } finally { t.hidden = was; } };
    r.issueTile = shown('st-pjattn-tile'); r.msgTile = shown('st-pjdm-tile');
    const a = card.cloneNode(true); a.classList.add('attn'); a.removeAttribute('data-project'); card.after(a);
    r.attn = getComputedStyle(a).borderTopColor; a.remove();
    return r;
  });
  if (out.found) {
    await page.hover('#pj-list.asgrid .pj-row:not(.attn)'); await page.waitForTimeout(200);
    out.hover = await page.evaluate(() => { const h = document.querySelector('#pj-list.asgrid .pj-row:not(.attn):hover'); return h ? getComputedStyle(h).borderTopColor + ' | ' + getComputedStyle(h).boxShadow : 'missed'; });
    await page.mouse.move(1, 1);
    /* A card reached from the keyboard keeps a visible focus ring (the browser's own; nothing here removes it), since
       at rest the plain card has no edge. A key press first, so the focus that follows counts as keyboard focus. */
    await page.keyboard.press('Shift');
    out.focus = await page.evaluate(() => { const c = document.querySelector('#pj-list.asgrid .pj-row:not(.attn)'); if (!c) return null;
      c.focus(); const cs = getComputedStyle(c);
      const v = { visible: c.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth }; c.blur(); return v; });
    /* The roadmap rows, read on the roadmap and compared with the look off by the caller; then back to the grid. */
    await page.evaluate(() => { const r = document.querySelector('#pj-list-view .vt[data-layout="roadmap"]'); if (r) r.click(); });
    await page.waitForTimeout(400);
    out.roadmap = await page.evaluate(() => { const row = document.querySelector('#pj-list:not(.asgrid) .pj-row');
      if (!row) return null; const c = getComputedStyle(row);
      return { border: c.borderTopWidth + ' ' + c.borderTopStyle, shadow: c.boxShadow, radius: c.borderTopLeftRadius, padding: c.padding }; });
    await page.evaluate(() => { const g = document.querySelector('#pj-list-view .vt[data-layout="grid"]'); if (g) g.click(); });
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => showTab('agents'));
  await page.waitForTimeout(300);
  return out;
}
/* #4470, a project's Documents screen in the new look: back is the round chevron (the text link hidden) and it
   returns to the project; the folder / conversation switch is a grey pill (shown by hand: the fixture's room has
   no files) whose chosen segment keeps today's gold. Reads, then returns to the Agents tab. */
async function docsLook(page, projectId) {
  await page.mouse.move(1, 1);
  await page.evaluate(async (id) => { await loadProjects(); showTab('projects'); openProject(id); }, projectId);
  await page.waitForSelector('#pj-one-view:not([hidden])', { timeout: 8000 }).catch(() => {});
  if (await page.isVisible('#pj-docs-all')) await page.click('#pj-docs-all');   // as a person opens it
  await page.waitForSelector('#pj-docs-view:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const back = document.getElementById('docs-back'), chev = document.getElementById('docs-chev'), sw = document.getElementById('docs-seg');
    if (!back || !chev || !sw || document.getElementById('pj-docs-view').hidden) return { found: false };
    const was = sw.hidden; sw.hidden = false;
    try {
      const cs = getComputedStyle(sw), on = sw.querySelector('[aria-checked="true"]');
      return { found: true, backShown: getComputedStyle(back).display !== 'none', chevShown: getComputedStyle(chev).display !== 'none',
        segRadius: cs.borderTopLeftRadius, segEdge: cs.borderTopColor, segBg: cs.backgroundColor, chosen: on ? getComputedStyle(on).backgroundColor : 'absent' };
    } finally { sw.hidden = was; }
  });
  if (out.found && out.chevShown) {
    await page.click('#docs-chev');
    await page.waitForTimeout(400);
    out.chevBack = await page.evaluate(() => !document.getElementById('pj-one-view').hidden && document.getElementById('pj-docs-view').hidden);
  }
  await page.evaluate(() => showTab('agents'));
  await page.waitForTimeout(300);
  return out;
}
/* #4470 (#718's phone row): with the look on, Add Project must not run under the sort or the view toggle on a phone.
   A touch phone context of its own (so the page takes its touch sizes, the sort at 16px), the look stored before
   load; reads the boxes of Add Project, the sort and the toggle and reports any horizontal overlap on a shared line. */
async function projectsPhoneRow(browser, url, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('kosmos-look', 'new'); } catch {} });
    await page.goto(url, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => { showTab('projects'); pjView('list'); });
    await page.waitForSelector('#pj-new', { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(300);
    return await page.evaluate(() => {
      // A hidden control has a zero box and could not collide, so it reads as missing (the arm fails, not passes).
      const box = (q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; };
      const a = box('#pj-new'), s = box('#pj-list-view .sortctl'), v = box('#pj-list-view .viewtoggle');
      const hit = (x, y) => !!x && !!y && x.l < y.r - 0.5 && y.l < x.r - 0.5 && x.t < y.b - 0.5 && y.t < x.b - 0.5;
      return { look: document.documentElement.getAttribute('data-look'), add: a, sort: s, toggle: v,
        overlap: hit(a, s) || hit(a, v), wide: document.documentElement.scrollWidth > innerWidth + 1 };
    });
  } finally { await ctx.close(); }
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
      const setBefore = await page.evaluate(SETTINGS_LOOK);   // and today's Settings
      const ctlBefore = await page.evaluate(CTRL_LOOK);   // and today's buttons
      await page.mouse.move(0, 0);
      const crBefore = await page.evaluate(CREATE_LOOK);   // and today's create step
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
      const setOn = await page.evaluate(SETTINGS_LOOK);
      const navWide = width > 640;   // up to 40rem the nav is the sideways scroller, with no box
      chk(setOn.found && setOn.navBg === (navWide ? GREY_OF[theme] : CLEAR) && setOn.onBg === (navWide ? PAGE_OF[theme] : GREY_OF[theme])
        && setOn.onEdge === CLEAR && setOn.offBg === CLEAR && setOn.offEdge === CLEAR,
        `${tag} On, Settings: the nav ${navWide ? 'is the grey box, the current item a tile in the page' : 'stays a scroller, the current item a grey tile'}; no edge and no gold`, JSON.stringify(setOn));
      chk(setOn.found && setOn.boxEdge === CLEAR && setOn.boxRadius === '28px' && setOn.labelCase === 'none',
        `${tag} On, Settings: its boxes have no edge and 28px corners, its field labels are sentence case`, JSON.stringify(setOn));
      const ctlOn = await page.evaluate(CTRL_LOOK);
      await page.mouse.move(0, 0);   // round 1: no card under a leftover pointer for the resting read
      const crOn = await page.evaluate(CREATE_LOOK);
      chk(crOn.found && !crOn.restHovered && crOn.restEdge === CLEAR && crOn.kindEdge === CLEAR && crOn.chosenEdge !== CLEAR
        && crOn.continueRadius === '999px' && crOn.teamRadius === '999px' && crOn.createRadius === '999px' && crOn.inlineRadius === '999px' && crOn.plainRadius === '999px',
        `${tag} On, Create an agent: resting option cards (kind and role) have no edge, the chosen one keeps its outline, every main button is a pill (Team's too)`, JSON.stringify(crOn));
      /* Round 1: a card under the pointer keeps today's edge (a real hover on the shown step). Round 3: the scroll, the
         panels and the probe id are saved in the page and ALWAYS put back, and a missing card is a failure, not a skip. */
      if (width > 640) {
        const saved = await page.evaluate(() => { const p = document.getElementById('panel-create'), st = document.getElementById('cstep-role');
          const c = st && [...st.querySelectorAll('.pick2')].find((x) => !x.querySelector('input:checked'));
          if (!p || !st || !c) return null; const had = c.id; c.id = c.id || 'cr-hover-probe';
          const sv = { px: scrollX, py: scrollY, p: p.hidden, st: st.hidden, c: c.hidden, had, sel: '#' + c.id }; p.hidden = false; st.hidden = false; c.hidden = false;
          p.dataset.crSaved = JSON.stringify(sv); return sv.sel; });
        let hv = null;
        try {
          if (saved) { await page.hover(saved, { timeout: 3000 }); hv = await page.evaluate((sel) => { const c = document.querySelector(sel); return { hovered: c.matches(':hover'), edge: getComputedStyle(c).borderTopColor }; }, saved); }
        } catch (e) { hv = { error: String(e && e.message || e).slice(0, 120) }; }
        finally {
          await page.mouse.move(0, 0);
          await page.evaluate(() => { const p = document.getElementById('panel-create'); if (!p || !p.dataset.crSaved) return; const sv = JSON.parse(p.dataset.crSaved); delete p.dataset.crSaved;
            const st = document.getElementById('cstep-role'), c = document.querySelector(sv.sel);
            if (c) { c.hidden = sv.c; if (!sv.had) c.removeAttribute('id'); } if (st) st.hidden = sv.st; p.hidden = sv.p; scrollTo(sv.px, sv.py); });
        }
        chk(!!saved && !!hv && hv.hovered && hv.edge !== CLEAR, `${tag} On, Create an agent: a card under the pointer keeps its edge`, JSON.stringify({ saved, hv }));
      }
      /* Round 3: a button's fill is above the box in both schemes (white in light; a step lighter than the box in dark,
         where the field is black), never the field's. */
      const RAISE_OF = { light: 'rgb(255, 255, 255)', dark: 'rgb(58, 58, 60)' };
      chk(ctlOn.disabledFound && ctlOn.disabledBg === CLEAR && ctlOn.disabledEdge !== CLEAR,
        `${tag} On, the controls: a disabled plain button is an outlined pill, not a faint shape`, JSON.stringify(ctlOn));
      chk(ctlOn.found && ctlOn.plainBg === RAISE_OF[theme] && ctlOn.plainEdge === CLEAR && ctlOn.plainRadius === '999px'
        && ctlOn.plainShadow !== 'none' && ctlOn.mainRadius === '999px' && ctlOn.mainBg !== PAGE_OF[theme] && ctlOn.mainBg !== CLEAR
        && ctlOn.dangerEdge !== CLEAR && ctlOn.dangerRadius === '999px' && ctlOn.quietBg === RAISE_OF[theme] && ctlOn.quietEdge === CLEAR && ctlOn.quietRadius === '999px'
        && ctlOn.plainFocus !== 'none' && ctlOn.plainFocus !== 'not focused' && ctlOn.outsideDangerEdge !== CLEAR,
        `${tag} On, the controls: plain and quiet buttons are raised pills in the page's ground with no edge, the main one a pill that keeps its fill, a danger one a pill that keeps its edge`, JSON.stringify(ctlOn));
      const OLD_DOT = 'rgb(122, 27, 18)';   // #7a1b12, tuned for the gold current item
      chk(setOn.found && setOn.dotBg !== OLD_DOT && setOn.dotBg !== CLEAR && setOn.dotBg !== 'absent' && setOn.plusNavBg !== GREY_OF[theme] && setOn.plusOnEdge !== CLEAR,
        `${tag} On, Settings: the current item's needs-you dot is not the gold-era dark red, and the Kosmos+ section keeps today's nav`, JSON.stringify(setOn));
      if (width === 1280) {
        await page.setViewportSize({ width: 800, height: 900 }); await page.waitForTimeout(150);
        const set800 = await page.evaluate(SETTINGS_LOOK);
        chk(set800.found && set800.navBg === GREY_OF[theme] && set800.navW <= set800.vw && set800.sw <= set800.vw,
          `${tag} On, Settings at 800 wide: the nav box wraps its items inside the page, no sideways scroll`, JSON.stringify(set800));
        await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(150);
      }
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
      const phOn = await page.evaluate(PHONE_LOOK);
      const top = (t) => !!t && t.agentAvTopOff <= 4 && t.tall > 40, foot = (t) => !!t && t.yourAvBottomOff <= 4;
      chk(phOn.found && top(phOn.room) && top(phOn.dm) && foot(phOn.room) && foot(phOn.dm) && phOn.newTaskRadius === '999px',
        `${tag} On: an agent's message has its avatar at the top (room and DM), yours keeps it at the foot, and New task is a pill`, JSON.stringify(phOn));
      if (width <= 960) chk(phOn.found && phOn.cog !== 'hidden' && phOn.cog.on && phOn.cog.right <= phOn.vw && phOn.cog.sw <= phOn.vw
        && phOn.cogLong && phOn.cogLong.on && phOn.cogLong.sw <= phOn.vw && phOn.cogRowMarginRight === '4px',
        `${tag} On, a phone: the project's gear sits on the crumb's line inside the page, with a long name too, and keeps 4px for its touch area`, JSON.stringify(phOn));
      if (width === 1280) {   /* round 1: the header stacks up to 60rem, so the band above a phone is read too */
        await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(200);
        const ph900 = await page.evaluate(PHONE_LOOK);
        chk(ph900.found && ph900.cog !== 'hidden' && ph900.cog.on && ph900.cog.sw <= ph900.vw && ph900.cogLong && ph900.cogLong.on,
          `${tag} On at 900 wide: the project's gear sits on the crumb's line, with a long name too`, JSON.stringify(ph900));
        await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(200);
      }
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
        const ctlForced = await page.evaluate(CTRL_LOOK);
        chk(ctlForced.found && ctlForced.plainBg === 'rgb(58, 58, 60)' && ctlForced.plainEdge === 'rgba(0, 0, 0, 0)',
          `${tag} On + chosen Dark: a plain button is the raised dark pill, a step lighter than the box`, JSON.stringify(ctlForced));
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
      if (width < 600) {
        for (const w of [320, 360, 390, 480, 520]) {   // 480 is the 30rem edge; 520 is past it (the one-line label)
          const row = await projectsPhoneRow(browser, URL, w);
          chk(row.look === 'new' && row.add && row.sort && row.toggle && !row.overlap && !row.wide,
            `${tag} On, Projects at ${w} on a touch phone: Add Project does not run under the sort or the view toggle (#718)`, JSON.stringify(row));
        }
      }
      const dcOn = await docsLook(page, proj.id);
      chk(dcOn.found && !dcOn.backShown && dcOn.chevShown && dcOn.chevBack === true,
        `${tag} On, Documents: back is the round chevron (the text link hidden), and it returns to the project`, JSON.stringify(dcOn));
      chk(dcOn.found && dcOn.segRadius === '999px' && dcOn.segEdge === 'rgba(0, 0, 0, 0)' && dcOn.segBg === GREY_OF[theme],
        `${tag} On, Documents: the folder / conversation switch is a grey pill with no edge`, JSON.stringify(dcOn));
      const plOn = await projectsLook(page);
      chk(plOn.found && plOn.card === 'rgba(0, 0, 0, 0)' && plOn.shadow === 'none' && plOn.radius === '24px',
        `${tag} On, Projects: a plain project card loses its border and shadow and takes 24px corners`, JSON.stringify(plOn));
      chk(plOn.found && plOn.tile === 'rgba(0, 0, 0, 0)' && plOn.tileBg === 'rgba(0, 0, 0, 0)' && plOn.plus.round === '50%' && plOn.plus.w === 40 && plOn.newBorder === 'none',
        `${tag} On, Projects: the Projects tile has no box and Add Project is a 40px round button with no dashed edge`, JSON.stringify(plOn));
      chk(plOn.found && plOn.attn !== 'rgba(0, 0, 0, 0)' && plOn.hover && plOn.hover !== 'missed',
        `${tag} On, Projects: a needs-you card keeps its red edge, and a card under the pointer shows its border (a sign it opens)`, JSON.stringify(plOn));
      chk(plOn.found && plOn.issueTile && plOn.msgTile && plOn.issueTile.border !== 'rgba(0, 0, 0, 0)' && plOn.msgTile.border === 'rgba(0, 0, 0, 0)' && plOn.msgTile.bg === 'rgba(0, 0, 0, 0)',
        `${tag} On, Projects: the Issue tile keeps its red outline, the Messages count has no box`, JSON.stringify({ issue: plOn.issueTile, msg: plOn.msgTile }));

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
      const setOff = await page.evaluate(SETTINGS_LOOK);
      chk(setOff.found && setBefore.found && JSON.stringify(setOff) === JSON.stringify(setBefore) && setOff.onEdge !== 'rgba(0, 0, 0, 0)' && setOff.boxEdge !== 'rgba(0, 0, 0, 0)' && setOff.labelCase === 'uppercase' && setOff.dotBg === 'rgb(122, 27, 18)',
        `${tag} Off, Settings: exactly today's gold current item, edged boxes and capital labels, as before the switch was touched (the control)`, JSON.stringify({ off: setOff, before: setBefore }));
      const ctlOff = await page.evaluate(CTRL_LOOK);
      chk(ctlOff.found && ctlBefore.found && JSON.stringify(ctlOff) === JSON.stringify(ctlBefore) && ctlOff.plainEdge !== 'rgba(0, 0, 0, 0)' && ctlOff.plainRadius !== '999px',
        `${tag} Off, the controls: exactly today's gold-edged buttons, as before the switch was touched (the control)`, JSON.stringify({ off: ctlOff, before: ctlBefore }));
      const phOff = await page.evaluate(PHONE_LOOK);
      chk(phOff.found && phOff.room && phOff.dm && phOff.room.agentAvTopOff > 4 && phOff.dm.agentAvTopOff > 4 && phOff.newTaskRadius !== '999px',
        `${tag} Off: an agent's message keeps its avatar at the bubble's foot (room and DM) and New task its corners (the control)`, JSON.stringify(phOff));
      await page.mouse.move(0, 0);
      const crOff = await page.evaluate(CREATE_LOOK);
      chk(crOff.found && crBefore.found && JSON.stringify(crOff) === JSON.stringify(crBefore) && crOff.restEdge !== 'rgba(0, 0, 0, 0)' && crOff.continueRadius !== '999px',
        `${tag} Off, Create an agent: today's edged cards and Continue, as before the switch was touched (the control)`, JSON.stringify({ off: crOff, before: crBefore }));
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
      const dcOff = await docsLook(page, proj.id);
      chk(dcOff.found && dcOff.backShown && !dcOff.chevShown && dcOff.segRadius !== '999px',
        `${tag} Off, Documents: today's text back link, no chevron, today's switch (the control)`, JSON.stringify(dcOff));
      chk(dcOn.found && dcOff.found && dcOn.chosen === dcOff.chosen && dcOff.chosen !== 'absent' && dcOff.chosen !== 'rgba(0, 0, 0, 0)',
        `${tag} Documents: the chosen segment is today's gold with the look on`, JSON.stringify({ on: dcOn.chosen, off: dcOff.chosen }));
      const plOff = await projectsLook(page);
      chk(plOff.found && plOff.card !== 'rgba(0, 0, 0, 0)' && plOff.shadow !== 'none' && plOff.radius === '12px' && plOff.tile !== 'rgba(0, 0, 0, 0)' && plOff.plus.round !== '50%' && plOff.newBorder === 'dashed',
        `${tag} Off, Projects: today's bordered card with 12px corners, boxed Projects tile and dashed Add Project tile (the control)`, JSON.stringify(plOff));
      chk(plOn.found && plOff.found && plOn.attn === plOff.attn && plOn.seg === plOff.seg && plOff.seg !== 'rgba(0, 0, 0, 0)' && plOff.seg !== 'absent',
        `${tag} Projects: the needs-you edge and the current view's gold are today's with the look on`, JSON.stringify({ on: [plOn.attn, plOn.seg], off: [plOff.attn, plOff.seg] }));
      chk(plOn.found && plOff.found && plOn.hover === plOff.hover && plOff.hover !== 'missed',
        `${tag} Projects: a card under the pointer shows today's hover border and lift with the look on`, JSON.stringify({ on: plOn.hover, off: plOff.hover }));
      chk(plOn.focus && plOn.focus.visible && plOn.focus.style !== 'none' && parseFloat(plOn.focus.width) > 0 && JSON.stringify(plOn.focus) === JSON.stringify(plOff.focus),
        `${tag} Projects: a card reached from the keyboard shows a focus ring with the look on, as with it off`, JSON.stringify({ on: plOn.focus, off: plOff.focus }));
      chk(plOn.roadmap && plOff.roadmap && JSON.stringify(plOn.roadmap) === JSON.stringify(plOff.roadmap),
        `${tag} Projects: a plain roadmap row is exactly today's with the look on (no border, same shadow, corners and padding)`, JSON.stringify({ on: plOn.roadmap, off: plOff.roadmap }));
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
