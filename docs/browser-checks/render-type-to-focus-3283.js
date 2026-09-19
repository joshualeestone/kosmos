// Browser-check-surface: d-say pj-post
/* #3283 type-to-focus: a printable keystroke typed with NOTHING focused routes
 * straight into the current surface's composer - no click into the field first.
 * Josh: nothing else on those screens catches key commands, so the first key
 * should just start populating the message input. Three surfaces:
 *   1. agent conversation view (panel-detail Talk)   -> #d-say
 *   2. project GRID view (tabs layout)                -> #pj-post
 *   3. project CONSOLIDATED view (same DOM, CSS mode) -> #pj-post
 *
 * Why a browser check: the whole behaviour is real focus + real key delivery.
 * The mechanism is "focus the composer on keydown WITHOUT preventDefault, and
 * the browser retargets the triggering character into the now-focused field."
 * JSDOM lays nothing out and does not deliver keystrokes to a focused element,
 * so it cannot observe either half. This types REAL keys and reads the real
 * document.activeElement and the composer's real value.
 *
 * 🔑 THE SETUP CONTROL IS THE WHOLE TEST. Every "the composer got the keystroke"
 * assertion is vacuous unless, immediately before, the composer did NOT have
 * focus. That arm is asserted first on each surface and named so a failure says
 * which half broke. And a NEGATIVE arm proves the handler does not over-fire:
 * with a button already focused, typing must NOT jump to the composer.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-type-to-focus-3283.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n, note) => { ran++; console.log('PASS  ' + n + (note ? '  ' + note : '')); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };
const say = (n, cond, note) => (cond ? ok(n, note) : bad(n, note || 'assertion failed'));

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'ttf-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE pane, never a live agent - sandboxing the store is not sandboxing
     delivery, so this names a made-up session. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'ttf-discord', claim: 'ttf', title: '✳ idle' }));
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'ttf-discord\n');

  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  // Blur everything, then confirm nothing is focused (the setup control).
  const clearFocus = async () => {
    await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
    return p.evaluate(() => document.activeElement === document.body || document.activeElement === document.documentElement || document.activeElement === null);
  };
  const active = () => p.evaluate(() => (document.activeElement && document.activeElement.id) || (document.activeElement && document.activeElement.tagName) || 'null');

  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }

    // ---- SURFACE 1: agent conversation view (panel-detail Talk) -> #d-say ----
    await p.waitForSelector('[data-agent="ttf"]', { timeout: 15000 });
    await p.click('[data-agent="ttf"]');
    await p.waitForSelector('#panel-detail:not([hidden])', { timeout: 15000 });
    await p.waitForFunction(() => { const e = document.getElementById('d-say'); return e && e.getClientRects().length > 0; }, null, { timeout: 15000 });

    say('SETUP agent view: nothing is focused before typing', await clearFocus(), 'active=' + (await active()));
    await p.keyboard.type('hi', { delay: 6 });
    let r = await p.evaluate(() => ({ id: document.activeElement && document.activeElement.id, v: (document.getElementById('d-say') || {}).value }));
    say('agent view: a keystroke focuses the Talk composer (#d-say)', r.id === 'd-say', 'focused=' + r.id);
    say('agent view: the typed characters LAND in #d-say', r.v === 'hi', 'value=' + JSON.stringify(r.v));

    // NEGATIVE arm: with a real control already focused, typing must NOT hijack to the composer.
    await p.evaluate(() => { const el = document.getElementById('d-say'); if (el) el.value = ''; });
    const btn = await p.evaluate(() => { const nav = document.querySelector('#d-nav button'); if (nav) { nav.focus(); return nav.tagName; } return null; });
    if (btn) {
      const beforeId = await active();
      await p.keyboard.type('z', { delay: 6 });
      r = await p.evaluate(() => ({ id: document.activeElement && document.activeElement.tagName, dsay: (document.getElementById('d-say') || {}).value }));
      say('NEGATIVE: a button already focused is NOT hijacked to the composer', r.id === 'BUTTON' && r.dsay === '', 'active=' + r.id + ' d-say=' + JSON.stringify(r.dsay) + ' (was ' + beforeId + ')');
    } else {
      say('NEGATIVE: found a focusable control to test no-hijack', false, 'no #d-nav button present');
    }

    // ---- SURFACE 2: project GRID view (tabs layout) -> #pj-post ----
    await p.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Type To Focus' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      await fetch('/api/project/' + body.project.id + '/agent/ttf', { method: 'POST', headers: { 'content-type': 'application/json' } });
    });
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Type To Focus').first().click();
    await p.waitForFunction(() => { const e = document.getElementById('pj-post'); return e && e.getClientRects().length > 0; }, null, { timeout: 15000 });

    say('SETUP project grid: nothing is focused before typing', await clearFocus(), 'active=' + (await active()));
    await p.keyboard.type('yo', { delay: 6 });
    r = await p.evaluate(() => ({ id: document.activeElement && document.activeElement.id, v: (document.getElementById('pj-post') || {}).value }));
    say('project grid: a keystroke focuses the room composer (#pj-post)', r.id === 'pj-post', 'focused=' + r.id);
    say('project grid: the typed characters LAND in #pj-post', r.v === 'yo', 'value=' + JSON.stringify(r.v));

    // ---- SURFACE 3: project CONSOLIDATED view (same DOM, CSS mode) -> #pj-post ----
    /* The layout applies on load via paintStyles -> applyLayout, so save it then
       reload onto the projects tab (a seeded project auto-opens in consolidated,
       #867) rather than expecting the live PUT to repaint the current page. */
    await p.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) }));
    await p.goto(`http://127.0.0.1:${PORT}/?tab=projects`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
    await p.waitForFunction(() => document.body.classList.contains('consolidated'), null, { timeout: 15000 }).catch(() => {});
    const consOn = await p.evaluate(() => document.body.classList.contains('consolidated'));
    // reach an open project in consolidated (auto-opens; else open it), then confirm pj-post is reachable.
    await p.waitForFunction(() => { const e = document.getElementById('pj-post'); return e && e.getClientRects().length > 0; }, null, { timeout: 15000 }).catch(() => {});
    const postVisibleCons = await p.evaluate(() => { const e = document.getElementById('pj-post'); return !!(e && e.getClientRects().length > 0); });
    say('project consolidated: the layout is active and #pj-post is rendered', consOn && postVisibleCons, 'consolidated=' + consOn + ' pj-post-visible=' + postVisibleCons);
    if (consOn && postVisibleCons) {
      await p.evaluate(() => { const e = document.getElementById('pj-post'); if (e) e.value = ''; });
      say('SETUP project consolidated: nothing is focused before typing', await clearFocus(), 'active=' + (await active()));
      await p.keyboard.type('ok', { delay: 6 });
      r = await p.evaluate(() => ({ id: document.activeElement && document.activeElement.id, v: (document.getElementById('pj-post') || {}).value }));
      say('project consolidated: a keystroke focuses #pj-post', r.id === 'pj-post', 'focused=' + r.id);
      say('project consolidated: the typed characters LAND in #pj-post', r.v === 'ok', 'value=' + JSON.stringify(r.v));
    }

    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    bad('the check ran to completion', String(e && e.message ? e.message : e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }
  console.log((failures ? 'FAIL' : 'PASS') + '  render-type-to-focus-3283  (' + ran + ' assertions)');
  process.exit(failures ? 1 : 0);
})();
