'use strict';

/*
 * #5406 part 2 slice C: a question's choices as buttons INSIDE its bubble in the direct-message thread (Josh's #3419
 * ruling: no prompt box, no banner). The page is opened from disk with its server calls answered by a stub, as
 * render-talk.js does, so no board is needed.
 *
 * THREE ARMS, light and dark:
 *   CHOICES   a live question with options and its identity (asked): the buttons are inside the question's bubble, in
 *             order, labelled, keyboard-focusable, and a press POSTs { text: digit, chose: label, asked } and says Sent.
 *             Focus across a rewrite: back on the same choice; to the message box when the question changed, or when
 *             the choice is drawn disabled (the answered lock).
 *   NO-MENU   the same question with options null (the server was not sure): no buttons (CONTROL).
 *   REPORTED  a question the agent reported in its own words (no live menu): no buttons (CONTROL), and with no
 *             `clearable` from the server, no "Answered, clear this" either (CONTROL for the next arm).
 *   ANSWERED  #5943 (Josh: an answered question stayed the newest bubble for 12 days): a reported question dated 12
 *             days back, the person's answer after it, then a later message, as the server now serves them (the placement itself
 *             is pinned in server.answeredq-5943.test.js); the page keeps that order,
 *             says "Asked 12 days ago", and its "Answered, clear this" is a focusable button that POSTs the agent's
 *             clear-selfreport route and repaints the thread without the question. SHOT_5943=<file.png> saves it.
 *
 *   LASTING   #6172: a permission prompt whose option 2 saves a lasting choice ("Yes, and don't ask again for: cd *"): all
 *             three are buttons; the first press of 2 posts nothing and arms it (said, drawn, and kept by a repaint), the
 *             second posts { lasting: true }; No goes on one press (CONTROL). SHOT_6172=<file.png> saves it armed.
 *
 * HEADLESS-safe (DOM-state assertions only). SHOT=<file.png> saves the light CHOICES arm's thread.
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-dmchoices-5406.js
 */

const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
/* The real menu draws "4. Type something."; the server serves only the answers (1 to 3), as OPTIONS does. */
const QUESTION = ' ☐ Fruit\n\nWhich fruit do you want?\n\n❯ 1. Apple\n     Apple\n  2. Banana\n     Banana\n  3. Cherry\n     Cherry\n  4. Type something.';
const row = (reported) => ({ id: 'needs-you-question:april', at: null, text: QUESTION, from: 'april', delivery: null, kind: 'question', reported });
const base = { olderCount: 0, historyBecause: null, historyUnfilable: false, owes: null, presence: 'on', presenceBecause: null,
  asking: true, question: { text: QUESTION }, questionBecause: null, codexHooks: null, answerNote: null };
const OPTIONS = [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana' }, { n: 3, label: 'Cherry' }];
/* #6172: Claude Code's permission prompt as the server serves it (status.claudePermissionPrompt), the card's own option 2. */
const PERM = ' Bash command\n\n cd /tmp\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don’t ask again for: cd *\n   3. No';
const PERM_OPTIONS = [{ n: 1, label: 'Yes' }, { n: 2, label: 'Yes, and don’t ask again for: cd *', lasting: true }, { n: 3, label: 'No' }];
const ARMS = {
  lasting: { ...base, question: { text: PERM }, options: PERM_OPTIONS, asked: 'cd /tmp',
    messages: [{ id: 'needs-you-question:april', at: null, text: PERM, from: 'april', delivery: null, kind: 'question', reported: false }] },
  choices: { ...base, messages: [row(false)], options: OPTIONS, asked: 'Which fruit do you want?' },
  'no-menu': { ...base, messages: [row(false)], options: null, asked: null },
  /* Served WITH options and asked, so only the page's own reported-row guard can keep the buttons off. */
  reported: { ...base, messages: [row(true)], question: { text: 'Which fruit do you want?', reported: true }, options: OPTIONS, asked: 'Which fruit do you want?' },
  /* #5943: the rows as the server now serves them, the question dated from its first ask and placed in time. */
  answered: { ...base, options: null, asked: null, question: { text: 'Which fruit do you want?', reported: true }, messages: [
    { from: 'april', text: 'I have a choice to put to you.', at: new Date(Date.now() - 12 * 86400000 - 120000).toISOString() },
    { id: 'needs-you-question:april', at: new Date(Date.now() - 12 * 86400000 - 60000).toISOString(), text: 'Which fruit do you want?',
      from: 'april', delivery: null, kind: 'question', reported: true, clearable: true },
    { from: null, text: 'Apple, please.', at: new Date(Date.now() - 3600000).toISOString(), delivery: { state: 'placed' } },
    { from: 'april', text: 'Noted.', at: new Date(Date.now() - 1800000).toISOString() },
  ] },
};

const problems = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) problems.push(name);
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
      page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
      await page.addInitScript(() => {
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;   // the page's own 5 s tick would repaint under the measurements
        window.__posted = [];
        window.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/thread') && opts && opts.method === 'POST') { window.__posted.push(JSON.parse(opts.body)); return enc({ delivery: { state: 'placed' }, recorded: true }); }
          if (u.includes('/clear-selfreport')) {   // #5943: the person cleared it; the next read has no question
            window.__cleared = (window.__cleared || 0) + 1;
            window.__fx = { ...window.__fx, asking: false, question: null, messages: window.__fx.messages.filter((m) => m.kind !== 'question') };
            return enc({ ok: true, cleared: true, state: 'idle', by: 'operator' });
          }
          if (u.includes('/thread')) return enc(window.__fx);
          if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
          return enc({});
        };
      });
      await page.goto(PAGE);
      for (const [arm, fx] of Object.entries(ARMS)) {
        await page.evaluate((f) => {
          window.__fx = f; window.__posted = [];
          CURRENT = { sessionName: 'april', name: 'April' };   // a bare assignment: the page's `let CURRENT`
          document.getElementById('panel-detail').hidden = false;
          const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
          document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
        }, fx);
        await page.evaluate(() => paintTalk('april', 'April'));
        await page.waitForTimeout(150);
        const seen = await page.evaluate(() => {
          const q = [...document.querySelectorAll('#d-dmthread .msg')].find((m) => /Which fruit|Do you want to proceed/.test(m.textContent));
          const btns = q ? [...q.querySelectorAll('.dmchoices .dmchoice')] : [];
          const all = document.querySelectorAll('#d-dmthread .dmchoice').length;
          return { question: !!q, inBubble: btns.length, all, labels: btns.map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
            focusable: btns.every((b) => b.tabIndex >= 0 && !b.disabled), group: !!(q && q.querySelector('.dmchoices[role="group"]')),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        check(`[${theme}] ${arm}: the question bubble is drawn`, seen.question, JSON.stringify(seen));
        if (arm === 'lasting') {
          check(`[${theme}] lasting: all three options are buttons, labelled with the prompt's words`, seen.all === 3
            && seen.labels.join('|') === '1 Yes|2 Yes, and don’t ask again for: cd *|3 No', JSON.stringify(seen.labels));
          await page.locator('#d-dmthread .dmchoice[data-n="2"]').click();
          await page.waitForTimeout(100);
          const armed = await page.evaluate(() => ({ posted: window.__posted.length,
            armed: !!document.querySelector('#d-dmthread .dmchoice[data-n="2"].armed'),
            say: (document.querySelector('#d-dmthread .dmchoices-msg') || {}).textContent || '' }));
          check(`[${theme}] lasting: the first press sends nothing and asks for a second`, armed.posted === 0 && armed.armed
            && /Press it again to choose it/.test(armed.say), JSON.stringify(armed));
          const kept = await page.evaluate(async () => { await paintTalk('april', 'April');
            return !!document.querySelector('#d-dmthread .dmchoice[data-n="2"].armed'); });
          check(`[${theme}] lasting: a repaint between the presses keeps it armed`, kept);
          if (theme === 'light' && process.env.SHOT_6172) await page.locator('#d-dmthread').screenshot({ path: process.env.SHOT_6172 });
          await page.waitForTimeout(700);   // past the gap: a confirm, not the same gesture
          await page.locator('#d-dmthread .dmchoice[data-n="2"]').click();
          await page.waitForTimeout(150);
          const sent = await page.evaluate(() => window.__posted);
          check(`[${theme}] lasting: the second press sends 2 with lasting`, sent.length === 1 && sent[0].text === '2' && sent[0].lasting === true
            && sent[0].chose === 'Yes, and don’t ask again for: cd *', JSON.stringify(sent));
          // Review 1: a double-click (two presses in one gesture) arms and does not send.
          await page.evaluate(async () => { window.__posted = []; DM_CHOICE_ANSWERED.delete('april'); DM_CHOICE_ARMED = null; await paintTalk('april', 'April'); });
          await page.locator('#d-dmthread .dmchoice[data-n="2"]').dblclick();
          await page.waitForTimeout(150);
          const dbl = await page.evaluate(() => ({ posted: window.__posted.length, armed: !!document.querySelector('#d-dmthread .dmchoice[data-n="2"].armed') }));
          check(`[${theme}] lasting: a double-click arms and sends nothing`, dbl.posted === 0 && dbl.armed, JSON.stringify(dbl));
          // Review 1: armed on one question, a press after the question changed (same layout) arms again and sends nothing.
          const moved = await page.evaluate(async () => {
            const keep = window.__fx;
            window.__fx = { ...keep, asked: 'cd /var' };
            await paintTalk('april', 'April');
            const out = { armedAfterChange: !!document.querySelector('#d-dmthread .dmchoice[data-n="2"].armed') };
            window.__keep6172 = keep;
            return out;
          });
          await page.waitForTimeout(700);
          await page.locator('#d-dmthread .dmchoice[data-n="2"]').click();
          await page.waitForTimeout(150);
          const changed = await page.evaluate(async () => { const out = { posted: window.__posted.length,
            armed: !!document.querySelector('#d-dmthread .dmchoice[data-n="2"].armed') };
            window.__fx = window.__keep6172; DM_CHOICE_ARMED = null; await paintTalk('april', 'April'); return out; });
          check(`[${theme}] lasting: a changed question is not confirmed by a press armed on the old one`, !moved.armedAfterChange
            && changed.posted === 0 && changed.armed, JSON.stringify({ ...moved, ...changed }));
          // Review 2: when the window ends, the screen stops saying armed (here shortened to 400 ms), even after a repaint.
          const lapsed = await page.evaluate(async () => {
            window.__posted = []; DM_CHOICE_ANSWERED.delete('april'); DM_CHOICE_ARMED = null; DM_CHOICE_ARM_MS = 400;
            await paintTalk('april', 'April');
            document.querySelector('#d-dmthread .dmchoice[data-n="2"]').click();
            await paintTalk('april', 'April');
            const before = !!document.querySelector('#d-dmthread .dmchoice[data-n="2"].armed');
            await new Promise((r) => setTimeout(r, 600));
            const out = { before, after: !!document.querySelector('#d-dmthread .dmchoice.armed'),
              note: (document.querySelector('#d-dmthread .dmchoices-msg') || {}).textContent || '', posted: window.__posted.length };
            DM_CHOICE_ARM_MS = 15000;
            return out;
          });
          check(`[${theme}] lasting: an arm that lapses stops showing as armed`, lapsed.before && !lapsed.after && lapsed.note === '' && lapsed.posted === 0, JSON.stringify(lapsed));
          // CONTROL: No is not lasting, so one press sends it, without lasting.
          await page.evaluate(async () => { window.__posted = []; DM_CHOICE_ANSWERED.delete('april'); await paintTalk('april', 'April'); });
          await page.locator('#d-dmthread .dmchoice[data-n="3"]').click();
          await page.waitForTimeout(150);
          const no = await page.evaluate(() => window.__posted);
          check(`[${theme}] lasting: No goes on one press, without lasting (CONTROL)`, no.length === 1 && no[0].text === '3' && no[0].lasting === undefined, JSON.stringify(no));
          await page.evaluate(() => { DM_CHOICE_ANSWERED.delete('april'); });
        } else if (arm === 'choices') {
          check(`[${theme}] choices: three buttons inside the question's bubble, in order`, seen.inBubble === 3 && seen.all === 3
            && seen.labels.join('|') === '1 Apple|2 Banana|3 Cherry', JSON.stringify(seen.labels));
          check(`[${theme}] choices: a labelled group, every button focusable`, seen.group && seen.focusable);
          check(`[${theme}] choices: no sideways overflow`, seen.overflow <= 0, String(seen.overflow));
          if (theme === 'light' && process.env.SHOT) await page.locator('#d-dmthread').screenshot({ path: process.env.SHOT });
          // Focus survives a rewrite: a new message arrives while a keyboard user stands on choice 3.
          await page.locator('#d-dmthread .dmchoice[data-n="3"]').focus();
          const refocused = await page.evaluate(async () => {
            const before = document.getElementById('d-dmthread').querySelector('.dmchoice[data-n="3"]');
            window.__fx = { ...window.__fx, messages: [...window.__fx.messages, { from: 'april', text: 'One more thing.', at: new Date(Date.now() + 1000).toISOString() }] };
            await paintTalk('april', 'April');
            const a = document.activeElement;
            return { replaced: !document.body.contains(before), n: a && a.classList.contains('dmchoice') ? a.getAttribute('data-n') : null };
          });
          check(`[${theme}] choices: a rewrite puts focus back on the same choice`, refocused.replaced && refocused.n === '3', JSON.stringify(refocused));
          // Review 30: a rewrite that brings a DIFFERENT question never leaves focus on one of its buttons.
          await page.locator('#d-dmthread .dmchoice[data-n="3"]').focus();
          const moved = await page.evaluate(async () => {
            const keep = window.__fx;
            window.__fx = { ...keep, asked: 'Which colour do you want?',
              messages: [...keep.messages, { from: 'april', text: 'New question coming.', at: new Date(Date.now() + 2000).toISOString() }] };
            await paintTalk('april', 'April');
            const a = document.activeElement;
            const out = { onChoice: !!(a && a.classList && a.classList.contains('dmchoice')), id: a && a.id };
            window.__fx = keep;
            await paintTalk('april', 'April');
            return out;
          });
          check(`[${theme}] choices: a rewrite with a different question sends focus to the message box`, !moved.onChoice && moved.id === 'd-say', JSON.stringify(moved));
          // Review 32: a rewrite inside the answered lock draws the same choice disabled, which cannot take focus.
          await page.locator('#d-dmthread .dmchoice[data-n="3"]').focus();
          const locked = await page.evaluate(async () => {
            DM_CHOICE_ANSWERED.set('april', { asked: window.__fx.asked, at: Date.now(), sure: true });
            const keep = window.__fx;
            window.__fx = { ...keep, messages: [...keep.messages, { from: 'april', text: 'Still thinking.', at: new Date(Date.now() + 3000).toISOString() }] };
            await paintTalk('april', 'April');
            const a = document.activeElement;
            const out = { drawnOff: !!document.querySelector('#d-dmthread .dmchoice[data-n="3"][disabled]'), id: a && a.id,
              onChoice: !!(a && a.classList && a.classList.contains('dmchoice')) };
            DM_CHOICE_ANSWERED.delete('april');
            window.__fx = keep;
            await paintTalk('april', 'April');
            return out;
          });
          check(`[${theme}] choices: a rewrite inside the answered lock sends focus to the message box, not a disabled choice`,
            locked.drawnOff && !locked.onChoice && locked.id === 'd-say', JSON.stringify(locked));
          await page.locator('#d-dmthread .dmchoice[data-n="2"]').click();
          await page.waitForTimeout(150);
          const posted = await page.evaluate(() => window.__posted);
          const said = await page.evaluate(() => (document.querySelector('#d-dmthread .dmchoices-msg') || {}).textContent || '');
          check(`[${theme}] choices: a placed press says Sent.`, said === 'Sent.', JSON.stringify(said));
          check(`[${theme}] choices: a press sends the digit, the words and the question`, posted.length === 1
            && posted[0].text === '2' && posted[0].chose === 'Banana' && posted[0].asked === 'Which fruit do you want?', JSON.stringify(posted));
        } else if (arm === 'answered') {
          const a = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#d-dmthread .msg, #d-dmthread [data-mid]')];
            const idxOf = (re) => rows.findIndex((r) => re.test(r.textContent));
            const q = rows.find((r) => /Which fruit/.test(r.textContent));
            const btn = q && q.querySelector('.dmq-clear');
            return { qAt: idxOf(/Which fruit/), answerAt: idxOf(/Apple, please/), laterAt: idxOf(/Noted\./),
              age: (q && q.querySelector('.dmq-age') || {}).textContent || '', btn: btn ? btn.textContent : null,
              focusable: !!(btn && btn.tabIndex >= 0 && !btn.disabled), choices: document.querySelectorAll('#d-dmthread .dmchoice').length,
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
          });
          check(`[${theme}] answered: the page keeps the served order (the dated question above the answer; the server places it, server.answeredq-5943.test.js)`,
            a.qAt >= 0 && a.answerAt > a.qAt && a.laterAt > a.answerAt, JSON.stringify(a));
          check(`[${theme}] answered: it says how long it has been asked`, a.age === 'Asked 12 days ago', JSON.stringify(a.age));
          check(`[${theme}] answered: "Answered, clear this" is a focusable button on the bubble`, a.btn === 'Answered, clear this' && a.focusable, JSON.stringify(a));
          check(`[${theme}] answered: no choice buttons and no sideways overflow`, a.choices === 0 && a.overflow <= 0, JSON.stringify(a));
          if (theme === 'light' && process.env.SHOT_5943) await page.locator('#d-dmthread').screenshot({ path: process.env.SHOT_5943 });
          await page.locator('#d-dmthread .dmq-clear').click();
          await page.waitForTimeout(200);
          const after = await page.evaluate(() => ({ cleared: window.__cleared || 0,
            question: [...document.querySelectorAll('#d-dmthread .msg')].some((m) => /Which fruit/.test(m.textContent)),
            // The thread's own text: the answer and the later message are still there (no conversation deleted).
            answer: /Apple, please\./.test(document.getElementById('d-dmthread').textContent)
              && /Noted\./.test(document.getElementById('d-dmthread').textContent) }));
          check(`[${theme}] answered: pressing it clears through the route and the question goes, the conversation stays`,
            after.cleared === 1 && !after.question && after.answer, JSON.stringify(after));
        } else {
          check(`[${theme}] ${arm}: no buttons (CONTROL)`, seen.all === 0, String(seen.all));
          const clearBtns = await page.evaluate(() => document.querySelectorAll('#d-dmthread .dmq-clear').length);
          check(`[${theme}] ${arm}: no "Answered, clear this" without clearable (CONTROL)`, clearBtns === 0, String(clearBtns));
        }
      }
      await page.close();
    }
  } catch (e) {
    problems.push('the check could not run: ' + ((e && e.message) || e));
  } finally {
    await browser.close();
  }
  for (const p of problems) console.error(' FAIL ' + p);
  console.log(problems.length ? 'FAIL render-dmchoices-5406 (' + problems.length + ')' : 'PASS render-dmchoices-5406');
  process.exit(problems.length ? 1 : 0);
}

run().catch((e) => { console.error(' FAIL ' + ((e && e.message) || e)); process.exit(1); });
