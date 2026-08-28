'use strict';

/**
 * Adding a project member opens a real dialog, and there are three ways out (#1303 H item 3).
 *
 * 🔑 Josh: "Let's make adding a member to the project spawn a modal just like
 * adding a task to the project." The old control replaced itself with an inline
 * row inside a column that was already too narrow for it, which is the defect he
 * reported as "trying to add a project member does not fit in this area at all".
 *
 * 🛑 THIS NEEDS A PROJECT WITH A FREE AGENT ON SCREEN, and both halves are easy
 * to get wrong in a way that passes. `#pj-add-member` HIDES ITSELF when every
 * agent is already a member, so a fixture with one agent in a one-agent project
 * renders no button and a check that only asserted "no modal appeared" would be
 * green on a page that could never have shown one. The fleet here is two agents
 * and the project holds one.
 *
 * ⚠️ A dialog is not verified by existing. It is verified by being ON SCREEN with
 * real dimensions, and by every advertised way out actually closing it, so this
 * asserts the box's rectangle rather than the `hidden` attribute alone.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-member-modal.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session. Runs the
 * server in-process against a fixture fleet, every state root a temp dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mem-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const projects = require('../../engine/projects');
const srv = require('../../server.js');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'idle', displayName: 'April', role: 'Research Assistant' }),
    fleet.agent('mikey', { state: 'idle', displayName: 'Mikey', role: 'Bookkeeper' }),
  ]);
  /* One member, so mikey is free and the button has something to offer. */
  const p = projects.create({ name: 'Member Test' });
  projects.writeAll(projects.readAll().map((x) => (x.id === p.id ? { ...x, agents: ['april'] } : x)));

  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    /* ⚠️ DISMISS FIRST, THEN NAVIGATE AGAIN. Escaping the first-run overlay puts
       the board back on its default tab, so the row for a seeded project resolves
       in the DOM while its PANEL is still hidden. A child can report itself
       present while its parent is not, which is exactly what a `waitForSelector`
       on the row alone cannot tell you. */
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-project="' + p.id + '"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-project="' + p.id + '"]');
    await page.waitForTimeout(700);

    /* The box's rectangle, or null when it is not painted. A selector that
       matches nothing answers 'missing', so an absence line cannot pass on a
       page that has lost the element entirely. */
    const box = () => page.$eval('#am-modal .rm-box', (el) => {
      const back = el.closest('#am-modal');
      if (back.hidden || getComputedStyle(back).display === 'none') return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }).catch(() => 'missing');

    /* 🛑 THE CONTROL, and it runs before anything is clicked. If the dialog were
       already up, every assertion below would pass without the button working. */
    chk((await box()) === null, 'the dialog is closed before the button is pressed');
    const btn = await page.$('#pj-add-member');
    chk(!!btn, 'the add-a-member control is on screen', btn ? '' : 'no free agent, or the control is gone');

    if (btn) {
      await btn.click();
      await page.waitForTimeout(500);
      const open = await box();
      chk(open && open.w > 200 && open.h > 80, 'pressing it opens a dialog with real dimensions',
        JSON.stringify(open));
      /* ⚠️ GATED ON THE BOX BEING ON SCREEN. An attribute check does not care
         whether the element is painted, so perturbing the open away left this
         line green on a dialog nobody could see. Found by perturbing, not by
         reading: the arm that failed was the one beside it. */
      chk(!!open && await page.$eval('#am-modal .rm-box', (el) => el.getAttribute('role') === 'dialog'
        && el.getAttribute('aria-modal') === 'true').catch(() => false),
        'it is announced as a modal dialog');

      /* Way out 1: Escape. */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      chk((await box()) === null, 'Escape closes it');

      /* Way out 2: clicking the backdrop. */
      await (await page.$('#pj-add-member')).click();
      await page.waitForTimeout(400);
      chk((await box()) !== null, 'it reopens', 'so the close did not break the button');
      await page.evaluate(() => document.getElementById('am-modal').click());
      await page.waitForTimeout(400);
      chk((await box()) === null, 'clicking the backdrop closes it');

      /* ⚠️ AND THE BACKDROP MUST NOT SWALLOW A CLICK ON THE BOX ITSELF, which is
         the usual way this idiom breaks: the dialog shuts the moment somebody
         reaches for the field inside it. */
      await (await page.$('#pj-add-member')).click();
      await page.waitForTimeout(400);
      await page.click('#am-modal .rm-box');
      await page.waitForTimeout(400);
      chk((await box()) !== null, 'clicking inside the box does NOT close it');
    }

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
