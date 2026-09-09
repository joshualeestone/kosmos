// Browser-check-surface: pjs-sound-toggle
'use strict';
/* #2407: the per-project new-message "bubble pop" plays in the REAL page.
 *
 * The node test (web.bubblepop-2407.test.js) runs the extracted #2407 block against a
 * stubbed Web Audio. What a node --test cannot see is that the block is actually WIRED
 * into the shipped page as live globals and that the per-project toggle element paints.
 * This drives the shipped page with a counting AudioContext stub (installed before any
 * page script via addInitScript) to exercise the decision logic, AND runs one pop
 * through the REAL Chromium AudioContext (the stub is swapped out for that one check)
 * so a real Web Audio constraint the stub cannot catch -- e.g. exponentialRampToValueAtTime
 * targeting 0 -- fails loudly here rather than only on a device with speakers.
 *
 * ASSERTS:
 *   1. the #2407 globals exist on the page (wired, not dead source).
 *   2. the first load baselines and does NOT ring; a later rise rings once.
 *   3. a burst (several projects rising at once) rings once, not per message.
 *   4. a muted project does not ring; an unmuted one does (per-project).
 *   5. Do-Not-Disturb (SOUND_QUIET) suppresses the pop.
 *   6. an unknown (null) unread neither rings nor rebaselines to zero; a real rise after still rings.
 *   7. the currently-open project does not ring; a background one does after switching away.
 *   8. the stubbed pop is a sine starting at 400 Hz (the recipe fields).
 *   9. one pop through the REAL AudioContext builds a valid graph (no throw).
 *  10. the per-project settings toggle exists and paintSwitch drives its state.
 *
 * DOM-state + a stubbed-AudioContext call count (+ one real-context throw check), so headless is fine.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-bubblepop-2407.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|status 404/.test(m.text())) errs.push(m.text()); });

    // Replace AudioContext BEFORE any page script runs: record each oscillator that
    // starts (one per pop) and the first frequency value set, so the recipe is checkable.
    await p.addInitScript(() => {
      window.__pops = [];
      window.__RealAC = window.AudioContext;   // kept so one check can exercise the real graph
      const Fake = function () {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
      };
      Fake.prototype.resume = function () { return Promise.resolve(); };
      Fake.prototype.createOscillator = function () {
        const rec = { type: '', startFreq: null };
        const o = {
          set type(v) { rec.type = v; }, get type() { return rec.type; },
          frequency: { setValueAtTime: (v) => { if (rec.startFreq === null) rec.startFreq = v; }, linearRampToValueAtTime: () => {} },
          connect() {}, disconnect() {},
          start() { window.__pops.push(rec); }, stop() {}, onended: null,
        };
        return o;
      };
      Fake.prototype.createGain = function () {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      };
      window.AudioContext = Fake;
      window.webkitAudioContext = Fake;
    });

    await p.goto('http://127.0.0.1:' + PORT + '/?first-run=1', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof window.ringNewMessages === 'function', { timeout: 8000 }).catch(() => {});

    // 1. globals wired
    const wired = await p.evaluate(() => ['ringNewMessages', 'playBubblePop', 'projectSoundOn', 'setProjectSoundOn'].every((f) => typeof window[f] === 'function'));
    if (wired) ok('the #2407 sound globals are wired into the page'); else bad('globals wired', 'a #2407 global is missing');

    const pops = () => p.evaluate(() => window.__pops.length);
    // BUBBLE_LAST is reset too: the debounce that coalesces a burst across rapid polls
    // would otherwise suppress the next scenario's pop (scenarios fire ms apart).
    const reset = () => p.evaluate(() => { window.__pops = []; PJ_UNREAD_SEEN = null; SOUND_QUIET = false; BUBBLE_LAST = 0; });

    // 2. first load no ring; a rise rings once
    await reset();
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 3 }]));
    if ((await pops()) === 0) ok('the first (baseline) load does NOT ring'); else bad('first-load rang', String(await pops()));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 4 }]));
    if ((await pops()) === 1) ok('a new message on a later load rings once'); else bad('rise ring count', String(await pops()));

    // 3. burst = one pop
    await reset();
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 5 }, { id: 'b', unread: 2 }]));
    if ((await pops()) === 1) ok('a burst (two projects rising at once) rings once'); else bad('burst ring count', String(await pops()));

    // 4. muted project does not ring; unmuted does (consistent project sets each poll)
    await reset();
    await p.evaluate(() => { setProjectSoundOn('a', false); });
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 9 }, { id: 'b', unread: 0 }]));
    if ((await pops()) === 0) ok('a muted project does not ring'); else bad('muted rang', String(await pops()));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 10 }, { id: 'b', unread: 1 }]));
    if ((await pops()) === 1) ok('an unmuted project rings (mute is per-project)'); else bad('unmuted did not ring', String(await pops()));
    await p.evaluate(() => { setProjectSoundOn('a', true); });   // restore

    // 5. DND suppresses
    await reset();
    await p.evaluate(() => { SOUND_QUIET = true; });
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 0 }]));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 3 }]));
    if ((await pops()) === 0) ok('Do-Not-Disturb suppresses the pop'); else bad('DND rang', String(await pops()));

    // 6. an UNKNOWN count (null unread) never rings and never rebaselines to zero
    await reset();
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 2 }]));         // baseline 2
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: null }]));      // transient count-read failure
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 2 }]));         // same 2 -> must NOT be a 0->2 rise
    if ((await pops()) === 0) ok('an unknown (null) count neither rings nor rebaselines to zero'); else bad('null-unread false-rang', String(await pops()));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 3 }]));         // a real new message
    if ((await pops()) === 1) ok('a real rise after an unknown blip still rings'); else bad('post-null rise did not ring', String(await pops()));

    // 7. the currently-open project never rings; a background one does
    await reset();
    await p.evaluate(() => { PJ_CURRENT = 'a'; });
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 0 }, { id: 'b', unread: 0 }]));
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 1 }, { id: 'b', unread: 0 }]));   // message in the OPEN room
    if ((await pops()) === 0) ok('the currently-open project does not ring'); else bad('open project rang', String(await pops()));
    await p.evaluate(() => { PJ_CURRENT = 'b'; });
    await p.evaluate(() => ringNewMessages([{ id: 'a', unread: 2 }, { id: 'b', unread: 0 }]));   // a is now background
    if ((await pops()) === 1) ok('a background project rings after switching away'); else bad('background did not ring', String(await pops()));
    await p.evaluate(() => { PJ_CURRENT = null; });

    // 8. the stubbed pop is a sine starting at 400 Hz (the recipe fields)
    await reset();
    await p.evaluate(() => playBubblePop());
    const rec = await p.evaluate(() => window.__pops[0] || null);
    if (rec && rec.type === 'sine' && rec.startFreq === 400) ok('the pop is a sine starting at 400 Hz (the documented recipe)'); else bad('recipe', JSON.stringify(rec));

    // 9. one pop through the REAL AudioContext must not throw (catches a real Web Audio
    //    constraint the stub cannot, e.g. exponentialRampToValueAtTime targeting 0).
    const real = await p.evaluate(() => {
      const saved = window.AudioContext;
      try {
        window.AudioContext = window.__RealAC;
        BUBBLE_CTX = null; BUBBLE_LAST = 0;
        playBubblePop();
        return { ok: true };
      } catch (e) {
        return { ok: false, err: String((e && e.message) || e) };
      } finally {
        window.AudioContext = saved; BUBBLE_CTX = null;
      }
    });
    if (real.ok) ok('one pop through a REAL AudioContext builds a valid graph (no throw)'); else bad('real graph threw', real.err);

    // 7. the per-project settings toggle exists and paintSwitch drives it
    const tog = await p.evaluate(() => {
      const el = document.getElementById('pjs-sound-toggle');
      if (!el || typeof paintSwitch !== 'function') return { present: false };
      paintSwitch('pjs-sound-toggle', true);
      const onState = el.getAttribute('aria-checked');
      paintSwitch('pjs-sound-toggle', false);
      const offState = el.getAttribute('aria-checked');
      return { present: true, role: el.getAttribute('role'), onState, offState };
    });
    if (tog.present && tog.role === 'switch' && tog.onState === 'true' && tog.offState === 'false') ok('the per-project sound toggle exists and paintSwitch drives its state'); else bad('settings toggle', JSON.stringify(tog));

    if (errs.length) bad('no page errors', errs.join(' | ')); else ok('no page errors');
    await p.close();
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 15) { console.log('bubblepop: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('bubblepop: ' + failures + ' FAILED'); process.exit(1); }
  console.log('bubblepop: all good, ' + ran + ' checks');
})();