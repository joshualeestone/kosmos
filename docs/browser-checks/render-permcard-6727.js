'use strict';
// Browser-check-surface: dmPermissionHtml dmperm dmperm-ask dmperm-says dmperm-allow dmperm-deny dmperm-more dmperm-detail dmperm-main DM_PERM_DOES
/*
 * kosmos#6727 (Josh, 10-20: "yikes.. what is this"): an agent stopped on Claude Code's permission prompt reads as one
 * short card in its chat, never as the terminal's screen. The page is opened from disk with its server calls answered
 * by a stub (as render-dmchoices-5406.js), and the stub serves exactly what the server would: the card fields come from
 * the engine's own reading (chat.permissionCard) of the captured screens, the options from status.claudePermissionPrompt.
 *
 *   CARD     the bash capture: "Wants to run a command." (the bubble's header names the agent), Claude's own description, Allow then Deny, "Show details"
 *            closed with the command and the other options inside; no rule, option number, key hint or question in the
 *            visible text; Allow posts the prompt's "Yes" number, Deny its "No" number (one press each).
 *   DELETE   the dangerous-rm prompt: "April wants to run a command that deletes files."
 *   PRESENCE OFF  the card served while the composer is closed (no buttons): drawn as before, no card (review 1).
 *   CONTROL  the same question served WITHOUT `permission`: drawn as before (its text and numbered buttons), so the card
 *            comes from the field and nothing else.
 * Light and dark, at desktop and phone width. HEADLESS-safe (DOM-state assertions). SHOT=<file.png> saves the light card.
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-permcard-6727.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const chat = require('../../engine/chat');
const status = require('../../engine/status');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'file://' + path.join(ROOT, 'web', 'index.html');
const SCREENS = path.join(ROOT, 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const RM = BASH.replace(' /usr/bin/uuidgen\n', ' rm -rf "$TARGET/build"\n')
  .replace('Generate a UUID with uuidgen', 'Remove the old build folder')
  .replace('This command requires approval', 'Dangerous rm operation on possibly-empty variable path');

/* What the thread route serves for a screen: the question (questionIn), its options and identity, and the card. */
function served(screen, withCard) {
  const q = chat.questionIn(screen, 'claude');
  const pp = status.claudePermissionPrompt(screen);
  const card = chat.permissionCard(screen);
  if (!q || !pp || !card) throw new Error('premise: the screen is not a readable permission prompt');
  const row = { id: 'needs-you-question:april', at: null, text: q.text, from: 'april', delivery: null, kind: 'question', reported: false,
    ...(withCard ? { permission: card } : {}) };
  return { olderCount: 0, historyBecause: null, historyUnfilable: false, owes: null, presence: 'on', presenceBecause: null,
    asking: true, question: { text: q.text }, questionBecause: null, codexHooks: null, answerNote: null,
    options: chat.optionsIn(q.text), asked: chat.questionAbove(q.text), messages: [row], card };
}
const CHROME = /─{4}|╌{4}|Esc to cancel|Tab to amend|❯|Do you want to proceed/;

const problems = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) problems.push(name);
}

async function paint(page, fx) {
  await page.evaluate((f) => {
    window.__fx = f; window.__posted = [];
    CURRENT = { sessionName: 'april', name: 'April' };   // a bare assignment: the page's `let CURRENT`
    DM_CHOICE_ANSWERED.clear(); DM_CHOICE_ARMED = null;   // a fresh question each arm
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  }, fx);
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(150);
}
/* The bubble's visible words: what a person reads with Show details closed. */
const readCard = (page) => page.evaluate(() => {
  const q = document.querySelector('#d-dmthread .msg .dmperm');
  if (!q) return null;
  const more = q.querySelector('details.dmperm-more');
  const clone = q.cloneNode(true);
  clone.querySelectorAll('details').forEach((d) => d.remove());
  return {
    shown: clone.textContent.replace(/\s+/g, ' ').trim(),
    ask: (q.querySelector('.dmperm-ask') || {}).textContent || '',
    says: (q.querySelector('.dmperm-says') || {}).textContent || '',
    main: [...q.querySelectorAll('.dmperm-main .dmchoice')].map((b) => b.textContent.trim() + '#' + b.getAttribute('data-n')),
    open: more ? more.open : null,
    detail: more ? ((more.querySelector('.dmperm-detail') || {}).textContent || '') : '',
    moreButtons: more ? [...more.querySelectorAll('.dmchoice')].map((b) => b.getAttribute('data-n')) : [],
    bubbleText: q.closest('.msg').textContent,
  };
});

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      for (const [w, h] of [[1100, 900], [393, 852]]) {
        const tag = `[${theme} ${w}]`;
        const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
        page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
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

        // CARD
        const fx = served(BASH, true);
        await paint(page, fx);
        const c = await readCard(page);
        check(`${tag} CARD the ask says who and what, in plain words`, !!c && c.ask === 'Wants to run a command.', JSON.stringify(c && c.ask));
        check(`${tag} CARD Claude's own description sits under it, marked as its own words`, !!c && c.says === 'It says: Generate a UUID with uuidgen', JSON.stringify(c && c.says));
        check(`${tag} CARD Allow then Deny, on the prompt's own Yes and No numbers`, !!c && JSON.stringify(c.main) === JSON.stringify(['Allow#' + fx.card.allow, 'Deny#' + fx.card.deny]), JSON.stringify(c && c.main));
        check(`${tag} CARD Show details is closed, and holds the command and the other options`, !!c && c.open === false
          && c.detail === '/usr/bin/uuidgen' && JSON.stringify(c.moreButtons) === '["2","3"]', JSON.stringify(c && { open: c.open, detail: c.detail, more: c.moreButtons }));
        check(`${tag} CARD no terminal chrome in what a person reads`, !!c && !CHROME.test(c.shown) && !/\b\d\.\s/.test(c.shown), JSON.stringify(c && c.shown));
        check(`${tag} CARD the raw screen is not in the bubble at all`, !!c && !/Esc to cancel|Tab to amend|─{4}/.test(c.bubbleText), '');
        if (theme === 'light' && w === 1100 && process.env.SHOT) await page.locator('#d-dmthread').screenshot({ path: process.env.SHOT });
        // No card, no button: fail the press arms as assertions, not as a 30 s click timeout, so every arm still reports.
        const press = async (n) => {
          const b = page.locator('#d-dmthread .dmperm-main .dmchoice[data-n="' + n + '"]');
          if (await b.count() !== 1) return false;
          await b.click();
          await page.waitForTimeout(150);
          return true;
        };
        await press(fx.card.allow);
        let posted = await page.evaluate(() => window.__posted.slice());
        check(`${tag} CARD Allow sends the prompt's Yes, once`, posted.length === 1 && posted[0].text === String(fx.card.allow) && posted[0].chose === 'Yes'
          && posted[0].asked === fx.asked && !posted[0].lasting, JSON.stringify(posted));
        const afterAllow = await page.evaluate(() => (document.querySelector('#d-dmthread .dmperm-main .dmchoices-msg') || {}).textContent || '');
        check(`${tag} CARD after Allow the card says Allowed.`, afterAllow === 'Allowed.', JSON.stringify(afterAllow));
        await paint(page, fx);
        await press(fx.card.deny);
        posted = await page.evaluate(() => window.__posted.slice());
        check(`${tag} CARD Deny sends the prompt's No, once`, posted.length === 1 && posted[0].text === String(fx.card.deny) && posted[0].chose === 'No', JSON.stringify(posted));
        const afterDeny = await page.evaluate(() => (document.querySelector('#d-dmthread .dmperm-main .dmchoices-msg') || {}).textContent || '');
        check(`${tag} CARD after Deny the card says Denied.`, afterDeny === 'Denied.', JSON.stringify(afterDeny));

        // DELETE
        await paint(page, served(RM, true));
        const d = await readCard(page);
        check(`${tag} DELETE the dangerous rm reads as a command that deletes files`, !!d && d.ask === 'Wants to run a command that deletes files.', JSON.stringify(d && d.ask));

        // PRESENCE OFF (review 1): the composer is closed, so no buttons are drawn, and so no card either: the old text.
        await paint(page, { ...served(BASH, true), presence: 'off' });
        const off = await page.evaluate(() => ({ card: !!document.querySelector('#d-dmthread .dmperm'),
          text: [...document.querySelectorAll('#d-dmthread .msg')].some((x) => /Do you want to proceed/.test(x.textContent)) }));
        check(`${tag} PRESENCE OFF no buttons, so no card that promises them: the question as before`, !off.card && off.text, JSON.stringify(off));

        // CONTROL
        await paint(page, served(BASH, false));
        const old = await page.evaluate(() => {
          const m = [...document.querySelectorAll('#d-dmthread .msg')].find((x) => /Do you want to proceed/.test(x.textContent));
          return { card: !!document.querySelector('#d-dmthread .dmperm'), shown: !!m, numbered: m ? m.querySelectorAll('.dmchoice .dmchoice-n').length : 0 };
        });
        check(`${tag} CONTROL without the field the question is drawn as before (its text and numbered buttons)`, !old.card && old.shown && old.numbered === 4, JSON.stringify(old));
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (problems.length) { console.log('\nFAIL  render-permcard-6727: ' + problems.join(' | ')); process.exit(1); }
  console.log('\nrender-permcard-6727: all arms passed.');
}
run().catch((e) => { console.error('FAIL  render-permcard-6727', e && e.message); process.exit(1); });
