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
 *   repaint    -> a re-check of the same note keeps Dismiss and its focus; a different note is painted again (control)
 *   tones      -> neutral in light, dark by media query, forced dark, and Kosmos+ in light and in dark
 *   phone      -> at 390px the note keeps its line (phones hide other notices' small lines)
 *   refused    -> a dismiss the board refuses keeps the note and says so; a keyboard dismiss moves focus to the K mark
 *   restart    -> a new board start time under an open page brings the note (control: the same start time does not)
 *   midnight   -> with the page clock pinned at 23:30 then 00:10, the same note says "yesterday at"
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
/* Review 4: every dated case runs at a pinned noon, so "at" / "yesterday at" do not depend on when the check runs (just
   after midnight, or on a day the clocks change). */
const NOON = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const noteAt = (bootAgo, upAgo) => ({ lastAliveAt: new Date(NOON - bootAgo - MIN).toISOString(), bootAt: new Date(NOON - bootAgo).toISOString(), upAt: new Date(NOON - upAgo).toISOString() });
const T = '\\d{1,2}:\\d{2}\\s?[AP]M';
const CASES = [
  { key: 'today', note: noteAt(7 * MIN, 0), head: new RegExp('^This computer restarted at ' + T + '$'), line: new RegExp('^Kosmos was running and started again by itself at ' + T + '\\.$') },
  { key: 'yesterday', note: noteAt(DAY, DAY - 7 * MIN), head: new RegExp('^This computer restarted yesterday at ' + T + '$'), line: new RegExp('^Kosmos was running and started again by itself yesterday at ' + T + '\\.$') },
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
    await pg.clock.setFixedTime(new Date(NOON));
    let served = c.note;   // what the route answers; the repaint arm below changes it
    await pg.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note: served }) }).catch(() => {}));
    let dismissStatus = 200;   // the failed-dismiss arm below sets 500
    await pg.route('**/api/board/restart-note/dismiss', (route) => { dismissed.push(route.request().method()); return route.fulfill({ status: dismissStatus, contentType: 'application/json', body: dismissStatus === 200 ? '{"dismissed":true}' : '{"error":"we could not record that the note was dismissed"}' }).catch(() => {}); });
    // The note's own answer is awaited, so an empty slot (the control) means it was asked and said none, not not-yet.
    const asked = pg.waitForResponse((r) => r.url().endsWith('/api/board/restart-note'), { timeout: 15000 }).then(() => true, () => false);
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    say(await asked, c.key + ': the page asked the board for its note');
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
        /* Review 8: a repaint under a focused Dismiss keeps focus on the new Dismiss; a removal under it moves focus to
           the K mark. Neither drops it to the page. */
        served = { ...c.note, upAt: new Date(Date.parse(c.note.upAt) + 2 * 60000).toISOString() };
        const kept = await pg.evaluate(async () => { document.querySelector('#reboot-slot .ux').focus(); await rebootNoteCheck(); const a = document.activeElement; return a && a.matches('#reboot-slot .ux'); });
        say(kept, 'repaint under focus: the new Dismiss has the focus');
        served = null;
        const away = await pg.evaluate(async () => { document.querySelector('#reboot-slot .ux').focus(); await rebootNoteCheck(); const a = document.activeElement; return a ? (a.id || a.tagName) : null; });
        say(away === 'klink', 'removed under focus: focus moves to the K mark', JSON.stringify(away));
        served = c.note;
        await pg.evaluate(async () => { await rebootNoteCheck(); });   // the note back for the arms below
        /* Review 4: the tone is the neutral one in every dark spelling too (the light one is checked above). */
        const tones = await pg.evaluate(() => {
          const t = () => document.querySelector('#reboot-slot .utoast.reboot');
          // --label-2 as the toast itself inherits it: Kosmos+ redefines it on body, not on the root.
          const read = () => ({ tone: getComputedStyle(t()).getPropertyValue('--utone').trim(), label2: getComputedStyle(t()).getPropertyValue('--label-2').trim() });
          const out = {};
          document.documentElement.setAttribute('data-theme', 'dark'); out.forced = read(); document.documentElement.removeAttribute('data-theme');
          // Kosmos+ in light AND in dark: in dark the dark rule alone keeps it neutral, so only light tests the Kosmos+ rule.
          document.body.classList.add('plus-active'); out['plus light'] = read();
          document.documentElement.setAttribute('data-theme', 'dark'); out['plus dark'] = read();
          document.body.classList.remove('plus-active'); document.documentElement.removeAttribute('data-theme');
          return out;
        });
        await pg.emulateMedia({ colorScheme: 'dark' });
        tones.media = await pg.evaluate(() => { const el = document.querySelector('#reboot-slot .utoast.reboot'); return { tone: getComputedStyle(el).getPropertyValue('--utone').trim(), label2: getComputedStyle(el).getPropertyValue('--label-2').trim() }; });
        await pg.emulateMedia({ colorScheme: 'light' });
        for (const k of ['media', 'forced', 'plus light', 'plus dark']) say(tones[k].tone !== '' && tones[k].tone === tones[k].label2, 'tone (' + (k.startsWith('plus') ? 'Kosmos+ ' + k.slice(5) : k + ' dark') + '): neutral, not amber or red', tones[k].tone + ' vs ' + tones[k].label2);
        /* Review 4: a dismiss the board refuses keeps the note and says so in its words. */
        dismissStatus = 500;
        await pg.click('#reboot-slot .ux');
        await pg.waitForTimeout(300);
        const refused = await pg.evaluate(() => { const t = document.querySelector('#reboot-slot .utoast.reboot'); return { kept: Boolean(t), said: t ? ((t.querySelector('.utxt .rerr') || {}).textContent || '') : '' }; });
        say(refused.kept && /could not record that just now/.test(refused.said), 'dismiss refused: the note stays and says it could not record it', JSON.stringify(refused));
        const firstErr = await pg.$('#reboot-slot .rerr');
        await pg.click('#reboot-slot .ux');
        await pg.waitForTimeout(300);
        const again = await pg.evaluate((prev) => { const all = document.querySelectorAll('#reboot-slot .rerr'); return { count: all.length, renewed: all.length === 1 && all[0] !== prev }; }, firstErr);
        say(again.count === 1 && again.renewed, 'dismiss refused twice: one line, said again (a new node, so it is announced)', JSON.stringify(again));
        const cleared = await pg.evaluate(async () => { await rebootNoteCheck(); return { note: Boolean(document.querySelector('#reboot-slot .utoast.reboot')), err: Boolean(document.querySelector('#reboot-slot .rerr')) }; });
        say(cleared.note && !cleared.err, 'dismiss refused: a later re-check the board answers clears the stale line, keeps the note', JSON.stringify(cleared));
        dismissStatus = 200;
        dismissed.length = 0;   // the refused click above posted too; this arm must see its own
        /* Review 6: dismissed from the keyboard, focus goes to the K mark (as after the login notice), never lost. */
        await pg.focus('#reboot-slot .ux');
        await pg.keyboard.press('Enter');
        await pg.waitForTimeout(300);
        const focusAfter = await pg.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; });
        say(focusAfter === 'klink', 'dismiss: focus moves to the K mark', JSON.stringify(focusAfter));
        const after = await pg.evaluate(() => document.getElementById('reboot-slot').innerHTML.trim());
        say(after === '', 'dismiss: the X empties the slot');
        say(dismissed.includes('POST'), 'dismiss: the board is told (POST /api/board/restart-note/dismiss)');
      }
    }
    say(errs.length === 0, c.key + ': no page errors', errs.join(' | '));
    await pg.close();
  }
  /* Review 7: on a phone the note keeps its line (phones hide every notice's small line except the login notice's and
     this one's). Control: the same page at desktop width shows it too, so a hidden line here is the phone rule. */
  {
    const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
    await pg.clock.setFixedTime(new Date(NOON));
    await pg.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note: noteAt(7 * MIN, 0) }) }).catch(() => {}));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.waitForFunction(() => document.querySelector('#reboot-slot .utoast.reboot'), null, { timeout: 12000 }).catch(() => {});
    const phone = await pg.evaluate(() => { const sm = document.querySelector('#reboot-slot .utxt small'); return sm ? { display: getComputedStyle(sm).display, h: sm.getBoundingClientRect().height, text: sm.textContent } : null; });
    say(Boolean(phone) && phone.display !== 'none' && phone.h > 0 && /started again by itself/.test(phone.text), 'phone: the note keeps its line at 390px', JSON.stringify(phone));
    await pg.close();
  }
  /* Review 4: a board that starts again under an open page is asked again for its note. The page loads with no note;
     the note then appears on the route. Control: the same start time, no re-check, nothing painted. Then the start time
     moves and the note must be painted within a few of the page's 5-second polls. */
  {
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    let note = null;
    let startedAt = null;   // null: pass the board's own value through
    await pg.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note }) }).catch(() => {}));
    await pg.route('**/api/status', async (route) => {
      let res, data;
      try { res = await route.fetch(); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      if (startedAt && data && data.engine) data.engine.startedAt = startedAt;
      await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    note = noteAt(7 * MIN, 0);
    await pg.waitForTimeout(11000);   // two polls with the same start time
    const quiet = await pg.$eval('#reboot-slot', (el) => el.innerHTML.trim()).catch(() => 'x');
    say(quiet === '', 'board restart (control): the same start time asks nothing again', JSON.stringify(quiet.slice(0, 80)));
    startedAt = new Date().toISOString();
    const painted = await pg.waitForFunction(() => document.querySelector('#reboot-slot .utoast.reboot'), null, { timeout: 20000 }).then(() => true, () => false);
    say(painted, 'board restart: a new start time under the open page brings the note');
    say(errs.length === 0, 'board restart: no page errors', errs.join(' | '));
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
