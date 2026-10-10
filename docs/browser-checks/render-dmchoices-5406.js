'use strict';

/*
 * #5406 part 2 slice C: a question's choices as buttons INSIDE its bubble in the direct-message thread (Josh's #3419
 * ruling: no prompt box, no banner). The page is opened from disk with its server calls answered by a stub, as
 * render-talk.js does, so no board is needed.
 *
 * THREE ARMS, light and dark:
 *   CHOICES   a live question with options and its identity (asked): the buttons are inside the question's bubble, in
 *             order, labelled, keyboard-focusable, and a press POSTs { text: digit, chose: label, asked }.
 *   NO-MENU   the same question with options null (the server was not sure): no buttons (CONTROL).
 *   REPORTED  a question the agent reported in its own words (no live menu): no buttons (CONTROL).
 *
 * HEADLESS-safe (DOM-state assertions only). SHOT=<file.png> saves the light CHOICES arm's thread.
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-dmchoices-5406.js
 */

const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const QUESTION = ' ☐ Fruit\n\nWhich fruit do you want?\n\n❯ 1. Apple\n     Apple\n  2. Banana\n     Banana\n  3. Cherry\n     Cherry\n  4. Type something.';
const row = (reported) => ({ id: 'needs-you-question:april', at: null, text: QUESTION, from: 'april', delivery: null, kind: 'question', reported });
const base = { olderCount: 0, historyBecause: null, historyUnfilable: false, owes: null, presence: 'on', presenceBecause: null,
  asking: true, question: { text: QUESTION }, questionBecause: null, codexHooks: null, answerNote: null };
const OPTIONS = [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana' }, { n: 3, label: 'Cherry' }];
const ARMS = {
  choices: { ...base, messages: [row(false)], options: OPTIONS, asked: 'Which fruit do you want?' },
  'no-menu': { ...base, messages: [row(false)], options: null, asked: null },
  reported: { ...base, messages: [row(true)], question: { text: 'Which fruit do you want?', reported: true }, options: null, asked: null },
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
          const q = [...document.querySelectorAll('#d-dmthread .msg')].find((m) => /Which fruit/.test(m.textContent));
          const btns = q ? [...q.querySelectorAll('.dmchoices .dmchoice')] : [];
          const all = document.querySelectorAll('#d-dmthread .dmchoice').length;
          return { question: !!q, inBubble: btns.length, all, labels: btns.map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
            focusable: btns.every((b) => b.tabIndex >= 0 && !b.disabled), group: !!(q && q.querySelector('.dmchoices[role="group"]')),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        check(`[${theme}] ${arm}: the question bubble is drawn`, seen.question, JSON.stringify(seen));
        if (arm === 'choices') {
          check(`[${theme}] choices: three buttons inside the question's bubble, in order`, seen.inBubble === 3 && seen.all === 3
            && seen.labels.join('|') === '1 Apple|2 Banana|3 Cherry', JSON.stringify(seen.labels));
          check(`[${theme}] choices: a labelled group, every button focusable`, seen.group && seen.focusable);
          check(`[${theme}] choices: no sideways overflow`, seen.overflow <= 0, String(seen.overflow));
          if (theme === 'light' && process.env.SHOT) await page.locator('#d-dmthread').screenshot({ path: process.env.SHOT });
          await page.locator('#d-dmthread .dmchoice[data-n="2"]').click();
          await page.waitForTimeout(150);
          const posted = await page.evaluate(() => window.__posted);
          check(`[${theme}] choices: a press sends the digit, the words and the question`, posted.length === 1
            && posted[0].text === '2' && posted[0].chose === 'Banana' && posted[0].asked === 'Which fruit do you want?', JSON.stringify(posted));
        } else {
          check(`[${theme}] ${arm}: no buttons (CONTROL)`, seen.all === 0, String(seen.all));
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
