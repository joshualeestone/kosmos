'use strict';
/* #2255: emoji reactions on room posts, checked in the real painted room.
 *
 * The operator opens a project room, reacts to a post from the "+" palette, sees
 * the pill appear with a count and the gold `.mine` accent, and toggles it back
 * off. Driven against the SHIPPED page + the real react route (never a copy):
 * self-boots a sandboxed server, creates a project + an agent on it, posts a
 * message, opens the room, and interacts.
 *
 * DOM-state assertions only (a pill's presence, its count text, aria-pressed,
 * the palette's hidden flag), so headless + mode-independent. A control proves
 * the toggle round-trips: reacting twice with the same emoji leaves NO pill.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-reactions-2255.js
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
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-' + k.toLowerCase() + '-'));
  }
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '✳ idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
      const t = '[' + theme + ']';
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|status 404/.test(m.text())) errs.push(m.text()); });

      await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

      const pjName = 'Reax ' + theme;
      const made = await p.evaluate(async (name) => {
        const r1 = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r1.ok) return { error: 'project create ' + r1.status };
        const id = (await r1.json()).project.id;
        await fetch('/api/project/' + id + '/agent/roomer', { method: 'POST', headers: { 'content-type': 'application/json' } });
        const r2 = await fetch('/api/project/' + id + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'react to me' }) });
        const j = await r2.json().catch(() => null);
        if (j && j.delivery && j.delivery.state === 'could_not') return { error: 'post refused: ' + j.delivery.because };
        return { id };
      }, pjName);
      if (made.error) { bad(t + ' fixture posted a room message', made.error); await p.close(); continue; }

      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText(pjName, { exact: true }).first().click();
      await p.waitForSelector('#pj-room', { state: 'visible' });
      // Wait for the post's reaction row (the "+" opener) to paint.
      await p.waitForSelector('#pj-room .msg-b .rxns .rxn-add', { timeout: 15000 }).catch(() => {});

      const initial = await p.evaluate(() => {
        const box = document.querySelector('#pj-room .msg-b .rxns');
        return { hasRow: !!box, pills: box ? box.querySelectorAll('.rxn').length : -1,
          hasAdd: !!(box && box.querySelector('.rxn-add')),
          pickerHidden: box && box.querySelector('.rxn-picker') ? box.querySelector('.rxn-picker').hidden : null };
      });
      if (initial.hasRow && initial.hasAdd) ok(t + ' a post shows a reaction row with a "+" opener'); else bad(t + ' reaction row + opener', JSON.stringify(initial));
      if (initial.pills === 0) ok(t + ' a fresh post has no pills yet'); else bad(t + ' no initial pills', 'pills=' + initial.pills);
      if (initial.pickerHidden === true) ok(t + ' the quick palette starts hidden'); else bad(t + ' palette starts hidden', String(initial.pickerHidden));

      // Open the palette.
      await p.click('#pj-room .msg-b .rxns .rxn-add');
      const opened = await p.evaluate(() => {
        const picker = document.querySelector('#pj-room .msg-b .rxns .rxn-picker');
        const add = document.querySelector('#pj-room .msg-b .rxns .rxn-add');
        return { shown: picker ? !picker.hidden : null, picks: picker ? picker.querySelectorAll('.rxn-pick').length : -1,
          expanded: add ? add.getAttribute('aria-expanded') : null };
      });
      if (opened.shown && opened.picks >= 4) ok(t + ' the "+" reveals the quick palette (' + opened.picks + ' emoji)'); else bad(t + ' palette reveals', JSON.stringify(opened));
      if (opened.expanded === 'true') ok(t + ' the opener reports aria-expanded=true'); else bad(t + ' aria-expanded', String(opened.expanded));

      // React with the first palette emoji.
      await p.click('#pj-room .msg-b .rxns .rxn-pick');
      await p.waitForSelector('#pj-room .msg-b .rxns .rxn', { timeout: 8000 }).catch(() => {});
      const reacted = await p.evaluate(() => {
        const pill = document.querySelector('#pj-room .msg-b .rxns .rxn');
        return { has: !!pill, count: pill ? (pill.querySelector('.rxn-n') || {}).textContent : null,
          mine: pill ? pill.classList.contains('mine') : null,
          pressed: pill ? pill.getAttribute('aria-pressed') : null };
      });
      if (reacted.has) ok(t + ' clicking a palette emoji adds a pill'); else bad(t + ' pill added', JSON.stringify(reacted));
      if (reacted.count === '1') ok(t + ' the pill shows count 1'); else bad(t + ' pill count 1', String(reacted.count));
      if (reacted.mine && reacted.pressed === 'true') ok(t + ' the pill is marked as the viewer\'s own (mine + aria-pressed)'); else bad(t + ' pill mine/pressed', JSON.stringify(reacted));

      // Toggle it off by clicking the pill again (the control that proves the round-trip).
      await p.click('#pj-room .msg-b .rxns .rxn');
      await p.waitForTimeout(500);
      const toggled = await p.evaluate(() => {
        const box = document.querySelector('#pj-room .msg-b .rxns');
        return { pills: box ? box.querySelectorAll('.rxn').length : -1 };
      });
      if (toggled.pills === 0) ok(t + ' CONTROL: clicking the pill again toggles the reaction OFF (no pill)'); else bad(t + ' toggle-off leaves no pill', 'pills=' + toggled.pills);

      if (errs.length) bad(t + ' no page errors', errs.join(' | ')); else ok(t + ' no page errors');
      await p.close();
    }
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 16) { console.log('reactions: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('reactions: ' + failures + ' FAILED'); process.exit(1); }
  console.log('reactions: all good, ' + ran + ' checks');
})();
