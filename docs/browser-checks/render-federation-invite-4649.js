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
      if (window.__inviteDelay) await new Promise((r) => setTimeout(r, window.__inviteDelay));   // A7a holds one in flight
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

  await browser.close();
  if (problems.length) {
    console.log('render-federation-invite-4649: ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log('render-federation-invite-4649: all arms passed.');
})().catch((err) => { console.error('FAIL  render-federation-invite-4649: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
