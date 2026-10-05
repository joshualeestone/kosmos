// Browser-check-surface: pj-addmenu pj-addmenu-agent pj-addmenu-agent-sub pj-addmenu-outside fedinv-modal fedinv-label fedinv-kind-agent fedinv-make fedinv-msg fedinv-josh fedinv-code fedinv-copy fedinv-until fedinv-ok pjAddPlus fedInviteMake pj-fed-outside alist-fed-outside fedout-row fedout-act fedout-note mem-msg fedMembersLoad fedRemoveGo fedWithdraw pjFedMessage fedinv-copy-all fedinv-easier fedinv-status fedInviteCopyAll fedInviteText refreshYouName pj-new pj-mode-join pj-join-verify copyTextViaExec fedCopyText fedInviteCopyReset fedInviteCopy copyKeysWord copyKeysGlyph fedFirstName FEDINV_CLIP_HOLDS FEDINV_COPY_TOKEN FEDINV_COPY_TEXT FEDINV_COPY_BUSY FEDINV_BUSY_LINE fedInviteCopySaid
'use strict';
/**
 * kosmos#4649 slice A: inviting someone outside from the Members "+" (Mona's shots 01, 02, 03).
 *
 * WHAT THIS PINS, ARM BY ARM, AND WHY EACH CAN FAIL ON origin/main TODAY:
 *  A1  gate "show", tab view: the Members "+" opens a two-item menu ("Add one of your agents" with the
 *      local agents in its sub-line, "Invite someone outside" with its sub-line), and NOT #am-modal; the
 *      "+" says aria-expanded="true"; the menu sits below the "+" with its right edge on the "+"'s right
 *      edge; Escape closes it and puts focus back on the "+". Main: the "+" opens #am-modal directly and
 *      there is no #pj-addmenu.
 *  A2  "Add one of your agents" opens today's #am-modal, with a real box, in the tab view AND from the
 *      consolidated rail "+" (#rail-agents-new while the project's members are grouped). Main: no item.
 *  A3  gate NOT "show": the "+" opens #am-modal directly, no menu, and the outside item and the sheet are
 *      display:none. Its CONTROL is A1 (the same page with the gate "show" shows the item).
 *  A4  the sheet: an empty "Who is it for?" sends nothing and says so; a filled one with "Their agent"
 *      POSTs /api/federation/invite with `project` (the id), `label` and `invited_kind`, and NO
 *      `project_ref`. Main: no sheet.
 *  A5  the code screen: "Invite code for <label>", Josh's #3311 sentence verbatim (the same text as
 *      #pj-invite-msg), the code, "It works once, until Sunday, October 11." from expires_at; Copy copies
 *      it; Done closes and returns focus to the "+". The label input stops at 80 characters (typed, not
 *      set). Errors: a 409 not-owner shows pjFedMessage's sentence, a 502 shows the board's sentence as
 *      given, and the label is kept. Main: no sheet.
 *  A6  393 wide (a phone): the menu and both states of the sheet fit, with no sideways scroll.
 *
 * kosmos#4649 slice B: the owner's "From outside" section in Members (Mona's shots 07, 09, 10), Remove and
 * Withdraw, against Kitty's GET /api/federation/members, POST /api/federation/remove { project, edge_id } and
 * POST /api/federation/withdraw { project, invite_id }, all faked below (initStub). Each arm fails on
 * origin/main because main has no #pj-fed-outside, never asks /api/federation/members and has no remove or
 * withdraw route caller; the arm-specific control is named on each line.
 *  B1  one joined, one pending, one expired, one withdrawn, one removed, one null-label joined, one null-label
 *      pending, and one joined whose label is a local agent's name: the rows and sub-lines exactly as spec
 *      section 2 and Mona's Q-M2/Q-M3 answers say, in the board's order; withdrawn and removed absent; one
 *      "From outside" heading; no could-not-check line (checked_at is a number). Asked with ?project=k.
 *      Control: the same page with `invites: []` has no heading at all (B1b), so the heading is data-driven.
 *  B2  Remove opens #mem-modal with shot 09's title, Mona's no-agent body (spec G2), "Cancel" and
 *      "Remove Dana Ruiz" (.danger-btn); confirming POSTs exactly { project, edge_id }; after the 200 the dialog
 *      closes, the list is asked again and Dana's row is gone. Control: B3's 502 keeps it.
 *  B3  Remove 502: the dialog stays open with the board's sentence in #mem-msg and the row stays. Control: B2's
 *      200 removes it. Remove 404: the dialog closes, the board's sentence is shown under the list, and the list
 *      is asked again.
 *  B4  Withdraw 409 unsupported: POSTs { project, invite_id }, keeps the pending row, says the board's sentence
 *      with " on Oct 11" (Kitty's Q-K2) under that row, and does NOT ask the list again. 409 joined: says
 *      "Someone already joined with this code. Remove them instead." and asks again (the row is now joined).
 *      Control: each is the other's (one refetches, the other does not). 200: asked again, the row gone.
 *  B5  checked_at null: the one plain line "Kosmos could not check who has joined just now. This list may be out
 *      of date.", rows kept with no Withdraw and no Make a new code (the board then reports a joined person as
 *      pending or expired, and sends no joined rows). Control: B1 (a number) has no such line and offers both.
 *      A 404 draws nothing at all. The GET failing (500):
 *      no outside rows, the same line, and the project's own agents still listed.
 *  B6  the outside disc is dashed and untinted (computed border-top-style dashed, transparent background), in
 *      light AND dark, including the row labelled "Ada", the name of a local agent (#3851). Control: the local
 *      Ada's own disc in the same Members card IS tinted, so the page does tint that name where it should.
 *  B7  an expired row's "Make a new code" opens the invite sheet with its label and kind filled in and focus on
 *      "Make an invite code"; making it asks the list again, and the expired row goes once a pending one has
 *      the same label. Control: before the new code, the expired row is listed (B1).
 *  B8  gate not "show": the members route is never asked and the section draws nothing. Control: B1.
 *  B10a a label that is not a name ("my sister") gets the they/their body, never "my's computer". Control: Dana's
 *       body says "Dana's computer".
 *  B10b another project opened while a Remove is asked: the dialog closes, nothing is said, and the old
 *       project's list is not asked again. Control: B2, where the same 200 does ask again.
 *  B11a consolidated layout: Withdraw pressed in the RAIL asks the board and says its 409 unsupported sentence
 *       there. Control: B4, the same answer in the tab layout.
 *  B11b the gate leaving "show" while an outside Remove is open closes the dialog. Control: the dialog is open
 *       just before.
 *  B12  through the real gate path (fedGateStamp, not fedGateMembers): a project opened with the gate OFF asks
 *       nothing; the next stamp to "show" asks once for it and draws the section; a stamp back to off hides it.
 *       Control: B8, where the gate stays off and nothing is asked.
 *  B13  the shared #761 dialog after an outside Remove left a 502 showing and was cancelled: a local agent's
 *       minus opens it with no danger look, no stale message and a live button. Control: the 502 state just before.
 *  B14  after a Withdraw refusal, focus is on that row's Withdraw (not <body>) and the sentence is in #fed-live.
 *       Control: #fed-live is empty or absent before the action.
 *  B15  consolidated layout on a board with NO agents of its own: the rail still lists the project's people from
 *       outside (the Members card is hidden there). Control: B9, the same rows with agents on the board.
 *  B10c an unchecked answer (checked_at null, with rows) is asked again after 30 s, not before. Control: a
 *       checked answer is not asked again after the same 30 s.
 *  B9  consolidated layout: the same rows under the project's members in the rail (#alist-fed-outside), with
 *      the "Other Agents" sub-header still after them. Control: B1b's empty answer adds nothing to the rail.
 *
 * kosmos#4649 slice C: "Copy the invitation" on the code step (Mona's shot 03 button and line, shot 04's text, her
 * Q-M5 owner name). On origin/main (no invite sheet) the C block fails from its first arm. On slice B (no
 * #fedinv-copy-all) the C0 arms fail by assertion and the run then crashes in C1, waiting for #fedinv-copy-all;
 * nothing after that point runs there. The owner's name is the board's "You" name (/api/you, faked below as __you)
 * and the address is the ACCOUNT's name (owner_name on the owner's members answer, Kitty's follow-up), both read by
 * the page's own loaders (refreshYouName, fedMembersLoad), not set by hand. It is never this computer's own
 * address.
 *  C0  the code step reads as shot 03: "It works once, until Sunday, October 11. You can withdraw it from Members
 *      until Dana joins.", the Easier box naming Dana, and "Copy the invitation" as the primary (uprime) button
 *      after Done, with the bare-code Copy still there. A label that is not a name ("my sister") says "they join"
 *      and "they need". Control: the Dana line, the same code path with a name.
 *  C1  with the name and the address: Copy the invitation writes EXACTLY shot 04's text, "Maya Chen
 *      (maya.kosmosplus.com) invited you ...", and says Copied, then reverts. Control: the bare Copy, pressed
 *      first on the same screen, writes only the code.
 *  C2  with no "You" name the text starts "maya.kosmosplus.com invited you" (and is otherwise the same); with a
 *      name but no owner_name (or one that is not a Kosmos+ name), "Maya Chen invited you"; with neither,
 *      "Someone invited you". Control: C1 with both.
 *  C3  the step words, read OUT OF the copied invitation (not typed again here), each exist as a visible label on
 *      the page's own path: "+ Add Project" on the Projects list, "Join an external project" on the Add Project
 *      screen it opens, "Verify" on the join step that opens. A later rename of either side fails here. Control:
 *      the same finder, given a phrase the page does not have ("Join a shared project"), finds nothing.
 *  C4  writeText rejecting AND select-and-copy failing: the message line says "Kosmos could not copy the
 *      invitation. ...", the button keeps its words, the sheet stays open, and nothing throws. Control: C1 says Copied.
 *  C5  a page loaded as Windows (navigator.platform Win32) names Ctrl C and Ctrl+C in the copy-yourself lines;
 *      control: the same page loaded as a Mac (MacIntel) names Command C and the Command glyph.
 *  C5b on a Windows page the bare Copy's real refusal renders "Press Ctrl+C to copy" and "... press Ctrl C.".
 *  C6  a clipboard that never answers: nothing said while it waits, the bare Copy ignored, the 3 s limit's refusal,
 *      then the late write lands and the line says Copied.
 *  C7  a held write landing after a newer, successful copy on the other button: the line says what the clipboard
 *      now holds. Control: C6. C7b: the same with the SAME button (same text): the line keeps the newer "Copied".
 *      C7c: the same button, both presses refused: the stale write that lands turns the refusal into "Copied".
 *      (C7b fails only if the stale write wrongly prints the "finished late" line; it cannot tell silence from a
 *      second Copied.)
 *  C9  the clipboard-holds record through its real listeners (blur, copy events) and an in-time write, and a held
 *      write from a closed sheet landing under a new code.
 *  C8  the sheet's own type inside #panel-projects: its title is the size of another dialog's .rm-title (the add-
 *      agent dialog's), and its fields carry no hairline (border-top-width 0). Control: a .field outside the sheet
 *      keeps its hairline.
 *  C4b writeText rejecting but select-and-copy working (plusCopyViaExec's pattern): the exact invitation is
 *      selected and copied, and the button says Copied. Control: C4, the same press with the fallback failing.
 *
 * HERMETIC: web/index.html over file://, every route answered by the stub below (render-pj-clear-2575's
 * pattern: the stub's own /api/projects carries the seeded project, so a late startup poll cannot wipe
 * it; every catch-all reply carries the fixture's gate fields, so a late status poll cannot restamp the
 * gate under an arm). The timezone is pinned to UTC so the long date is fixed. Chromium only, like its
 * federation neighbours (render-fed-plus-gate, render-fed-external-3311).
 *
 * Not part of `npm test`: it needs a browser. See README.md in this directory.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-federation-invite-4649.js
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-federation-invite-4649: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
// Chromium reports the host's platform, so a check run on a Mac expects the Mac's copy keys (C4's line).
const ON_MAC = process.platform === 'darwin';
const SHOW = { sourceChannel: 'prod', federationLive: true, kosmos_plus: true };
const OFF = { sourceChannel: 'prod', federationLive: false, kosmos_plus: true };
// Sunday, October 11, 2026, 12:00 UTC (the page runs in UTC, below).
const EXPIRES = Date.UTC(2026, 9, 11, 12, 0, 0) / 1000;
const CODE = 'JrKnrXIraC_OmCrVTWCj2CCebdrOuTHb9Nrd7tDLdec.D4myQso2xpsgeYrm';
const JOSH = 'To connect external Kosmos users or their agents, give them this code to enter when joining an external project on Kosmos:';

const problems = [];
/* Ternary emit shape (render-pj-clear-2575's check()): a PASS/FAIL result line. */
function check(name, pass, detail) {
  if (!pass) problems.push(name);
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

function initStub(cfg) {
  window.setInterval = () => 0;   // no background poll repaints under an arm
  window.__fed = cfg.fed;
  window.__posts = [];
  window.__copied = [];
  window.__invite = { status: 200, body: { code: cfg.code, expires_at: cfg.expires, invite_id: 'inv-1' } };
  window.__project = { id: 'k', name: 'Spring launch', parent: null, archived: false, description: '',
    agents: [{ sessionName: 'ada', name: 'Ada' }, { sessionName: 'basil', name: 'Basil' }], summary: {}, unread: 0 };
  /* Slice B's routes. The default members answer lists nobody, so the slice A arms see no section. */
  window.__members = { status: 200, body: { owner: true, sealed: false, invites: [], checked_at: 1791115200 } };
  window.__memberUrls = [];
  window.__remove = { status: 200, body: { removed: true } };
  window.__removes = [];
  window.__withdraw = { status: 200, body: { withdrawn: true } };
  window.__withdraws = [];
  window.__answerDelay = 0;
  window.__computers = null;    // slice C's C2 plants this computer's address here, to prove it is never printed
  /* Slice C's Copy the invitation tries select-and-copy FIRST. A real execCommand would copy past the stubbed
     clipboard, so it is stubbed too: it records what it would copy and fails unless an arm sets __execOk. */
  window.__execOk = false;
  window.__execTexts = [];
  document.execCommand = (cmd) => {
    if (cmd !== 'copy') return false;
    const a = document.activeElement;
    window.__execTexts.push(a && typeof a.value === 'string' ? a.value : null);
    return window.__execOk === true;
  };
  window.__you = null;          // slice C: /api/you's `you` ({ name }); null leaves it to the catch-all (no name)
  window.__unhandled = [];
  window.addEventListener('unhandledrejection', (e) => { window.__unhandled.push(String(e.reason && e.reason.message || e.reason)); });
  const a = (s, name) => ({ sessionName: s, name, role: '', running: false, state: 'stopped', context: null });
  window.__agents = [a('ada', 'Ada'), a('basil', 'Basil'), a('cleo', 'Cleo')];
  const enc = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    if (u.includes('/api/federation/invite')) {
      let body = null;
      try { body = JSON.parse(String((opts && opts.body) || 'null')); } catch { body = 'unreadable'; }
      window.__posts.push({ url: u, method, body });
      return enc(window.__invite.status, window.__invite.body);
    }
    if (u.includes('/api/federation/members')) {
      window.__memberUrls.push(u);
      return enc(window.__members.status, window.__members.body);
    }
    for (const [route, log, key] of [['/api/federation/remove', '__removes', '__remove'], ['/api/federation/withdraw', '__withdraws', '__withdraw']]) {
      if (!u.includes(route)) continue;
      let body = null;
      try { body = JSON.parse(String((opts && opts.body) || 'null')); } catch { body = 'unreadable'; }
      window[log].push({ method, body });
      if (window.__answerDelay) await new Promise((r) => setTimeout(r, window.__answerDelay));   // B10b holds one in flight
      return enc(window[key].status, window[key].body);
    }
    if (/\/api\/you(\?|$)/.test(u) && window.__you) return enc(200, Object.assign({ ok: true, agents: window.__agents }, window.__fed, { you: window.__you }));
    if (u.includes('/api/remote/computers') && window.__computers) return enc(200, window.__computers);   // C2's planted address
    if (/\/api\/projects(\?|$)/.test(u) && method === 'GET') return enc(200, { ok: true, projects: [window.__project] });
    return enc(200, Object.assign({ ok: true, agents: window.__agents }, window.__fed));
  };
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (t) => { window.__copied.push(String(t)); } } });
  } catch { /* the copy arm reports it */ }
}

/* Put the open project on screen in the given layout, the gate stamped from the fixture. */
async function openProjectIn(page, layout) {
  await page.evaluate((layout) => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    fedGateStamp(window.__fed);
    document.documentElement.setAttribute('data-layout', layout);
    PROJECTS.length = 0;
    PROJECTS.push(window.__project);
    LAST = window.__agents.slice();
    PJ_CURRENT = 'k';
    showTab('projects');
    openProject('k');
    if (layout === 'consolidated' && typeof paintAgentList === 'function') paintAgentList();
  }, layout);
  await page.waitForTimeout(250);
}

const read = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const box = (el) => { if (!vis(el)) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const menu = document.getElementById('pj-addmenu');
  const items = menu ? [...menu.querySelectorAll('.pj-addmenu-it')].filter(vis).map((b) => ({
    id: b.id,
    head: [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
    sub: (b.querySelector('small') || {}).textContent || '',
  })) : null;
  const am = document.querySelector('#am-modal .rm-box');
  const inv = document.querySelector('#fedinv-modal .rm-box');
  return {
    menuExists: !!menu, menuBox: box(menu), items,
    amBox: box(am), invBox: box(inv),
    outsideDisplay: document.getElementById('pj-addmenu-outside') ? getComputedStyle(document.getElementById('pj-addmenu-outside')).display : 'MISSING',
    invDisplay: document.getElementById('fedinv-modal') ? getComputedStyle(document.getElementById('fedinv-modal')).display : 'MISSING',
    focus: document.activeElement ? document.activeElement.id : null,
    vw: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
const closeAll = (page) => page.evaluate(() => {
  if (typeof pjAddMenuClose === 'function') pjAddMenuClose(false);
  const inv = document.getElementById('fedinv-modal'); if (inv) inv.hidden = true;
  const am = document.getElementById('am-modal'); if (am) am.hidden = true;
});

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-federation-invite-4649: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const newPage = async (width, fed, platform) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'UTC', locale: 'en-US' });
    // C5: a page that believes it runs on another platform (MSG_MENU_MAC is read once, at load).
    if (platform) await ctx.addInitScript((p) => { Object.defineProperty(navigator, 'platform', { configurable: true, get: () => p }); }, platform);
    await ctx.addInitScript(initStub, { fed, code: CODE, expires: EXPIRES });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => check('no page error', false, e.message));
    await page.goto(PAGE);
    if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
    return { ctx, page };
  };

  /* ---------------- A1, A2 (tab), A4, A5: desktop, tab view, gate "show" ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    const before = await read(page);
    check('A1 setup: the Members "+" is on screen and nothing is open yet',
      before.amBox === null && before.menuBox === null, JSON.stringify({ am: before.amBox, menu: before.menuBox }));

    await page.click('#pj-add-member');
    let s = await read(page);
    const plus = await page.$eval('#pj-add-member', (b) => { const r = b.getBoundingClientRect(); return { r: Math.round(r.right), b: Math.round(r.bottom), expanded: b.getAttribute('aria-expanded'), haspopup: b.getAttribute('aria-haspopup') }; });
    check('A1 the "+" opens the menu, not #am-modal', s.menuBox !== null && s.amBox === null, JSON.stringify({ menu: s.menuBox, am: s.amBox }));
    check('A1 the menu has both items, Mona\'s words exactly',
      !!s.items && s.items.length === 2
      && s.items[0].head === 'Add one of your agents' && s.items[0].sub === 'Ada, Basil and the rest of your team'
      && s.items[1].head === 'Invite someone outside' && s.items[1].sub === 'A person, or their agent, on their own Kosmos',
      JSON.stringify(s.items));
    check('A1 the "+" says it opens a menu and that it is open', plus.haspopup === 'menu' && plus.expanded === 'true', JSON.stringify(plus));
    const card = await page.$eval('.pjcard-members', (c) => { const r = c.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; });
    check('A1 the menu sits below the "+", right edges aligned, inside the Members card and the window',
      !!s.menuBox && Math.abs(s.menuBox.r - plus.r) <= 2 && s.menuBox.t >= plus.b && s.menuBox.l >= card.l - 1 && s.menuBox.r <= card.r + 1
      && s.menuBox.l >= 0 && s.menuBox.r <= s.vw,
      JSON.stringify({ menu: s.menuBox, plus, card }));
    check('A1 focus moves into the menu (its first item)', s.focus === 'pj-addmenu-agent', 'focus=' + s.focus);
    await page.keyboard.press('ArrowDown');
    const down = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check('A1 ArrowDown moves to "Invite someone outside"', down === 'pj-addmenu-outside', 'focus=' + down);
    await page.keyboard.press('Escape');
    s = await read(page);
    const exp = await page.$eval('#pj-add-member', (b) => b.getAttribute('aria-expanded'));
    check('A1 Escape closes the menu and returns focus to the "+"', s.menuBox === null && s.focus === 'pj-add-member' && exp === 'false',
      JSON.stringify({ menu: s.menuBox, focus: s.focus, exp }));

    // A2, tab view: "Add one of your agents" is today's #am-modal.
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-agent');
    s = await read(page);
    check('A2 tab view: "Add one of your agents" opens #am-modal with a real box, menu closed',
      !!s.amBox && s.amBox.w > 200 && s.amBox.h > 80 && s.menuBox === null, JSON.stringify({ am: s.amBox, menu: s.menuBox }));
    await closeAll(page);

    // A4: the sheet. An empty label sends nothing.
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    s = await read(page);
    check('A4 "Invite someone outside" opens the sheet, menu closed, focus in "Who is it for?"',
      !!s.invBox && s.menuBox === null && s.focus === 'fedinv-label', JSON.stringify({ inv: s.invBox, menu: s.menuBox, focus: s.focus }));
    const ask = await page.evaluate(() => ({
      title: document.getElementById('fedinv-t').textContent,
      can: document.getElementById('fedinv-can').textContent.replace(/\s+/g, ' ').trim(),
      max: document.getElementById('fedinv-label').getAttribute('maxlength'),
      person: document.getElementById('fedinv-kind-person').checked,
    }));
    check('A4 the asking step reads as shot 02', ask.title === 'Invite someone outside your Kosmos'
      && ask.can === "They can read and post in this project's conversation, and add their own agents to it.They cannot see your files or tasks, or tell your computer or your agents to do anything. Your agents read what they write and decide for themselves."
      && ask.person === true, JSON.stringify(ask));
    await page.click('#fedinv-make');
    const empty = await page.evaluate(() => ({ posts: window.__posts.length, msg: document.getElementById('fedinv-msg').textContent, invalid: document.getElementById('fedinv-label').getAttribute('aria-invalid') }));
    check('A4 an empty "Who is it for?" sends nothing and says so', empty.posts === 0 && empty.msg.length > 0 && empty.invalid === 'true', JSON.stringify(empty));

    // A5: the label stops at 80 characters, typed key by key.
    await page.locator('#fedinv-label').pressSequentially('x'.repeat(100));
    const typed = await page.$eval('#fedinv-label', (i) => i.value.length);
    check('A5 the label stops at 80 characters (maxlength=' + ask.max + ')', ask.max === '80' && typed === 80, 'typed length ' + typed);

    // A5: errors. 409 not-owner -> the mapped sentence; 502 -> the board's sentence as given; the label kept.
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.evaluate(() => { window.__invite = { status: 409, body: { reason: 'not-owner', error: 'board words' } }; });
    await page.click('#fedinv-make');
    await page.waitForTimeout(150);
    let err = await page.evaluate(() => ({ msg: document.getElementById('fedinv-msg').textContent, label: document.getElementById('fedinv-label').value, asking: !document.getElementById('fedinv-ask').hidden }));
    check('A5 a 409 not-owner shows "Only the owner of this project can invite people to it." and keeps the label',
      err.msg === 'Only the owner of this project can invite people to it.' && err.label === 'Dana Ruiz' && err.asking, JSON.stringify(err));
    await page.evaluate(() => { window.__invite = { status: 502, body: { error: 'The connection service said no just now.' } }; });
    await page.click('#fedinv-make');
    await page.waitForTimeout(150);
    err = await page.evaluate(() => ({ msg: document.getElementById('fedinv-msg').textContent, label: document.getElementById('fedinv-label').value }));
    check('A5 a 502 shows the board\'s sentence as given', err.msg === 'The connection service said no just now.' && err.label === 'Dana Ruiz', JSON.stringify(err));

    // A4: the request. "Their agent", then Make.
    await page.evaluate((c) => { window.__posts.length = 0; window.__invite = { status: 200, body: { code: c.code, expires_at: c.expires, invite_id: 'inv-1' } }; }, { code: CODE, expires: EXPIRES });
    await page.click('label:has(#fedinv-kind-agent)');
    await page.click('#fedinv-make');
    await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    const sent = await page.evaluate(() => window.__posts.slice());
    const b = sent.length === 1 ? sent[0].body : null;
    check('A4 Make POSTs /api/federation/invite once with project (the id), label and invited_kind, and no project_ref',
      sent.length === 1 && sent[0].method === 'POST' && !!b && b.project === 'k' && b.label === 'Dana Ruiz'
      && b.invited_kind === 'agent' && !('project_ref' in b), JSON.stringify(sent));

    // A5: the code screen.
    const done = await page.evaluate(() => ({
      title: document.getElementById('fedinv-t').textContent,
      josh: document.getElementById('fedinv-josh').textContent,
      joshMain: (document.getElementById('pj-invite-msg') || {}).textContent,
      code: document.getElementById('fedinv-code').value,
      until: document.getElementById('fedinv-until').textContent,
      askHidden: document.getElementById('fedinv-ask').hidden,
      focus: document.activeElement && document.activeElement.id,
    }));
    check('A5 the title names the label', done.title === 'Invite code for Dana Ruiz', done.title);
    check('A5 Josh\'s sentence, verbatim, the same words as the create form\'s', done.josh === JOSH && done.joshMain === JOSH, JSON.stringify({ josh: done.josh }));
    check('A5 the code is shown', done.code === CODE && done.askHidden, JSON.stringify(done));
    check('A5 "It works once, until Sunday, October 11." from expires_at (slice C adds the withdraw sentence after it)',
      done.until === 'It works once, until Sunday, October 11. You can withdraw it from Members until Dana joins.', done.until);
    await page.click('#fedinv-copy');
    await page.waitForTimeout(100);
    const copied = await page.evaluate(() => ({ copied: window.__copied.slice(), btn: document.getElementById('fedinv-copy').textContent }));
    check('A5 Copy copies the code and says Copied', copied.copied.length === 1 && copied.copied[0] === CODE && copied.btn === 'Copied', JSON.stringify(copied));
    // A stray backdrop click must not lose a code on screen.
    await page.mouse.click(5, 5);
    s = await read(page);
    check('A5 a backdrop click leaves the code on screen', !!s.invBox, JSON.stringify({ inv: s.invBox }));
    await page.click('#fedinv-ok');
    s = await read(page);
    check('A5 Done closes the sheet and returns focus to the "+"', s.invBox === null && s.focus === 'pj-add-member', JSON.stringify({ inv: s.invBox, focus: s.focus }));
    await ctx.close();
  }

  /* ---------------- A3: gate NOT "show" ---------------- */
  {
    const { ctx, page } = await newPage(1280, OFF);
    await openProjectIn(page, 'tabs');
    await page.click('#pj-add-member');
    const s = await read(page);
    const hp = await page.$eval('#pj-add-member', (b) => b.getAttribute('aria-haspopup'));
    check('A3 gate not "show": the "+" opens #am-modal directly, no menu', !!s.amBox && s.menuBox === null, JSON.stringify({ am: s.amBox, menu: s.menuBox }));
    check('A3 gate not "show": the outside item and the sheet are display:none, and the "+" claims no menu',
      s.outsideDisplay === 'none' && s.invDisplay === 'none' && hp === null, JSON.stringify({ outside: s.outsideDisplay, inv: s.invDisplay, hp }));
    // Even when called directly, the sheet refuses to open with the gate off.
    const forced = await page.evaluate(() => { fedInviteOpen(document.getElementById('pj-add-member')); return document.getElementById('fedinv-modal').hidden; });
    check('A3 gate not "show": fedInviteOpen does not open the sheet', forced === true, 'hidden=' + forced);
    await ctx.close();
  }

  /* ---------------- A2 consolidated: the rail "+" ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'consolidated');
    const grouped = await page.evaluate(() => (typeof AGENTS_GROUPED !== 'undefined' && AGENTS_GROUPED) && document.getElementById('rail-agents-new').getClientRects().length > 0);
    check('A2 consolidated setup: the project\'s members are grouped and the rail "+" is on screen', grouped === true, 'grouped=' + grouped);
    await page.click('#rail-agents-new');
    let s = await read(page);
    check('A2 consolidated: the rail "+" opens the same menu', s.menuBox !== null && s.amBox === null && !!s.items && s.items.length === 2, JSON.stringify({ menu: s.menuBox, items: s.items }));
    await page.click('#pj-addmenu-agent');
    s = await read(page);
    check('A2 consolidated: "Add one of your agents" opens #am-modal with a real box', !!s.amBox && s.amBox.w > 200 && s.amBox.h > 80, JSON.stringify({ am: s.amBox }));
    await closeAll(page);
    await page.click('#rail-agents-new');
    await page.click('#pj-addmenu-outside');
    s = await read(page);
    check('A2 consolidated: "Invite someone outside" opens the sheet with a real box', !!s.invBox && s.invBox.w > 200, JSON.stringify({ inv: s.invBox }));
    await ctx.close();
  }

  /* ---------------- A6: phone width, no sideways scroll ---------------- */
  {
    const { ctx, page } = await newPage(393, SHOW);
    await openProjectIn(page, 'tabs');
    await page.click('#pj-add-member');
    let s = await read(page);
    check('A6 393 wide: the menu opens inside the window', !!s.menuBox && s.menuBox.l >= 0 && s.menuBox.r <= s.vw && s.overflowX <= 0,
      JSON.stringify({ menu: s.menuBox, vw: s.vw, overflowX: s.overflowX }));
    await page.click('#pj-addmenu-outside');
    s = await read(page);
    check('A6 393 wide: the asking step fits, no sideways scroll', !!s.invBox && s.invBox.l >= 0 && s.invBox.r <= s.vw && s.overflowX <= 0,
      JSON.stringify({ inv: s.invBox, vw: s.vw, overflowX: s.overflowX }));
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.click('#fedinv-make');
    await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    s = await read(page);
    const code = await page.$eval('#fedinv-code', (i) => { const r = i.getBoundingClientRect(); return { r: Math.round(r.right), value: i.value }; });
    check('A6 393 wide: the code step fits (the long code is cut, not the page)', !!s.invBox && s.invBox.r <= s.vw && s.overflowX <= 0
      && code.value === CODE && code.r <= s.invBox.r, JSON.stringify({ inv: s.invBox, code, vw: s.vw, overflowX: s.overflowX }));
    await ctx.close();
  }

  /* ---------------- slice B: the owner's "From outside" section (shots 07, 09, 10) ---------------- */
  // Unix seconds at noon UTC (the page runs in UTC), so every short date is fixed.
  const D = (month, day) => Date.UTC(2026, month, day, 12, 0, 0) / 1000;
  const SEP = 8, OCT = 9;
  const row = (o) => Object.assign({ invite_id: null, label: null, kind: 'person', made_at: null, expires_at: null,
    state: 'pending', edge_id: null, joined_at: null }, o);
  const DANA = row({ invite_id: 'inv-dana', label: 'Dana Ruiz', made_at: D(OCT, 1), expires_at: D(OCT, 8), state: 'joined', edge_id: 'edge-dana', joined_at: D(OCT, 4) });
  const LEE = row({ invite_id: 'inv-lee', label: 'Lee Park', made_at: D(OCT, 4), expires_at: D(OCT, 11) });
  const OLD = row({ invite_id: 'inv-old', label: 'Old Friend', kind: 'agent', made_at: D(SEP, 24), expires_at: D(OCT, 1), state: 'expired' });
  const GONE_W = row({ invite_id: 'inv-wd', label: 'Withdrawn One', made_at: D(OCT, 2), expires_at: D(OCT, 9), state: 'withdrawn' });
  const GONE_R = row({ invite_id: 'inv-rm', label: 'Removed One', made_at: D(SEP, 30), expires_at: D(OCT, 7), state: 'removed', edge_id: 'edge-rm', joined_at: D(OCT, 1) });
  const NOLABEL_J = row({ invite_id: 'inv-cs', state: 'joined', edge_id: 'edge-cs', joined_at: D(OCT, 3) });
  const ADA = row({ invite_id: 'inv-ada', label: 'Ada', kind: 'agent', made_at: D(OCT, 1), expires_at: D(OCT, 8), state: 'joined', edge_id: 'edge-ada', joined_at: D(OCT, 2) });
  const NOLABEL_P = row({ invite_id: 'inv-nl', made_at: D(OCT, 4), expires_at: D(OCT, 11) });
  const ALL = [DANA, LEE, OLD, GONE_W, GONE_R, NOLABEL_J, ADA, NOLABEL_P];
  const answer = (invites, extra) => ({ status: 200, body: Object.assign({ owner: true, sealed: true, invites, checked_at: D(OCT, 4) }, extra || {}) });
  // Each expected row: [disc letters, name, sub-line, action]. Spec section 2 plus Mona's Q-M2 (expired) and Q-M3
  // (no label: "Someone you invited" on an empty disc) and Kitty's contract ("Invited <date>" for a pending one).
  const EXPECT = [
    ['DR', 'Dana Ruiz', 'Person · joined Oct 4', 'Remove'],
    ['LP', 'Lee Park', 'Invited · until Oct 11', 'Withdraw'],
    ['OF', 'Old Friend', 'Expired Oct 1', 'Make a new code'],
    ['', 'Someone you invited', 'Person · joined Oct 3', 'Remove'],
    ['A', 'Ada', 'Agent · joined Oct 2', 'Remove'],
    ['', 'Invited Oct 4', 'Invited · until Oct 11', 'Withdraw'],
  ];
  const NOTE = 'Kosmos could not check who has joined just now. This list may be out of date.';
  const UNSUPPORTED = 'Kosmos cannot withdraw a code yet. This one stops working on its own when it lapses.';
  const JOINED = 'Someone already joined with this code. Remove them instead.';
  const readFed = (page, sel) => page.evaluate((sel) => {
    const box = document.querySelector(sel);
    if (!box) return { exists: false, display: 'MISSING', heads: [], notes: [], rows: [], msgs: [], text: '' };
    return {
      exists: true,
      display: getComputedStyle(box).display,
      heads: [...box.querySelectorAll('.fedout-h')].map((h) => h.textContent),
      notes: [...box.querySelectorAll('.fedout-note')].map((n) => n.textContent),
      rows: [...box.querySelectorAll('.fedout-row')].map((r) => {
        const act = r.querySelector('.fedout-act');
        return { key: r.dataset.fedKey, disc: r.querySelector('.msg-av').textContent, name: r.querySelector('.fedout-nm').textContent,
          sub: r.querySelector('.fedout-sub').textContent, act: act ? act.textContent : '', actOn: !!act && !act.disabled };
      }),
      msgs: [...box.querySelectorAll('.fmsg')].map((m) => m.textContent).filter(Boolean),
      text: box.textContent,
    };
  }, sel);
  const rowsAre = (rows, expect) => rows.length === expect.length
    && expect.every((e, i) => rows[i].disc === e[0] && rows[i].name === e[1] && rows[i].sub === e[2] && rows[i].act === e[3]);
  const setMembers = (page, ans) => page.evaluate((a) => { window.__members = a; }, ans);
  const gets = (page) => page.evaluate(() => window.__memberUrls.length);
  const modal = (page) => page.evaluate(() => ({
    open: !document.getElementById('mem-modal').hidden,
    title: document.getElementById('mem-title').textContent,
    body: document.getElementById('mem-small').textContent,
    keep: document.getElementById('mem-keep').textContent,
    go: document.getElementById('mem-go').textContent,
    danger: document.getElementById('mem-go').classList.contains('danger-btn'),
    msg: document.getElementById('mem-msg') ? document.getElementById('mem-msg').textContent : 'MISSING',
  }));
  const act = (page, key) => page.click('#pj-fed-outside .fedout-row[data-fed-key="' + key + '"] .fedout-act');
  const DANA_BODY = 'Confirm that you want to remove Dana Ruiz from Spring launch. Dana\u2019s computer stops getting new messages from this room. What Dana already received stays on Dana\u2019s computer.';

  /* B1, B1b, B6, B8 controls: the list itself. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'tabs');
    let f = await readFed(page, '#pj-fed-outside');
    const urls = await page.evaluate(() => window.__memberUrls.slice());
    check('B1 the members route is asked for the open project', urls.length >= 1 && urls.every((u) => /\/api\/federation\/members\?project=k$/.test(u)), JSON.stringify(urls));
    check('B1 one "From outside" heading', f.heads.length === 1 && f.heads[0] === 'From outside', JSON.stringify(f.heads));
    check('B1 the rows and sub-lines, exactly, in the board\'s order', rowsAre(f.rows, EXPECT), JSON.stringify(f.rows));
    check('B1 withdrawn and removed invites are not shown', !/Withdrawn One|Removed One/.test(f.text), f.text);
    check('B1 no could-not-check line when checked_at is a number', f.notes.length === 0 && !f.text.includes(NOTE), JSON.stringify(f.notes));
    /* Mona's review (20:0x): in the ~246 px tab column a long action ("Make a new code") squeezed the text, so
       "Old Friend" broke over two lines and the date split as "Expired Oct / 1". Every name and sub-line now
       sits on ONE line, the action dropping under the text when it does not fit. */
    const oneLine = await page.evaluate(() => [...document.querySelectorAll('#pj-fed-outside .fedout-row')].map((r) => {
      const lh = (el) => parseFloat(getComputedStyle(el).lineHeight) || 16;
      const nm = r.querySelector('.fedout-nm'); const sub = r.querySelector('.fedout-sub');
      return { key: r.dataset.fedKey, nm: nm.getBoundingClientRect().height <= lh(nm) * 1.5, sub: sub.getBoundingClientRect().height <= lh(sub) * 1.5 };
    }));
    check('B1 at 1280 every name and sub-line is on one line (Mona: "Expired Oct / 1" split)',
      oneLine.length === EXPECT.length && oneLine.every((o) => o.nm && o.sub), JSON.stringify(oneLine));

    /* B6: dashed and untinted, the "Ada" row included; the local Ada disc is the tinted control. */
    const discs = async () => page.evaluate(() => {
      const st = (el) => { if (!el) return null; const c = getComputedStyle(el); return { border: c.borderTopStyle, bg: c.backgroundColor }; };
      return {
        dana: st(document.querySelector('#pj-fed-outside .fedout-row[data-fed-key="e:edge-dana"] .msg-av')),
        ada: st(document.querySelector('#pj-fed-outside .fedout-row[data-fed-key="e:edge-ada"] .msg-av')),
        lee: st(document.querySelector('#pj-fed-outside .fedout-row[data-fed-key="i:inv-lee"] .msg-av')),
        localAda: st(document.querySelector('#pj-one-agents .pj-member[data-agent="ada"] .pj-face')),
      };
    });
    const clear = (s) => !!s && s.border === 'dashed' && (s.bg === 'rgba(0, 0, 0, 0)' || s.bg === 'transparent');
    let d = await discs();
    check('B6 light: the outside discs are dashed and untinted, the "Ada" row too', clear(d.dana) && clear(d.ada) && clear(d.lee), JSON.stringify(d));
    check('B6 control: the local Ada\'s own disc is tinted', !!d.localAda && !clear(d.localAda) && d.localAda.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(d.localAda));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    d = await discs();
    check('B6 dark: still dashed and untinted (the dark .msg-av ground does not reach them)', clear(d.dana) && clear(d.ada) && clear(d.lee), JSON.stringify(d));
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

    /* B1b: an empty answer draws nothing, no heading. */
    await setMembers(page, answer([]));
    await page.evaluate(() => fedMembersLoad('k'));
    await page.waitForTimeout(150);
    f = await readFed(page, '#pj-fed-outside');
    check('B1b `invites: []`: no "From outside" heading and no rows (the section is display:none)',
      f.heads.length === 0 && f.rows.length === 0 && f.display === 'none', JSON.stringify(f));
    await ctx.close();
  }

  /* B2, B3: Remove. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'tabs');
    await act(page, 'e:edge-dana');
    let m = await modal(page);
    check('B2 Remove opens #mem-modal with shot 09\'s title, the no-agent body, Cancel and "Remove Dana Ruiz"',
      m.open && m.title === 'Remove Dana Ruiz from this project?' && m.body === DANA_BODY && m.keep === 'Cancel'
      && m.go === 'Remove Dana Ruiz' && m.danger && m.msg === '', JSON.stringify(m));
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check('B2 focus lands on Cancel (the harmless answer)', focus === 'mem-keep', 'focus=' + focus);

    // B3 first: 502 keeps the dialog, says why, keeps the row.
    await page.evaluate(() => { window.__remove = { status: 502, body: { error: 'The connection service refused just now.' } }; });
    await page.click('#mem-go');
    await page.waitForTimeout(200);
    m = await modal(page);
    let f = await readFed(page, '#pj-fed-outside');
    check('B3 remove 502: the dialog stays open with the board\'s sentence', m.open && m.msg === 'The connection service refused just now.', JSON.stringify(m));
    check('B3 remove 502: Dana\'s row stays', f.rows.some((r) => r.key === 'e:edge-dana'), JSON.stringify(f.rows.map((r) => r.key)));

    // B2: the 200. The next members answer has Dana removed.
    const before = await gets(page);
    await page.evaluate(() => { window.__removes.length = 0; window.__remove = { status: 200, body: { removed: true } }; });
    await setMembers(page, answer(ALL.map((r) => (r === DANA ? Object.assign({}, r, { state: 'removed' }) : r))));
    await page.click('#mem-go');
    await page.waitForTimeout(250);
    const sent = await page.evaluate(() => window.__removes.slice());
    m = await modal(page);
    f = await readFed(page, '#pj-fed-outside');
    check('B2 confirm POSTs exactly { project, edge_id }', sent.length === 1 && sent[0].method === 'POST'
      && JSON.stringify(sent[0].body) === JSON.stringify({ project: 'k', edge_id: 'edge-dana' }), JSON.stringify(sent));
    check('B2 after the 200 the dialog closes, the list is asked again, and the row is gone',
      !m.open && (await gets(page)) > before && !f.rows.some((r) => r.key === 'e:edge-dana') && f.rows.length === EXPECT.length - 1,
      JSON.stringify({ open: m.open, rows: f.rows.map((r) => r.key) }));
    check('B2 the dialog is back to its own look for the next caller (no danger class, no error)', !m.danger && m.msg === '', JSON.stringify(m));

    // B3: 404. The dialog closes, the sentence is said under the list, and the list is asked again.
    await act(page, 'e:edge-ada');
    const before404 = await gets(page);
    await page.evaluate(() => { window.__remove = { status: 404, body: { error: 'That member is not in this project.' } }; });
    await setMembers(page, answer([LEE]));
    await page.click('#mem-go');
    await page.waitForTimeout(250);
    m = await modal(page);
    f = await readFed(page, '#pj-fed-outside');
    check('B3 remove 404: the dialog closes, the board\'s sentence is shown, and the list is asked again',
      !m.open && f.msgs.includes('That member is not in this project.') && (await gets(page)) > before404, JSON.stringify({ open: m.open, msgs: f.msgs }));
    await ctx.close();
  }

  /* B4: Withdraw. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'tabs');
    let before = await gets(page);
    await page.evaluate((e) => { window.__withdraw = { status: 409, body: { reason: 'unsupported', error: e } }; }, UNSUPPORTED);
    await act(page, 'i:inv-lee');
    await page.waitForTimeout(200);
    let sent = await page.evaluate(() => window.__withdraws.slice());
    let f = await readFed(page, '#pj-fed-outside');
    const leeAt = f.rows.findIndex((r) => r.key === 'i:inv-lee');
    const under = await page.evaluate(() => {
      const r = document.querySelector('#pj-fed-outside .fedout-row[data-fed-key="i:inv-lee"]');
      const n = r && r.nextElementSibling;
      return n && n.classList.contains('fmsg') ? n.textContent : null;
    });
    check('B4 Withdraw POSTs exactly { project, invite_id }', sent.length === 1 && sent[0].method === 'POST'
      && JSON.stringify(sent[0].body) === JSON.stringify({ project: 'k', invite_id: 'inv-lee' }), JSON.stringify(sent));
    check('B4 409 unsupported: the pending row stays, with the board\'s sentence and the lapse date under it',
      leeAt >= 0 && f.rows[leeAt].sub === 'Invited · until Oct 11' && f.rows[leeAt].actOn
      && under === 'Kosmos cannot withdraw a code yet. This one stops working on its own when it lapses on Oct 11.', JSON.stringify({ under, rows: f.rows }));
    check('B4 409 unsupported: the list is not asked again (control for 409 joined below)', (await gets(page)) === before, 'gets ' + before + ' -> ' + (await gets(page)));

    // 409 joined: someone used the code; the next answer has Lee joined.
    before = await gets(page);
    await page.evaluate((e) => { window.__withdraw = { status: 409, body: { reason: 'joined', error: e } }; }, JOINED);
    await setMembers(page, answer(ALL.map((r) => (r === LEE ? Object.assign({}, r, { state: 'joined', edge_id: 'edge-lee', joined_at: D(OCT, 5) }) : r))));
    await act(page, 'i:inv-lee');
    await page.waitForTimeout(250);
    f = await readFed(page, '#pj-fed-outside');
    const lee = f.rows.find((r) => r.name === 'Lee Park');
    check('B4 409 joined: its sentence is shown and the list is asked again (Lee is now a joined row with Remove)',
      f.msgs.includes(JOINED) && (await gets(page)) > before && !!lee && lee.sub === 'Person · joined Oct 5' && lee.act === 'Remove',
      JSON.stringify({ msgs: f.msgs, lee }));

    // 200: asked again, the row gone (the next answer has it withdrawn).
    before = await gets(page);
    await page.evaluate(() => { window.__withdraw = { status: 200, body: { withdrawn: true } }; });
    await setMembers(page, answer(ALL.map((r) => (r === NOLABEL_P ? Object.assign({}, r, { state: 'withdrawn' }) : r))));
    await act(page, 'i:inv-nl');
    await page.waitForTimeout(250);
    f = await readFed(page, '#pj-fed-outside');
    check('B4 Withdraw 200: the list is asked again and the withdrawn row is gone',
      (await gets(page)) > before && !f.rows.some((r) => r.key === 'i:inv-nl'), JSON.stringify(f.rows.map((r) => r.key)));
    await ctx.close();
  }

  /* B5: checked_at null, and the GET failing. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    /* What the board really sends when it cannot read the connections (fedmembers.members): no joined rows at all,
       and a joined person shown as pending or expired by the clock. So the page offers no Withdraw and no Make a new
       code there (they would act on a state that may be wrong). DANA_P is Dana, joined, as the board then reports her. */
    const DANA_P = row({ invite_id: 'inv-dana', label: 'Dana Ruiz', made_at: D(OCT, 1), expires_at: D(OCT, 8) });
    await page.evaluate((a) => { window.__members = a; }, answer([DANA_P, LEE, OLD], { checked_at: null }));
    await openProjectIn(page, 'tabs');
    let f = await readFed(page, '#pj-fed-outside');
    check('B5 checked_at null: the one could-not-check line, as a plain hint', f.notes.length === 1 && f.notes[0] === NOTE, JSON.stringify(f.notes));
    const hint = await page.evaluate(() => { const n = document.querySelector('#pj-fed-outside .fedout-note'); return n ? n.className : null; });
    check('B5 the line is a .fhint (Mona\'s Q-M6), not an error', !!hint && /\bfhint\b/.test(hint) && !/\bfmsg\b/.test(hint), String(hint));
    check('B5 checked_at null: the rows stay, with no Withdraw and no Make a new code (control: B1 offers both)', rowsAre(f.rows, [
      ['DR', 'Dana Ruiz', 'Invited · until Oct 8', ''],
      ['LP', 'Lee Park', 'Invited · until Oct 11', ''],
      ['OF', 'Old Friend', 'Expired Oct 1', ''],
    ]), JSON.stringify(f.rows));
    /* A 404 (a board without the members route, or a project not on this computer) draws nothing, not the line. */
    await setMembers(page, { status: 404, body: { error: 'no such endpoint' } });
    await page.evaluate(() => fedMembersLoad('k'));
    await page.waitForTimeout(150);
    f = await readFed(page, '#pj-fed-outside');
    check('B5 a 404 draws no heading, no rows and no could-not-check line (control: the 500 below has the line)',
      f.heads.length === 0 && f.rows.length === 0 && f.notes.length === 0, JSON.stringify(f));
    /* shared (Kitty, 18:18): an unchecked answer with no rows but shared:true still says could-not-check;
       the same answer without shared draws nothing (a never-shared project). */
    await setMembers(page, answer([], { checked_at: null, shared: true }));
    await page.evaluate(() => fedMembersLoad('k'));
    await page.waitForTimeout(150);
    f = await readFed(page, '#pj-fed-outside');
    const sharedOn = { heads: f.heads.length, notes: f.notes.length, rows: f.rows.length };
    await setMembers(page, answer([], { checked_at: null }));
    await page.evaluate(() => fedMembersLoad('k'));
    await page.waitForTimeout(150);
    f = await readFed(page, '#pj-fed-outside');
    check('B5 shared:true with no rows says could-not-check; without shared it draws nothing (the control)',
      sharedOn.heads === 1 && sharedOn.notes === 1 && sharedOn.rows === 0 && f.heads.length === 0 && f.notes.length === 0,
      JSON.stringify({ sharedOn, without: { heads: f.heads, notes: f.notes } }));
    /* A refresh that FAILS after a good answer keeps that answer's rows, unchecked; only a first load that fails has
       no rows to keep. */
    await setMembers(page, answer([LEE]));
    await page.evaluate(() => fedMembersLoad('k'));
    await setMembers(page, { status: 500, body: { error: 'we cannot read the connected-projects record on this computer right now' } });
    await page.evaluate(() => fedMembersLoad('k'));
    await page.waitForTimeout(150);
    f = await readFed(page, '#pj-fed-outside');
    check('B5 a failed refresh keeps the last good rows, with the line and no Withdraw (unchecked)',
      rowsAre(f.rows, [['LP', 'Lee Park', 'Invited · until Oct 11', '']]) && f.notes.length === 1 && f.notes[0] === NOTE, JSON.stringify(f));
    await page.evaluate(() => { FED_MEMBERS = null; return fedMembersLoad('k'); });
    await page.waitForTimeout(150);
    f = await readFed(page, '#pj-fed-outside');
    const own = await page.evaluate(() => [...document.querySelectorAll('#pj-one-agents .pj-member')].map((r) => r.dataset.agent));
    check('B5 a first load that fails: no outside rows, the same line, and the project\'s own agents still listed',
      f.rows.length === 0 && f.notes.length === 1 && f.notes[0] === NOTE && own.join(',') === 'ada,basil', JSON.stringify({ f, own }));
    await ctx.close();
  }

  /* B10: names in the confirm body, a project switch mid-Remove, and the 30 s retry of an unchecked answer. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    const SIS = row({ invite_id: 'inv-sis', label: 'my sister', made_at: D(OCT, 1), expires_at: D(OCT, 8), state: 'joined', edge_id: 'edge-sis', joined_at: D(OCT, 2) });
    await page.evaluate((a) => { window.__members = a; }, answer([DANA, SIS]));
    await openProjectIn(page, 'tabs');
    const body = () => page.evaluate(() => document.getElementById('mem-small').textContent);
    await act(page, 'e:edge-sis');
    const sis = await body();
    await page.click('#mem-keep');
    await act(page, 'e:edge-dana');
    const dana = await body();
    check('B10a a label that is not a name gets the they/their body (control: Dana\'s body names her)',
      /remove my sister from Spring launch\. Their computer/.test(sis) && !/my['\u2019]s/.test(sis) && /Dana\u2019s computer/.test(dana), JSON.stringify({ sis, dana }));
    // B10b: hold the Remove in flight, open another project, then let it answer.
    const getsK = () => page.evaluate(() => window.__memberUrls.filter((u) => /project=k(&|$)/.test(u)).length);
    const before = await getsK();
    await page.evaluate(() => { window.__answerDelay = 300; window.__remove = { status: 200, body: { removed: true } }; });
    await page.click('#mem-go');
    await page.evaluate(() => { PJ_CURRENT = 'elsewhere'; });
    await page.waitForTimeout(500);
    const m = await modal(page);
    const loose = await page.evaluate(() => Object.keys(FED_MSGS).length);
    check('B10b another project opened mid-Remove: the dialog closes, nothing is said, the old list is not asked again (control: B2 asks again)',
      !m.open && loose === 0 && (await getsK()) === before, JSON.stringify({ open: m.open, loose, before, after: await getsK() }));
    await page.evaluate(() => { window.__answerDelay = 0; PJ_CURRENT = 'k'; });
    // B10c: an unchecked answer is asked again after 30 s; a checked one is not.
    const ask = async (ans) => {
      await page.evaluate((a) => { window.__members = a; }, ans);
      await page.evaluate(() => fedMembersLoad('k'));
      const n0 = await gets(page);
      await page.evaluate(() => fedGateMembers(true));
      const soon = (await gets(page)) - n0;
      await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 31000; fedGateMembers(true); Date.now = real; });
      await page.waitForTimeout(150);
      return { soon, later: (await gets(page)) - n0 - soon };
    };
    const unchecked = await ask(answer([LEE], { checked_at: null }));
    const checked = await ask(answer([LEE]));
    check('B10c unchecked: not asked again at once, asked again after 30 s (control: a checked answer is not)',
      unchecked.soon === 0 && unchecked.later === 1 && checked.soon === 0 && checked.later === 0, JSON.stringify({ unchecked, checked }));
    await ctx.close();
  }

  /* B7: Make a new code. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'tabs');
    await act(page, 'i:inv-old');
    const sheet = await page.evaluate(() => ({
      open: !document.getElementById('fedinv-modal').hidden,
      label: document.getElementById('fedinv-label').value,
      agent: document.getElementById('fedinv-kind-agent').checked,
      asking: !document.getElementById('fedinv-ask').hidden,
      focus: document.activeElement && document.activeElement.id,
    }));
    check('B7 "Make a new code" opens the invite sheet with the label and kind filled in, focus on Make',
      sheet.open && sheet.asking && sheet.label === 'Old Friend' && sheet.agent && sheet.focus === 'fedinv-make', JSON.stringify(sheet));
    const before = await gets(page);
    await page.evaluate(() => { window.__posts.length = 0; });
    await setMembers(page, answer([row({ invite_id: 'inv-new', label: 'Old Friend', kind: 'agent', made_at: D(OCT, 4), expires_at: D(OCT, 11) })].concat(ALL)));
    await page.click('#fedinv-make');
    await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(150);
    const posts = await page.evaluate(() => window.__posts.slice());
    const f = await readFed(page, '#pj-fed-outside');
    check('B7 the new code is made for the same label and kind', posts.length === 1 && posts[0].body.label === 'Old Friend'
      && posts[0].body.invited_kind === 'agent' && posts[0].body.project === 'k', JSON.stringify(posts));
    check('B7 the list is asked again, and the expired row goes once a pending one has its label',
      (await gets(page)) > before && f.rows.some((r) => r.key === 'i:inv-new' && r.sub === 'Invited · until Oct 11') && !f.rows.some((r) => r.key === 'i:inv-old'),
      JSON.stringify(f.rows.map((r) => r.key + ' ' + r.sub)));
    await ctx.close();
  }

  /* B8: gate not "show". */
  {
    const { ctx, page } = await newPage(1280, OFF);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'tabs');
    const f = await readFed(page, '#pj-fed-outside');
    const asked = await gets(page);
    check('B8 gate not "show": the members route is never asked and nothing is drawn',
      asked === 0 && f.rows.length === 0 && f.heads.length === 0 && f.display === 'none', JSON.stringify({ asked, f }));
    await ctx.close();
  }

  /* B9: consolidated. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'consolidated');
    const f = await readFed(page, '#alist-fed-outside');
    const order = await page.evaluate(() => {
      const kids = [...document.getElementById('alist').children];
      return { fed: kids.findIndex((k) => k.id === 'alist-fed-outside'), hdr: kids.findIndex((k) => k.classList && k.classList.contains('alist-grouphdr')) };
    });
    check('B9 consolidated: the same rows in the rail, under the project\'s members and above "Other Agents"',
      rowsAre(f.rows, EXPECT) && f.heads.length === 1 && order.fed >= 0 && order.fed === order.hdr - 1, JSON.stringify({ order, rows: f.rows }));
    await setMembers(page, answer([]));
    await page.evaluate(() => fedMembersLoad('k'));
    await page.waitForTimeout(150);
    const gone = await page.evaluate(() => !document.getElementById('alist-fed-outside'));
    check('B9 control: an empty answer adds nothing to the rail', gone === true, 'absent=' + gone);
    await ctx.close();
  }

  /* B15: consolidated, a board with no agents of its own. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; window.__agents = []; }, answer([DANA, LEE]));
    await openProjectIn(page, 'consolidated');
    const f = await readFed(page, '#alist-fed-outside');
    check('B15 no agents on the board: the rail still lists the people from outside (control: B9 with agents)',
      f.exists && f.rows.length === 2 && f.rows.some((r) => r.act === 'Remove') && f.rows.some((r) => r.act === 'Withdraw'), JSON.stringify(f));
    await ctx.close();
  }

  /* B13 and B14: the shared dialog for a local remove after an outside one, and focus plus the announcer. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'tabs');
    await act(page, 'e:edge-dana');
    await page.evaluate(() => { window.__remove = { status: 502, body: { error: 'The connection service refused just now.' } }; });
    await page.click('#mem-go');
    await page.waitForTimeout(200);
    const left = await modal(page);
    await page.click('#mem-keep');
    await page.click('#pj-one-agents .pj-minus[data-drop="ada"]');
    await page.waitForTimeout(100);
    const local = await modal(page);
    const goLive = await page.evaluate(() => !document.getElementById('mem-go').disabled);
    check('B13 a local minus after a cancelled outside 502: no danger look, no stale message, a live button (control: the 502 state before)',
      left.open && left.danger && left.msg !== '' && local.open && !local.danger && local.msg === '' && goLive, JSON.stringify({ left, local, goLive }));
    await page.click('#mem-keep');
    const liveBefore = await page.evaluate(() => { const e = document.getElementById('fed-live'); return e ? e.textContent : ''; });
    await page.evaluate((e) => { window.__withdraw = { status: 409, body: { reason: 'unsupported', error: e } }; }, UNSUPPORTED);
    await act(page, 'i:inv-lee');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      focused: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fedKey || document.activeElement.tagName : null,
      live: (document.getElementById('fed-live') || {}).textContent || '' }));
    check('B14 a Withdraw refusal: focus stays on that row\'s Withdraw and the sentence is said in #fed-live (control: empty before)',
      liveBefore === '' && after.focused === 'i:inv-lee' && /lapses on Oct 11/.test(after.live), JSON.stringify({ liveBefore, after }));
    await ctx.close();
  }

  /* B12: the gate reaching "show" with a project already open, through fedGateStamp itself. */
  {
    const { ctx, page } = await newPage(1280, OFF);
    await page.evaluate((a) => { window.__members = a; }, answer([LEE]));
    await openProjectIn(page, 'tabs');
    const asksK = () => page.evaluate(() => window.__memberUrls.filter((u) => /project=k(&|$)/.test(u)).length);
    const off = await asksK();
    await page.evaluate((d) => fedGateStamp(d), SHOW);
    await page.waitForTimeout(250);
    const on = await asksK();
    let f = await readFed(page, '#pj-fed-outside');
    const shownRows = f.rows.length;
    await page.evaluate((d) => fedGateStamp(d), OFF);
    await page.waitForTimeout(100);
    f = await readFed(page, '#pj-fed-outside');
    const hidden = f.display === 'none';
    // Back to show with a fresh answer: no new ask, but the section is drawn again at once.
    await page.evaluate((d) => fedGateStamp(d), SHOW);
    await page.waitForTimeout(100);
    const again = await asksK();
    f = await readFed(page, '#pj-fed-outside');
    check('B12 gate off: nothing asked; the stamp to show asks once and draws Lee; off hides it; show again redraws it without a new ask (control: B8)',
      off === 0 && on === 1 && shownRows === 1 && hidden && again === 1 && f.rows.length === 1 && f.display !== 'none',
      JSON.stringify({ off, on, shownRows, hidden, again, rows: f.rows.length, display: f.display }));
    await ctx.close();
  }

  /* B11: a click in the consolidated rail, and the gate leaving "show" under an open outside Remove. */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await page.evaluate((a) => { window.__members = a; }, answer(ALL));
    await openProjectIn(page, 'consolidated');
    await page.evaluate(() => { window.__withdraws.length = 0; window.__withdraw = { status: 409, body: { error: 'Kosmos cannot withdraw a code yet. This one stops working on its own when it lapses.', reason: 'unsupported' } }; });
    await page.click('#alist-fed-outside .fedout-row[data-fed-key="i:inv-lee"] .fedout-act');
    await page.waitForTimeout(250);
    const sent = await page.evaluate(() => window.__withdraws.slice());
    const f = await readFed(page, '#alist-fed-outside');
    check('B11a rail: Withdraw asks the board for Lee and says the lapse sentence in the rail (control: B4 in the tab layout)',
      sent.length === 1 && sent[0].body && sent[0].body.invite_id === 'inv-lee' && f.msgs.some((t) => /lapses on Oct 11/.test(t)) && f.rows.some((r) => r.key === 'i:inv-lee'),
      JSON.stringify({ sent, msgs: f.msgs }));
    await page.click('#alist-fed-outside .fedout-row[data-fed-key="e:edge-dana"] .fedout-act');
    await page.waitForTimeout(100);
    const openBefore = (await modal(page)).open;
    await page.evaluate((d) => fedGateStamp(d), OFF);   // the real gate path, not fedGateMembers directly
    await page.waitForTimeout(100);
    const openAfter = (await modal(page)).open;
    check('B11b the gate leaving "show" closes an open outside Remove (control: open just before)', openBefore === true && openAfter === false,
      JSON.stringify({ openBefore, openAfter }));
    await ctx.close();
  }

  /* ---------------- slice C: "Copy the invitation" (shot 03 button and line, shot 04 text) ---------------- */
  {
    const ADDR = 'maya.kosmosplus.com';
    const invitation = (who) => who + ' invited you to the project "Spring launch" on Kosmos.\n'
      + '\n'
      + '1. Open Kosmos on your computer. If you do not have it yet, get it at installkosmos.com and sign in to Kosmos+.\n'
      + '2. Go to Projects, press + Add Project, then Join an external project.\n'
      + '3. Paste this code and press Verify:\n'
      + '\n'
      + CODE + '\n'
      + '\n'
      + 'The code works once, until Sunday, October 11.';
    /* Set the "You" name and the owner's members answer (owner_name: the ACCOUNT's name, Kitty's follow-up), then let
       the page's own loaders read them. The address is never this computer's own (a second computer, or a retired
       first one, has an address that is not the account's name). */
    const owner = (page, name, ownerName) => page.evaluate(async (o) => {
      window.__you = { name: o.name };
      window.__members = { status: 200, body: Object.assign({ owner: true, sealed: false, invites: [], checked_at: 1791115200 },
        o.ownerName === null ? {} : { owner_name: o.ownerName }) };
      await refreshYouName();
      await fedMembersLoad('k');
      return { you: YOU_NAME, ownerName: (FED_MEMBERS && FED_MEMBERS.body && FED_MEMBERS.body.owner_name) || '' };
    }, { name, ownerName });
    const step = (page) => page.evaluate(() => {
      const all = document.getElementById('fedinv-copy-all');
      const acts = all ? [...all.parentElement.querySelectorAll('button')].map((b) => b.id) : [];
      return {
        until: document.getElementById('fedinv-until').textContent,
        easier: (document.getElementById('fedinv-easier') || {}).textContent || null,
        allText: all ? all.textContent : null, allPrime: !!all && all.classList.contains('uprime'),
        allShown: !!all && all.getClientRects().length > 0, acts,
        copyText: document.getElementById('fedinv-copy').textContent,
        status: document.getElementById('fedinv-status').textContent,
        open: !document.getElementById('fedinv-modal').hidden,
        copied: window.__copied.slice(), unhandled: window.__unhandled.slice(),
      };
    });
    const makeCode = async (page, label) => {
      await page.click('#pj-add-member');
      await page.click('#pj-addmenu-outside');
      await page.fill('#fedinv-label', label);
      await page.click('#fedinv-make');
      await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    };
    const copyAll = async (page) => { await page.click('#fedinv-copy-all'); await page.waitForTimeout(100); };

    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    let o = await owner(page, 'Maya Chen', 'maya');
    check('C setup: the page read the "You" name and the account name (owner_name) through its own loaders',
      o.you === 'Maya Chen' && o.ownerName === 'maya', JSON.stringify(o));
    await makeCode(page, 'Dana Ruiz');
    let st = await step(page);
    check('C0 the code step reads as shot 03: the withdraw line names Dana',
      st.until === 'It works once, until Sunday, October 11. You can withdraw it from Members until Dana joins.', st.until);
    check('C0 the Easier box names Dana',
      st.easier === 'Easier: copy the whole invitation. It has the code and the three steps Dana needs, ready to paste into an email or a text.', st.easier);
    check('C0 "Copy the invitation" is the primary button, after Done, and the bare Copy stays',
      st.allText === 'Copy the invitation' && st.allPrime && st.allShown && st.acts.join(',') === 'fedinv-ok,fedinv-copy-all' && st.copyText === 'Copy',
      JSON.stringify({ allText: st.allText, prime: st.allPrime, shown: st.allShown, acts: st.acts, copy: st.copyText }));
    const c0focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check('C0 the code step puts focus on Copy the invitation, the primary', c0focus === 'fedinv-copy-all', 'focus=' + c0focus);

    // C1: the control first, on the same screen: the bare Copy writes only the code.
    await page.evaluate(() => { window.__copied.length = 0; });
    await page.click('#fedinv-copy');
    await page.waitForTimeout(100);
    st = await step(page);
    check('C1 control: the bare Copy writes only the code', st.copied.length === 1 && st.copied[0] === CODE, JSON.stringify(st.copied));
    await copyAll(page);
    st = await step(page);
    const c1 = st.copied[1];
    check('C1 Copy the invitation writes shot 04\'s text exactly, with the name and the address',
      st.copied.length === 2 && c1 === invitation('Maya Chen (' + ADDR + ')'), JSON.stringify(c1));
    check('C1 it says Copied, and the bare Copy is not left saying Copied', st.allText === 'Copied' && st.copyText === 'Copy' && st.status === 'Invitation copied.',
      JSON.stringify({ all: st.allText, copy: st.copyText, status: st.status }));
    await page.waitForTimeout(2300);
    st = await step(page);
    check('C1 the button reverts to "Copy the invitation"', st.allText === 'Copy the invitation' && st.status === '', JSON.stringify({ all: st.allText, status: st.status }));

    // C3: the step words, read out of the invitation that was just copied.
    const m2 = /^2\. Go to Projects, press (.+), then (.+)\.$/m.exec(c1 || '');
    const m3 = /^3\. Paste this code and press (.+):$/m.exec(c1 || '');
    const words = m2 && m3 ? [m2[1], m2[2], m3[1]] : null;
    check('C3 setup: the invitation names three step words', !!words && words.length === 3, JSON.stringify(words));

    // C2: no "You" name, then a name and no address, then neither. Each is read by the page's loaders again.
    const variant = async (name, ownerName) => {
      const got = await owner(page, name, ownerName);
      await page.evaluate(() => { window.__copied.length = 0; });
      await copyAll(page);
      const s2 = await step(page);
      return { got, text: s2.copied[0] };
    };
    let v = await variant('', 'maya');
    check('C2 no "You" name: "maya.kosmosplus.com invited you ...", the rest the same (control: C1 with the name)',
      v.got.you === '' && v.text === invitation(ADDR), JSON.stringify(v));
    /* No owner_name (a board before Kitty's follow-up): the name alone, never this computer's address. Control: C1
       with owner_name carries the address. */
    v = await variant('Maya Chen', null);
    check('C2 no owner_name: "Maya Chen invited you ...", with no address (control: C1 with owner_name)',
      v.got.ownerName === '' && v.text === invitation('Maya Chen'), JSON.stringify(v));
    /* This computer's own address is NEVER printed, even when the board knows it (a second computer's, or a retired
       first one's, is not the account's name). Planted here through the page's own loader; control: C1, where the
       account name (owner_name) is printed. */
    const planted = await page.evaluate(async () => {
      window.__computers = { ok: true, domain: 'kosmosplus.com', computers: [{ name: 'studio', address: 'maya-studio.kosmosplus.com', this: true, online: true }] };
      await computersFetch();   // the page's own loader; no typeof guard, so a rename fails here
      return THIS_COMPUTER_NAME;
    });
    v = await variant('Maya Chen', null);
    check('C2 this computer\'s own address, which the page has read, is not printed (control: C1 prints the account name)',
      planted === 'studio' && !String(v.text).includes('maya-studio') && v.text === invitation('Maya Chen'), JSON.stringify({ planted, v }));
    v = await variant('Maya Chen', 'Not A Handle!');
    check('C2 an owner_name that is not a Kosmos+ name is not printed', v.text === invitation('Maya Chen'), JSON.stringify(v));
    v = await variant('', null);
    check('C2 neither: "Someone invited you ..."', v.text === invitation('Someone'), JSON.stringify(v));

    // C4: the clipboard refuses AND the select-and-copy fallback fails. Restore the name and address first.
    await owner(page, 'Maya Chen', 'maya');
    await page.evaluate(() => {
      window.__copied.length = 0;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Write permission denied.'); } } });
      window.__execOk = false;   // the select-and-copy fails too
      FEDINV_CLIP_HOLDS = '';    // no earlier copy of this text on record (C2 left one), so the refusal is real
    });
    await copyAll(page);
    st = await step(page);
    // The keys are this computer's (Mona: Command C is wrong on Windows), read from the page's one helper.
    const keys = await page.evaluate(() => copyKeysWord());
    check('C4 the keys named are this platform\'s', keys === (ON_MAC ? 'Command C' : 'Ctrl C'), 'keys=' + keys);
    check('C4 a refused clipboard says so in the message line, keeps the button\'s words and the sheet, and throws nothing (control: C1 said Copied)',
      st.status === 'Kosmos could not copy the invitation. Select the code above and press ' + keys + ' to copy the code alone, then paste it into your message.'
      && st.allText === 'Copy the invitation' && st.open && st.copied.length === 0 && st.unhandled.length === 0,
      JSON.stringify({ status: st.status, all: st.allText, open: st.open, unhandled: st.unhandled }));
    await page.waitForTimeout(2300);
    st = await step(page);
    check('C4 the refusal stays on screen (no revert timer clears it)', st.status.startsWith('Kosmos could not copy the invitation.'), st.status);
    // C4b: the clipboard still refuses, but the select-and-copy fallback works: the same exact text, and Copied.
    await page.evaluate(() => { window.__execTexts.length = 0; window.__execOk = true; });
    await copyAll(page);
    st = await step(page);
    const exec = await page.evaluate(() => ({ texts: window.__execTexts.slice(), focus: document.activeElement && document.activeElement.id }));
    check('C4b select-and-copy (tried first) copies the exact invitation, says Copied, and focus is back on the button (control: C4, failing)',
      exec.texts.length === 1 && exec.texts[0] === invitation('Maya Chen (' + ADDR + ')') && st.allText === 'Copied'
      && st.status === 'Invitation copied.' && exec.focus === 'fedinv-copy-all',
      JSON.stringify({ exec, all: st.allText, status: st.status }));
    await page.evaluate(() => { window.__execOk = false; });
    await page.click('#fedinv-ok');

    // C3 continued: walk the page's own path to the join step, finding each word as a visible label.
    const find = (page, text) => page.evaluate((t) => {
      const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const norm = (el) => el.textContent.replace(/\s+/g, ' ').trim();
      const root = document.getElementById('panel-projects');
      const hit = root ? [...root.querySelectorAll('button, label, a')].find((el) => vis(el) && norm(el) === t) : null;
      document.querySelectorAll('[data-c3-hit]').forEach((el) => el.removeAttribute('data-c3-hit'));
      if (hit) hit.setAttribute('data-c3-hit', '1');
      return hit ? (hit.id || hit.tagName + ':' + (hit.querySelector('input') || {}).id) : null;
    }, text);
    const found = [];
    if (words) {
      await page.evaluate(() => { showTab('projects'); pjView('list'); });   // the Projects list, where step 2 starts
      await page.waitForTimeout(200);
      for (const w of words) {
        const hit = await find(page, w);
        found.push({ word: w, hit });
        if (!hit) break;
        if (found.length === 3) break;   // Verify is found as a label; not pressed (no side effect on the stub)
        await page.click('[data-c3-hit]');
        await page.waitForTimeout(200);
      }
    }
    check('C3 each step word is a visible label on the page\'s own path: Projects list, Add Project screen, join step',
      !!words && found.length === 3 && found.every((f) => f.hit), JSON.stringify(found));
    const none = await find(page, 'Join a shared project');
    check('C3 control: the same finder finds nothing for a phrase the page does not have', none === null, String(none));
    await ctx.close();

    /* C5: the helper names Ctrl C on a Windows page (Mona: Command C is wrong on Windows). Control: a Mac page
       (MacIntel) names Command C, whatever the runner is. C5b then checks a real refusal line renders it. */
    {
      const words = {};
      for (const plat of ['Win32', 'MacIntel']) {
        const pw = await newPage(1280, SHOW, plat);
        words[plat] = await pw.page.evaluate(() => ({ word: copyKeysWord(), glyph: copyKeysGlyph() }));
        await pw.ctx.close();
      }
      check('C5 Windows names Ctrl C and Ctrl+C; the Mac names Command C and \u2318C (control)',
        words.Win32.word === 'Ctrl C' && words.Win32.glyph === 'Ctrl+C' && words.MacIntel.word === 'Command C' && words.MacIntel.glyph === '\u2318C',
        JSON.stringify(words));
      // C5b: on a Windows page, the bare Copy's real refusal (clipboard and select-and-copy both failing) renders
      // Windows keys in its button and line, so the sheet's bare Copy going back to a hard-coded Command C fails here.
      // (pjCopyInvite and pjsOwnCopy use the same helper; C5 pins the helper, no arm renders their refusals.)
      const pw = await newPage(1280, SHOW, 'Win32');
      await openProjectIn(pw.page, 'tabs');
      await makeCode(pw.page, 'Dana Ruiz');
      await pw.page.evaluate(() => {
        window.__execOk = false;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
      });
      await pw.page.click('#fedinv-copy');
      await pw.page.waitForTimeout(100);
      const win = await step(pw.page);
      check('C5b a Windows page\'s bare Copy refusal says Ctrl+C and Ctrl C (control: C5\'s Mac page names Command C)',
        win.copyText === 'Press Ctrl+C to copy' && win.status === 'Kosmos could not copy it. Select the code and press Ctrl C.',
        JSON.stringify({ copy: win.copyText, status: win.status }));
      await pw.ctx.close();
    }

    /* C6: the clipboard that never answers. Select-and-copy fails, the clipboard is held: the line says nothing for the
       first 3 s, the bare Copy is ignored while it waits (one answer at a time), then the 3 s limit says it could not
       copy; when the held write finally lands, the line says Copied (plusCopyAddress's rule). */
    {
      const pc = await newPage(1280, SHOW);
      await openProjectIn(pc.page, 'tabs');
      await owner(pc.page, 'Maya Chen', 'maya');
      await makeCode(pc.page, 'Dana Ruiz');
      await pc.page.evaluate(() => {
        window.__execOk = false;
        window.__copied.length = 0;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (txt) => new Promise((ok) => { window.__releaseClip = () => { window.__copied.push(txt); ok(); }; }) } });
      });
      await pc.page.click('#fedinv-copy-all');
      await pc.page.waitForTimeout(300);
      const waiting = await step(pc.page);
      await pc.page.click('#fedinv-copy');   // ignored while Copy the invitation waits
      await pc.page.waitForTimeout(100);
      const bareWhileBusy = await step(pc.page);
      await pc.page.waitForTimeout(3200);   // ~600 ms past the 3 s limit, for a loaded runner
      const limit = await step(pc.page);
      await pc.page.evaluate(() => window.__releaseClip());
      await pc.page.waitForTimeout(150);
      const late = await step(pc.page);
      check('C6 a held clipboard: nothing said while it waits, the bare Copy ignored, the 3 s limit says it could not copy, a late write says Copied',
        waiting.status === '' && waiting.allText === 'Copy the invitation'
        && bareWhileBusy.status === 'One moment: Kosmos is still copying. Press again in a few seconds.' && bareWhileBusy.copyText === 'Copy'
        && limit.status.startsWith('Kosmos could not copy the invitation.')
        && late.status === 'Invitation copied.' && late.allText === 'Copied' && late.copied.length === 1 && late.copied[0] === invitation('Maya Chen (' + ADDR + ')'),
        JSON.stringify({ waiting: waiting.status, bare: [bareWhileBusy.status, bareWhileBusy.copyText], limit: limit.status, late: [late.status, late.allText, late.copied.length] }));
      await pc.ctx.close();
    }

    /* C7: the cross-button case. The invitation's clipboard is held past the 3 s limit (refusal shown), then the bare
       Copy succeeds by select-and-copy ("Code copied."), then the held invitation write lands and replaces the code.
       The line must say what the clipboard now holds, not leave "Code copied." standing. Control: C6, the same late
       write with no newer press, says "Invitation copied.". */
    {
      const p7 = await newPage(1280, SHOW);
      await openProjectIn(p7.page, 'tabs');
      await makeCode(p7.page, 'Dana Ruiz');
      await p7.page.evaluate(() => {
        window.__execOk = false;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (txt) => new Promise((ok) => { window.__releaseClip = () => ok(); }) } });
      });
      await p7.page.click('#fedinv-copy-all');
      await p7.page.waitForTimeout(3600);   // ~600 ms past the limit: the refusal is up and the busy flag is free
      await p7.page.evaluate(() => { window.__execOk = true; });
      await p7.page.click('#fedinv-copy');
      await p7.page.waitForTimeout(100);
      const newer = await step(p7.page);
      await p7.page.evaluate(() => window.__releaseClip());
      await p7.page.waitForTimeout(150);
      const after = await step(p7.page);
      check('C7 a held write that lands after a newer copy says the clipboard now holds the invitation (control: C6 without a newer press)',
        newer.status === 'Code copied.'
        && after.status === 'An earlier copy finished late, so the clipboard now holds the invitation. Press Copy to copy the code alone.',
        JSON.stringify({ newer: newer.status, after: after.status }));
      // C7b: the same button twice (same text): the stale write changes nothing, so the newer "Copied" stands.
      await p7.page.evaluate(() => {
        FEDINV_CLIP_HOLDS = '';   // C7's late write recorded the invitation; each arm starts with no copy on record
        window.__execOk = false;
        window.__holds = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise((ok) => { window.__holds.push(ok); }) } });
      });
      await p7.page.click('#fedinv-copy-all');
      await p7.page.waitForTimeout(3600);
      await p7.page.click('#fedinv-copy-all');
      await p7.page.waitForTimeout(100);
      await p7.page.evaluate(() => window.__holds[1]());   // the newer press lands first
      await p7.page.waitForTimeout(150);
      await p7.page.evaluate(() => window.__holds[0]());   // then the stale one, same text
      await p7.page.waitForTimeout(150);
      const same = await step(p7.page);
      check('C7b a stale write of the same text leaves the newer "Invitation copied." standing (control: C7 with the other button)',
        same.status === 'Invitation copied.', JSON.stringify({ status: same.status }));
      // C7c: the same button twice, BOTH refused (both held past the limit), then the stale write lands: it did copy
      // the invitation, so the refusal gives way to "Invitation copied." (control: C7b, where the newer press said so).
      await p7.page.evaluate(() => { window.__holds = []; FEDINV_CLIP_HOLDS = ''; });   // no copy on record: both presses refused
      await p7.page.click('#fedinv-copy-all');
      await p7.page.waitForTimeout(3600);
      await p7.page.click('#fedinv-copy-all');
      await p7.page.waitForTimeout(3600);
      const refused = await step(p7.page);
      await p7.page.evaluate(() => window.__holds[0]());   // the stale write, same text, lands
      await p7.page.waitForTimeout(150);
      const landed = await step(p7.page);
      check('C7c a stale same-text write after a refused newer press says "Invitation copied."',
        refused.status.startsWith('Kosmos could not copy the invitation.') && landed.status === 'Invitation copied.',
        JSON.stringify({ refused: refused.status, landed: landed.status }));
      await p7.ctx.close();
    }

    /* C8: the sheet's type (Mona's NIT 4): title size equals the add-agent dialog's .rm-title; fields have no hairline. */
    {
      const p8 = await newPage(1280, SHOW);
      await openProjectIn(p8.page, 'tabs');
      await p8.page.click('#pj-add-member');
      await p8.page.click('#pj-addmenu-outside');
      const css = await p8.page.evaluate(() => {
        const px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
        const ref = document.querySelector('#am-modal .rm-title');
        const fields = [...document.querySelectorAll('#fedinv-modal .field')].map((f) => getComputedStyle(f).borderTopWidth);
        const outside = [...document.querySelectorAll('.field')].find((f) => !f.closest('#fedinv-modal') && parseFloat(getComputedStyle(f).borderTopWidth) > 0);
        return { title: px(document.getElementById('fedinv-t')), ref: px(ref), fields, outside: !!outside };
      });
      check('C8 the sheet title is the size of the add-agent dialog\'s .rm-title, and its fields carry no hairline (control: a .field elsewhere does)',
        css.ref !== null && css.title === css.ref && css.fields.length > 0 && css.fields.every((w) => parseFloat(w) === 0) && css.outside,
        JSON.stringify(css));
      await p8.ctx.close();
    }

    /* C9: the clipboard-holds record through its REAL listeners, and a write that lands after the sheet was reopened.
       (a) an in-time clipboard write, then a refused press of the same text: Copied (the record);
       (b) the same with a window blur in between: refused (control for a); (c) with a copy event in between: refused;
       (d) a held write from a closed sheet lands while a new code is on screen: the line says so. */
    {
      const p9 = await newPage(1280, SHOW);
      await openProjectIn(p9.page, 'tabs');
      await makeCode(p9.page, 'Dana Ruiz');
      const setClip = (page, mode) => page.evaluate((m) => {
        window.__execOk = false;
        const w = m === 'ok' ? async () => {} : m === 'no' ? async () => { throw new Error('denied'); } : () => new Promise((ok) => { window.__releaseClip = ok; });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: w } });
      }, mode);
      const press = async (page) => { await page.click('#fedinv-copy-all'); await page.waitForTimeout(120); return (await step(page)).status; };
      const run = async (between) => {
        await p9.page.evaluate(() => { FEDINV_CLIP_HOLDS = ''; });
        await setClip(p9.page, 'ok');
        await press(p9.page);
        await p9.page.waitForTimeout(2100);   // past the Copied revert
        if (between === 'blur') await p9.page.evaluate(() => window.dispatchEvent(new Event('blur')));
        if (between === 'copy') await p9.page.evaluate(() => document.dispatchEvent(new Event('copy')));
        await setClip(p9.page, 'no');
        return press(p9.page);
      };
      const a = await run(null), b = await run('blur'), cc = await run('copy');
      check('C9 a refused press after an in-time copy of the same text says Copied; after a blur or a copy event it is refused (controls)',
        a === 'Invitation copied.' && b.startsWith('Kosmos could not copy the invitation.') && cc.startsWith('Kosmos could not copy the invitation.'),
        JSON.stringify({ a, b, cc }));
      // (d): hold a write, close the sheet, make a new code, then let the old write land.
      await setClip(p9.page, 'hold');
      await p9.page.click('#fedinv-copy-all');
      await p9.page.waitForTimeout(100);
      await p9.page.click('#fedinv-ok');
      await makeCode(p9.page, 'Lee Park');
      await p9.page.evaluate(() => window.__releaseClip());
      await p9.page.waitForTimeout(150);
      const d = (await step(p9.page)).status;
      check('C9 a held write from a closed sheet that lands under a new code says the clipboard holds that one (control: the same sheet path, C6)',
        d === 'A copy from an earlier invitation finished late, so the clipboard now holds that one. Press Copy or Copy the invitation again for this code.', d);
      await p9.ctx.close();
    }

    // C0 with a label that is not a name: they/their, never "my's".
    const p2 = await newPage(1280, SHOW);
    await openProjectIn(p2.page, 'tabs');
    await makeCode(p2.page, 'my sister');
    st = await step(p2.page);
    check('C0 a label that is not a name: "until they join" and "the three steps they need" (control: the Dana lines)',
      st.until === 'It works once, until Sunday, October 11. You can withdraw it from Members until they join.'
      && st.easier === 'Easier: copy the whole invitation. It has the code and the three steps they need, ready to paste into an email or a text.',
      JSON.stringify({ until: st.until, easier: st.easier }));
    await p2.ctx.close();
  }

  await browser.close();
  if (problems.length) {
    console.log('render-federation-invite-4649: ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log('render-federation-invite-4649: all arms passed.');
})().catch((err) => { console.error('FAIL  render-federation-invite-4649: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
