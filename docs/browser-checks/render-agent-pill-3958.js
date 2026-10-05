// Browser-check-surface: d-state d-task d-start-wrap d-linklost d-linklost-text d-linklost-restart
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
 *   - after a flip to needs-you, the pill says exactly what the agent's grid card says;
 *   - on the second working poll in a row, the pill's dots are the same nodes, so their animation
 *     was not rebuilt and restarted by the poll (asserted to have run, not skipped);
 *   - after needs-you: auth_failed shows the Sign in again button and the screen evidence, and
 *     working hides them again; stopped shows "Start this agent", and working hides it again (a
 *     Start button frozen at open could sit beside Working and restart a running agent);
 *   - #4591: on a page that prefers reduced motion, the pill's and the DM line's working dots still
 *     fade in turn (they stopped dead there before, which reads as frozen) and do not move.
 * Control: the first reading (idle, before any flip) shows the instrument can read "Idle" and "no
 * dots", so a working reading is not the instrument's default.
 *   - #5333: a running agent whose run token is no longer on file (it lost its link to Kosmos) gets the notice
 *     under its pill, naming it, with a Restart that opens the shared restart confirm (and its "Write a handoff,
 *     then restart"); once its run's token is on file the notice is gone. Control: the notice is hidden before.
 *     A partly removed agent (removal could not stop it, token revoked on purpose) is never told to Restart.
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

const setState = (state, extra) => fleet.install([
  fleet.agent('beatrix', { state, displayName: 'Beatrix', role: 'Collections Coordinator', ...(extra || {}) }),
]);
const sendertoken = require('../../engine/sendertoken');   // #5333: the board reads this store, in this process

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
        /* A third state: needs-you. The pill must say exactly what the agent's own grid card says,
           the one derivation both surfaces share, and not linger on Working. */
        setState('needs_you');
        await page.waitForTimeout(6500);
        const nv = await page.evaluate(() => {
          const card = [...document.querySelectorAll('.acard')].find((c) => /Beatrix/.test(c.textContent));
          /* The state WORD, the <b> both badges carry: the card's badge also holds its Answer button. */
          const word = (el) => { const x = el ? el.querySelector('b') : null; return x ? x.textContent.trim() : null; };
          return { pill: word(document.getElementById('d-state')), card: word(card ? card.querySelector('.astate') : null) };
        });
        chk(nv.card && nv.pill === nv.card && nv.pill !== 'Working' && nv.pill !== 'Idle',
          `${engineName} -> needs_you: the pill says what the grid card says`, JSON.stringify(nv));
        /* The rest of the header follows the poll too: an agent that hits auth_failed after the page
           opened shows the Sign in again button and its screen evidence; back to working hides them. */
        setState('auth_failed');
        await page.waitForTimeout(6500);
        const af = await page.evaluate(() => ({ reauth: !document.getElementById('d-reauth').hidden, said: !document.getElementById('d-said').hidden }));
        chk(af.reauth && af.said, `${engineName} -> auth_failed: the Sign in again button and the screen evidence appear without reopening`, JSON.stringify(af));
        setState('working');
        await page.waitForTimeout(6500);
        const ok = await page.evaluate(() => ({ reauth: !document.getElementById('d-reauth').hidden }));
        chk(!ok.reauth, `${engineName} -> working again: the Sign in again button is gone`, JSON.stringify(ok));
        const startShown = () => page.evaluate(() => {
          const w = document.getElementById('d-start-wrap');
          const b = document.getElementById('d-start-agent');
          return { wrap: !!(w && !w.hidden), btn: !!(b && !b.hidden && !b.disabled) };
        });
        chk(!(await startShown()).wrap, `${engineName}: control: no Start button while working`);
        /* #4591 (Josh 2026-09-29 11:47: "his animate green dots are not animating", Mac app): with Reduce Motion
           on, the dots stopped dead, three level full-green dots, which is what his screenshot shows and reads as
           frozen. Reduce Motion asks for no MOVEMENT; a fade is not movement. So they still fade in turn, and
           do not move. Measured on a fresh page that prefers reduced motion, the agent working. */
        {
          const rm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
          const rmErrs = [];
          rm.on('pageerror', (e) => rmErrs.push(e.message));
          await rm.goto(URL);
          await rm.waitForSelector('.acard .namego', { timeout: 20000 });
          await rm.locator('.acard .namego').first().click();
          await rm.waitForSelector('#d-state .act i', { timeout: 20000 });
          await rm.waitForSelector('#d-busy:not([hidden]) .act i', { timeout: 20000 }).catch(() => {});
          const fade = (sel) => rm.evaluate(async (sel) => {
            const dots = [...document.querySelectorAll(sel)];
            const ops = new Set(), tfs = new Set(), spread = [];
            for (let k = 0; k < 14; k++) {
              const cs = dots.map((d) => getComputedStyle(d));
              cs.forEach((c) => { ops.add(c.opacity); tfs.add(c.transform); });
              spread.push(Math.max(...cs.map((c) => +c.opacity)) - Math.min(...cs.map((c) => +c.opacity)));
              await new Promise((r) => setTimeout(r, 100));
            }
            return { reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, dots: dots.length,
              opacities: ops.size, transforms: [...tfs], inTurn: dots.length ? Math.max(...spread) > 0.15 : false };
          }, sel);
          // Both sets of dots in Josh's screenshot: the pill, and the "is working" line under the thread.
          for (const [where, sel] of [['the pill', '#d-state .act i'], ['the DM line', '#d-busy .act i']]) {
            const f = await fade(sel);
            chk(f.reduce && f.dots === 3 && f.opacities >= 4 && f.inTurn,
              `${engineName}: with Reduce Motion on, ${where}'s working dots still fade, in turn, so Working reads as live`, JSON.stringify(f));
            // A guard, not evidence for #4591 (animation: none on main moves nothing either): the bounce stays off.
            chk(f.transforms.every((t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'),
              `${engineName}: and ${where}'s dots do not move (guard: no translate comes back under Reduce Motion)`, JSON.stringify(f.transforms));
          }
          chk(rmErrs.length === 0, `${engineName}: the Reduce Motion page throws no error`, rmErrs.join(' | '));
          await rm.close();
        }
        setState('stopped');
        await page.waitForTimeout(6500);
        const st = await startShown();
        chk(st.wrap && st.btn, `${engineName} -> stopped: "Start this agent" appears without reopening`, JSON.stringify(st));
        setState('working');
        await page.waitForTimeout(6500);
        const wk = await startShown();
        chk(!wk.wrap, `${engineName} -> working after stopped: the Start button is gone, not left beside Working`, JSON.stringify(wk));
        /* #5333: a running agent that has lost its link. Control first: no notice while its run carries no instance. */
        const linkNote = () => page.evaluate(() => {
          const n = document.getElementById('d-linklost');
          const b = document.getElementById('d-linklost-restart');
          return { shown: !!(n && !n.hidden && n.getClientRects().length), text: ((document.getElementById('d-linklost-text') || {}).textContent || ''),
            target: b ? b.dataset.restartAgent : null };
        });
        chk(!(await linkNote()).shown, `${engineName}: control: no lost-link notice for a running agent with nothing to compare`);
        /* A real board that has launched agents has a token store; this sandbox has minted nothing yet, and a board with no
           store at all is never told an agent is lost (it cannot tell). So another agent's token makes the store exist. */
        sendertoken.mint('beatrix');   // her file exists, holding a run other than the one her session carries
        setState('working', { tokenInstance: 'abcdef123456' });   // this run's token is not in her file
        /* Counted by the page's own poll counter, not by the clock: a fixed wait can hold one poll or two. */
        const seenN = () => page.evaluate(() => { const e = LINK_LOST_SEEN.get('beatrix'); return e ? e.n : 0; });
        await page.waitForFunction(() => { const e = LINK_LOST_SEEN.get('beatrix'); return !!e && e.n === 1; }, null, { timeout: 15000 });
        chk(!(await linkNote()).shown, `${engineName} -> link lost on ONE poll: no notice yet (it waits for a second, past a restart's moment)`, 'n=' + (await seenN()));
        await page.waitForFunction(() => { const e = LINK_LOST_SEEN.get('beatrix'); return !!e && e.n >= 2; }, null, { timeout: 15000 });
        const lost = await linkNote();
        chk(lost.shown && /^Beatrix has lost its link to Kosmos, so it cannot answer you in Kosmos\./.test(lost.text) && lost.target === 'beatrix',
          `${engineName} -> link lost: the notice names the agent and its Restart is for that agent`, JSON.stringify(lost));
        await page.click('#d-linklost-restart');
        await page.waitForTimeout(300);
        const dlg = await page.evaluate(() => { const h = document.getElementById('rst-handoff-go'); return !!(h && h.getClientRects().length); });
        chk(dlg, `${engineName} -> link lost: Restart opens the shared confirm, with "Write a handoff, then restart"`, String(dlg));
        await page.click('#rst-keep').catch(() => {});   // Leave it running: nothing is restarted here
        /* A removal that could not stop the session revokes its token on purpose and keeps the card (hidesCard false):
           that agent must not be told to Restart. The record goes; the token stays gone. */
        const REMOVED_FILE = require('../../engine/remove').REMOVED_FILE;
        fs.writeFileSync(REMOVED_FILE, JSON.stringify([{ name: 'beatrix', removedAt: new Date().toISOString(), stopped: false }]));
        await page.waitForTimeout(6500);
        const removing = await linkNote();
        fs.rmSync(REMOVED_FILE, { force: true });
        chk(!removing.shown, `${engineName} -> removed but still running: no Restart notice for an agent being removed`, JSON.stringify(removing));
        await page.waitForTimeout(6500);
        await page.waitForFunction(() => { const e = LINK_LOST_SEEN.get('beatrix'); return !!e && e.n >= 2; }, null, { timeout: 15000 }).catch(() => {});   // two polls in a row again
        chk((await linkNote()).shown, `${engineName} -> removal record gone, token still gone: the notice is back (the guard, not the poll, hid it)`);
        const minted = sendertoken.mint('beatrix');
        setState('working', { tokenInstance: minted.instance });   // its run's token is on file
        await page.waitForTimeout(6500);
        chk(!(await linkNote()).shown, `${engineName} -> token on file: the notice is gone`);
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
