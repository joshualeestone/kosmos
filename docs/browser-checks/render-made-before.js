'use strict';
/**
 * The never-recorded state, on a screen (#149/#150, 2026-08-23).
 *
 * `node --test` proves the wording exists in the markup and the flag gates it.
 * It cannot prove the sentence actually lands on the card and the panel, that
 * the picker is refused BEFORE a click, that the explainer names the way in,
 * or the regression the review caught: one agent's refusal sentence standing
 * on another agent's panel after a switch. This can.
 *
 * ⚠️ THE SERVER RUNS IN THIS PROCESS WITH A FIXTURE FLEET, and every state
 * root is a temp dir, INCLUDING the launch dir: the recorded-agent control
 * writes a plist into the sandboxed AGENT_WORKFORCE_LAUNCH, never the real
 * ~/Library/LaunchAgents. The check clicks nav pills and reads text: no Save,
 * no Restart, no Remove, no model change.
 *
 * 🔑 THE CONTROL IS AN AGENT WITH A LAUNCH FILE beside one without: if both
 * wore the sentence, the check would be reading the fixture, not the flag.
 *
 *   node docs/browser-checks/render-made-before.js            # headed
 *   HEADED=0 node docs/browser-checks/render-made-before.js   # headless
 *   SHOT_DIR=... to keep the screenshots somewhere.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mb-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mb-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mb-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mb-launch-'));
/* The projects root too, or /api/projects reads the operator's real
   ~/Kosmos/Projects into the fixture board and the screenshots. */
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mb-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mb-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('rick', { state: 'idle', displayName: 'Rick', role: 'a researcher' }),
    fleet.agent('bob', { state: 'idle', displayName: 'Bob', role: 'a bookkeeper' }),
  ]);
  /* The control: Bob has a launch file in the SANDBOXED launch dir. */
  fs.writeFileSync(create.plistPath('bob'),
    create.plistFor('bob', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-opus-5'), 'utf8');
  /* And the STOPPED half: a profile with no pane and no plist makes a
     stopped known row, the state the review found dead behind a pctOf
     throw. Everything it writes is under the sandboxed data root. */
  require('../../engine/store').writeProfile('gone', { displayName: 'Gone' });
  // The offline rows require the worker FOLDER to exist (survey's k.folder
  // gate); a profile alone is not an agent the board will show.
  fs.mkdirSync(create.workerDir('gone'), { recursive: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="rick"]', { timeout: 8000 });

    // The card: Rick wears the sentence, Bob does not.
    const cards = await page.evaluate(() => ({
      rick: document.querySelector('[data-agent="rick"] .amodel').textContent,
      bob: document.querySelector('[data-agent="bob"] .amodel').textContent,
    }));
    chk(cards.rick === 'Made before Kosmos recorded this', 'the no-plist card wears the sentence', cards.rick);
    chk(cards.bob !== 'Made before Kosmos recorded this', 'CONTROL: the with-plist card does not', cards.bob);
    /* The sentence is 2.5x the old label; a text-equality pin cannot see an
       ellipsis or an overflowed row, so measure the fit where it renders. */
    const fit = await page.evaluate(() => {
      const el = document.querySelector('[data-agent="rick"] .amodel');
      return { over: el.scrollWidth > el.clientWidth + 1, w: el.clientWidth, sw: el.scrollWidth };
    });
    chk(!fit.over, 'the longer sentence fits the card without overflowing', JSON.stringify(fit));

    // Rick's panel: explainer visible with the way in, picker refused pre-click.
    await page.click('[data-agent="rick"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.click('#d-nav button[data-go="model"]');
    await page.waitForTimeout(400);
    const rick = await page.evaluate(() => ({
      why: document.getElementById('d-runson-why'),
      whyText: document.getElementById('d-runson-why').textContent,
      whyH: document.getElementById('d-runson-why').getBoundingClientRect().height,
      msg: document.getElementById('d-model-msg').textContent,
      disabled: document.getElementById('d-model').disabled,
    }));
    chk(rick.whyH > 0 && /To bring it in/.test(rick.whyText), 'the explainer is on screen and names the way in', rick.whyText);
    chk(rick.disabled === true, 'the picker is refused before any click');
    chk(/no launch file to change/.test(rick.msg), 'the refusal says why in the state’s own words', rick.msg);
    await page.screenshot({ path: path.join(OUT, 'made-before-rick.png'), fullPage: false });

    // The regression the review caught: switch to Bob, nothing lingers.
    await page.click('.tab[data-tab="agents"]');
    await page.waitForTimeout(300);
    await page.click('[data-agent="bob"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.click('#d-nav button[data-go="model"]');
    await page.waitForTimeout(400);
    const bob = await page.evaluate(() => ({
      whyH: document.getElementById('d-runson-why').getBoundingClientRect().height,
      msg: document.getElementById('d-model-msg').textContent,
      disabled: document.getElementById('d-model').disabled,
    }));
    chk(bob.whyH === 0, 'CONTROL: the explainer is off Bob’s screen', String(bob.whyH));
    chk(bob.msg === '', 'CONTROL: Rick’s refusal did not linger on Bob’s panel', bob.msg);
    chk(bob.disabled === false, 'CONTROL: the with-plist picker is usable');
    await page.screenshot({ path: path.join(OUT, 'made-before-bob-control.png'), fullPage: false });

    // The stopped never-recorded agent: the panel OPENS (this used to throw
    // in pctOf before anything painted), the explainer wears the stopped
    // wording (no instruction to stop an agent that is not running), and the
    // memory box says never recorded.
    await page.click('.tab[data-tab="agents"]');
    await page.waitForTimeout(300);
    await page.waitForSelector('[data-agent="gone"]', { timeout: 8000 });
    await page.click('[data-agent="gone"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.click('#d-nav button[data-go="model"]');
    await page.waitForTimeout(400);
    const gone = await page.evaluate(() => ({
      why: document.getElementById('d-runson-why').textContent,
      msg: document.getElementById('d-model-msg').textContent,
    }));
    chk(/To bring it in: add it from Found agents/.test(gone.why) && !/stop it/.test(gone.why),
      'the stopped explainer names the way in without telling anyone to stop a stopped agent', gone.why);
    chk(/Add it from Found agents/.test(gone.msg) && !/Stop it/.test(gone.msg),
      'the stopped picker refusal matches', gone.msg);
    await page.click('#d-nav button[data-go="memory"]');
    await page.waitForTimeout(300);
    const mem = await page.evaluate(() => document.getElementById('d-memory').textContent);
    chk(/memory was never recorded/.test(mem), 'the stopped memory box says never recorded', mem.slice(0, 120));
    await page.screenshot({ path: path.join(OUT, 'made-before-gone-stopped.png'), fullPage: false });

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('shots: ' + OUT);
  if (fail.length) { console.error('FAILURES: ' + fail.length); process.exit(1); }
})();
