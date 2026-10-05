// Browser-check-surface: pj-room d-dmthread rxns rxn-quick rxn-ref rxn-copy msg-menu msg-menu-copy msg-menu-text msg-toast pj-one-name
'use strict';
/* #4631 (Josh, 2026-09-29 14:42): "would be even cooler if i could like ctrl + click and get a message ID from any
 * message to then reference it to an agent later on". In the real page (web/index.html from disk, fetch stubbed):
 *
 *   R1  a room post's hover bar has Copy message id (once Copy reference), showing the number faintly; Reply stays last (#4358)
 *   R2  clicking it copies "message 530 in Kosmos Growth" and says so in a toast
 *   R3  right-clicking the post opens the menu, and its Copy message id (once Copy message reference) copies the same words
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
 * #5312 (Josh, 2026-10-05): "two buttons instead for a 'copy message' and 'copy message id'":
 *   C1  the bar starts Copy message, then Copy message id; Copy message copies the whole text as written
 *   C2  a long message copies in full (no "[cut]"), line breaks kept; attachments copy as their file names
 *   C3  the menu offers Copy message then Copy message id; the arrow keys move between them; each copies its own
 *   C4  an outside guest's row (no id) offers Copy message alone, from what the row shows
 *   C5  a direct-conversation row copies its own record's words; a failed copy says so without the words
 *   C6  on a touchscreen the bar keeps seven buttons: Copy (named for its menu) opens the menu with both, and the bar fits
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
      { kind: 'post', id: 'm532', from: 'april', to: [], project: 'p1', at: a1, text: 'First line\n\n' + 'word '.repeat(900) + 'END' },
      { kind: 'post', id: 'm533', from: 'april', to: [], project: 'p1', at: a1, text: 'Here are both.',
        attachments: [{ name: 'Brief.pdf', url: '/api/files/1', kind: 'pdf' }, { name: 'Logo.png', url: '/api/files/2', kind: 'image' }] },
      { kind: 'post', id: 'm534', from: 'april', to: [], project: 'p1', at: a1, text: 'Deck.pptx', attachments: [{ name: 'Deck.pptx', url: '/api/files/3', kind: 'other' }] },
    ];
    PJ_ROOM_POSTS = new Map(rows.map((r) => [r.id, r])); PJ_CURRENT = 'p1'; PJ_ROOM_POSTS_OF = 'p1';   // painted for this project
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
      const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, timezoneId: 'America/Chicago', locale: 'en-US' });   // #5312: the narrow common phone
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
      /* C6: on a touchscreen the bar keeps #4409's seven buttons (an eighth covered the corner of the message under it, so a
         tap meant to close the bar hit Reply): Copy opens the menu with both, and a phone has no right-click to reach it
         otherwise. Opened by a real tap on the message, so the page's own placement runs. */
      await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } }); });
      const tp = await page.evaluate(() => { const bd = document.querySelector('#pj-room .msg[data-mid="m530"] .msg-bd'); const r = bd.getBoundingClientRect(); return { x: r.right - 12, y: r.bottom - 6 }; });
      await page.touchscreen.tap(tp.x, tp.y);
      await page.waitForTimeout(250);
      const c6 = await page.evaluate(() => {
        const row = document.querySelector('#pj-room .msg[data-mid="m530"]'); const room = document.getElementById('pj-room');
        const q = row.querySelector('.rxn-quick'); const qr = q.getBoundingClientRect();
        const inL = room.getBoundingClientRect().left + room.clientLeft; const inR = inL + room.clientWidth;
        const shown = [...q.children].filter((k) => k.getClientRects().length).map((k) => k.className.split(' ')[0]);
        const cp = q.querySelector('.rxn-copy').getBoundingClientRect();
        const cb = q.querySelector('.rxn-copy');
        return { name: cb.getAttribute('aria-label'), popup: cb.getAttribute('aria-haspopup'), open: row.classList.contains('rxn-show'), shown: shown.join(','), copy: [Math.round(cp.width), Math.round(cp.height)], barH: Math.round(qr.height),
          inside: qr.left >= inL - 0.5 && qr.right <= inR + 0.5, bar: [Math.round(qr.left), Math.round(qr.right)], thread: [Math.round(inL), Math.round(inR)] };
      });
      chk(c6.name === 'Copy message or its id' && c6.popup === 'menu', '[touch] C6 Copy is named for what it opens (a menu with both)', JSON.stringify(c6));
      // The touch test changing (a pointer attached) renames it for what a press then does, and back.
      const relabel = await page.evaluate(() => { const real = window.matchMedia; const b = document.querySelector('#pj-room .msg[data-mid="m530"] .rxn-copy');
        window.matchMedia = (q) => ({ matches: false, media: q }); msgCopyRelabel(); const pointer = [b.getAttribute('aria-label'), b.getAttribute('aria-haspopup')];
        window.matchMedia = real; msgCopyRelabel(); const touch = [b.getAttribute('aria-label'), b.getAttribute('aria-haspopup')]; return { pointer, touch }; });
      chk(relabel.pointer[0] === 'Copy message' && relabel.pointer[1] === null && relabel.touch[0] === 'Copy message or its id' && relabel.touch[1] === 'menu',
        '[touch] C6 a change of the touch test renames Copy for what a press then does', JSON.stringify(relabel));
      chk(c6.open && c6.shown === 'rxn-copy,rxn-pick,rxn-pick,rxn-pick,rxn-more,rxn-speak,rxn-reply' && c6.copy[0] >= 36 && c6.copy[1] >= 36 && c6.barH < 50 && c6.inside,
        '[touch] C6 a tapped-open bar keeps seven buttons (Copy, no Copy message id), Copy a room-sized target, on one line inside the thread', JSON.stringify(c6));
      await page.locator('#pj-room .msg[data-mid="m530"] .rxn-copy').tap();
      await page.waitForTimeout(150);
      const c6m = await page.evaluate(() => { const m = document.getElementById('msg-menu'); return m ? { shown: !m.hidden, items: [...m.querySelectorAll('.msg-menu-i:not([hidden])')].map((i) => i.textContent.trim()).join('|'),
        open: !!document.querySelector('#pj-room .msg.rxn-show'), copied: window.__copied.slice() } : null; });
      chk(c6m && c6m.shown && c6m.items === 'Copy message|Copy message id' && c6m.copied.length === 0,
        '[touch] C6 Copy opens the menu with Copy message and Copy message id (and copies nothing yet)', JSON.stringify(c6m));
      if (c6m && c6m.shown) {
        await page.locator('#msg-menu-copy').tap(); await page.waitForTimeout(150);
        const idCopied = await page.evaluate(() => window.__copied.slice());
        chk(idCopied[0] === 'message 530 in Kosmos Growth', '[touch] C6 Copy message id in that menu copies the reference', JSON.stringify(idCopied));
      }
      // A row with nothing to copy: Copy says so instead of doing nothing (the menu does not open empty).
      const none = await page.evaluate(() => new Promise((res) => { const d = document.createElement('div'); d.className = 'msg'; d.setAttribute('data-mid', 'x-none');
        document.getElementById('pj-room').appendChild(d); const b = document.createElement('button'); d.appendChild(b);
        msgCopyPressed(b, d); setTimeout(() => { const m = document.getElementById('msg-menu'); const t = document.getElementById('msg-toast');
          const out = { menu: !!m && !m.hidden, toast: t && !t.hidden ? t.textContent || msgToast.words : null }; d.remove(); res(out); }, 120); }));
      chk(!none.menu && none.toast === 'There is nothing to copy in this message.', '[touch] C6 Copy on a row with nothing to copy says so', JSON.stringify(none));
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
          const kids = [...q.children].map((k) => k.classList.contains('rxn-ref') ? 'ref' : k.classList.contains('rxn-copy') ? 'copy' : k.classList.contains('rxn-reply') ? 'reply' : k.classList.contains('rxn-speak') ? 'speak' : k.classList.contains('rxn-more') ? 'more' : k.classList.contains('rxn-pick') ? 'pick' : '?');
          const ref = q.querySelector('.rxn-ref');
          const r = ref.getBoundingClientRect();
          const cp = q.querySelector('.rxn-copy');
          return { kids: kids.join(','), n: (ref.querySelector('.rxn-ref-n') || {}).textContent, label: ref.getAttribute('aria-label'), title: ref.title,
            copyLabel: cp && cp.getAttribute('aria-label'), copyTitle: cp && cp.title,
            op: Number(getComputedStyle(q).opacity), h: r.height, w: r.width };
        });
        chk(bar.kids === 'copy,ref,pick,pick,pick,more,speak,reply', tag + 'C1 the bar starts Copy message, then Copy message id, and keeps Reply last (an agent\'s post, so read aloud, #4409, sits before it)', bar.kids);
        chk(bar.n === '530' && bar.label === 'Copy message id 530' && bar.title === 'Copy message id' && bar.op === 1, tag + 'R1 on hover Copy message id shows the number, and says what it copies', JSON.stringify(bar));
        chk(bar.copyLabel === 'Copy message' && bar.copyTitle === 'Copy message', tag + 'C1 Copy message is labelled in Josh\'s words', JSON.stringify(bar));
        chk(bar.h >= 24 && bar.w >= 24, tag + 'R1 the button is a 24px target (WCAG 2.5.8)', bar.w + 'x' + bar.h);
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await post.screenshot({ path: path.join(SHOTS, 'hover-bar.png') }); }
        await post.locator('.rxn-ref').click();
        await page.waitForTimeout(100);
        const r2 = await page.evaluate(() => ({ copied: window.__copied.slice(), toast: (document.getElementById('msg-toast') || {}).textContent, shown: !!document.getElementById('msg-toast') && !document.getElementById('msg-toast').hidden }));
        chk(r2.copied[0] === 'message 530 in Kosmos Growth', tag + 'R2 the button copies the reference', JSON.stringify(r2.copied));
        chk(r2.shown && /Copied "message 530 in Kosmos Growth"\. Paste it to any agent\./.test(r2.toast || ''), tag + 'R2 a toast says what was copied', r2.toast);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'toast.png') });

        // C1: Copy message copies the whole text, as written.
        await page.evaluate(() => { window.__copied.length = 0; });
        await post.hover();
        await post.locator('.rxn-copy').click();
        await page.waitForTimeout(100);
        const c1 = await page.evaluate(() => ({ copied: window.__copied.slice(), toast: document.getElementById('msg-toast').textContent }));
        chk(c1.copied[0] === 'The AtlasGrid deck is ready for review.' && c1.toast === 'Copied the message.', tag + 'C1 Copy message copies the whole text and says so', JSON.stringify(c1));
        // C2: a long message in full, its blank line kept; attachments by name; a files-only post names them once.
        const c2 = await page.evaluate(() => ['m532', 'm533', 'm534'].map((id) => msgCopyText(document.querySelector('#pj-room .msg[data-mid="' + id + '"]'))));
        chk(c2[0].startsWith('First line\n\nword word') && c2[0].endsWith('word END') && c2[0].length === 'First line\n\n'.length + 'word '.length * 900 + 3 && !/\[cut\]/.test(c2[0]),
          tag + 'C2 a long message copies in full, line breaks kept, with no [cut]', c2[0].length + ' ' + JSON.stringify(c2[0].slice(-20)));
        chk(c2[1] === 'Here are both.\nBrief.pdf\nLogo.png', tag + 'C2 attachments copy as their file names, each on its own line', JSON.stringify(c2[1]));
        chk(c2[2] === 'Deck.pptx', tag + 'C2 a post that is only a file copies its name once', JSON.stringify(c2[2]));
        const c2b = await page.evaluate(() => msgCopyWords({ text: '\n\n  indented first line\nlast  \n\n' }));
        chk(c2b === '  indented first line\nlast', tag + 'C2 blank lines come off both ends, and the first line keeps its indent', JSON.stringify(c2b));
        const c2c = await page.evaluate(() => { const d = document.createElement('div'); d.className = 'msg'; d.setAttribute('data-mid', 'x-none');
          document.getElementById('pj-room').appendChild(d); msgMenuOpen(d, 20, 20); const m = document.getElementById('msg-menu'); const shown = !m.hidden; d.remove(); return shown; });
        chk(c2c === false, tag + 'C3 a row with nothing to copy opens no (empty) menu', String(c2c));
      }

      // R3: right-click (on a Mac this is also ctrl-click).
      await page.evaluate(() => { window.__copied.length = 0; });
      const box = await post.locator('.msg-bd').boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
      const menu = await page.evaluate(() => { const m = document.getElementById('msg-menu'); return m ? { shown: !m.hidden,
        items: [...m.querySelectorAll('.msg-menu-i:not([hidden])')].map((i) => i.textContent.trim()).join('|'), focus: document.activeElement && document.activeElement.id } : null; });
      chk(menu && menu.shown && menu.items === 'Copy message|Copy message id' && menu.focus === 'msg-menu-text', tag + 'C3 right-click opens the menu, Copy message then Copy message id, the first focused', JSON.stringify(menu));
      await page.keyboard.press('ArrowDown');
      const down = await page.evaluate(() => document.activeElement && document.activeElement.id);
      await page.keyboard.press('ArrowDown');
      const wrap = await page.evaluate(() => document.activeElement && document.activeElement.id);
      chk(down === 'msg-menu-copy' && wrap === 'msg-menu-text', tag + 'C3 the arrow keys move between the two items, and wrap', JSON.stringify({ down, wrap }));
      await page.click('#msg-menu-text');
      await page.waitForTimeout(100);
      const c3 = await page.evaluate(() => ({ copied: window.__copied.slice(), hidden: document.getElementById('msg-menu').hidden }));
      chk(c3.copied[0] === 'The AtlasGrid deck is ready for review.' && c3.hidden, tag + 'C3 Copy message in the menu copies the whole text and closes the menu', JSON.stringify(c3));
      await page.evaluate(() => { window.__copied.length = 0; });
      await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
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
      chk(guest === '', tag + 'CONTROL: a room row with no number (an outside guest) has no id to copy', JSON.stringify(guest));
      /* Drawn by the page's own renderer (pjRoomRow's external branch), so what the fallback strips is what a real row holds. */
      const c4 = await page.evaluate(() => { const box = document.createElement('div');
        box.innerHTML = pjRoomRow({ kind: 'external', id: 'x-1b2c', from: 'Ben', fromKind: 'person', at: new Date().toISOString(), text: 'Hi there\nsecond line' }, { id: 'p1', name: 'Kosmos Growth', agents: [] }, false);
        const d = box.firstElementChild; document.getElementById('pj-room').appendChild(d);
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }); d.querySelector('.msg-ext-tx').dispatchEvent(ev);
        const m = document.getElementById('msg-menu');
        const out = { text: msgCopyText(d), taken: ev.defaultPrevented, items: [...m.querySelectorAll('.msg-menu-i:not([hidden])')].map((i) => i.id).join('|'), focus: document.activeElement && document.activeElement.id };
        msgMenuClose(false); d.remove(); return out; });
      chk(c4.text === 'Hi there\nsecond line' && c4.taken && c4.items === 'msg-menu-text' && c4.focus === 'msg-menu-text',
        tag + 'C4 an outside guest\'s row offers Copy message alone, its words without the name, tag or time', JSON.stringify(c4));
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
        // C5: a DM row copies its own record's words (as written, before the screen drops a leading name), found by `at`.
        const c5 = await page.evaluate((a5) => {
          const t = document.getElementById('d-dmthread');
          const rec = { from: 'april', at: a5, text: 'April: the record says this\nand this' };
          DM_ROWS = new Map([[a5, rec]]); DM_ROWS_OF = 'april';
          t.insertAdjacentHTML('beforeend', dmRow(rec, 'April', false));
          const row = t.lastElementChild; const out = msgCopyText(row);
          DM_ROWS_OF = 'someone-else'; const stale = msgCopyText(row);   // a store painted for another agent is not read
          row.remove(); DM_ROWS = new Map(); DM_ROWS_OF = null; return { out, stale };
        }, at(5));
        chk(c5.out === 'April: the record says this\nand this', tag + 'C5 a direct-conversation row copies its record\'s words', JSON.stringify(c5));
        chk(c5.stale === 'the record says this\nand this', tag + 'C5 a store painted for another agent is not read: the row\'s own words instead', JSON.stringify(c5));
        /* A row a repaint detached while the menu was open is in neither thread: it copies its own words, never a DM record
           that happens to share its id. */
        const c5d = await page.evaluate(() => { const row = document.querySelector('#pj-room .msg[data-mid="m530"]'); const clone = row.cloneNode(true);
          DM_ROWS = new Map([['x', { id: 'm530', at: 'x', text: 'A DIFFERENT MESSAGE' }]]); const out = msgCopyText(clone); DM_ROWS = new Map(); return out; });
        chk(c5d === 'The AtlasGrid deck is ready for review.', tag + 'C5 a detached room row copies its own words, not a DM record with the same id', JSON.stringify(c5d));
        /* The screen fallback drops a link's preview card (its site, title and description are not the message). */
        const c5p = await page.evaluate(() => { const box = document.createElement('div');
          box.innerHTML = pjRoomRow({ kind: 'post', id: 'm599', from: 'april', to: [], project: 'p1', at: new Date().toISOString(), text: 'See https://example.com/a',
            preview: { url: 'https://example.com/a', site: 'PREVIEWSITE', title: 'PREVIEWTITLE', description: 'PREVIEWDESC' } }, { id: 'p1', name: 'Kosmos Growth', agents: [{ sessionName: 'april', name: 'April' }] }, false);
          const row = box.firstElementChild; return { hasCard: !!row.querySelector('.lpv'), text: msgCopyText(row) }; });
        chk(c5p.hasCard && /^See /.test(c5p.text) && !/PREVIEW/.test(c5p.text), tag + 'C5 a row copied from the screen leaves out a link\'s preview card', JSON.stringify(c5p));
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
        await page.evaluate(() => msgTextCopy(document.querySelector('#d-dmthread .msg:not(.you)')));
        await page.waitForTimeout(120);
        const c5b = await page.evaluate(() => document.getElementById('msg-toast').textContent);
        await page.evaluate(() => { document.execCommand = window.__execNo; window.__clipFails = false; });
        chk(c5b === 'Could not copy. Select the message and copy it instead.', tag + 'C5 when Copy message cannot copy, the toast says so without the words (a message can be long)', JSON.stringify(c5b));
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
        const word = await page.evaluate(() => {
          const p = document.querySelector('#pj-room .msg[data-mid="m530"] .msg-bd p') || document.querySelector('#pj-room .msg[data-mid="m530"] .msg-bd');
          const tn = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
          const r = document.createRange(); const i = tn.textContent.indexOf('AtlasGrid'); r.setStart(tn, i); r.setEnd(tn, i + 9);
          const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        await page.mouse.click(word.x, word.y, { button: 'right' });
        await page.waitForTimeout(150);
        const r12a = await page.evaluate(() => ({ open: !!document.getElementById('msg-menu') && !document.getElementById('msg-menu').hidden,
          sel: String(getSelection()) }));
        chk(r12a.open && r12a.sel === '', '[webkit] R12 a real right-click on a word opens the menu (and leaves no stray word selected)', JSON.stringify(r12a));
        if (r12a.open) {
          /* #4601: a click where the item is DRAWN. page.click scrolls its target into view first, and any scroll closes
             this menu (the page closes it on scroll), so on a runner where that scroll happens (Linux WebKit, about half
             the first attempts) the click found the item hidden. A person clicks a visible menu item without scrolling. */
          const ib = await page.evaluate(() => { const r = document.getElementById('msg-menu-copy').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          await page.mouse.click(ib.x, ib.y);
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
