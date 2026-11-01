// Browser-check-surface: plus-asks plus-ask-rows plus-asks-title askcard ask-rows plus-join plus-join-match askwait JOIN_WAIT_WORDS computersReadSoon
'use strict';
/* #6315: the coordinator names a joining computer's request computer:<its 32-hex id> (kosmos#4681). This check
   mocks the board's routes, so it proves the PAGE carries that id (data-id, the selector, the Allow body); the
   board's own handling is in engine/remote.joincode-4794.test.js. */
const PC_ID = 'computer:36b705ae542a7305ca8a368286c37161';
const PC2_ID = 'computer:40aa54e6686da825d85e6f0971e5ee74';
/**
 * The "wants to connect" sheet (#4637, Josh 09-29: "radically redesign... doesn't fit the branding"; Mona Lisa's flow
 * outline on #4754, Josh's go 09-30 17:34).
 *
 * What this pins, and why each line can fail:
 *  - another of the person's computers joining (#4773's joining_computer) reads "Your computer "windowsbox" wants to
 *    join", named once there (#6522: no "Type the code shown on" line; the field reads "Code"); a phone beside it (the CONTROL) keeps its
 *    own name and the device-in-your-hand line;
 *  - each sheet carries no Kosmos+ brand line (#6519: the Kosmos+ page already says it), the code (for a computer, the field for it) once as one large line read out a character at a time, then
 *    Allow and a quiet Not me (no Deny, no letter boxes);
 *  - Allow on the computer turns its sheet into "windowsbox is connected." with where to remove it;
 *  - on another page the notice says the sheet's words ("Your computer "windowsbox" wants to join." for one, "2 devices want
 *    to connect to your Kosmos." for a computer and a phone, #6388: "2 of your computers want to join." for two
 *    computers) with Review;
 *  - an Allow that fails leaves the request waiting (the heading stays, its sheet first); with nothing waiting the heading goes;
 *  - #6405: a computer's request (joining, or was a computer) shows no age and never fades, and turning it away keeps the
 *    password sentence (its first_seen is its first ask); CONTROL: a day-old phone still says when and fades;
 *  - #6404: the computer's sheet asks the person to type the code shown on windowsbox (this computer's own is never shown),
 *    a wrong one is answered on the sheet and sends nothing, the right one is sent as the tunnel wrote it;
 *  - #4794 slice 1 (superseded on the sheet by #6404): Allow sends the code (a
 *    phone's Allow sends none); with no code yet a quiet line says why (code_wait, Mona Lisa's words; an unknown value
 *    gets the default) and Allow is disabled; a refused code ("code_changed") is worded;
 *  - #4794: on the computer WAITING, #plus-join replaces the coordinator's sentence: working out, the code with "The
 *    codes match" (which posts that code), (#6314, #6404, #6522) "The codes match. If you have not yet, type this code on <name>, your
 *    other computer, and press Allow." with the code
 *    still large (it is typed there), ran out, too many tries;
 *  - 1400 and 390 wide, no sideways scroll, no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   HEADED=0 node docs/browser-checks/render-connect-sheet-4637.js
 */
require('./lib-sandbox-home.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-connect-sheet-4637: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const now = () => Math.floor(Date.now() / 1000);
/* The worst contrast of an element's text against every stop of its host's gradient (the sheet's or the notice's
   navy), WCAG relative luminance. The small new text on navy is measured, not assumed (review round 3). */
const WORST_CONTRAST = `(el) => {
  const nums = (v) => (v.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const host = el.closest('.askreq') || el.closest('#askcard');
  const stops = (getComputedStyle(host).backgroundImage.match(/rgba?\\([^)]*\\)/g) || []).map(nums);
  const fg = lum(nums(getComputedStyle(el).color));
  return stops.length ? Math.min(...stops.map((st) => { const b = lum(st); return (Math.max(fg, b) + 0.05) / (Math.min(fg, b) + 0.05); })) : 0;
}`;
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'hers.kosmosplus.com' } };

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const width of [1400, 390]) {
      const tag = `[${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      let pending = [
        { device_id: PC_ID, name: 'windowsbox', code: '482 915', first_seen: now() - 30, joining_computer: 'windowsbox' },
        { device_id: 'd-ph', name: 'iPhone', code: 'K7-4M', first_seen: now() - 90, joining_computer: null },
      ];
      let remoteNow = REMOTE;   // #4794: switched to waiting-allow for the joining arms
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? remoteNow : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: pending, email: 'you@example.com' })));
      let phoneFailsOnce = true;   // the phone's first Allow fails: its sheet must still read as waiting
      const allowBodies = {};      // #4794: what each Allow sent
      let codeChangedOnce = false; // #4794: set to refuse one computer Allow with code_changed
      await page.route('**/api/remote/devices/allow', (route, req) => {
        const sent = JSON.parse(req.postData() || '{}'); const id = sent.device_id; allowBodies[id] = sent;
        if (codeChangedOnce) { codeChangedOnce = false; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'code_changed' }) }); }
        if (id === 'd-ph' && phoneFailsOnce) { phoneFailsOnce = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the tunnel did not answer' }) }); }
        pending = pending.filter((d) => d.device_id !== id); return route.fulfill(json({ ok: true }));
      });
      const denyIds = [];          // #6404: every Not me sent (a click in the code field must never send one)
      await page.route('**/api/remote/devices/deny', (route, req) => { const id = JSON.parse(req.postData() || '{}').device_id; denyIds.push(id); pending = pending.filter((d) => d.device_id !== id); return route.fulfill(json({ ok: true })); });
      await page.route('**/api/remote/devices', (route) => route.fulfill(json({ on: true, allowed: [], pending })));
      let computerReads = 0;   // #6403: real reads of Your computers, beside the call spy below
      await page.route('**/api/remote/computers', (route) => { computerReads += 1; return route.fulfill(json({ ok: true, domain: 'kosmosplus.example', computers: [] })); });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

      /* On another page, one request: the notice says the sheet's own words. */
      const both = pending;
      pending = both.filter((d) => d.device_id === PC_ID);
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(300);
      const one = await page.evaluate(() => (document.getElementById('askcard').innerText || '').replace(/\s+/g, ' ').trim());
      chk(/Your computer "windowsbox" wants to join\./.test(one), `${tag} one computer waiting: the notice says "Your computer "windowsbox" wants to join."`, one);
      /* #6388: two of the person's computers and nothing else: computers, not devices (the computer-and-phone notice below is the control). */
      const pcRow = both.find((d) => d.device_id === PC_ID);
      pending = [pcRow, { ...pcRow, device_id: PC_ID + '-2', name: 'macmini', joining_computer: 'macmini' }];
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(300);
      const twoPc = await page.evaluate(() => (document.getElementById('askcard').innerText || '').replace(/\s+/g, ' ').trim());
      chk(/2 of your computers want to join\./.test(twoPc) && !/devices/.test(twoPc), `${tag} #6388: two computers waiting: "2 of your computers want to join."`, twoPc);
      pending = both;
      /* On another page: the compact notice, in the same words. */
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForTimeout(500);
      const note = await page.evaluate(() => {
        const c = document.getElementById('askcard');
        return { shown: !!(c && !c.hidden && c.getBoundingClientRect().height > 0), text: (c && c.innerText || '').replace(/\s+/g, ' ').trim(), review: !!(c && c.querySelector('[data-ask="open"]')) };
      });
      chk(note.shown && /2 devices want to connect to your Kosmos\./.test(note.text) && note.review && /kosmos\+/i.test(note.text), `${tag} on another page: a Kosmos+ notice with Review`, JSON.stringify(note));
      const noteContrast = await page.evaluate((fn) => { const w = eval(fn); const n = document.querySelector('#askcard .asknote');
        return n ? [...n.querySelectorAll(':scope > span')].map((e) => Math.round(w(e) * 100) / 100) : []; }, WORST_CONTRAST);   // #6315: the words, not the close button's glyph
      chk(noteContrast.length === 2 && noteContrast.every((r) => r >= 4.5), `${tag} the notice's words read on its navy (4.5:1)`, JSON.stringify(noteContrast));
      /* Review W2: the notice's edges line up with the banner under it (#conn). Fails if the banner is not shown. */
      const edges = await page.evaluate(() => {
        const a = document.getElementById('askcard').getBoundingClientRect(), c = document.getElementById('conn');
        const b = c && !c.hidden && c.getBoundingClientRect().height > 0 ? c.getBoundingClientRect() : null;
        return b ? { dl: Math.round(a.left - b.left), dr: Math.round(a.right - b.right) } : null;
      });
      chk(edges && Math.abs(edges.dl) <= 1 && Math.abs(edges.dr) <= 1, `${tag} the notice lines up with the banner under it`, JSON.stringify(edges));

      /* On Kosmos Plus: the sheets. */
      await page.evaluate(() => showTab('settings'));
      // First run can open after the early Escape; it must not sit over the Kosmos+ tab.
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.click('#s-nav button[data-go="plus"]');
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
      await page.waitForSelector('#plus-ask-rows .askreq', { timeout: 5000 }).catch(() => {});
      const sheets = await page.evaluate(() => [...document.querySelectorAll('#plus-ask-rows .askreq')].map((r) => {
        const code = r.querySelector('.askcodebig'), field = r.querySelector('.askcodein'), place = code || r.querySelector('.askcodetype');
        const acts = [...r.querySelectorAll('.acts button')].map((b) => b.textContent.trim());
        return { brand: (r.querySelector('.askbrand') || {}).textContent || '', head: (r.querySelector('.askwho b') || {}).textContent || '',
          say: (r.querySelector('.asksay') || {}).textContent || '', code: code ? code.textContent : '', label: code ? code.getAttribute('aria-label') : '',
          size: (code || field) ? parseFloat(getComputedStyle(code || field).fontSize) : 0, boxes: r.querySelectorAll('.devcode-cell').length,
          aboveActs: !!(place && place.nextElementSibling && place.nextElementSibling.classList.contains('acts')), acts,
          inside: !place || place.getBoundingClientRect().right <= r.getBoundingClientRect().right + 0.5,
          /* #6404: a computer's sheet asks for the code on the joining computer and never shows this one's own. */
          field: field ? { label: (r.querySelector('.askcodetype label') || {}).textContent || '', value: field.value, labelled: !!(field.labels && field.labels.length),
            /* #6522 review 1: what assistive tech reads with the field: the elements its aria-describedby names, in order. */
            described: (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => { const n = document.getElementById(id); return n ? n.textContent : '<missing ' + id + '>'; }) } : null,
          sayParagraphs: r.querySelectorAll('.asksay').length,
          ownCode: r.innerHTML.indexOf('482 915') > -1 || r.innerHTML.indexOf('4 8 2, 9 1 5') > -1,
          allowOff: ((a) => !!(a && (a.disabled || a.getAttribute('aria-disabled') === 'true')))(r.querySelector('[data-ask="allow"]')),
          /* The headline gets the sheet's width, not the icon's 40px column (a grid slip read one word per line). */
          headShare: (r.querySelector('.askwho') || r).getBoundingClientRect().width / r.getBoundingClientRect().width };
      }));
      /* Measured while the sheets are there (an empty list would pass every()). */
      // #6405: the phone's row carries its age; the computer's row has none (its first_seen is its first ask, not this one).
      const nowrap = await page.evaluate(() => { const t = [...document.querySelectorAll('#plus-ask-rows .askreq .askwho span')]; return t.length === 1 && t.every((e) => getComputedStyle(e).whiteSpace === 'nowrap'); });
      const contrast = await page.evaluate((fn) => { const w = eval(fn); const pick = (sel) => document.querySelector('#plus-ask-rows ' + sel);
        return Object.fromEntries([['time', '.askwho span'], ['notme', '.btn.quiet'], ['say', '.asksay'], ['codelabel', '.askcodetype label']].map(([k, sel]) => [k, pick(sel) ? Math.round(w(pick(sel)) * 100) / 100 : 0])); }, WORST_CONTRAST);
      chk(Object.values(contrast).every((r) => r >= 4.5), `${tag} the sheet's small text reads on the navy (4.5:1 against every stop of its gradient)`, JSON.stringify(contrast));
      /* kosmos#6314 (Josh 11:30): a NEW request scrolls the Kosmos+ section's requests into view; the same requests
         repainting never move the page again. Precondition first, so this cannot pass on a page too short to scroll. */
      const scroll = await page.evaluate(async () => {
        const p = document.getElementById('plus-asks');
        const inView = () => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };
        const down = () => { for (let n = p.parentElement; n; n = n.parentElement) { if (n.scrollHeight > n.clientHeight + 4) n.scrollTop = n.scrollHeight; } window.scrollTo(0, document.documentElement.scrollHeight); };
        const wait = () => new Promise((r) => setTimeout(r, 900));
        down(); await wait(); const hidden = !inView();
        ASK.shownKey = ''; paintAsk(); await wait(); const shown = inView();
        down(); await wait(); paintAsk(); await wait(); const stayed = !inView();
        return { hidden, shown, stayed };
      });
      if (!scroll.hidden && width > 600) console.log(`SKIP  ${tag} #6314 scroll: this page is too short at this width to scroll the requests away (the 390 arm proves it)`);
      else chk(scroll.hidden && scroll.shown && scroll.stayed, `${tag} #6314: a new request scrolls into view on Kosmos+, once (scrolled away first: off screen; new: on screen; same again: not moved)`, JSON.stringify(scroll));
      const pc = sheets.find((x) => /windowsbox/.test(x.head)) || {};
      const ph = sheets.find((x) => /iPhone/.test(x.head)) || {};
      chk(pc.head === 'Your computer "windowsbox" wants to join' && pc.say === '',   // #6522: named once, in the heading
        `${tag} a computer joining reads as one of your own computers`, JSON.stringify(pc));
      chk(ph.head === 'iPhone wants to connect to your Kosmos' && /Allow only if this code is showing on the device in your hand\./.test(ph.say) && !/signed it in/.test(ph.say),
        `${tag} CONTROL: a phone keeps its own name and the device-in-your-hand line`, JSON.stringify(ph));
      chk(sheets.length === 2 && sheets.every((x) => x.brand === '' && x.boxes === 0 && x.size >= 28 && x.aboveActs && x.inside && x.headShare >= 0.5 && JSON.stringify(x.acts) === JSON.stringify(['Allow', 'Not me'])),
        `${tag} each sheet: no Kosmos+ brand line (#6519), a headline across the sheet, the code once and large (no boxes), directly above Allow and Not me`, JSON.stringify(sheets));
      chk(ph.code === 'K7-4M' && ph.label === 'K 7, 4 M', `${tag} the code is read out a character at a time`, JSON.stringify([ph.code, ph.label]));
      chk(pc.field && pc.field.label === 'Code' && pc.field.labelled && pc.field.value === '' && !pc.code && !pc.ownCode && pc.allowOff,
        `${tag} #6404: a computer's sheet has one labelled field for the code on windowsbox, never shows (or speaks) this computer's code, and Allow waits`, JSON.stringify(pc));
      chk(!ph.field && !ph.allowOff, `${tag} #6404 CONTROL: a phone's sheet has no field and Allow is ready`, JSON.stringify(ph));
      /* #6522 review 1: the name is on screen once, in the heading, and the field is described by that heading; an empty
         line renders no paragraph. The phone's sheet (the CONTROL) keeps its line. */
      chk(pc.field && pc.field.described.length === 1 && /windowsbox/.test(pc.field.described[0]) && pc.sayParagraphs === 0 && ph.sayParagraphs === 1,
        `${tag} #6522: the code field is described by the heading that names windowsbox, and an empty line renders no paragraph`, JSON.stringify({ pc: pc.field, pcSay: pc.sayParagraphs, phSay: ph.sayParagraphs }));
      /* #6404 review 1: clicking the field's label, then the field, as a person would, sends nothing and turns nobody away. */
      await page.click('label[for="askcode-' + PC_ID + '"]');
      await page.click('[id="askcode-' + PC_ID + '"]');
      await page.waitForTimeout(300);
      const clicked = await page.evaluate((id) => ({ focused: document.activeElement === document.getElementById('askcode-' + id),
        still: !!document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="' + id + '"]') }), PC_ID);
      chk(clicked.focused && clicked.still && denyIds.length === 0 && !allowBodies[PC_ID],
        `${tag} #6404: clicking the label and the field puts the person in it and sends nothing (no Not me, no Allow)`, JSON.stringify({ clicked, denyIds }));
      /* #6404: typed digits survive a repaint, with focus and the place kept; Allow wakes only at six digits. */
      await page.keyboard.type('48');
      const partial = await page.evaluate((id) => { for (const rid of ['ask-rows', 'plus-ask-rows']) { const el = document.getElementById(rid); if (el) el.__lastLive = null; }
        paintAsk(); const f = document.getElementById('askcode-' + id), a = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="' + id + '"]');
        return { value: f && f.value, focused: document.activeElement === f, caret: f && f.selectionStart, allowOff: !!(a && (a.disabled || a.getAttribute('aria-disabled') === 'true')) }; }, PC_ID);
      chk(partial.value === '48' && partial.focused && partial.caret === 2 && partial.allowOff,
        `${tag} #6404: two digits typed survive a repaint (value, focus, place) and Allow still waits`, JSON.stringify(partial));
      const inMarkup = await page.evaluate((id) => { const f = document.getElementById('askcode-' + id); return !f || f.hasAttribute('value'); }, PC_ID);
      /* #6404 review 5: short of six digits Allow stays reachable: Tab from the field lands on Allow (never Not me), and a
         press says what is missing and sends nothing. */
      await page.keyboard.press('Tab');
      const tabTo = await page.evaluate(() => (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.ask) || '');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Type the six digits/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const shortSaid = await page.evaluate(() => /Type the six digits shown on windowsbox, then press Allow\./.test(document.getElementById('plus-ask-rows').innerText));
      chk(tabTo === 'allow' && shortSaid && !allowBodies[PC_ID] && denyIds.length === 0,
        `${tag} #6404: with two digits, Tab lands on Allow (not Not me) and pressing it says to type all six; nothing sent`, JSON.stringify({ tabTo, shortSaid, denyIds }));
      chk(!inMarkup, `${tag} #6404: the page never writes what is typed as the field's value attribute (the digits are put back after a rebuild)`);
      /* A wrong code: Allow wakes at six digits, but pressing it is answered here and nothing reaches the tunnel. */
      await page.click('[id="askcode-' + PC_ID + '"]', { clickCount: 3 });
      await page.keyboard.type('111 111');
      const wrongOn = await page.evaluate((id) => { const a = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="' + id + '"]'); return !a.disabled && a.getAttribute('aria-disabled') !== 'true'; }, PC_ID);
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="' + PC_ID + '"]');
      await page.waitForFunction(() => /That is not the code/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      /* aria-describedby is a LIST of ids (#6522 review 1: the heading, then the error line), so each one is resolved. */
      const wrong = await page.evaluate((id) => { const f = document.getElementById('askcode-' + id);
        const said = f ? (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((n) => document.getElementById(n)).filter(Boolean) : [];
        return { text: (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '), focused: document.activeElement === f,
          invalid: f && f.getAttribute('aria-invalid'), describedBy: said.map((n) => n.textContent).join(' ') }; }, PC_ID);
      chk(wrongOn && /That is not the code windowsbox shows\. Check it on windowsbox and type it again\./.test(wrong.text) && !allowBodies[PC_ID] && denyIds.length === 0 && wrong.focused
        && wrong.invalid === 'true' && /That is not the code/.test(wrong.describedBy),
        `${tag} #6404: a wrong code is answered on the sheet (the field is marked invalid and described by it), sends nothing, and puts the person back in the field`, JSON.stringify({ wrongOn, wrong, sent: allowBodies[PC_ID], denyIds }));
      /* The right digits, typed without the space: Allow sends the code as the tunnel wrote it. */
      await page.click('[id="askcode-' + PC_ID + '"]', { clickCount: 3 });
      await page.keyboard.type('482915');
      chk(await page.evaluate(() => document.getElementById('plus-asks-title').textContent) === 'Waiting for you', `${tag} the section says Waiting for you, not the old wording`);

      /* #6403: count the forced reads of Your computers (after an Allow of a computer, and when this computer is let in). */
      await page.evaluate(() => { window.__forced = 0; const real = computersReadSoon; window.computersReadSoon = (f) => { if (f) window.__forced += 1; return real(f); }; });
      const readsBeforeAllow = computerReads;
      /* Allow the computer: its sheet says it is connected. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="' + PC_ID + '"]');
      await page.waitForFunction(() => /windowsbox is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const done = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/windowsbox is connected\. You can remove it any time under Devices\./.test(done) && !/trust each other/.test(done),
        `${tag} after Allow: "windowsbox is connected." and where to remove it`, done);
      chk(/iPhone wants to connect to your Kosmos/.test(done), `${tag} the other request is still waiting`, done);
      chk(allowBodies[PC_ID] && allowBodies[PC_ID].code === '482 915', `${tag} #6404: Allow on the computer sends the code typed from it, in the tunnel's own form`, JSON.stringify(allowBodies[PC_ID]));
      const forcedAfterPc = await page.evaluate(() => window.__forced);
      chk(forcedAfterPc === 1, `${tag} #6403: allowing a computer asks for a read of Your computers at once`, String(forcedAfterPc));
      await page.waitForTimeout(300);
      chk(computerReads > readsBeforeAllow, `${tag} #6403: and the read reaches /api/remote/computers`, JSON.stringify({ readsBeforeAllow, computerReads }));
      chk(await page.evaluate(() => !document.getElementById('plus-asks-title').hidden), `${tag} with a request still waiting, the heading shows`);
      /* Review W1: under the heading, what waits comes first; the answered line follows it. */
      const order = await page.evaluate(() => [...document.getElementById('plus-ask-rows').children].map((e) => e.classList.contains('askreq') ? 'waiting' : 'answered'));
      chk(JSON.stringify(order) === JSON.stringify(['waiting', 'answered']), `${tag} the waiting sheet sits under the heading, the answered line after it`, JSON.stringify(order));
      /* Review round 1: an Allow that fails leaves the request waiting: the heading stays and its sheet stays first. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-ph"]');
      await page.waitForFunction(() => /did not answer/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const err = await page.evaluate(() => ({ title: !document.getElementById('plus-asks-title').hidden, reason: /the tunnel did not answer/.test(document.getElementById('plus-ask-rows').innerText),
        order: [...document.getElementById('plus-ask-rows').children].map((e) => e.classList.contains('askreq') ? 'waiting' : 'answered') }));
      chk(err.title && err.reason && JSON.stringify(err.order) === JSON.stringify(['waiting', 'answered']), `${tag} a failed Allow still waits and says why: the heading stays, its sheet first`, JSON.stringify(err));
      /* Review W1: with nothing left waiting, "Waiting for you" goes; the success lines stand alone. */
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-ph"]');
      await page.waitForFunction(() => /iPhone is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const after = await page.evaluate(() => ({ title: !document.getElementById('plus-asks-title').hidden, text: (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' ') }));
      chk(allowBodies['d-ph'] && allowBodies['d-ph'].code === undefined, `${tag} #4794 CONTROL: a phone's Allow sends no code`, JSON.stringify(allowBodies['d-ph']));
      chk(await page.evaluate(() => window.__forced) === 1, `${tag} #6403 CONTROL: allowing a phone does not read Your computers`);
      chk(!after.title && /windowsbox is connected\./.test(after.text) && /iPhone is connected\./.test(after.text), `${tag} nothing waiting: no "Waiting for you" over the success lines`, JSON.stringify(after));

      chk(nowrap, `${tag} "a moment ago" stays on one line`);
      /* #6405: a computer's request first seen a day ago (it asked again just now) shows no age and is not faded; CONTROL:
         a phone first seen a day ago still says when and is faded. */
      const dayOld = await page.evaluate(async () => {
        const old = Math.floor(Date.now() / 1000) - 23 * 3600;
        const keep = ASK.devices;
        ASK.devices = [
          { device_id: 'computer:day-old', name: 'oldbox', code: '135 246', first_seen: old, joining_computer: 'oldbox' },
          { device_id: 'd-ph-old', name: 'iPhone', code: 'Q2-8R', first_seen: old, joining_computer: null },
          { device_id: 'd-wac-old', name: 'oldpc', code: '', first_seen: old, joining_computer: null, code_wait: 'was_a_computer' },
        ];
        paintAsk();
        const card = (id) => { const b = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="' + id + '"]'); return b && b.closest('.askreq'); };
        const pc = card('computer:day-old'), ph = card('d-ph-old'), wac = card('d-wac-old');
        // Turned away: a day-old computer row still gets the fresh wording, with the password sentence.
        ASK.done['computer:day-old'] = { state: 'denied', at: Date.now(), device: ASK.devices[0] };
        paintAsk();
        const deniedText = (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' ');
        delete ASK.done['computer:day-old'];
        // CONTROL: a day-old phone turned away gets the old-request wording, no password sentence.
        ASK.done['d-ph-old'] = { state: 'denied', at: Date.now(), device: ASK.devices[1] };
        paintAsk();
        const phoneDenied = (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' ');
        delete ASK.done['d-ph-old'];
        const out = { pcAge: pc ? pc.querySelectorAll('[data-ask-ago]').length : -1, pcStale: pc ? pc.classList.contains('stale') : null,
          wacAge: wac ? wac.querySelectorAll('[data-ask-ago]').length : -1, wacStale: wac ? wac.classList.contains('stale') : null,
          deniedPassword: /change that email's password/.test(deniedText),
          phoneOldWording: /can ask again by signing in/.test(phoneDenied) && !/change that email's password/.test(phoneDenied),
          phAge: ph ? ph.querySelectorAll('[data-ask-ago]').length : -1, phStale: ph ? ph.classList.contains('stale') : null };
        ASK.devices = keep; paintAsk();
        return out;
      });
      chk(dayOld.pcAge === 0 && dayOld.pcStale === false, `${tag} #6405: a computer that first asked a day ago shows no age and is not faded`, JSON.stringify(dayOld));
      chk(dayOld.wacAge === 0 && dayOld.wacStale === false, `${tag} #6405: a row that was a computer likewise shows no age and is not faded`, JSON.stringify(dayOld));
      chk(dayOld.deniedPassword === true, `${tag} #6405: turning away a day-old computer row keeps the password sentence (it may have just asked)`, JSON.stringify(dayOld));
      chk(dayOld.phoneOldWording === true, `${tag} #6405 CONTROL: turning away a day-old phone keeps the old-request wording, no password sentence`, JSON.stringify(dayOld));
      chk(dayOld.phAge === 1 && dayOld.phStale === true, `${tag} #6405 CONTROL: a phone first seen a day ago still says when and is faded`, JSON.stringify(dayOld));
      /* #4794: a computer whose code is not worked out yet: a quiet line in the code's place, Allow disabled, Not me enabled. */
      const waitCase = async (code_wait) => {
        pending = [{ device_id: 'd-w', name: 'laptop3', code: '', first_seen: now() - 10, joining_computer: 'laptop3', code_wait }];
        await page.evaluate(() => pollAsk());
        await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-w"]', { timeout: 5000 }).catch(() => {});
        return page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); if (!r) return null;
          const a = r.querySelector('[data-ask="allow"]'), n = r.querySelector('[data-ask="deny"]');
          return { wait: (r.querySelector('.askwait') || {}).textContent || '', code: !!r.querySelector('.askcodebig'), allowOff: !!(a && a.disabled), denyOn: !!(n && !n.disabled) }; });
      };
      const dl = await waitCase('daily_limit');
      chk(dl && dl.wait === 'This computer has added as many computers as it can today. Try again tomorrow.' && !dl.code && dl.allowOff && dl.denyOn,
        `${tag} #4794: no code yet (daily_limit): Mona's line, no code, Allow disabled, Not me enabled`, JSON.stringify(dl));
      /* #6383: the joining computer's code ran out; nothing comes until Try again is pressed there. */
      const cro = await waitCase('code_ran_out');
      chk(cro && cro.wait === 'The code for laptop3 ran out. On laptop3, press Try again for a new one.' && !cro.code && cro.allowOff && cro.denyOn,
        `${tag} #6383: code_ran_out: says press Try again on the joining computer, no code, Allow disabled, Not me enabled`, JSON.stringify(cro));
      const wac = await (async () => {   // was_a_computer comes on a row with no joining_computer (devices.rs)
        pending = [{ device_id: 'd-wac', name: 'oldbox', code: '777 777', first_seen: now() - 10, joining_computer: null, code_wait: 'was_a_computer' }];
        await page.evaluate(() => pollAsk());
        await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-wac"]', { timeout: 5000 }).catch(() => {});
        return page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); const a = r && r.querySelector('[data-ask="allow"]');
          return r ? { wait: (r.querySelector('.askwait') || {}).textContent || '', allowOff: !!(a && a.disabled), code: !!r.querySelector('.askcodebig') } : null; });
      })();
      chk(wac && wac.wait === 'This started as a computer and now shows as a device, so it cannot be allowed. Press Not me.' && wac.allowOff && !wac.code,
        `${tag} #4794: was_a_computer (no joining_computer, even WITH a code): its line, no code, Allow disabled (reviews 1, 3)`, JSON.stringify(wac));
      const unk = await waitCase(null);
      chk(unk && unk.wait === 'Working out the code with laptop3. It shows here in a moment.' && unk.allowOff,
        `${tag} #4794: no code and no reason: the default line, Allow disabled`, JSON.stringify(unk));
      /* #4794: Allow refused because the code changed is worded, not relayed raw. */
      pending = [{ device_id: 'd-cc', name: 'laptop4', code: '135 792', first_seen: now() - 10, joining_computer: 'laptop4' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]', { timeout: 5000 }).catch(() => {});
      codeChangedOnce = true;
      await page.fill('#askcode-d-cc', '135792');
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]');
      await page.waitForFunction(() => /code changed/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const cc = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/The code changed before you pressed Allow\. Type the new one from laptop4, then press Allow\./.test(cc) && !/code_changed/.test(cc),
        `${tag} #4794: a refused code is worded ("The code changed..."), never the raw tag`, cc);
      /* #6522 review 1: with an error showing, the field is described by the heading AND the error line. */
      const ccDescribed = await page.evaluate(() => { const f = document.getElementById('askcode-d-cc');
        return f ? (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => (document.getElementById(id) || {}).textContent || '<missing ' + id + '>') : null; });
      chk(ccDescribed && ccDescribed.length === 2 && /laptop4/.test(ccDescribed[0]) && /The code changed before you pressed Allow/.test(ccDescribed[1]),
        `${tag} #6522: with an error, the code field is described by the heading and the error line`, JSON.stringify(ccDescribed));
      const heldOff = await page.evaluate(() => { const a = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]'); return !!(a && a.disabled); });
      chk(heldOff, `${tag} #4794: after "code changed", Allow waits while the same code shows (review 3)`);
      pending = [{ device_id: 'd-cc', name: 'laptop4', code: '864 201', first_seen: now() - 10, joining_computer: 'laptop4' }];
      await page.evaluate(() => pollAsk());
      await page.waitForTimeout(400);
      const fresh = await page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); const a = r && r.querySelector('[data-ask="allow"]');
        return r ? { allowOff: !!(a && (a.disabled || a.getAttribute('aria-disabled') === 'true')), say: (r.querySelector('.asksay') || {}).textContent || '', value: (r.querySelector('.askcodein') || {}).value } : null; });
      await page.fill('#askcode-d-cc', '864 201');
      const freshOn = await page.evaluate(() => { const a = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="d-cc"]'); return !a.disabled && a.getAttribute('aria-disabled') !== 'true'; });
      chk(fresh && fresh.value === '' && fresh.allowOff && !/code changed/.test(fresh.say) && freshOn,
        `${tag} #4794/#6404: a new code clears the refusal and what was typed for the old one; typing the new one brings Allow back`, JSON.stringify({ fresh, freshOn }));
      /* #6404 review 2: Enter in the field. Five digits: nothing. Six wrong: answered on the sheet. Six right: sent. Never Not me. */
      pending = [{ device_id: 'd-en', name: 'laptop5', code: '246 801', first_seen: now() - 10, joining_computer: 'laptop5' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-en', { timeout: 5000 }).catch(() => {});
      await page.click('#askcode-d-en');
      await page.keyboard.type('24680'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const enterShort = !allowBodies['d-en'] && /Type the six digits shown on laptop5/.test(await page.evaluate(() => document.getElementById('plus-ask-rows').innerText));
      await page.keyboard.type('9'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /That is not the code laptop5 shows/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const enterWrong = !allowBodies['d-en'] && /That is not the code laptop5 shows/.test(await page.evaluate(() => document.getElementById('plus-ask-rows').innerText));
      await page.click('#askcode-d-en', { clickCount: 3 }); await page.keyboard.type('246801'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => /laptop5 is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      chk(enterShort && enterWrong && allowBodies['d-en'] && allowBodies['d-en'].code === '246 801' && !denyIds.includes('d-en'),
        `${tag} #6404: Enter in the field: five digits say to type all six, six wrong ones are answered, six right ones Allow; never Not me`, JSON.stringify({ enterShort, enterWrong, sent: allowBodies['d-en'], denyIds }));
      /* #6404 review 3: typed for a code that changed before the press: the sheet says the code is new, sends nothing. */
      pending = [{ device_id: 'd-nw', name: 'laptop6', code: '102 938', first_seen: now() - 10, joining_computer: 'laptop6' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-nw', { timeout: 5000 }).catch(() => {});
      await page.click('#askcode-d-nw'); await page.keyboard.type('102938');
      pending = [{ ...pending[0], code: '475 610' }];   // laptop6 has a new code, and this page reads it before the press
      const nw = await page.evaluate(async () => { await pollAsk(); await askAct('allow', 'd-nw'); return (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '); });
      chk(/laptop6 has a new code\. Type the new one from laptop6, then press Allow\./.test(nw) && !/That is not the code/.test(nw) && !allowBodies['d-nw'],
        `${tag} #6404: typed for a code that changed before the press: "has a new code", nothing sent`, nw);
      /* #6404 review 5: the person typed the NEW code from the other screen before this page read it: Allow reads the list
         again and lets it in with what was typed, rather than calling it wrong. */
      pending = [{ device_id: 'd-rc', name: 'laptop7', code: '111 333', first_seen: now() - 10, joining_computer: 'laptop7' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-rc', { timeout: 5000 }).catch(() => {});
      pending = [{ ...pending[0], code: '222 444' }];
      // One step in the page, so the page's own 5 s poll cannot read the new code first and skip the re-read under test.
      const rc = await page.evaluate(async () => {
        const before = (ASK.devices.find((x) => x.device_id === 'd-rc') || {}).code;
        askTyped('d-rc', '222444');
        let reads = 0; const real = window.pollAsk; window.pollAsk = async () => { reads += 1; return real(); };
        try { await askAct('allow', 'd-rc'); } finally { window.pollAsk = real; }
        return { before, reads, text: document.getElementById('plus-ask-rows').innerText };
      });
      chk(rc.before === '111 333' && rc.reads >= 1 && allowBodies['d-rc'] && allowBodies['d-rc'].code === '222 444' && /laptop7 is connected\./.test(rc.text),
        `${tag} #6404: a code typed from the other screen before this page saw it is read again and let in, sending what was typed`, JSON.stringify({ rc: { ...rc, text: undefined }, sent: allowBodies['d-rc'] }));
      /* #6404 review 2: two computers waiting at once keep their own typing; Allow on one sends only its code. */
      pending = [{ device_id: 'd-2a', name: 'boxa', code: '111 222', first_seen: now() - 10, joining_computer: 'boxa' },
        { device_id: 'd-2b', name: 'boxb', code: '333 444', first_seen: now() - 10, joining_computer: 'boxb' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-2b', { timeout: 5000 }).catch(() => {});
      await page.click('#askcode-d-2a'); await page.keyboard.type('111222');
      const two = await page.evaluate(() => { for (const rid of ['ask-rows', 'plus-ask-rows']) { const el = document.getElementById(rid); if (el) el.__lastLive = null; } paintAsk();
        const off = (x) => { const a = document.querySelector('#plus-ask-rows [data-ask="allow"][data-id="' + x + '"]'); return a.disabled || a.getAttribute('aria-disabled') === 'true'; };
        const b = document.getElementById('askcode-d-2b'), aOn = !off('d-2a'), bOff = off('d-2b');
        return { a: document.getElementById('askcode-d-2a').value, b: b && b.value, aOn, bOff }; });
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-2a"]');
      await page.waitForFunction(() => /boxa is connected\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      chk(two.a === '111222' && two.b === '' && two.aOn && two.bOff && allowBodies['d-2a'] && allowBodies['d-2a'].code === '111 222' && !allowBodies['d-2b'],
        `${tag} #6404: two computers waiting keep their own typing; Allow on one sends only its code`, JSON.stringify({ two, a: allowBodies['d-2a'], b: allowBodies['d-2b'] }));
      /* kosmos#6404: a computer already allowed here finishing its code check (the tunnel's recheck row): it says so, the
         button is Confirm, Confirm sends the typed code, and the card then says to finish on that computer. Not me only
         cancels the check and says the computer stays connected. */
      pending = [{ device_id: 'd-rk', name: 'boxc', code: '135 246', first_seen: 0, joining_computer: 'boxc', recheck: true }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-rk', { timeout: 5000 }).catch(() => {});
      const rk = await page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); const a = r && r.querySelector('[data-ask="allow"]');
        return r ? { head: (r.querySelector('.askwho b') || {}).textContent || '', say: (r.querySelector('.asksay') || {}).textContent || '', button: a ? a.textContent : '',
          label: a ? a.getAttribute('aria-label') : '', field: !!r.querySelector('.askcodein'), own: r.innerHTML.indexOf('135 246') > -1 } : null; });
      chk(rk && rk.head === 'Your computer "boxc" wants to finish its code check' && rk.say === '' && rk.button === 'Confirm'
        && /^Confirm the code check for computer boxc$/.test(rk.label) && rk.field && !rk.own,
        `${tag} #6404: a code check reads as finishing one, with the field and Confirm, and never shows this computer's code`, JSON.stringify(rk));
      /* Tunnel review 24: the tunnel's defence against a coordinator's own hello on the joining computer rests on this
         comparison, so a wrong code on a check's Confirm is answered here and nothing reaches the tunnel. */
      await page.click('#askcode-d-rk'); await page.keyboard.type('999999');
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-rk"]');
      await page.waitForTimeout(300);
      chk(!allowBodies['d-rk'], `${tag} #6404: a wrong code on a check's Confirm sends nothing`, JSON.stringify(allowBodies['d-rk'] || null));
      await page.fill('#askcode-d-rk', '');
      await page.click('#askcode-d-rk'); await page.keyboard.type('135246');
      await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-rk"]');
      await page.waitForFunction(() => /The code check with boxc is done here\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const rkDone = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(allowBodies['d-rk'] && allowBodies['d-rk'].code === '135 246' && /The code check with boxc is done here\. Now press The codes match on boxc\./.test(rkDone) && !/boxc is connected/.test(rkDone),
        `${tag} #6404: Confirm sends the typed code and says to finish on that computer`, JSON.stringify({ sent: allowBodies['d-rk'], rkDone }));
      /* Review 2: a later check from the same computer reuses its id; with its own time it is a new request, not the
         answer to the old one. */
      pending = [{ device_id: 'd-rk', name: 'boxc', code: '975 310', first_seen: 99, joining_computer: 'boxc', recheck: true }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-rk', { timeout: 5000 }).catch(() => {});
      const rkAgain = await page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); return r ? (r.querySelector('.askwho b') || {}).textContent || '' : ''; });
      chk(rkAgain === 'Your computer "boxc" wants to finish its code check', `${tag} #6404: a later check under the same id is a new request, not the old answer`, rkAgain);
      pending = [{ device_id: 'd-rk2', name: 'boxd', code: '864 975', first_seen: 0, joining_computer: 'boxd', recheck: true }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#plus-ask-rows [data-ask="deny"][data-id="d-rk2"]', { timeout: 5000 }).catch(() => {});
      await page.click('#plus-ask-rows [data-ask="deny"][data-id="d-rk2"]');
      await page.waitForFunction(() => /code check with boxd was cancelled/.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const rkNo = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(denyIds.includes('d-rk2') && /The code check with boxd was cancelled\. It stays connected\./.test(rkNo) && !/password/.test(rkNo),
        `${tag} #6404: Not me on a code check cancels only the check and says the computer stays connected`, rkNo);
      /* Review 3: after Not me and Got it on a check, a later check from that computer (same id, its own time) is a new
         request, not the cancelled answer (which never expires on its own). */
      await page.click('#plus-ask-rows [data-ask="gotit"][data-id="d-rk2"]').catch(() => {});
      pending = [{ device_id: 'd-rk2', name: 'boxd', code: '246 135', first_seen: 777, joining_computer: 'boxd', recheck: true }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#askcode-d-rk2', { timeout: 5000 }).catch(() => {});
      const rkNew = await page.evaluate(() => { const r = document.querySelector('#plus-ask-rows .askreq'); return r ? (r.querySelector('.askwho b') || {}).textContent || '' : ''; });
      chk(rkNew === 'Your computer "boxd" wants to finish its code check', `${tag} #6404: a check after a cancelled one (Got it pressed) is a new request`, rkNew);

      /* #4794: this computer WAITING to be allowed. The pill says so; #plus-join replaces the coordinator's sentence. */
      let join = { supported: true, held: true, join_code: '', on: null, asked_of: ['homemac'], failed: false, confirmed: false, confirm_expired: false };
      let confirmBody = null;
      remoteNow = { ...REMOTE, status: { state: 'waiting-allow', because: 'waiting for one of your computers to allow this one' } };
      const forcedAtWait = await page.evaluate(() => window.__forced);
      let joinDelayMs = 0;     // review 1: hold the pairing round open, as the tunnel's real round can take seconds
      let confirmRefuse = '';  // review 1: a confirm the tunnel refuses (code_expired)
      let joinGets = 0;        // review 6: each GET is a signed pairing round, so the endings must not poll
      let joinFailOnce = false; // review 6: a failed round on load must not spend the read on load
      let joinFailAlways = false; // a board whose every round fails (no connector, coordinator down)
      /* #6027: this handler waits before it answers, so the answer can land after the browser closed; inside the try,
         its late rejection is caught instead of crashing the check after it passed. */
      await page.route('**/api/remote/join', async (route) => {
        try {
          joinGets += 1; if (joinDelayMs) await new Promise((r) => setTimeout(r, joinDelayMs));
          if (joinFailAlways || joinFailOnce) { joinFailOnce = false; return await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'busy' }) }); }
          return await route.fulfill(json(join));
        } catch { await route.abort().catch(() => {}); }
      });
      await page.route('**/api/remote/join/confirm', (route, req) => { confirmBody = JSON.parse(req.postData() || '{}');
        if (confirmRefuse) { const why = confirmRefuse; confirmRefuse = ''; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: why }) }); }
        join = { ...join, confirmed: true }; return route.fulfill(json({ ok: true, confirmed: true, with: 'homemac' })); });
      const readJoin = async () => { await page.evaluate(() => { PLUS_JOIN_AT = 0; return paintPlus(); }); await page.waitForTimeout(700);
        return page.evaluate(() => { const j = document.getElementById('plus-join'), b = document.getElementById('plus-join-match'), c = j && j.querySelector('.askcodebig');
          return { shown: !!(j && !j.hidden), text: (j && j.innerText || '').replace(/\s+/g, ' ').trim(), code: c ? c.textContent : '', label: c ? c.getAttribute('aria-label') : '',
            size: c ? parseFloat(getComputedStyle(c).fontSize) : 0, button: b ? b.getAttribute('aria-label') : null, status: document.getElementById('plus-status').textContent,
            pill: document.getElementById('plus-pill').textContent }; }); };
      let jr = await readJoin();
      chk(jr.shown && jr.text === 'Working out the code with homemac, your other computer...' && !jr.button && jr.status === '' && jr.pill === 'Waiting to be allowed',
        `${tag} #4794 waiting: "Working out the code with homemac, your other computer...", no button, the coordinator's sentence gone`, JSON.stringify(jr));
      /* kosmos#6385: a wait with no code for over a minute says why it can take a while, as a hint (grey, not the bold
         action line), and the line goes when it is no longer a wait. The wait's start is set back rather than waited for. */
      const slow = await page.evaluate(() => { PLUS_JOIN_NOCODE_AT = Date.now() - 61 * 1000; paintPlusJoin();
        const j = document.getElementById('plus-join'), s = j && j.querySelector('.plus-join-slow');
        const out = { text: s ? s.textContent : '', fhint: !!(s && s.classList.contains('fhint')), weight: s ? getComputedStyle(s).fontWeight : '' };
        PLUS_JOIN_NOCODE_AT = 0; paintPlusJoin(); out.after = !!(j && j.querySelector('.plus-join-slow')); return out; });
      chk(/one computer at a time, about one every 10 minutes/.test(slow.text) && /Keep this open\. If no code comes, Settings, then Kosmos\+, on your other computer says why it is waiting\./.test(slow.text) && slow.fhint && Number(slow.weight) < 600 && !slow.after,
        `${tag} #6385 waiting over a minute: the block says the other computer adds one at a time, as a hint, and the line goes once the wait restarts`, JSON.stringify(slow));
      join = { ...join, join_code: '482 915', on: 'homemac' };
      jr = await readJoin();
      chk(jr.shown && /^Allow this computer from your other one\.\s*Open Kosmos on your other computer, homemac, and go to Settings, then Kosmos\+\.\s*Type this code there, then press Allow\.\s*Once homemac says this computer is connected, press The codes match here\./.test(jr.text) && jr.code === '482 915' && jr.label === '4 8 2, 9 1 5' && jr.size >= 28 && jr.button === 'The codes match: 4 8 2, 9 1 5',
        `${tag} #4794/#6314 waiting: the other computer named as the other one, where to look on it, the code large and "The codes match"`, JSON.stringify(jr));
      /* kosmos#6314 (Josh 11:37): while waiting, the pairing is the page's one job: the devices list and company block step aside. */
      const aside = await page.evaluate(() => ['plus-devices', 'plus-org'].map((id) => { const e = document.getElementById(id); return !e || getComputedStyle(e).display === 'none'; }));
      chk(aside[0] && aside[1], `${tag} #6314 waiting: the devices list and the company block are not on screen`, JSON.stringify(aside));
      /* Review 1: while a pairing round is in flight the coordinator's sentence must not come back beside the block. */
      joinDelayMs = 2500;
      const midRound = await page.evaluate(async () => { PLUS_JOIN_AT = 0; const p = paintPlus(); await new Promise((r) => setTimeout(r, 1200));
        const st = document.getElementById('plus-status').textContent; await p; return st; });
      joinDelayMs = 0;
      chk(midRound === '', `${tag} #4794: during a pairing round the coordinator's sentence stays away (one wait message)`, JSON.stringify(midRound));
      /* Review 1: a confirm the tunnel refuses (the code ran out) is worded, not relayed raw. */
      confirmRefuse = 'code_expired';
      await page.click('#plus-join-match');
      await page.waitForFunction(() => /ran out/.test(document.getElementById('plus-join').innerText), null, { timeout: 5000 }).catch(() => {});
      const refused = await page.evaluate(() => (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' '));
      chk(/That code ran out\./.test(refused) && !/code_expired|on its way|Try again/.test(refused), `${tag} #4794/#6353: a refused confirm (expired) is worded, and promises no new code (none comes without Try again)`, refused);
      /* Review 2: the same refusal again must leave the button pressable (an identical repaint was skipped before). */
      confirmRefuse = 'code_expired';
      await page.click('#plus-join-match');
      await page.waitForTimeout(800);
      const again2 = await page.evaluate(() => { const b = document.getElementById('plus-join-match'); return { there: !!b, enabled: !!(b && !b.disabled) }; });
      chk(again2.there && again2.enabled, `${tag} #4794: after the same refusal twice the button can be pressed again`, JSON.stringify(again2));
      await page.click('#plus-join-match');
      await page.waitForFunction(() => /Matched\./.test(document.getElementById('plus-join').innerText), null, { timeout: 5000 }).catch(() => {});
      jr = await readJoin();
      chk(confirmBody && confirmBody.code === '482 915' && /^The codes match\.\s*If you have not yet, type this code on homemac, your other computer, and press Allow\./.test(jr.text) && !/Waiting for/.test(jr.text) && jr.code === '482 915' && jr.size >= 28 && !jr.button,
        `${tag} #4794/#6314 waiting: "The codes match" posts the code shown; then the next action leads and (#6404) the code stays large`, JSON.stringify({ confirmBody, jr }));
      /* Review 5: the tunnel reports a code that ran out unconfirmed as an ending only once this computer is no longer
         held (while held it says needs_retry instead, #6353), so the shape is connected, not held, no code. */
      join = { ...join, held: false, join_code: '', on: null, confirmed: false, confirm_expired: true };   // no code, so no join_codes, so no on (review 7)
      const forcedBeforeIn = await page.evaluate(() => window.__forced);
      chk(forcedBeforeIn === forcedAtWait, `${tag} #6403 CONTROL: no forced read while this computer waits to be allowed`, JSON.stringify({ forcedAtWait, forcedBeforeIn }));
      remoteNow = REMOTE;   // connected
      jr = await readJoin();
      chk(await page.evaluate(() => window.__forced) === forcedBeforeIn + 1, `${tag} #6403: when this computer is let in, it asks for a read of Your computers at once`);
      chk(jr.shown && jr.text === 'homemac allowed this computer. Its code ran out before The codes match was pressed here.' && !jr.button && !jr.code && jr.pill === 'Connected',
        `${tag} #4794: allowed, then the code ran out unconfirmed: said, no button (review 5)`, JSON.stringify(jr));
      /* Review 6: that ending lasts until this computer pairs again, so it is said once and never polled for, and it does
         not take the status line: an outage after it is still said. */
      const getsAtEnd = joinGets;
      jr = await readJoin(); jr = await readJoin();
      chk(jr.shown && jr.text === 'homemac allowed this computer. Its code ran out before The codes match was pressed here.' && joinGets === getsAtEnd, `${tag} #4794: the ran-out ending stays and runs no more pairing rounds (review 6)`, JSON.stringify({ jr, rounds: joinGets - getsAtEnd }));
      remoteNow = { ...REMOTE, status: { state: 'down', because: 'the relay cannot be reached' } };
      jr = await readJoin();
      chk(jr.shown && /relay cannot be reached/.test(jr.status), `${tag} #4794: an outage after the ending is still said (review 6)`, JSON.stringify(jr));
      /* kosmos#6404: a page loaded later, with a tunnel that can offer one fresh code check: the ending carries Check the
         code (the probe's one read on load), the press asks for it, and the check's steps show with its code large. The
         arm puts back everything it changes, so the arms after it start where they did. */
      {
        const outage = remoteNow, joinBefore = join;
        remoteNow = REMOTE;
        join = { ...join, held: false, join_code: '', on: null, confirmed: false, confirm_expired: true, can_recheck: true, rechecking: false, recheck_with: 'homemac' };
        let recheckPosts = 0;
        await page.route('**/api/remote/join/recheck', (route) => { recheckPosts += 1;
          join = { ...join, can_recheck: false, rechecking: true, confirm_expired: false, join_code: '246 810', on: 'homemac' };
          return route.fulfill(json({ ok: true })); });
        await page.evaluate(() => plusJoinReset());
        jr = await readJoin();
        const rb = await page.evaluate(() => { const b = document.getElementById('plus-join-recheck'); return b ? b.textContent : null; });
        chk(jr.shown && /^homemac allowed this computer\. Its code ran out before The codes match was pressed here\.\s*To finish, check the code with homemac once\. You will need to be at both computers\./.test(jr.text) && rb === 'Check the code',
          `${tag} #6404: allowed, code ran out, a check can be asked for: the ending says so with Check the code (also on a later load)`, JSON.stringify({ jr, rb }));
        /* Review 1: the ending is not polled and the page forgets its last answer on the next repaint; the button must
           stay through repaints, with no more pairing rounds. */
        const getsBefore = joinGets;
        jr = await readJoin(); jr = await readJoin();
        const rb2 = await page.evaluate(() => { const b = document.getElementById('plus-join-recheck'); return b ? b.textContent : null; });
        chk(/To finish, check the code with homemac once\./.test(jr.text) && rb2 === 'Check the code' && joinGets === getsBefore,
          `${tag} #6404: Check the code stays through repaints, and the ending runs no more pairing rounds`, JSON.stringify({ jr, rb2, joinGets, getsBefore }));
        await page.click('#plus-join-recheck');
        await page.waitForTimeout(400);
        jr = await readJoin();
        chk(recheckPosts === 1 && /^Finish the code check with homemac\.\s*On homemac, go to Settings, then Kosmos\+\.\s*Type this code there, then press Confirm\.\s*Once homemac says the check is done, press The codes match here\.\s*If it is cancelled on homemac, this ends by itself within ten minutes, and you can check again\./.test(jr.text)
          && jr.code === '246 810' && jr.size >= 28 && !!jr.button,
          `${tag} #6404: Check the code asks once, then the check's steps show with the code large and The codes match`, JSON.stringify({ recheckPosts, jr }));
        /* Review 2: the check ends with no code confirmed (the tunnel offers it again): the button comes back. */
        join = { ...join, rechecking: false, can_recheck: true, join_code: '', on: null, confirm_expired: true };
        jr = await readJoin(); jr = await readJoin();
        const back = await page.evaluate(() => !!document.getElementById('plus-join-recheck'));
        chk(back && /To finish, check the code with homemac once\./.test(jr.text), `${tag} #6404: a check that ended offers Check the code again`, JSON.stringify(jr));
        /* kosmos#6386: a press the tunnel refuses with tries left: the check is only unavailable, so nothing reads as
           finished, and the button goes. */
        await page.unroute('**/api/remote/join/recheck');
        await page.route('**/api/remote/join/recheck', (route) => { join = { ...join, can_recheck: false };
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'nothing_to_recheck' }) }); });
        await page.click('#plus-join-recheck');
        await page.waitForTimeout(500);
        const refused = await page.evaluate(() => ({ text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(), button: !!document.getElementById('plus-join-recheck') }));
        chk(!refused.button && refused.text === 'homemac allowed this computer. Its code ran out before The codes match was pressed here. The code cannot be checked right now.',
          `${tag} #6386: a press refused with tries left says the check cannot be done now, and the button goes`, JSON.stringify(refused));
        join = { ...join, can_recheck: true };
        await page.evaluate(() => { PLUS_JOIN_NOTE.recheck = true; PLUS_JOIN_MSG = ''; paintPlusJoin(); });
        /* A press refused because every try is used: it says so and the button goes. */
        await page.unroute('**/api/remote/join/recheck');
        // The tunnel with every try used also stops offering the check (can_recheck needs tries left).
        await page.route('**/api/remote/join/recheck', (route) => { join = { ...join, can_recheck: false };
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'attempts_used' }) }); });
        await page.click('#plus-join-recheck');
        await page.waitForTimeout(500);
        const used = await page.evaluate(() => ({ text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' '), button: !!document.getElementById('plus-join-recheck') }));
        chk(!used.button && /Every try for this computer and homemac is used, so the code cannot be checked again\./.test(used.text),
          `${tag} #6404: a press refused for tries used says so and the button goes`, JSON.stringify(used));
        /* Review 3: a check that ends on its last try (the tunnel: failed, no code, no check on offer) has an ending
           of its own; the block does not go blank. A live check first, then that answer. */
        join = { ...join, rechecking: true, can_recheck: false, failed: false, join_code: '135 790', on: 'homemac', confirm_expired: false };
        await page.evaluate(() => { PLUS_JOIN = { supported: true, held: false, rechecking: true, join_code: '135 790', on: 'homemac', recheck_with: 'homemac' }; PLUS_JOIN_WAITING = true; PLUS_JOIN_NOTE = null; });
        jr = await readJoin();
        join = { ...join, rechecking: false, can_recheck: false, failed: true, join_code: '', on: null, confirm_expired: true };
        jr = await readJoin(); jr = await readJoin();
        chk(jr.shown && /^homemac allowed this computer\. Its code ran out before The codes match was pressed here\.\s*Every try for this computer and homemac is used, so the code cannot be checked again\./.test(jr.text)
          && !/Too many tries/.test(jr.text), `${tag} #6404: a check that ends on its last try says every try is used (no blank block, no sign-in-again advice)`, JSON.stringify(jr));
        await page.unroute('**/api/remote/join/recheck');
        join = joinBefore; remoteNow = outage;
        await page.evaluate(() => plusJoinReset());
      }
      /* Too many tries: still held, every attempt used, no code (the tunnel's failed). */
      join = { ...join, held: true, failed: true, on: null };
      remoteNow = { ...REMOTE, status: { state: 'waiting-allow', because: 'waiting for one of your computers to allow this one' } };
      jr = await readJoin();
      chk(jr.text === 'Too many tries. On homemac, your other computer, press Not me on this request, then sign this computer in again.' && !jr.button,
        `${tag} #4794 waiting: too many tries says the recovery`, JSON.stringify(jr));
      // #6387: and the pill says it needs the person, as it does for a code that ran out below (it read Waiting to be allowed).
      chk(jr.pill === 'Needs you', `${tag} #6387 waiting: too many tries is Needs you on the pill`, JSON.stringify(jr));
      /* #6353: still held, the code ran out, and no new attempt starts until the person presses Try again (a night with
         nobody here used to spend every try). The block says so and offers the button; pressing it posts the retry, and
         while the tunnel starts the new attempt the block says one is on its way. */
      let retryPosts = 0; let retryRefuse = '';
      await page.route('**/api/remote/join/retry', (route) => { retryPosts += 1;
        if (retryRefuse) { const why = retryRefuse; retryRefuse = ''; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: why }) }); }
        join = { ...join, needs_retry: false }; return route.fulfill(json({ ok: true })); });
      join = { ...join, held: true, failed: false, needs_retry: true, confirm_expired: true, confirmed: false, join_code: '', on: null };
      jr = await readJoin();
      const retryBtn = await page.evaluate(() => { const b = document.getElementById('plus-join-retry'); return b ? { text: b.textContent, enabled: !b.disabled } : null; });
      chk(jr.shown && jr.text === 'A new code is needed to finish pairing. When you are at both computers, press Try again. Try again' && !jr.button && retryBtn && retryBtn.enabled && jr.pill === 'Needs you',
        `${tag} #6353 waiting: a code that ran out waits for Try again, says so, and the pill says Needs you`, JSON.stringify({ jr, retryBtn }));
      /* Every try used: the refusal paints the failed recovery at once, never Try again beside "Too many tries". */
      retryRefuse = 'attempts_used';
      joinDelayMs = 3000;   // no round answers in time: what shows is the page's own repaint of the refusal
      await page.click('#plus-join-retry');
      await page.waitForTimeout(500);
      const usedSay = await page.evaluate(() => ({ text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(), btn: !!document.getElementById('plus-join-retry'),
        pill: document.getElementById('plus-pill').textContent }));
      chk(usedSay.text === 'Too many tries. On homemac, your other computer, press Not me on this request, then sign this computer in again.' && !usedSay.btn,
        `${tag} #6353: a Try again refused for every try used says the recovery, with no Try again left`, JSON.stringify(usedSay));
      // #6387 review 1: the page's own failed (set by that refusal) keeps the pill on Needs you, not Waiting to be allowed.
      chk(usedSay.pill === 'Needs you', `${tag} #6387: a refused Try again with every try used keeps Needs you on the pill`, JSON.stringify(usedSay));
      await page.waitForTimeout(3500); joinDelayMs = 0;   // outlasts the held round, so the next read is not paced
      join = { ...join, failed: false, needs_retry: true };
      await page.evaluate(() => { PLUS_JOIN_CODE_AT = Date.now() - 601 * 1000; });   // an old code's clock, long run out
      jr = await readJoin();
      const clockAtRetry = await page.evaluate(() => PLUS_JOIN_CODE_AT);
      chk(clockAtRetry === 0, `${tag} #6353: a round saying Try again is owed stops the page's code clock`, String(clockAtRetry));
      /* Accepted: the button goes at once, before any round answers (a second press would only be refused). */
      await page.evaluate(() => { PLUS_JOIN_CODE_AT = Date.now() - 601 * 1000; });   // so only the press's own reset keeps the next arm off "ran out"
      const postsBefore = retryPosts;
      joinDelayMs = 3000;
      await page.click('#plus-join-retry');
      await page.waitForTimeout(500);
      const rightAfter = await page.evaluate(() => ({ text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(), btn: !!document.getElementById('plus-join-retry'),
        focus: document.activeElement && document.activeElement.id, pill: document.getElementById('plus-pill').textContent }));
      /* Rounds failing for ten minutes after the press: the tunnel's Try again has lapsed too, so the promise goes. */
      const promiseOld = await page.evaluate(() => { const was = PLUS_JOIN_RETRY_AT; PLUS_JOIN_RETRY_AT = Date.now() - 601 * 1000; paintPlusJoin();
        const t = (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(); PLUS_JOIN_RETRY_AT = was; paintPlusJoin(); return t; });
      chk(promiseOld === 'That code ran out. Kosmos is checking with your other computer.', `${tag} #6353: ten minutes after an accepted Try again with no round answering, the block stops promising a code`, promiseOld);
      await page.waitForTimeout(3500); joinDelayMs = 0;
      chk(retryPosts === postsBefore + 1 && rightAfter.text === 'That code ran out. A new one is on its way.' && !rightAfter.btn && rightAfter.focus === 'plus-join' && rightAfter.pill === 'Waiting to be allowed',
        `${tag} #6353: Try again posts once, and at once the block says a new code is on its way (no button, before any round; focus stays in the block)`, JSON.stringify({ posts: retryPosts - postsBefore, rightAfter }));
      /* The tunnel then starts the attempt (its ran-out flag clears) before the new code is worked out. The old code's
         clock must not make that read as "ran out" with nothing to press. */
      join = { ...join, needs_retry: false, confirm_expired: false, join_code: '' };
      jr = await readJoin();
      chk(jr.text === 'Working out the code with homemac, your other computer...', `${tag} #6353: after Try again, the old code's clock does not read the new attempt as run out`, JSON.stringify(jr));
      /* A Try again the tunnel cannot take for another reason is said under the button, which stays. */
      join = { ...join, needs_retry: true, confirm_expired: true };
      jr = await readJoin();
      retryRefuse = 'the Plus connector could not be reached';
      await page.click('#plus-join-retry');
      await page.waitForFunction(() => /could not be reached/.test(document.getElementById('plus-join').innerText), null, { timeout: 5000 }).catch(() => {});
      const failSay = await page.evaluate(() => ({ text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(), btn: !!document.getElementById('plus-join-retry') }));
      chk(/could not be reached/.test(failSay.text) && failSay.btn, `${tag} #6353: a Try again that did not go through says why and leaves Try again`, JSON.stringify(failSay));
      const failOld = await page.evaluate(() => { const was = PLUS_JOIN_MSG_AT; PLUS_JOIN_MSG_AT = Date.now() - 601 * 1000; paintPlusJoin();
        const out = { text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(), btn: !!document.getElementById('plus-join-retry') };
        PLUS_JOIN_MSG_AT = was; paintPlusJoin(); return out; });
      chk(!/could not be reached/.test(failOld.text) && failOld.btn, `${tag} #6353: a Try again refusal is not left under the button after ten minutes, and Try again stays`, JSON.stringify(failOld));
      /* Refused because the pairing moved on: the button does not come back pressable before a round says what is next. */
      await page.waitForTimeout(4100);   // the failed press's own read, paced, is done
      join = { ...join, needs_retry: true, confirm_expired: true };
      jr = await readJoin();
      retryRefuse = 'nothing_to_retry';
      joinDelayMs = 3000;
      await page.click('#plus-join-retry');
      await page.waitForTimeout(500);
      const movedOn = await page.evaluate(() => ({ text: (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim(), btn: !!document.getElementById('plus-join-retry') }));
      await page.waitForTimeout(3500); joinDelayMs = 0;
      chk(movedOn.text === 'Working out the code with homemac, your other computer...' && !movedOn.btn,
        `${tag} #6353: a Try again refused as nothing to retry takes the button away, promising nothing`, JSON.stringify(movedOn));
      /* Focus is moved only when it was still on the pressed button: a person who tabbed away keeps their place. */
      join = { ...join, needs_retry: true, confirm_expired: true };
      jr = await readJoin();
      joinDelayMs = 3000;
      await page.evaluate(() => { const b = document.getElementById('plus-join-retry'); b.click(); document.getElementById('plus-pill').setAttribute('tabindex', '-1'); document.getElementById('plus-pill').focus(); });
      await page.waitForTimeout(3600); joinDelayMs = 0;
      const kept = await page.evaluate(() => document.activeElement && document.activeElement.id);
      chk(kept === 'plus-pill', `${tag} #6353: a person who moved focus while Try again was out keeps it`, String(kept));
      await page.evaluate(() => document.getElementById('plus-pill').removeAttribute('tabindex'));
      join = { ...join, needs_retry: false, confirm_expired: false };
      /* Review 3 (the tunnel's own contract): after the other computer's Allow this computer is connected and no longer
         held, but the code stays until it is confirmed here. The block must still show it, with the button. */
      join = { ...join, held: false, failed: false, confirm_expired: false, confirmed: false, join_code: '246 810', on: 'homemac' };
      remoteNow = REMOTE;   // connected
      jr = await readJoin();
      chk(jr.shown && /^If you typed this code on homemac, your other computer, to allow this computer, press The codes match\./.test(jr.text) && jr.code === '246 810' && jr.button && jr.pill === 'Connected' && jr.status === '',
        `${tag} #4794: allowed but not yet confirmed: the code and The codes match stay (the pill says Connected, the sentence stays away)`, JSON.stringify(jr));
      /* By the page's clock a code older than the tunnel's 10 minutes is shown as run out, even if rounds keep failing. */
      await page.evaluate(() => { PLUS_JOIN_CODE_AT = Date.now() - 601 * 1000; PLUS_JOIN.held = true; });   // review 7: paintPlusJoin reads the page's answer, not the route
      remoteNow = { ...REMOTE, status: { state: 'waiting-allow', because: 'waiting' } };
      join = { ...join, held: true };
      await page.evaluate(() => paintPlusJoin());
      const old = await page.evaluate(() => (document.getElementById('plus-join').innerText || '').replace(/\s+/g, ' ').trim());
      chk(old === 'That code ran out. Kosmos is checking with your other computer.', `${tag} #4794/#6353: a code past 10 minutes by the page's clock reads as run out, promising no new one`, old);
      /* Review 6: allowed (not held) and past the page's 10 minutes, no new code follows: it says the ending, and keeps
         reading until the tunnel's own answer, which then stays as the ending. */
      join = { ...join, held: false };
      remoteNow = REMOTE;
      jr = await readJoin();
      chk(jr.shown && jr.text === 'homemac allowed this computer. Its code ran out before The codes match was pressed here.' && !jr.button, `${tag} #4794: allowed and past 10 minutes: the ending, not "a new one is on its way" (review 6)`, JSON.stringify(jr));
      join = { ...join, join_code: '', on: null, confirm_expired: true };
      jr = await readJoin(); jr = await readJoin();
      chk(jr.shown && jr.text === 'homemac allowed this computer. Its code ran out before The codes match was pressed here.', `${tag} #4794: the tunnel's ran-out answer keeps the ending up (review 6)`, JSON.stringify(jr));
      /* CONTROL: a fresh page, connected and confirmed: the read on load answers and the block stays away (an ending is
         only said for a pairing this page watched). */
      join = { ...join, held: false, confirmed: true, confirm_expired: false, join_code: '246 810' };
      remoteNow = REMOTE;
      await page.evaluate(() => { PLUS_JOIN = null; PLUS_JOIN_NOTE = null; PLUS_JOIN_PROBED = false; PLUS_JOIN_PROBE_TRIES = 0; PLUS_JOIN_CODE_AT = 0; });
      jr = await readJoin(); jr = await readJoin();
      chk(!jr.shown && jr.pill === 'Connected', `${tag} #4794 CONTROL: connected, no pairing block`, JSON.stringify(jr));
      /* Review 5: a page loaded AFTER the other computer's Allow, with the code still up. Nothing earlier on this page has
         an answer, so only the one read on load can find it. CONTROL first: with that read already spent, it stays hidden. */
      join = { ...join, held: false, confirmed: false, confirm_expired: false, failed: false, join_code: '135 790', on: 'homemac' };
      await page.evaluate(() => { PLUS_JOIN = null; PLUS_JOIN_NOTE = null; PLUS_JOIN_PROBED = true; PLUS_JOIN_CODE_AT = 0; });
      jr = await readJoin(); jr = await readJoin();
      chk(!jr.shown, `${tag} #4794 CONTROL: without the read on load, a reloaded page never finds the code (review 5)`, JSON.stringify(jr));
      await page.evaluate(() => { PLUS_JOIN = null; PLUS_JOIN_NOTE = null; PLUS_JOIN_PROBED = false; PLUS_JOIN_PROBE_TRIES = 0; PLUS_JOIN_CODE_AT = 0; });
      /* Every round fails (no connector, or the coordinator is down): the read on load gives up after three tries
         rather than spawning a signed round every few seconds for as long as the page is open. */
      joinFailAlways = true;
      const getsBefore = joinGets;
      for (let i = 0; i < 5; i += 1) jr = await readJoin();
      joinFailAlways = false;
      chk(!jr.shown && joinGets - getsBefore === 3, `${tag} #4794: a read on load that always fails stops after three tries`, JSON.stringify({ rounds: joinGets - getsBefore }));
      await page.evaluate(() => { PLUS_JOIN_PROBE_TRIES = 0; });
      /* Review 6: the first read on load fails (a busy round): it is not spent, and the next paint reads again. */
      joinFailOnce = true;
      jr = await readJoin();
      const spent = await page.evaluate(() => PLUS_JOIN_PROBED);
      chk(!jr.shown && spent === false, `${tag} #4794: a failed read on load is not counted as done (review 6)`, JSON.stringify({ jr, spent }));
      jr = await readJoin();
      chk(jr.shown && jr.code === '135 790' && jr.button && jr.pill === 'Connected', `${tag} #4794: reloaded after the Allow, the code and The codes match come back (review 5)`, JSON.stringify(jr));
      /* Review 6: The codes match after the Allow completes the pairing; it says so rather than vanishing. */
      await page.click('#plus-join-match');
      await page.waitForFunction(() => /Matched with/.test(document.getElementById('plus-join').innerText), null, { timeout: 5000 }).catch(() => {});
      jr = await readJoin();
      chk(jr.shown && jr.text === 'Matched with homemac.' && !jr.button && !jr.code && confirmBody && confirmBody.code === '135 790',
        `${tag} #4794: matched after the Allow says "Matched with homemac." (review 6)`, JSON.stringify({ jr, confirmBody }));
      /* Not me on a computer joining names it the way its sheet did (review round 5). */
      pending = [{ device_id: PC2_ID, name: 'Laptop2', code: 'M5-N6', first_seen: now() - 20, joining_computer: 'laptop2' }];
      await page.evaluate(() => pollAsk());
      await page.waitForSelector('#plus-ask-rows [data-ask="deny"][data-id="' + PC2_ID + '"]', { timeout: 5000 }).catch(() => {});
      await page.click('#plus-ask-rows [data-ask="deny"][data-id="' + PC2_ID + '"]');
      await page.waitForFunction(() => /Turned away\./.test(document.getElementById('plus-ask-rows').innerText), null, { timeout: 5000 }).catch(() => {});
      const away = await page.evaluate(() => (document.getElementById('plus-ask-rows').innerText || '').replace(/\s+/g, ' '));
      chk(/Turned away\. That computer, laptop2, was not let in/.test(away) && !/Laptop2/.test(away), `${tag} Not me on a computer names it as its sheet did`, away);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      chk(wide <= 0, `${tag} no sideways scroll`, String(wide));
      chk(errs.length === 0, `${tag} no page errors`, JSON.stringify(errs));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
