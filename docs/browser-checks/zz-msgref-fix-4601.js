// Browser-check-surface: pj-room d-dmthread rxns rxn-quick rxn-ref msg-menu msg-menu-copy msg-toast pj-one-name
'use strict';
/* #4631 (Josh, 2026-09-29 14:42): "would be even cooler if i could like ctrl + click and get a message ID from any
 * message to then reference it to an agent later on". In the real page (web/index.html from disk, fetch stubbed):
 *
 *   R1  a room post's hover bar starts with Copy reference, showing the number faintly; Reply stays last (#4358)
 *   R2  clicking it copies "message 530 in Kosmos Growth" and says so in a toast
 *   R3  right-clicking the post opens the menu (Copy message reference), and its item copies the same words
 *   R4  ctrl-click (Windows) opens the same menu; on a Mac ctrl-click is the right-click of R3
 *   R5  a right-click on a LINK, or with text selected, keeps the browser's own menu (the page does not take it)
 *   R6  a direct-conversation row (no number) copies "April's message to me at <time> on <day>", and the
 *       person's own row copies "my message to April at ..."
 *   R7  when the clipboard cannot be written, the fallback still copies, and if that fails too the toast shows the words
 *   R8  Escape and a click outside close the menu
 *   R9  a name that opens the agent is left alone; R10 keyboard (menu key at the message, focus back, Tab closes);
 *   R11 a touchscreen long-press keeps the system menu
 *   R12 REAL WebKit: a right-click on a word opens the menu and a real click on the item copies (SKIPPED, said so, where
 *       WebKit is not installed)
 * Controls: the number is hidden until hover (the bar's own opacity), and a row with nothing to name offers no menu.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-msgref-4631.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const T0 = Date.parse('2026-09-29T19:31:00Z');
const at = (i) => new Date(T0 + i * 60000).toISOString();

async function paintRoom(page) {
  await page.evaluate(([a0, a1]) => {
    document.getElementById('panel-projects').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    const bc = document.getElementById('boot-cover'); if (bc) bc.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    document.getElementById('pj-one-name').textContent = 'Kosmos Growth';
    const p = { id: 'p1', name: 'Kosmos Growth', agents: [{ sessionName: 'april', name: 'April' }] };
    const rows = [
      { kind: 'post', id: 'm530', from: 'april', to: [], project: 'p1', at: a0, text: 'The AtlasGrid deck is ready for review.' },
      { kind: 'post', id: 'm531', from: 'april', to: [], project: 'p1', at: a1, text: 'Notes are at https://example.com/notes for later.' },
    ];
    const room = document.getElementById('pj-room');
    room.innerHTML = rows.map((m) => pjRoomRow(m, p, false)).join('');
    // Reveal the room's own column: every hidden ancestor, as opening the project would.
    for (let el = room; el && el !== document.body; el = el.parentElement) {
      if (el.hidden) el.hidden = false;
      if (getComputedStyle(el).display === 'none') el.style.display = 'block';
    }
    room.scrollIntoView();
  }, [at(0), at(1)]);
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // R11: on a touchscreen a long-press is how text is selected, so the page does not take contextmenu there.
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'America/Chicago', locale: 'en-US' });
      const page = await ctx.newPage();
      await page.addInitScript(() => { window.setInterval = () => 0; window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); });
      await page.goto(PAGE);
      await paintRoom(page);
      const touchTaken = await page.evaluate(() => {
        const bd = document.querySelector('#pj-room .msg[data-mid="m530"] .msg-bd');
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 });
        bd.dispatchEvent(ev); return { taken: ev.defaultPrevented, touch: matchMedia('(hover: none)').matches };
      });
      chk(touchTaken.touch && touchTaken.taken === false, '[touch] R11 a long-press on a touchscreen keeps the system menu', JSON.stringify(touchTaken));
      await ctx.close();
    }
    for (const platform of ['Win32', 'MacIntel']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.addInitScript((plat) => {
        Object.defineProperty(navigator, 'platform', { get: () => plat });
        window.setInterval = () => 0;
        window.__copied = [];
        window.__clipFails = false;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { if (window.__clipFails) throw new Error('denied'); window.__copied.push(t); } } });
        document.addEventListener('copy', () => { window.__copied.push('fallback:' + String(document.getSelection ? (document.activeElement && document.activeElement.value) || '' : '')); });
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async () => enc({});
      }, platform);
      await page.goto(PAGE);
      await paintRoom(page);
      const tag = '[' + platform + '] ';
      const post = page.locator('#pj-room .msg[data-mid="m530"]');

      if (platform === 'Win32') {
        await page.mouse.move(2, 2);
        const rest = await post.locator('.rxn-quick').evaluate((q) => Number(getComputedStyle(q).opacity));
        chk(rest === 0, tag + 'CONTROL: the number is hidden until the post is hovered', String(rest));
        await post.hover();
        await page.waitForTimeout(250);
        const bar = await post.evaluate((row) => {
          const q = row.querySelector('.rxn-quick');
          const kids = [...q.children].map((k) => k.classList.contains('rxn-ref') ? 'ref' : k.classList.contains('rxn-reply') ? 'reply' : k.classList.contains('rxn-speak') ? 'speak' : k.classList.contains('rxn-more') ? 'more' : k.classList.contains('rxn-pick') ? 'pick' : '?');
          const ref = q.querySelector('.rxn-ref');
          const r = ref.getBoundingClientRect();
          return { kids: kids.join(','), n: (ref.querySelector('.rxn-ref-n') || {}).textContent, label: ref.getAttribute('aria-label'),
            op: Number(getComputedStyle(q).opacity), h: r.height, w: r.width };
        });
        chk(bar.kids === 'ref,pick,pick,pick,more,speak,reply', tag + 'R1 the bar starts with Copy reference and keeps Reply last (an agent\'s post, so read aloud, #4409, sits before it)', bar.kids);
        chk(bar.n === '530' && bar.label === 'Copy a reference to message 530' && bar.op === 1, tag + 'R1 on hover it shows the number, and says what it copies', JSON.stringify(bar));
        chk(bar.h >= 24 && bar.w >= 24, tag + 'R1 the button is a 24px target (WCAG 2.5.8)', bar.w + 'x' + bar.h);
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await post.screenshot({ path: path.join(SHOTS, 'hover-bar.png') }); }
        await post.locator('.rxn-ref').click();
        await page.waitForTimeout(100);
        const r2 = await page.evaluate(() => ({ copied: window.__copied.slice(), toast: (document.getElementById('msg-toast') || {}).textContent, shown: !!document.getElementById('msg-toast') && !document.getElementById('msg-toast').hidden }));
        chk(r2.copied[0] === 'message 530 in Kosmos Growth', tag + 'R2 the button copies the reference', JSON.stringify(r2.copied));
        chk(r2.shown && /Copied "message 530 in Kosmos Growth"\. Paste it to any agent\./.test(r2.toast || ''), tag + 'R2 a toast says what was copied', r2.toast);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'toast.png') });
      }

      // R3: right-click (on a Mac this is also ctrl-click).
      await page.evaluate(() => { window.__copied.length = 0; });
      const box = await post.locator('.msg-bd').boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
      const menu = await page.evaluate(() => { const m = document.getElementById('msg-menu'); return m ? { shown: !m.hidden, item: m.textContent.trim(), focus: document.activeElement && document.activeElement.id } : null; });
      chk(menu && menu.shown && menu.item === 'Copy message reference' && menu.focus === 'msg-menu-copy', tag + 'R3 right-click opens the menu with its item focused', JSON.stringify(menu));
      if (SHOTS && platform === 'Win32') await page.screenshot({ path: path.join(SHOTS, 'menu.png') });
      await page.click('#msg-menu-copy');
      await page.waitForTimeout(100);
      const r3 = await page.evaluate(() => ({ copied: window.__copied.slice(), hidden: document.getElementById('msg-menu').hidden }));
      chk(r3.copied[0] === 'message 530 in Kosmos Growth' && r3.hidden, tag + 'R3 the item copies the reference and closes the menu', JSON.stringify(r3));

      // R4: ctrl-click. On Windows the page opens the menu from the click itself. On a Mac the SYSTEM turns
      // ctrl-click into the right-click R3 covers (Chromium on a Mac host does it too), so the page's click handler
      // must leave the click alone, or a Mac would get the menu twice. Dispatched as an event so the arm tests the
      // page's own decision whatever machine runs it.
      await page.keyboard.press('Escape');
      const r4 = await post.evaluate((row) => {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 30, clientY: 30 });
        row.querySelector('.msg-bd').dispatchEvent(ev);
        const open = !document.getElementById('msg-menu').hidden;
        return { taken: ev.defaultPrevented, open };
      });
      chk(platform === 'Win32' ? (r4.taken && r4.open) : (!r4.taken && !r4.open),
        tag + (platform === 'Win32' ? 'R4 ctrl-click opens the menu' : 'R4 the page leaves a Mac ctrl-click to the system (which makes it the right-click of R3)'), JSON.stringify(r4));
      await page.keyboard.press('Escape');

      // R9: a name or picture that opens the agent's page is left to that (a ctrl-click there already navigated).
      const nameTaken = await post.evaluate((row) => {
        const nm = row.querySelector('[data-open-agent]'); if (!nm) return 'no-name';
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 });
        nm.dispatchEvent(ev); return ev.defaultPrevented;
      });
      chk(nameTaken === false, tag + 'R9 a right-click or ctrl-click on the name that opens the agent is left alone', String(nameTaken));
      await page.keyboard.press('Escape');

      // R10: focus goes back where it was on Escape; Tab closes the menu; a keyboard's menu key (no pointer position)
      // opens it at the message, not in the corner.
      const r10 = await post.evaluate(async (row) => {
        const bd = row.querySelector('.msg-bd'); row.setAttribute('tabindex', '-1'); row.focus();
        bd.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
        const m = document.getElementById('msg-menu'); const mr = m.getBoundingClientRect(), rr = row.getBoundingClientRect();
        const atRow = mr.left >= rr.left && mr.top >= rr.top && mr.top <= rr.bottom;
        document.getElementById('msg-menu-copy').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        const back = document.activeElement === row && m.hidden;
        bd.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
        document.getElementById('msg-menu-copy').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        const tabbed = m.hidden;
        row.removeAttribute('tabindex');
        return { atRow, back, tabbed };
      });
      chk(r10.atRow && r10.back && r10.tabbed, tag + 'R10 keyboard: the menu key opens it at the message, Escape returns focus, Tab closes it', JSON.stringify(r10));

      // R8: Escape and a click outside close it.
      await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
      await page.keyboard.press('Escape');
      const esc = await page.evaluate(() => document.getElementById('msg-menu').hidden);
      await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
      await page.mouse.click(5, 5);
      const out = await page.evaluate(() => document.getElementById('msg-menu').hidden);
      chk(esc && out, tag + 'R8 Escape and a click outside close the menu', JSON.stringify({ esc, out }));

      // R5: a link, and a selection, keep the browser's own menu.
      const link = page.locator('#pj-room .msg[data-mid="m531"] a').first();
      const hasLink = await link.count();
      let linkTaken = null;
      if (hasLink) {
        linkTaken = await link.evaluate((a) => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }); a.dispatchEvent(ev); return ev.defaultPrevented; });
      }
      chk(hasLink && linkTaken === false, tag + 'R5 a right-click on a link keeps the browser menu', JSON.stringify({ hasLink, linkTaken }));
      const selTaken = await post.evaluate((row) => {
        const bd = row.querySelector('.msg-bd'); const r = document.createRange(); r.selectNodeContents(bd);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
        bd.dispatchEvent(ev); s.removeAllRanges(); return ev.defaultPrevented;
      });
      chk(selTaken === false, tag + 'R5 a right-click with text selected keeps the browser menu (its Copy)', String(selTaken));
      const plainTaken = await post.evaluate((row) => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }); row.querySelector('.msg-bd').dispatchEvent(ev); return ev.defaultPrevented; });
      chk(plainTaken === true, tag + 'CONTROL: the same right-click without a selection is taken', String(plainTaken));
      const guest = await page.evaluate(() => { const d = document.createElement('div'); d.className = 'msg ext'; d.setAttribute('data-mid', 'x-1b2c'); d.innerHTML = '<div class="msg-bd">Hi</div>';
        document.getElementById('pj-room').appendChild(d); const t = msgRefText(d); d.remove(); return t; });
      chk(guest === '', tag + 'CONTROL: a room row with no number (an outside guest) offers nothing to copy', JSON.stringify(guest));
      await page.keyboard.press('Escape');

      if (platform === 'Win32') {
        // R6: a direct conversation, rows with no number.
        await page.evaluate(([a2, a3]) => {
          document.getElementById('panel-projects').hidden = true;
          CURRENT = { sessionName: 'april', name: 'April' };
          LAST = [{ sessionName: 'april', name: 'April', state: 'idle' }];
          document.getElementById('panel-detail').hidden = false;
          const t = document.getElementById('d-dmthread');
          for (let el = t; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
          t.innerHTML = dmRow({ from: 'april', at: a2, text: 'The login fix is done.' }, 'April', false)
            + dmRow({ at: a3, text: 'Great, thanks', delivery: { state: 'placed', paneState: 'idle' } }, 'April', false);
          t.scrollIntoView();
        }, [at(2), at(3)]);
        const texts = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg')].map((r) => msgRefText(r)));
        chk(texts[0] === "April's message to me at 2:33 PM on Sep 29", tag + "R6 an agent's DM row copies whose it was and when", JSON.stringify(texts[0]));
        chk(texts[1] === 'my message to April at 2:34 PM on Sep 29', tag + "R6 the person's own row copies \"my message to April\"", JSON.stringify(texts[1]));
        // R6b: a DM row that does carry a number names the conversation, and keeps the number after a reaction repaint.
        const r6b = await page.evaluate((a4) => {
          const t = document.getElementById('d-dmthread');
          t.insertAdjacentHTML('beforeend', dmRow({ id: 'm77', from: 'april', at: a4, text: 'Numbered.' }, 'April', false));
          const row = t.lastElementChild; const box = row.querySelector('.rxns');
          const before = (row.querySelector('.rxn-ref-n') || {}).textContent || '';
          repaintReactions(box, [{ emoji: '\u{1F44D}', count: 1, who: ['you'], mine: true }]);
          const after = (row.querySelector('.rxn-ref-n') || {}).textContent || '';
          const text = msgRefText(row); row.remove();
          return { before, after, text };
        }, at(4));
        chk(r6b.before === '77' && r6b.after === '77' && r6b.text === 'message 77 in my conversation with April',
          tag + 'R6b a numbered DM row names the conversation and keeps its number after a reaction', JSON.stringify(r6b));
        const dmTaken = await page.evaluate(() => { const row = document.querySelector('#d-dmthread .msg.you .msg-bd'); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }); row.dispatchEvent(ev); return ev.defaultPrevented; });
        chk(dmTaken === true, tag + "R6 right-click works on the person's own DM row too (it has no hover bar)", String(dmTaken));
        await page.keyboard.press('Escape');
        const none = await page.evaluate(() => { const d = document.createElement('div'); d.className = 'msg'; d.setAttribute('data-mid', ''); document.getElementById('d-dmthread').appendChild(d); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); d.dispatchEvent(ev); d.remove(); return ev.defaultPrevented; });
        chk(none === false, tag + 'CONTROL: a row with nothing to name offers no menu', String(none));

        // R7: the clipboard refuses. Two arms, so a broken fallback cannot pass as a working one: the fallback copies
        // (execCommand says yes), and when it cannot, the toast shows the words (execCommand says no).
        await page.evaluate(() => { window.__clipFails = true; window.__copied.length = 0; });
        await page.evaluate(() => msgRefCopy(document.querySelector('#d-dmthread .msg:not(.you)')));
        await page.waitForTimeout(120);
        const r7a = await page.evaluate(() => ({ copied: window.__copied.slice(), toast: document.getElementById('msg-toast').textContent }));
        chk(r7a.copied.includes("fallback:April's message to me at 2:33 PM on Sep 29") && /^Copied "/.test(r7a.toast),
          tag + 'R7 with the clipboard refused, the fallback copies and says so', JSON.stringify(r7a));
        await page.evaluate(() => { window.__execNo = document.execCommand; document.execCommand = () => false; window.__copied.length = 0; });
        await page.evaluate(() => msgRefCopy(document.querySelector('#d-dmthread .msg:not(.you)')));
        await page.waitForTimeout(120);
        const r7b = await page.evaluate(() => ({ copied: window.__copied.slice(), toast: document.getElementById('msg-toast').textContent }));
        await page.evaluate(() => { document.execCommand = window.__execNo; window.__clipFails = false; });
        chk(r7b.copied.length === 0 && r7b.toast === "Could not copy. The reference is: April's message to me at 2:33 PM on Sep 29",
          tag + 'R7 when nothing can copy, the toast shows the words to copy by hand', JSON.stringify(r7b));
      }
      chk(errs.length === 0, tag + 'no page errors', errs.join(' | '));
      await ctx.close();
    }
    // R12: REAL WebKit (Safari and the Mac app's engine), which the Chromium passes above cannot stand in for. WebKit
    // selects the word under the pointer before it fires contextmenu, and does not focus a clicked button; each of
    // those once kept the menu from opening or from copying. A real right-click on a word, then a real click on the
    // menu item.
    let wk = null;
    try { wk = await require('playwright').webkit.launch({ headless: process.env.HEADED === '0' }); }
    catch (e) { console.log('SKIPPED  [webkit] R12: WebKit is not installed here (' + String(e && e.message || e).split('\n')[0] + '), so the Mac engine was NOT checked'); }
    if (wk) {
      try {
        const ctx = await wk.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
          window.setInterval = () => 0;
          window.__copied = [];
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } } });
          window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        });
        await page.goto(PAGE);
        await paintRoom(page);
        // MEASUREMENT (#4601): is something still SCROLLING when the right-click lands? Record scrollY, and every scrolling
        // element, from now; then wait until nothing has scrolled for 400ms before the click.
        await page.evaluate(() => { window.__sc = []; const t0 = performance.now(); window.__t0 = t0;
          document.addEventListener('scroll', (e) => window.__sc.push([Math.round(performance.now() - t0), e.target === document ? 'document' : (e.target.id || e.target.className || e.target.tagName), Math.round(scrollY), 'active=' + (document.activeElement && (document.activeElement.id || document.activeElement.tagName))]), true);
          document.addEventListener('focusin', (e) => window.__sc.push([Math.round(performance.now() - t0), 'FOCUSIN', e.target.id || e.target.tagName, Math.round(scrollY)]), true);
          window.addEventListener('resize', () => window.__sc.push([Math.round(performance.now() - t0), 'RESIZE', innerWidth + 'x' + innerHeight, document.documentElement.clientWidth]));
          document.addEventListener('focusout', (e) => window.__sc.push([Math.round(performance.now() - t0), 'FOCUSOUT', e.target.id || e.target.tagName, (e.relatedTarget && (e.relatedTarget.id || e.relatedTarget.tagName)) || 'none']), true); });
        // THE FIX under test (#4601): first-run's boot focuses its heading on a timer, even with #firstrun hidden by the
        // fixture, and that focus scrolls the document, which closes the menu. Wait for that focus (2s at most; on a
        // runner where it never comes, nothing is lost), then take it away, before the right-click.
        const frFocus = await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'fr-pane-1-h2', null, { timeout: 2000 }).then(() => true, () => false);
        await page.evaluate(() => { if (document.activeElement && document.activeElement.id === 'fr-pane-1-h2') document.activeElement.blur(); });
        console.log('PROBE-4601 frFocus ' + frFocus);
        // THE FIX under test, part 2 (#4601): after the fixture reveals the room, the page scrolls the document once
        // (to scrollY 144 here) anywhere from 0.16s to 2.1s later on Linux; landing after the right-click it closes the
        // menu (the page closes it on any scroll). Wait for that settle scroll (3s at most), then let it finish.
        const settled = await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 3000 }).then(() => true, () => false);
        await page.waitForTimeout(200);
        console.log('PROBE-4601 settleScroll ' + settled + ' at ' + (await page.evaluate(() => window.scrollY)));
        const settle = await page.evaluate(async () => { const start = performance.now(); let last = window.__sc.length, quietSince = performance.now();
          while (performance.now() - start < 5000) { await new Promise((r) => setTimeout(r, 50)); if (window.__sc.length !== last) { last = window.__sc.length; quietSince = performance.now(); } else if (performance.now() - quietSince >= 400) break; }
          return { waited: Math.round(performance.now() - start), before: window.__sc.slice(0, 12), count: window.__sc.length }; });
        console.log('PROBE-4601 settle ' + JSON.stringify(settle));
        const word = await page.evaluate(() => {
          const p = document.querySelector('#pj-room .msg[data-mid="m530"] .msg-bd p') || document.querySelector('#pj-room .msg[data-mid="m530"] .msg-bd');
          const tn = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
          const r = document.createRange(); const i = tn.textContent.indexOf('AtlasGrid'); r.setStart(tn, i); r.setEnd(tn, i + 9);
          const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        // MEASUREMENT (#4601): every pointer/mouse event the right-click delivers, and the menu's state over time.
        await page.evaluate(() => { window.__ev = []; const t0 = performance.now(); const menu = () => { const m = document.getElementById('msg-menu'); return m ? (m.hidden ? 'hidden' : 'open') : 'none'; };
          for (const k of ['pointerdown', 'mousedown', 'contextmenu', 'pointerup', 'mouseup', 'auxclick', 'click', 'blur', 'focusout', 'scroll', 'selectionchange'])
            document.addEventListener(k, (e) => window.__ev.push([Math.round(performance.now() - t0), k, e.button, e.target && (e.target.id || e.target.className || e.target.tagName), menu()]), true);
          window.__poll = []; const tick = () => { const st = menu(); const last = window.__poll[window.__poll.length - 1]; if (!last || last[1] !== st) window.__poll.push([Math.round(performance.now() - t0), st, document.activeElement && (document.activeElement.id || document.activeElement.tagName), document.visibilityState, document.hasFocus()]); window.__polls = (window.__polls || 0) + 1; if (window.__polls < 400) setTimeout(tick, 25); }; tick(); });
        await page.mouse.click(word.x, word.y, { button: 'right' });
        await page.waitForTimeout(150);
        console.log('PROBE-4601 events ' + JSON.stringify(await page.evaluate(() => window.__ev)));
        console.log('PROBE-4601 menu   ' + JSON.stringify(await page.evaluate(() => window.__poll)));
        console.log('PROBE-4601 after  ' + JSON.stringify(await page.evaluate(() => window.__sc.slice(-6))));
        console.log('PROBE-4601 later  ' + JSON.stringify(await page.evaluate(() => ({ sc: window.__sc.slice(-8), menu: (document.getElementById('msg-menu') || {}).hidden, cw: document.documentElement.clientWidth, iw: innerWidth }))));
        const r12a = await page.evaluate(() => ({ open: !!document.getElementById('msg-menu') && !document.getElementById('msg-menu').hidden,
          sel: String(getSelection()) }));
        chk(r12a.open && r12a.sel === '', '[webkit] R12 a real right-click on a word opens the menu (and leaves no stray word selected)', JSON.stringify(r12a));
        console.log('PROBE-4601 pre-copy ' + JSON.stringify(await page.evaluate(() => ({ poll: window.__poll, ev: (window.__ev || []).slice(-8), sc: (window.__sc || []).slice(-6) }))));
        if (r12a.open) {
          await page.click('#msg-menu-copy');
          await page.waitForTimeout(150);
        }
        const r12b = await page.evaluate(() => ({ copied: window.__copied.slice(), hidden: !document.getElementById('msg-menu') || document.getElementById('msg-menu').hidden }));
        chk(r12b.copied[0] === 'message 530 in Kosmos Growth' && r12b.hidden, '[webkit] R12 a real click on the item copies the reference', JSON.stringify(r12b));
        // Text the person had selected themselves still gets the browser's menu (its Copy).
        await page.evaluate(() => { const bd = document.querySelector('#pj-room .msg[data-mid="m531"] .msg-bd'); const r = document.createRange(); r.selectNodeContents(bd); getSelection().removeAllRanges(); getSelection().addRange(r); });
        const own = await page.evaluate(() => { const b = document.querySelector('#pj-room .msg[data-mid="m531"] .msg-bd').getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; });
        await page.mouse.click(own.x, own.y, { button: 'right' });
        await page.waitForTimeout(150);
        const r12c = await page.evaluate(() => !document.getElementById('msg-menu') || document.getElementById('msg-menu').hidden);
        chk(r12c, '[webkit] R12 CONTROL: with the person\'s own selection, the browser keeps its menu', String(r12c));
        chk(errs.length === 0, '[webkit] no page errors', errs.join(' | '));
        await ctx.close();
      } finally { await wk.close(); }
    }
  } finally {
    await browser.close();
  }
  console.log('');
  if (fail.length) { console.log(fail.length + ' failed'); process.exit(1); }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
