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
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/thread') && opts && opts.method === 'POST') {
            const body = JSON.parse(opts.body || '{}');
            window.__posts.push(body);
            window.__fx.messages.push({ at: new Date().toISOString(), text: body.text, delivery: { state: 'placed', paneState: 'idle' } });
            return enc({ ok: true, delivery: { state: 'placed', paneState: 'idle' } });
          }
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
