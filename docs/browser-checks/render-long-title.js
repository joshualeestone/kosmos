'use strict';

/**
 * A long project title truncates instead of squeezing the search box (#1303 F).
 *
 * 🔑 Josh, 0.5.97 review: "A really long project title. Let's truncate it sooner
 * so that we can keep the search box a usable size."
 *
 * 🛑 THE FIXTURE IS THE WHOLE CHECK. A project called "Henderson Lease" cannot
 * demonstrate this in either direction, so an identical check with an ordinary
 * name would pass on the broken page and on the fixed one alike. This opens a
 * project whose title is long enough to starve the row, and asserts against a
 * SHORT-titled project in the same run so the comparison is a measurement rather
 * than a threshold somebody typed.
 *
 * ⚠️ "Usable" is not self-evident, so it is stated: the search input must keep at
 * least 120px, which is about ten characters at this size, and it must not lose
 * width when the title gets longer.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-long-title.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lt-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lt-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lt-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lt-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lt-config-'));
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

/* 🔑 EXACTLY THE ENGINE'S CAP, so this is the WORST CASE A USER CAN ACTUALLY
   CREATE rather than a long string somebody invented. `projects.create` refuses
   past 60 ("that name is too long to make a folder out of"), which I found by
   handing it 72 and being told. A check built on an arbitrary length would test
   a title the product cannot hold. */
const LONG = 'Henderson Commercial Lease Renegotiation And Handover Ph Two'; // 60

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'Research Assistant' })]);
  const shortP = projects.create({ name: 'Reed' });
  const longP = projects.create({ name: LONG });

  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => fetch('/api/style', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'consolidated' }),
    }).then((r) => r.text()));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('.pj-row', { state: 'visible', timeout: 10000 });

    const openAndMeasure = async (id) => {
      await page.click('[data-project="' + id + '"]');
      await page.waitForTimeout(700);
      return page.evaluate(() => {
        const search = document.querySelector('.pjmidhead .tsearch');
        const name = document.querySelector('.pjmidhead .pjhead .dname');
        if (!search || !name) return { missing: true };
        const sr = search.getBoundingClientRect();
        const nr = name.getBoundingClientRect();
        const cs = getComputedStyle(name);
        return {
          searchW: Math.round(sr.width),
          searchVisible: sr.width > 0 && sr.height > 0,
          nameW: Math.round(nr.width),
          /* The tell for a real truncation: the text is wider than its box. A
             wrapped or overflowing title has scrollWidth > clientWidth too, so
             this is paired with the overflow property below rather than trusted
             on its own. */
          clipped: name.scrollWidth > name.clientWidth + 1,
          overflow: cs.overflow || cs.overflowX,
          whiteSpace: cs.whiteSpace,
          lines: Math.round(nr.height),
        };
      });
    };

    const s = await openAndMeasure(shortP.id);
    const l = await openAndMeasure(longP.id);
    console.log('');
    console.log('  short title : ' + JSON.stringify(s));
    console.log('  long  title : ' + JSON.stringify(l));
    console.log('');

    chk(!s.missing && !l.missing, 'the header renders a title and a search box for both');
    if (!s.missing && !l.missing) {
      /* 🛑 THE CONTROL. If the search box were missing or collapsed for BOTH,
         every comparison below would be vacuous. */
      chk(s.searchVisible && s.searchW > 120,
        'with a short title the search box is usable', s.searchW + 'px');

      /* His ask, stated as the thing that must not happen. */
      chk(l.searchVisible && l.searchW >= 120,
        'a long title does NOT squeeze the search box below usable',
        l.searchW + 'px');
      chk(Math.abs(l.searchW - s.searchW) <= 2,
        'the search box is the SAME width whatever the title length',
        s.searchW + 'px vs ' + l.searchW + 'px');

      /* And the title has to give way instead: truncated on one line. */
      chk(l.whiteSpace === 'nowrap', 'the long title stays on one line', l.whiteSpace);
      chk(l.clipped, 'the long title is actually clipped, so an ellipsis has something to do');
      chk(l.lines <= s.lines + 2, 'the long title does not grow the header taller',
        s.lines + 'px vs ' + l.lines + 'px');
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
