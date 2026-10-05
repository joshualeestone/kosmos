// Browser-check-surface: pj-addmenu pj-addmenu-agent pj-addmenu-agent-sub pj-addmenu-outside fedinv-modal fedinv-label fedinv-kind-agent fedinv-make fedinv-msg fedinv-josh fedinv-code fedinv-copy fedinv-until fedinv-ok pjAddPlus fedInviteMake
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
 *  A7  the review's guards: Enter while a Make is answered sends nothing more, Enter while composing sends nothing;
 *      a scroll keeps the menu, Tab returns to its +; a code survives a passing signup reading, closes on off.
 *  A8  the sheet's ways out (backdrop and Escape on each step) and its Tab trap.
 *  A9  the sheet does not close while Make is answered, and shows the minted code.
 *  A12 the abort landing during the body read (headers in, body stalled) gives the same message.
 *  A11 a Make past its limit (shortened by the arm) says a code may still have been made; Make is live again.
 *  A10 a forced close mid-Make (federation off) does not leave the reopened sheet refusing to close; the menu
 *      closes when its project is switched.
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
  window.__inviteDelay = 0;
  window.__inviteBodyStall = false;
  window.__copied = [];
  window.__invite = { status: 200, body: { code: cfg.code, expires_at: cfg.expires, invite_id: 'inv-1' } };
  window.__project = { id: 'k', name: 'Spring launch', parent: null, archived: false, description: '',
    agents: [{ sessionName: 'ada' }, { sessionName: 'basil' }], summary: {}, unread: 0 };
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
      // A7a holds one in flight; like a real fetch, an aborted signal rejects it with an AbortError (A11).
      if (window.__inviteDelay) {
        await new Promise((r, no) => {
          const t = setTimeout(r, window.__inviteDelay);
          const sig = opts && opts.signal;
          if (sig) sig.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; no(e); });
        });
      }
      // A12: the headers arrive, the body stalls, and (like a real fetch) the abort errors the body stream.
      if (window.__inviteBodyStall) {
        const sig = opts && opts.signal;
        const stream = new ReadableStream({ start(c) { if (sig) sig.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; c.error(e); }); } });
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return enc(window.__invite.status, window.__invite.body);
    }
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
  const newPage = async (width, fed) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'UTC', locale: 'en-US' });
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
    check('A5 "It works once, until Sunday, October 11." from expires_at', done.until === 'It works once, until Sunday, October 11.', done.until);
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
    const railGeo = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right) }; };
      return { rail: r(document.getElementById('rail-agents')), plus: r(document.getElementById('rail-agents-new')) };
    });
    check('A2 consolidated: the menu sits inside the rail with its right edge on the rail "+" (Q-M4)',
      !!s.menuBox && Math.abs(s.menuBox.r - railGeo.plus.r) <= 2 && s.menuBox.l >= railGeo.rail.l - 1 && s.menuBox.r <= railGeo.rail.r + 1,
      JSON.stringify({ menu: s.menuBox, railGeo }));
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
    const pcard = await page.$eval('.pjcard-members', (c) => { const b = c.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right) }; });
    check('A6 393 wide: the menu takes the card\'s full width under its head (Q-M4 phone rule; 16 px gutters)',
      !!s.menuBox && Math.abs(s.menuBox.l - Math.max(16, pcard.l)) <= 1 && Math.abs(s.menuBox.r - Math.min(s.vw - 16, pcard.r)) <= 1,
      JSON.stringify({ menu: s.menuBox, card: pcard, vw: s.vw }));
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

  /* ---------------- A7: the review round's guards (Enter, IME, scroll, Tab, a passing gate) ---------------- */
  {
    const SIGNUP = { sourceChannel: 'prod', federationLive: true, kosmos_plus: false };
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    // A7d: a scroll re-places the open menu instead of closing it; Tab closes it back to its "+".
    await page.click('#pj-add-member');
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    let s = await read(page);
    const afterScroll = s.menuBox !== null;
    await page.keyboard.press('Tab');
    s = await read(page);
    check('A7d a scroll keeps the menu open (control: Tab then closes it) and Tab returns focus to the "+"',
      afterScroll && s.menuBox === null && s.focus === 'pj-add-member', JSON.stringify({ afterScroll, menu: s.menuBox, focus: s.focus }));
    // A7a/b: Enter while a request is in flight sends nothing more; Enter while composing sends nothing.
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.evaluate(() => {
      window.__posts.length = 0;
      document.getElementById('fedinv-label').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    });
    const composing = await page.evaluate(() => window.__posts.length);
    await page.evaluate(() => { window.__inviteDelay = 400; });
    await page.focus('#fedinv-label');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    const sent = await page.evaluate(() => window.__posts.length);
    await page.evaluate(() => { window.__inviteDelay = 0; });
    check('A7a/b Enter three times while one request is asked sends ONE invite; Enter while composing sends none (control: the first Enter sends)',
      composing === 0 && sent === 1, JSON.stringify({ composing, sent }));
    // A7c: a passing "signup" reading keeps a code already on screen; federation turning off closes it.
    await page.evaluate((d) => fedGateStamp(d), SIGNUP);
    await page.waitForTimeout(100);
    s = await read(page);
    const keptOnSignup = s.invBox !== null;
    await page.evaluate((d) => fedGateStamp(d), OFF);
    await page.waitForTimeout(100);
    s = await read(page);
    check('A7c a code on screen survives a passing signup reading, and closes when federation turns off (control)',
      keptOnSignup && s.invBox === null, JSON.stringify({ keptOnSignup, inv: s.invBox }));
    // A7c control: the ASKING step does close on a signup reading.
    await page.evaluate((d) => fedGateStamp(d), SHOW);
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.evaluate((d) => fedGateStamp(d), SIGNUP);
    await page.waitForTimeout(100);
    s = await read(page);
    check('A7c the asking step closes on a signup reading', s.invBox === null, JSON.stringify({ inv: s.invBox }));
    await ctx.close();
  }

  /* ---------------- A8: the sheet's ways out and its Tab trap ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    const openSheet = async () => { await page.click('#pj-add-member'); await page.click('#pj-addmenu-outside'); };
    const sheet = () => page.evaluate(() => !document.getElementById('fedinv-modal').hidden);
    // Asking step: the backdrop and Escape both close it.
    await openSheet();
    await page.mouse.click(5, 5);
    const askBackdrop = await sheet();
    await openSheet();
    await page.keyboard.press('Escape');
    const askEscape = await sheet();
    // Tab stays inside the sheet (aria-modal): ten presses each way, focus never leaves it.
    await openSheet();
    const trapped = [];
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      trapped.push(await page.evaluate(() => document.getElementById('fedinv-modal').contains(document.activeElement)));
    }
    // Code step: the backdrop keeps it (a code cannot be shown again); Escape, deliberate, closes it.
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.click('#fedinv-make');
    await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    await page.mouse.click(5, 5);
    const codeBackdrop = await sheet();
    await page.keyboard.press('Escape');
    const codeEscape = await sheet();
    check('A8 asking step: backdrop and Escape close it; code step: the backdrop keeps it, Escape closes it',
      askBackdrop === false && askEscape === false && codeBackdrop === true && codeEscape === false,
      JSON.stringify({ askBackdrop, askEscape, codeBackdrop, codeEscape }));
    check('A8 Tab and Shift+Tab stay inside the sheet (aria-modal)', trapped.length === 10 && trapped.every(Boolean), JSON.stringify(trapped));
    await ctx.close();
  }

  /* ---------------- A9: the sheet does not close while Make is being answered ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.evaluate(() => { window.__inviteDelay = 500; });
    await page.click('#fedinv-make');
    await page.keyboard.press('Escape');
    const during = await page.evaluate(() => ({ open: !document.getElementById('fedinv-modal').hidden,
      cancelOff: document.getElementById('fedinv-cancel').disabled, said: document.getElementById('fedinv-msg').textContent }));
    await page.waitForFunction(() => !document.getElementById('fedinv-done').hidden, { timeout: 3000 }).catch(() => {});
    const shown = await page.evaluate(() => ({ open: !document.getElementById('fedinv-modal').hidden, code: document.getElementById('fedinv-code').value }));
    await page.evaluate(() => { window.__inviteDelay = 0; });
    check('A9 while Make is answered: Escape is refused out loud, Cancel is disabled, the sheet stays, and the minted code is shown (control: A8, Escape closes an idle asking step)',
      during.open && during.cancelOff && during.said === 'One moment: Kosmos is making the code.' && shown.open && shown.code === CODE, JSON.stringify({ during, shown }));
    await ctx.close();
  }

  /* ---------------- A10: a forced close mid-Make, and a stale menu after a project switch ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.evaluate(() => { window.__inviteDelay = 500; });
    await page.click('#fedinv-make');
    await page.evaluate((d) => fedGateStamp(d), OFF);   // forced close while the Make is answered
    await page.waitForTimeout(700);
    await page.evaluate((d) => { window.__inviteDelay = 0; fedGateStamp(d); }, SHOW);
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => document.getElementById('fedinv-modal').hidden);
    // The menu, opened, then its project switched: the next stamp closes it.
    await page.click('#pj-add-member');
    const openBefore = await page.evaluate(() => !document.getElementById('pj-addmenu').hidden);
    await page.evaluate((d) => { PJ_CURRENT = 'elsewhere'; fedGateStamp(d); }, SHOW);
    const openAfter = await page.evaluate(() => !document.getElementById('pj-addmenu').hidden);
    await page.evaluate(() => { PJ_CURRENT = 'k'; });
    check('A10 after a forced close mid-Make the reopened sheet closes on Escape; a switched project closes the menu (control: open before)',
      closed === true && openBefore === true && openAfter === false, JSON.stringify({ closed, openBefore, openAfter }));
    await ctx.close();
  }

  /* ---------------- A11: Make's limit (shortened here) and its message ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.evaluate(() => { FEDINV_MAKE_LIMIT_MS = 300; window.__inviteDelay = 2000; });
    await page.click('#fedinv-make');
    await page.waitForTimeout(700);
    const timed = await page.evaluate(() => ({ msg: document.getElementById('fedinv-msg').textContent, make: !document.getElementById('fedinv-make').disabled,
      focus: document.activeElement && document.activeElement.id }));
    await page.evaluate(() => { FEDINV_MAKE_LIMIT_MS = 60000; window.__inviteDelay = 0; });
    check('A11 a Make past its limit says a code may still have been made, Make is live again and focus is on the label (control: A4 answers in time)',
      timed.msg === 'Kosmos did not hear back in time. A code may still have been made; if so, it stops working on its own when it lapses.'
      && timed.make && timed.focus === 'fedinv-label', JSON.stringify(timed));
    await ctx.close();
  }

  /* ---------------- A12: an abort while the body is being read (res.json() swallows it; the signal does not) ---------------- */
  {
    const { ctx, page } = await newPage(1280, SHOW);
    await openProjectIn(page, 'tabs');
    await page.click('#pj-add-member');
    await page.click('#pj-addmenu-outside');
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.evaluate(() => { FEDINV_MAKE_LIMIT_MS = 300; window.__inviteBodyStall = true; });
    await page.click('#fedinv-make');
    await page.waitForTimeout(700);
    const msg = await page.evaluate(() => document.getElementById('fedinv-msg').textContent);
    await page.evaluate(() => { FEDINV_MAKE_LIMIT_MS = 60000; window.__inviteBodyStall = false; });
    check('A12 an abort during the body read still says a code may have been made (control: A11, an abort before the headers)',
      msg === 'Kosmos did not hear back in time. A code may still have been made; if so, it stops working on its own when it lapses.', msg);
    await ctx.close();
  }

  await browser.close();
  if (problems.length) {
    console.log('render-federation-invite-4649: ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log('render-federation-invite-4649: all arms passed.');
})().catch((err) => { console.error('FAIL  render-federation-invite-4649: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
