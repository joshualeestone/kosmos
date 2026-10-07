'use strict';

/**
 * #5359: the board's note that this computer restarted while Kosmos was running and Kosmos came back by itself.
 *
 * engine/restartnote.js decides when there is a note; GET /api/board/restart-note serves it; the page reads it once
 * when it opens and paints it into #reboot-slot (Mona Lisa's design: the login notice's .utoast, neutral tone, the
 * words role=status, a Dismiss button). This drives the REAL page by stubbing only that route at the network edge:
 *
 *   today      -> "This computer restarted at <time>" / "Kosmos was running and started again by itself at <time>."
 *   yesterday  -> "This computer restarted yesterday at <time>"
 *   older      -> "This computer restarted on <Mon D> at <time>"
 *   none       -> the slot is EMPTY (the control: the note shows only when there is one)
 *   dismiss    -> the X empties the slot and POSTs /api/board/restart-note/dismiss
 *
 *   AGENT_WORKFORCE_DATA=/tmp/rn PORT=17372 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17372 node docs/browser-checks/render-reboot-note-5359.js /tmp/rnshots
 *
 * HEADED by default. HEADED=0 on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17372';
const OUT = process.argv[2] || '/tmp/rnshots';
const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

const MIN = 60000;
const DAY = 24 * 3600000;
const noteAt = (bootAgo, upAgo) => ({ lastAliveAt: new Date(Date.now() - bootAgo - MIN).toISOString(), bootAt: new Date(Date.now() - bootAgo).toISOString(), upAt: new Date(Date.now() - upAgo).toISOString() });
const T = '\\d{1,2}:\\d{2}\\s?[AP]M';
const CASES = [
  { key: 'today', note: noteAt(7 * MIN, 0), head: new RegExp('^This computer restarted at ' + T + '$'), line: new RegExp('^Kosmos was running and started again by itself at ' + T + '\\.$') },
  { key: 'yesterday', note: noteAt(DAY, DAY - 7 * MIN), head: new RegExp('^This computer restarted yesterday at ' + T + '$'), line: /started again by itself (yesterday )?at / },
  { key: 'older', note: noteAt(3 * DAY, 3 * DAY - 7 * MIN), head: new RegExp('^This computer restarted on [A-Z][a-z]{2} \\d{1,2} at ' + T + '$'), line: /started again by itself on / },
  { key: 'none', note: null },
];

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const c of CASES) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    const dismissed = [];
    let served = c.note;   // what the route answers; the repaint arm below changes it
    await pg.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note: served }) }).catch(() => {}));
    await pg.route('**/api/board/restart-note/dismiss', (route) => { dismissed.push(route.request().method()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"dismissed":true}' }).catch(() => {}); });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForTimeout(300);
    const got = await pg.evaluate(() => {
      const slot = document.getElementById('reboot-slot');
      const t = slot && slot.querySelector('.utoast.reboot');
      return {
        slot: Boolean(slot), html: slot ? slot.innerHTML.trim() : '',
        head: t ? (t.querySelector('.utxt b') || {}).textContent : null,
        line: t ? (t.querySelector('.utxt small') || {}).textContent : null,
        role: t ? (t.querySelector('.utxt') || { getAttribute: () => null }).getAttribute('role') : null,
        noticeRole: t ? t.getAttribute('role') : null,
        x: t ? (t.querySelector('.ux') || { getAttribute: () => null }).getAttribute('aria-label') : null,
        tone: t ? getComputedStyle(t).getPropertyValue('--utone').trim() : null,
        label2: getComputedStyle(document.documentElement).getPropertyValue('--label-2').trim(),
        visible: t ? t.getBoundingClientRect().height > 0 : false,
      };
    });
    say(got.slot, c.key + ': #reboot-slot is on the page');
    if (!c.note) {
      say(got.html === '', c.key + ': no note, the slot is empty (control)', JSON.stringify(got.html.slice(0, 80)));
    } else {
      say(got.visible, c.key + ': the note shows');
      say(c.head.test(got.head || ''), c.key + ': the head says when the computer restarted', JSON.stringify(got.head));
      say(c.line.test(got.line || ''), c.key + ': the line says Kosmos came back by itself', JSON.stringify(got.line));
      say(got.role === 'status' && got.noticeRole !== 'status', c.key + ': role=status on the words, not the notice');
      say(got.x === 'Dismiss', c.key + ': the close button is labelled Dismiss', JSON.stringify(got.x));
      say(got.tone !== '' && got.tone === got.label2, c.key + ': neutral tone (--label-2), not amber or red', got.tone + ' vs ' + got.label2);
      await pg.screenshot({ path: path.join(OUT, 'reboot-' + c.key + '.png') }).catch(() => {});
      if (c.key === 'today') {
        /* Review 2: the ten-minute re-check must not repaint the same note, which would take focus off Dismiss. The
           control serves a DIFFERENT note and expects a new button, so the first arm can tell a repaint from none. */
        const same = await pg.evaluate(async () => {
          const before = document.querySelector('#reboot-slot .ux');
          before.focus();
          await rebootNoteCheck();
          const now = document.querySelector('#reboot-slot .ux');
          return { kept: now === before, focused: document.activeElement === before };
        });
        say(same.kept && same.focused, 'repaint: re-checking the same note keeps its Dismiss button and its focus', JSON.stringify(same));
        served = { ...c.note, upAt: new Date(Date.parse(c.note.upAt) + 60000).toISOString() };
        const changed = await pg.evaluate(async () => {
          const before = document.querySelector('#reboot-slot .ux');
          await rebootNoteCheck();
          const now = document.querySelector('#reboot-slot .ux');
          return { replaced: Boolean(now) && now !== before };
        });
        say(changed.replaced, 'repaint (control): a different note is painted again', JSON.stringify(changed));
        served = c.note;
        await pg.click('#reboot-slot .ux');
        await pg.waitForTimeout(300);
        const after = await pg.evaluate(() => document.getElementById('reboot-slot').innerHTML.trim());
        say(after === '', 'dismiss: the X empties the slot');
        say(dismissed.includes('POST'), 'dismiss: the board is told (POST /api/board/restart-note/dismiss)');
      }
    }
    say(errs.length === 0, c.key + ': no page errors', errs.join(' | '));
    await pg.close();
  }
  /* Review 3: the same note repaints when its words change across midnight. The page's clock is pinned at 23:30 with a
     restart at 23:20; moved to 00:10, a re-check of the SAME note must say "yesterday at", which a guard keyed on the
     note's times (not its words) would block. */
  {
    const base = new Date(); base.setHours(23, 30, 0, 0);
    const note = { lastAliveAt: new Date(base.getTime() - 11 * MIN).toISOString(), bootAt: new Date(base.getTime() - 10 * MIN).toISOString(), upAt: new Date(base.getTime() - 5 * MIN).toISOString() };
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.clock.setFixedTime(base);
    await pg.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note }) }).catch(() => {}));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForFunction(() => document.querySelector('#reboot-slot .utoast.reboot'), null, { timeout: 12000 }).catch(() => {});
    const before = await pg.$eval('#reboot-slot', (el) => el.textContent).catch(() => '');
    say(new RegExp('This computer restarted at 11:20\\s?PM').test(before), 'midnight: at 23:30 the head says "at 11:20 PM"', JSON.stringify(before));
    await pg.clock.setFixedTime(new Date(base.getTime() + 40 * MIN));   // 00:10 the next day
    const after = await pg.evaluate(async () => { await rebootNoteCheck(); return document.getElementById('reboot-slot').textContent; });
    say(new RegExp('This computer restarted yesterday at 11:20\\s?PM').test(after), 'midnight: after midnight the same note says "yesterday at"', JSON.stringify(after));
    say(errs.length === 0, 'midnight: no page errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.length : '\nall reboot-note checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('FAIL  the check crashed: ' + (e && e.message)); process.exit(1); });
