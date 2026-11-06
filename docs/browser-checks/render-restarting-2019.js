'use strict';
/**
 * #2019 (Mona Lisa's design half): the "restarting" board state. A disruption WE
 * started (restart / model / provider / instructions / account) takes the agent
 * out of tmux for a moment; the board must render that as an honest in-progress
 * state with the moving restart mark, NOT as "gone". The mark is the 16 px Sweep dots
 * since Josh 11-06 12:18 (#7896, kGlyph); it was the breathing .kspin Kosmos K before.
 *
 * The ENGINE half (Renet) emits `a.state === 'restarting'` with
 * `a.disruption = { cause, startedAt }`. This check does NOT depend on the engine:
 * it calls the page's own global render functions (card / stateCopyOf / cardStOf)
 * with fixture agents shaped to that contract, so the PRESENTATION is verified on
 * its own. That is the right scope -- my half is the render, the engine half is the
 * signal.
 *
 * What it pins, and why each can fail:
 *  - the cause-named copy (Restarting agent / Switching to <model> / Restarting to
 *    apply your changes / Switching account / a fallback), so a reworded or dropped
 *    label goes red,
 *  - the card is NOT "gone": pres is 'on' and the modifier class is 'restarting',
 *    never 'off'/'unk' (the exact lie this state exists to refuse),
 *  - the SOLID border (st-restarting, never the dashed unknown),
 *  - the Sweep dots are present (eight of them, the retired .kspin K gone), they sweep
 *    (sweepLite) when motion is allowed, and under reduced motion they take the app-wide
 *    calm pulse (calmPulse, no travel) rather than sweeping round the ring.
 *
 * Not part of `npm test` -- it needs a browser. See README.md for the recipe.
 *   HEADED=0 node docs/browser-checks/render-restarting-2019.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restarting-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restarting-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restarting-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restarting-l-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restarting-c-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* One case per cause, shaped to Renet's engine contract (a.disruption.cause). */
const CASES = [
  { cause: 'restart',      wantLabel: 'Restarting agent' },
  { cause: 'model',        wantLabel: 'Switching to Opus 5' },
  { cause: 'provider',     wantLabel: 'Switching provider' },
  { cause: 'instructions', wantLabel: 'Restarting to apply your changes' },
  { cause: 'account',      wantLabel: 'Switching account' },
  { cause: 'nonsense',     wantLabel: 'Restarting agent' },   // unknown cause -> fallback
  { cause: null,           wantLabel: 'Restarting agent' },   // absent disruption -> fallback
];

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

      // The render functions must be global (the page's board script is top-level).
      const haveFns = await page.evaluate(() => typeof card === 'function' && typeof lrow === 'function' && typeof stateCopyOf === 'function' && typeof cardStOf === 'function');
      chk(haveFns, `[${theme}] the board render functions are reachable`);
      if (!haveFns) continue;

      for (const c of CASES) {
        const disruption = c.cause === null ? null : { cause: c.cause, startedAt: '2026-09-04T01:00:00.000Z' };
        const res = await page.evaluate(({ disruption }) => {
          const a = {
            name: 'April', sessionName: 'april', displayName: 'April',
            role: 'a researcher', present: true, modelName: 'Opus 5',
            context: null, stateConfidence: 'reported',
            state: 'restarting', disruption,
          };
          const html = card(a);
          const st = cardStOf(a);
          const copy = stateCopyOf(a);
          // Render into a detached node to read classes/text without disturbing the board.
          const d = document.createElement('div');
          d.innerHTML = html;
          const cardEl = d.firstElementChild;
          const pill = cardEl.querySelector('.astate');
          const mark = cardEl.querySelector('.astate .spin.spin-sweep');
          const taskEl = cardEl.querySelector('.atask');
          return {
            pres: st.pres,
            label: copy.label,
            cardClass: cardEl.className,
            pillClass: pill ? pill.className : null,
            hasMark: !!mark && mark.querySelectorAll(':scope > i').length === 8 && !cardEl.querySelector('.kspin'),
            markClass: mark ? mark.className : null,
            task: taskEl ? taskEl.textContent.trim() : '',
            pillTitle: pill ? (pill.getAttribute('title') || '') : '',
          };
        }, { disruption });

        const tag = `[${theme}] cause=${c.cause}`;
        chk(res.label === c.wantLabel, `${tag} label is "${c.wantLabel}"`, JSON.stringify(res.label));
        chk(res.pres === 'on', `${tag} presence is on (not gone)`, res.pres);
        chk(/\brestarting\b/.test(res.cardClass) && !/\b(off|unk)\b/.test(res.cardClass),
          `${tag} card class is restarting, never off/unk`, res.cardClass);
        chk(/st-restarting/.test(res.pillClass || ''), `${tag} pill is st-restarting`, res.pillClass);
        chk(res.hasMark, `${tag} the Sweep restart dots are present (eight, no .kspin K)`, res.markClass);
        /* #6716 (Josh, 2026-10-20: no sentences on tiles): the calm line is the pill's hover, and the tile says nothing. */
        chk(/This takes a few seconds\. Nothing was lost\./.test(res.pillTitle),
          `${tag} the calm because-line is the pill's hover`, JSON.stringify(res.pillTitle));
        chk(res.task === '', `${tag} the tile carries no sentence (#6716)`, JSON.stringify(res.task));
      }

      // ---- paneless: a restarting agent whose pane is GONE still reads restarting -
      // The whole point of #2019 is the tmux gap: mid-restart the pane is gone, so the
      // engine's snapshot carries running:false while state:'restarting'. BOTH card()
      // and lrow() have an offline early-return guarded with `&& a.state !== 'restarting'`,
      // so a running:false restarting agent must NOT fall to "Not running" in either the
      // grid OR the list. (Only `running` is load-bearing here -- card()/lrow() derive
      // presence from CARD_ST.restarting.pres, not the fixture's `present`.) This arm
      // exercises the running:false path the per-cause cases above (present:true) never
      // touch, at both render sites where the guard lives, so neither is left unarmed.
      const paneless = await page.evaluate(() => {
        const a = {
          name: 'April', sessionName: 'april', displayName: 'April', role: 'a researcher',
          modelName: 'Opus 5', context: null, stateConfidence: 'reported',
          state: 'restarting', disruption: { cause: 'restart', startedAt: '2026-09-04T01:00:00.000Z' },
          running: false,
        };
        const cd = document.createElement('div'); cd.innerHTML = card(a);
        const cardEl = cd.firstElementChild;
        const pill = cardEl.querySelector('.astate');
        const ld = document.createElement('div'); ld.innerHTML = lrow(a);
        const rowEl = ld.firstElementChild;
        return {
          cardClass: cardEl.className,
          pillClass: pill ? pill.className : null,
          cardLabel: (cardEl.querySelector('.astate b') || {}).textContent || '',
          cardHasK: !!cardEl.querySelector('.astate .spin.spin-sweep') && !cardEl.querySelector('.kspin'),
          cardNotRunning: /Not running/.test(cardEl.textContent),
          rowText: rowEl.textContent,
          rowHasK: !!rowEl.querySelector('.lpill .spin.spin-sweep') && !rowEl.querySelector('.kspin'),
          rowNotRunning: /Not running/.test(rowEl.textContent),
        };
      });
      chk(/\brestarting\b/.test(paneless.cardClass) && !/\b(off|unk|notrunning)\b/.test(paneless.cardClass),
        `[${theme}] paneless (running:false) restarting CARD is restarting, never off/unk/notrunning`, paneless.cardClass);
      chk(/st-restarting/.test(paneless.pillClass || '') && paneless.cardHasK
        && paneless.cardLabel === 'Restarting agent' && !paneless.cardNotRunning,
        `[${theme}] paneless CARD shows the restart dots + "Restarting agent", never "Not running"`, JSON.stringify({ p: paneless.pillClass, k: paneless.cardHasK, l: paneless.cardLabel, nr: paneless.cardNotRunning }));
      chk(paneless.rowHasK && /Restarting agent/.test(paneless.rowText) && !paneless.rowNotRunning,
        `[${theme}] paneless (running:false) restarting ROW shows the restart dots + "Restarting agent", never "Not running"`, JSON.stringify({ k: paneless.rowHasK, nr: paneless.rowNotRunning }));
      // CONTROL: the SAME running:false with a non-restarting state MUST still render
      // "Not running" in BOTH the card and the row. This proves the paneless passes above
      // are the guard (`&& a.state !== 'restarting'`) doing its job at each site, not a
      // globally-defeated offline early-return -- an assertion that passed either way
      // would mean nothing.
      const offline = await page.evaluate(() => {
        const a = { name: 'April', sessionName: 'april', displayName: 'April', role: 'a researcher',
          modelName: 'Opus 5', context: null, stateConfidence: 'reported', state: 'idle', running: false };
        const cd = document.createElement('div'); cd.innerHTML = card(a);
        const ld = document.createElement('div'); ld.innerHTML = lrow(a);
        return {
          cardTxt: cd.firstElementChild.textContent, cardCls: cd.firstElementChild.className,
          rowTxt: ld.firstElementChild.textContent,
        };
      });
      chk(/Not running/.test(offline.cardTxt) && /\bnotrunning\b/.test(offline.cardCls),
        `[${theme}] CONTROL: a non-restarting running:false agent still reads "Not running" (card)`, offline.cardCls);
      chk(/Not running/.test(offline.rowTxt),
        `[${theme}] CONTROL: a non-restarting running:false agent still reads "Not running" (row)`, JSON.stringify(offline.rowTxt.slice(0, 40)));

      // ---- reduced motion: the dots stop travelling and calm to one pulse ------
      // Inject a restarting card, read the dots' animation under each motion setting.
      // The dot is each <i>'s ::before; all eight must agree.
      await page.evaluate(() => {
        const a = { name: 'April', sessionName: 'april', displayName: 'April', role: 'a researcher',
          present: true, modelName: 'Opus 5', context: null, stateConfidence: 'reported',
          state: 'restarting', disruption: { cause: 'restart' } };
        const host = document.createElement('div'); host.id = '__rtest';
        host.innerHTML = card(a); document.body.appendChild(host);
      });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const dotsNow = () => page.evaluate(() => {
        const dots = [...document.querySelectorAll('#__rtest .astate .spin.spin-sweep > i')];
        const names = [...new Set(dots.map((i) => getComputedStyle(i, '::before').animationName))];
        const transforms = [...new Set(dots.map((i) => getComputedStyle(i, '::before').transform))];
        return { n: dots.length, animName: names.length === 1 ? names[0] : names.join('|'), transforms: transforms.join('|') };
      });
      const motion = await dotsNow();
      chk(motion.n === 8 && motion.animName === 'sweepLite', `[${theme}] the restart dots sweep when motion is allowed`, JSON.stringify(motion));

      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reduced = await dotsNow();
      chk(reduced.n === 8 && reduced.animName === 'calmPulse', `[${theme}] reduced motion calms the dots to one pulse (calmPulse), not the sweep`, JSON.stringify(reduced));
      chk(reduced.transforms === 'none', `[${theme}] under reduced motion the dots do not travel or scale (transform none)`, reduced.transforms);

      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
