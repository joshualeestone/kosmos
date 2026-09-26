// Browser-check-surface: d-state d-task
'use strict';
/**
 * #3958 (Josh, 2026-09-26): on the agent page the status pill said Idle while the same page's DM
 * said "is working…", and the working dots did not animate after idle -> working.
 *
 * Boots a real sandboxed board with one agent, opens its page WHILE IT IS IDLE (the case that
 * froze), then flips the agent idle -> working -> idle -> working -> working through the fixture,
 * one poll apart. After each flip, on chromium and webkit:
 *   - the pill's word and state class match the agent's state;
 *   - while working, the pill carries the working dots and they MOVE (sampled, not just present);
 *   - the pill and the DM line agree (both working, or neither);
 *   - on the second working poll in a row, the pill's dots are the same nodes, so their animation
 *     was not rebuilt and restarted by the poll (asserted to have run, not skipped).
 * Control: the first reading (idle, before any flip) shows the instrument can read "Idle" and "no
 * dots", so a working reading is not the instrument's default.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-agent-pill-3958.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pill-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const setState = (state) => fleet.install([
  fleet.agent('beatrix', { state, displayName: 'Beatrix', role: 'Collections Coordinator' }),
]);

/* One reading of the pill and the DM line. `moves` samples the first pill dot twelve times over
   1.2s: a running animation gives many distinct frames, a static dot gives one. */
async function read(page) {
  return page.evaluate(async () => {
    const st = document.getElementById('d-state');
    const bz = document.getElementById('d-busy');
    const dot = st ? st.querySelector('.act i') : null;
    let moves = 0;
    if (dot) {
      const seen = new Set();
      for (let k = 0; k < 12; k++) {
        const cs = getComputedStyle(dot);
        seen.add(cs.transform + '|' + cs.opacity);
        await new Promise((r) => setTimeout(r, 100));
      }
      moves = seen.size;
    }
    /* Rebuilt or kept: a dot the previous reading marked is the same node, so its animation was
       never restarted. A rewritten pill hands back a fresh, unmarked node. */
    const now = st ? st.querySelector('.act i') : null;
    const same = !!(now && now.__pill3958 === true);
    if (now) now.__pill3958 = true;
    return {
      word: st ? st.textContent.trim() : '',
      cls: st ? st.className : '',
      dots: !!dot,
      moves,
      same,
      dm: !!(bz && !bz.hidden && /is working/.test(bz.textContent)),
    };
  });
}

(async () => {
  setState('idle');
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      setState('idle'); // each engine opens the page while the agent is idle, the case that froze
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        await page.locator('.acard .namego').first().click();
        await page.waitForSelector('#d-state', { timeout: 20000 });

        const first = await read(page);
        chk(first.word === 'Idle' && !first.dots && !first.dm,
          `${engineName}: control: opened while idle, the pill reads Idle with no dots and no DM line`, JSON.stringify(first));

        let prevWorking = null;
        let secondPolls = 0;
        for (const state of ['working', 'idle', 'working', 'working']) {
          setState(state);
          await page.waitForTimeout(6500); // one five-second poll, plus margin
          const r = await read(page);
          const tag = `${engineName} -> ${state}`;
          if (state === 'working') {
            chk(r.word === 'Working' && /\bst-working\b/.test(r.cls), `${tag}: the pill says Working`, `${r.word} / ${r.cls}`);
            chk(r.dots && r.moves >= 4, `${tag}: the pill's working dots are there and moving`, `dots=${r.dots} distinct frames=${r.moves}`);
            chk(r.dm, `${tag}: the DM line agrees (is working…)`);
            if (prevWorking) {
              chk(r.same, `${tag}: a second working poll keeps the pill's dots (same nodes, animation not restarted)`, `same=${r.same}`);
              secondPolls += 1;
            }
            prevWorking = r;
          } else {
            chk(r.word === 'Idle' && /\bst-idle\b/.test(r.cls) && !r.dots, `${tag}: the pill says Idle, no dots`, `${r.word} / ${r.cls}`);
            chk(!r.dm, `${tag}: the DM line agrees (no working line)`);
            prevWorking = null;
          }
        }
        chk(secondPolls === 1, `${engineName}: precondition: the keep-running arm actually ran once`, String(secondPolls));
        chk(errs.length === 0, `${engineName}: no page errors`, errs.join(' | '));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
