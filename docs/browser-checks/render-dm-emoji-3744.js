// Browser-check-surface: d-emoji-btn d-emoji d-say pj-emoji-btn pj-emoji emojibtn emojipanel
'use strict';

/**
 * kosmos#3744 (Josh, 2026-09-25 09:29: "We need emoji support in the agent DM."). The project
 * room's composer had the grey smiley and its panel (#2254, greyed by #2357); an agent's Direct
 * Message composer had only "+", the input and Post. This asserts, on the REAL rendered DM, on a
 * Mac and on Windows (the platform meta rewritten):
 *   - the DM composer has the grey smiley, in the same box as "+" and the input, with the room's
 *     accessible name, aria-controls and muted glyph;
 *   - a real mouse press opens the panel above the box, inside the window, with the room's list
 *     (the same PJ_EMOJI, not a second copy);
 *   - a pick inserts the emoji AT THE CARET, keeps focus in the input, and the panel stays open;
 *   - the keyboard works: Enter on the smiley opens it, Enter on an emoji inserts it, Escape
 *     closes it;
 *   - Post sends the emoji in the message body, and the message renders with it;
 *   - a box the agent cannot be reached through greys the smiley and closes the panel;
 *   - the room's own picker still opens and inserts into the room's input, and opening one
 *     panel closes the other.
 * Every arm fails on main, which has no #d-emoji-btn. Screenshots to argv[2] when given.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-emoji-3744.js [shotsDir]
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-dm-emoji-3744: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const now = () => new Date().toISOString();
const FX = {
  messages: [{ from: 'April', at: now(), text: 'ready when you are.' }],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-dm-emoji-3744: could not start a browser: ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  try {
    for (const platform of ['darwin', 'win32']) {
      const t = `[${platform}]`;
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      await page.addInitScript(() => {
        window.__fx = null;
        window.__posts = [];
        window.__threadFails = false;
        const enc = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/thread') && opts && opts.method === 'POST') {
            const body = JSON.parse(opts.body || '{}');
            window.__posts.push(body);
            window.__fx.messages.push({ at: new Date().toISOString(), text: body.text, delivery: { state: 'placed', paneState: 'idle' } });
            return enc({ ok: true, delivery: { state: 'placed', paneState: 'idle' } });
          }
          if (u.includes('/thread') && window.__threadFails) return enc({ error: 'we could not read this conversation' }, 500);
          if (u.includes('/thread')) return enc(window.__fx);
          if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
          return enc({});
        };
      });
      await page.goto(PAGE);
      // The platform is read from this meta at call time (onWindows), so setting it before the paint
      // is what a Windows board serves.
      if (platform === 'win32') await page.evaluate(() => { document.querySelector('meta[name="kosmos-platform"]').content = 'win32'; });
      const meta = await page.evaluate(() => ({ content: (document.querySelector('meta[name="kosmos-platform"]') || {}).content, win: onWindows() }));
      chk(meta.win === (platform === 'win32'), `${t} the page believes it is on ${platform}`, JSON.stringify(meta));
      await page.evaluate((f) => {
        window.__fx = JSON.parse(JSON.stringify(f));
        CURRENT = { sessionName: 'april', name: 'April' };
        document.getElementById('panel-detail').hidden = false;
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      }, FX);
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);

      // The smiley: present, in the DM's own box, beside "+", named and muted as the room's is.
      const mark = await page.evaluate(() => {
        const b = document.getElementById('d-emoji-btn');
        if (!b) return { present: false };
        const box = document.getElementById('d-say').closest('.composerbox');
        const room = document.getElementById('pj-emoji-btn');
        const glyph = b.querySelector('.emojibtn-glyph');
        return {
          present: true, visible: b.getBoundingClientRect().width > 0, sameBox: !!box && box.contains(b) && box.contains(document.getElementById('d-attach')),
          cls: b.className, label: b.getAttribute('aria-label'), roomLabel: room.getAttribute('aria-label'),
          controls: b.getAttribute('aria-controls'), expanded: b.getAttribute('aria-expanded'), disabled: b.disabled,
          filter: glyph ? getComputedStyle(glyph).filter : null, roomFilter: getComputedStyle(room.querySelector('.emojibtn-glyph')).filter,
        };
      });
      chk(mark.present && mark.visible && mark.sameBox, `${t} the DM composer has the grey smiley, in the same box as "+" and the input`, JSON.stringify(mark));
      chk(mark.present && mark.cls === 'emojibtn' && mark.label === mark.roomLabel && mark.controls === 'd-emoji' && mark.expanded === 'false' && !mark.disabled,
        `${t} it is the room's button: same name, controls its own panel, closed`, JSON.stringify(mark));
      chk(mark.present && mark.filter === mark.roomFilter && /grayscale/.test(mark.filter || ''), `${t} its glyph is muted grey, as the room's is (#2357)`, JSON.stringify(mark));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `3744-${platform}-1-dm-composer.png`) });
      if (!mark.present) { await page.close(); continue; }

      // A real mouse press opens it above the box, inside the window, with the room's list.
      await page.click('#d-say');
      await page.keyboard.type('hi there');
      await page.evaluate(() => { const s = document.getElementById('d-say'); s.setSelectionRange(2, 2); });
      await page.click('#d-emoji-btn');
      await page.waitForTimeout(80);
      const open = await page.evaluate(() => {
        const panel = document.getElementById('d-emoji');
        const r = panel.getBoundingClientRect();
        const box = document.getElementById('d-say').closest('.composerbox').getBoundingClientRect();
        const glyphs = [...panel.querySelectorAll('button[data-emoji]')].map((b) => b.dataset.emoji);
        return { shown: !panel.hidden && r.height > 0, expanded: document.getElementById('d-emoji-btn').getAttribute('aria-expanded'),
          count: glyphs.length, same: JSON.stringify(glyphs) === JSON.stringify(PJ_EMOJI), above: r.bottom <= box.top + 8,
          inside: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, role: panel.getAttribute('role'), plabel: panel.getAttribute('aria-label') };
      });
      chk(open.shown && open.expanded === 'true' && open.role === 'group' && open.plabel === 'Pick an emoji', `${t} a mouse press opens the panel`, JSON.stringify(open));
      chk(open.count >= 70 && open.same, `${t} the panel is the room's own list (PJ_EMOJI), not a second copy`, JSON.stringify({ count: open.count, same: open.same }));
      chk(open.above && open.inside, `${t} it opens above the box, inside the window`, JSON.stringify(open));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `3744-${platform}-2-dm-emoji-open.png`) });

      // A pick inserts at the caret, keeps focus in the input, and leaves the panel open.
      const first = await page.evaluate(() => document.querySelector('#d-emoji button[data-emoji]').dataset.emoji);
      await page.click('#d-emoji button[data-emoji]');
      await page.waitForTimeout(50);
      const pick = await page.evaluate((g) => {
        const s = document.getElementById('d-say');
        return { value: s.value, caret: s.selectionStart, want: 2 + g.length, focus: document.activeElement === s,
          open: !document.getElementById('d-emoji').hidden, roomValue: document.getElementById('pj-post').value };
      }, first);
      chk(pick.value === 'hi' + first + ' there' && pick.caret === pick.want, `${t} a pick inserts the emoji at the caret, not at the end`, JSON.stringify(pick));
      chk(pick.focus && pick.open && pick.roomValue === '', `${t} focus stays in the DM input, the panel stays open, the room's input is untouched`, JSON.stringify(pick));
      // The pick is a typed character to everything listening: the draft kept for April holds it.
      const draft = await page.evaluate(() => (typeof TALK_DRAFTS !== 'undefined' && TALK_DRAFTS.april) || null);
      chk(draft === pick.value, `${t} the draft kept for April holds the emoji (a pick fires input, like typing)`, JSON.stringify({ draft, value: pick.value }));

      // The keyboard: Escape closes; Enter on the smiley opens; Enter on an emoji inserts.
      await page.keyboard.press('Escape');
      const esc = await page.evaluate(() => ({ hidden: document.getElementById('d-emoji').hidden, expanded: document.getElementById('d-emoji-btn').getAttribute('aria-expanded') }));
      chk(esc.hidden && esc.expanded === 'false', `${t} Escape closes it`, JSON.stringify(esc));
      await page.focus('#d-emoji-btn');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
      await page.focus('#d-emoji button[data-emoji]:nth-child(2)');
      const second = await page.evaluate(() => document.activeElement.dataset.emoji);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
      const kb = await page.evaluate(() => ({ value: document.getElementById('d-say').value, focus: document.activeElement && document.activeElement.id }));
      chk(kb.value.includes(second) && kb.focus === 'd-say', `${t} the keyboard opens it and picks with Enter, landing back in the input`, JSON.stringify({ ...kb, second }));
      await page.keyboard.press('Escape');

      // Post sends the emoji, and the message renders with it.
      await page.click('#d-send');
      await page.waitForTimeout(250);
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);
      const sent = await page.evaluate((g) => {
        const last = window.__posts[window.__posts.length - 1];
        const rows = [...document.querySelectorAll('#d-dmthread .msg.you')].map((r) => r.textContent);
        return { posted: last ? last.text : null, rendered: rows.some((x) => x.includes(g)), g };
      }, first);
      chk(sent.posted && sent.posted.includes(first) && sent.posted.includes(second), `${t} Post sends the emoji in the message`, JSON.stringify(sent));
      chk(sent.rendered, `${t} the sent message renders with the emoji`, JSON.stringify(sent));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `3744-${platform}-3-dm-emoji-sent.png`) });

      // A box the agent cannot be reached through: the smiley greys and the panel closes.
      await page.click('#d-emoji-btn');
      await page.waitForTimeout(50);
      await page.evaluate(() => { window.__fx.presence = 'off'; window.__fx.presenceBecause = 'April is not running'; });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);
      const off = await page.evaluate(() => ({ say: document.getElementById('d-say').disabled, btn: document.getElementById('d-emoji-btn').disabled,
        panel: document.getElementById('d-emoji').hidden, opacity: getComputedStyle(document.getElementById('d-emoji-btn')).opacity }));
      chk(off.say && off.btn && off.panel && off.opacity === '0.5', `${t} a box April cannot be reached through greys the smiley and closes the panel`, JSON.stringify(off));
      await page.evaluate(() => { window.__fx.presence = 'on'; window.__fx.presenceBecause = null; });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);
      const on = await page.evaluate(() => ({ btn: document.getElementById('d-emoji-btn').disabled }));
      chk(!on.btn, `${t} and it comes back with the box`, JSON.stringify(on));

      // The other way the box closes: the conversation cannot be read at all.
      await page.click('#d-emoji-btn');
      await page.waitForTimeout(50);
      await page.evaluate(() => { window.__threadFails = true; });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);
      const unread = await page.evaluate(() => {
        const say = document.getElementById('d-say'); const before = say.value;
        pjEmojiInsert('\u{1F680}', 'agent');   // a pick that reaches a closed box anyway is refused
        return { say: say.disabled, btn: document.getElementById('d-emoji-btn').disabled, panel: document.getElementById('d-emoji').hidden, refused: say.value === before };
      });
      chk(unread.say && unread.btn && unread.panel, `${t} a conversation that cannot be read greys the smiley and closes the panel too`, JSON.stringify(unread));
      chk(unread.refused, `${t} an emoji is never put into a closed box`, JSON.stringify(unread));
      await page.evaluate(() => { window.__threadFails = false; });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);

      // Leaving for another agent takes the panel with it, as it takes the words.
      await page.click('#d-emoji-btn');
      await page.waitForTimeout(50);
      const sw = await page.evaluate(async () => {
        const was = !document.getElementById('d-emoji').hidden;
        // openDetail opens only an agent the board knows, so Bob is put on it (minimal, as the poll would).
        LAST = [{ sessionName: 'april', name: 'April', state: 'idle', running: true }, { sessionName: 'bob', name: 'Bob', state: 'idle', running: true }];
        try { openDetail('bob', 'talk'); } catch (e) { return { was, threw: String(e && e.message || e) }; }
        await new Promise((r) => setTimeout(r, 150));
        return { was, open: !document.getElementById('d-emoji').hidden, expanded: document.getElementById('d-emoji-btn').getAttribute('aria-expanded') };
      });
      chk(sw.was && !sw.threw && !sw.open && sw.expanded === 'false', `${t} switching to another agent closes the panel`, JSON.stringify(sw));
      await page.evaluate(() => { CURRENT = { sessionName: 'april', name: 'April' }; });
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(150);

      // A short window: the panel is not cut off by the conversation's scroll box, whose top edge it
      // used to rise past; every part of it is on screen and is the panel, not what is behind it.
      // 420 is the case that clipped: the composer sits within a panel's height of the scroll box's top.
      for (const h of [620, 420]) {
        await page.setViewportSize({ width: 1200, height: h });
        await page.waitForTimeout(100);
        await page.click('#d-emoji-btn');
        await page.waitForTimeout(80);
        const shortW = await page.evaluate(() => {
          const panel = document.getElementById('d-emoji');
          const r = panel.getBoundingClientRect();
          const probe = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && panel.contains(el); };
          const tb = document.getElementById('d-talk-box').getBoundingClientRect();
          const box = document.getElementById('d-say').closest('.composerbox').getBoundingClientRect();
          return { tight: box.top - tb.top < r.height + 8, top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: innerHeight,
            topHit: probe(r.left + r.width / 2, r.top + 4), bottomHit: probe(r.left + r.width / 2, r.bottom - 4),
            first: panel.querySelector('button[data-emoji]').getBoundingClientRect().top >= r.top - 1 };
        });
        chk(shortW.top >= 0 && shortW.bottom <= shortW.h && shortW.left >= 0 && shortW.right <= 1200 && shortW.topHit && shortW.bottomHit,
          `${t} at 1200x${h} the whole panel is on screen and nothing covers or clips it`, JSON.stringify(shortW));
        if (SHOTS && h === 420) await page.screenshot({ path: path.join(SHOTS, `3744-${platform}-4-short-window.png`) });
        await page.keyboard.press('Escape');
      }
      /* Review pass 2: shorter still. The panel is either fully between the sticky header and the
         window's bottom edge, or closed when there is no room for it; never hanging off the window
         or tucked under the header. 260 is the height a fixed minimum used to push it off. */
      for (const h of [260, 200, 160]) {
        await page.setViewportSize({ width: 1200, height: h });
        await page.waitForTimeout(100);
        await page.evaluate(() => { document.getElementById('d-say').scrollIntoView({ block: 'end' }); pjEmojiOpen('agent'); });
        await page.waitForTimeout(80);
        const tiny = await page.evaluate(() => {
          const panel = document.getElementById('d-emoji');
          const head = document.querySelector('.apphead').getBoundingClientRect();
          const r = panel.getBoundingClientRect();
          const probe = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && panel.contains(el); };
          return { open: !panel.hidden, expanded: document.getElementById('d-emoji-btn').getAttribute('aria-expanded'),
            top: Math.round(r.top), bottom: Math.round(r.bottom), headBottom: Math.round(head.bottom), h: innerHeight,
            topHit: !panel.hidden && probe(r.left + r.width / 2, r.top + 3), bottomHit: !panel.hidden && probe(r.left + r.width / 2, r.bottom - 3) };
        });
        const inside = tiny.open && tiny.top >= tiny.headBottom && tiny.bottom <= tiny.h && tiny.topHit && tiny.bottomHit;
        const closed = !tiny.open && tiny.expanded === 'false';
        chk(inside || closed, `${t} at 1200x${h} the panel is wholly between the header and the window's edge, or closed`, JSON.stringify(tiny));
        if (h === 260) chk(inside, `${t} at 1200x260 there is room, so it is open and whole`, JSON.stringify(tiny));
        if (h === 160) chk(closed, `${t} at 1200x160 there is no room for it, so it is closed, not hidden under the header`, JSON.stringify(tiny));
        await page.evaluate(() => pjEmojiClose('agent'));
      }
      // Review pass 3: in a window short enough to cap the panel, its grid scrolls to the very end
      // and stays there, so the last emoji can be reached (re-placing on its own scroll once pulled
      // it back to about the middle).
      await page.setViewportSize({ width: 1200, height: 300 });
      await page.waitForTimeout(100);
      const endOf = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.getElementById('d-say').scrollIntoView({ block: 'end' });
        pjEmojiOpen('agent');
        await wait(60);
        const panel = document.getElementById('d-emoji');
        const max = panel.scrollHeight - panel.clientHeight;
        panel.scrollTop = max;
        await wait(120);
        const last = panel.querySelector('button[data-emoji]:last-child').getBoundingClientRect();
        const r = panel.getBoundingClientRect();
        const out = { open: !panel.hidden, capped: max > 20, max, at: Math.round(panel.scrollTop), lastInside: last.bottom <= r.bottom + 1 && last.top >= r.top - 1 };
        pjEmojiClose('agent');
        return out;
      });
      chk(endOf.open && endOf.capped && endOf.at >= endOf.max - 2 && endOf.lastInside, `${t} at 1200x300 the list scrolls to its last emoji and stays there`, JSON.stringify(endOf));
      await page.setViewportSize({ width: 1200, height: 700 });
      await page.waitForTimeout(100);
      /* Its box carried out of sight: the panel closes rather than staying open where nobody can see
         or reach it. At wide widths the thread scrolls inside the box and the composer stays put; at
         mid widths (about 480 to 520) the page itself scrolls and does carry it away (review pass 3).
         Driven directly here, the same at any width: the box moved off screen, then a scroll event,
         which is what announces it. */
      const away = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const cbox = document.getElementById('d-say').closest('.composerbox');
        pjEmojiOpen('agent');
        await wait(60);
        const openedInView = !document.getElementById('d-emoji').hidden;
        cbox.style.transform = 'translateY(' + (innerHeight + 400) + 'px)';
        document.getElementById('d-dmthread').dispatchEvent(new Event('scroll'));
        await wait(60);
        const out = { overflowed: cbox.getBoundingClientRect().top > innerHeight, openedInView, open: !document.getElementById('d-emoji').hidden,
          expanded: document.getElementById('d-emoji-btn').getAttribute('aria-expanded') };
        cbox.style.transform = '';
        return out;
      });
      chk(away.overflowed && away.openedInView && !away.open && away.expanded === 'false', `${t} its box carried out of sight closes the panel`, JSON.stringify(away));
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(100);

      // A phone: no smiley in the DM (its own keyboard has emoji), so the words keep the width.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      const phone = await page.evaluate(() => {
        const b = document.getElementById('d-emoji-btn');
        return { shown: b.getBoundingClientRect().width > 0, sayWidth: Math.round(document.getElementById('d-say').getBoundingClientRect().width) };
      });
      chk(!phone.shown, `${t} at phone width the DM has no smiley, so the words keep their room`, JSON.stringify(phone));
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(100);

      // The room's picker still works, and only one panel is open at a time.
      const room = await page.evaluate(() => {
        const input = document.getElementById('pj-post');
        input.value = 'ab'; input.setSelectionRange(1, 1);
        pjEmojiOpen('agent');
        const agentOpen = !document.getElementById('d-emoji').hidden;
        document.getElementById('pj-emoji-btn').click();
        const out = { agentOpen, roomOpen: !document.getElementById('pj-emoji').hidden, agentAfter: !document.getElementById('d-emoji').hidden };
        document.querySelector('#pj-emoji button[data-emoji]').click();
        out.roomValue = input.value; out.first = PJ_EMOJI[0];
        pjEmojiClose('room');
        return out;
      });
      chk(room.agentOpen && room.roomOpen && !room.agentAfter, `${t} opening the room's panel closes the DM's`, JSON.stringify(room));
      chk(room.roomValue === 'a' + room.first + 'b', `${t} the room's picker still inserts into the room's own input`, JSON.stringify(room));

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) {
    console.error('render-dm-emoji-3744: ' + fail.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('render-dm-emoji-3744: the agent DM composer has the room\'s emoji picker, on a Mac and on Windows.');
})().catch((err) => {
  console.error('FAIL  render-dm-emoji-3744: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
