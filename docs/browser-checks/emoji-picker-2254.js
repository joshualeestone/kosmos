/* #2254: the composer emoji picker inserts a glyph at the cursor in #pj-post.
 *
 * Josh: "add a card so that the user could add emojis to their input." This is
 * the INPUT side (a picker in the project composer); #2067 is the DISPLAY side.
 *
 * 🛑 WHY A BROWSER CHECK. The picker is markup + a click that mutates a real
 * textarea's value at its real caret and dispatches the real `input` event; none
 * of that is observable in JSDOM (no layout, no rendered panel). This opens a
 * real room, opens the panel, clicks an emoji, and reads #pj-post.value.
 *
 * Every arm is written to FAIL on the pre-#2254 markup: there is no #pj-emoji-btn
 * and no #pj-emoji before this change, so presence/open/insert all red on main.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/emoji-picker-2254.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(require('node:child_process').execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());

let failures = 0, ran = 0;
const ok = (n, note) => { ran++; console.log('PASS  ' + n + (note ? '  ' + note : '')); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };
const say = (n, cond, note) => (cond ? ok(n, note) : bad(n, note || 'assertion failed'));

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'em-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE member, never a live agent: the room refuses a post with nobody on
     the project, and a real session name would type into that agent's live pane. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'emoji-discord', claim: 'emoji', title: '✳ idle' }));
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'emoji-discord\n');

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

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Emoji Room' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      await fetch('/api/project/' + body.project.id + '/agent/emoji', { method: 'POST',
        headers: { 'content-type': 'application/json' } });
    });
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Emoji Room').first().click();
    await p.waitForSelector('#pj-room', { state: 'visible' });
    await p.waitForFunction(() => {
      const el = document.getElementById('pj-post');
      return el && el.getBoundingClientRect().height > 0;
    }, null, { timeout: 15000 });

    // Arm 1 (control): the button exists in the composer. Reds on pre-#2254 main.
    const btn = await p.$('#pj-emoji-btn');
    say('the emoji button is present in the composer', !!btn);
    if (!btn) throw new Error('no #pj-emoji-btn - nothing else can be asserted');

    // Arm 2: panel is hidden until the button is clicked, then shown + aria set.
    const hiddenBefore = await p.evaluate(() => document.getElementById('pj-emoji').hidden);
    say('the panel starts hidden', hiddenBefore === true);
    await p.click('#pj-emoji-btn');
    await p.waitForFunction(() => !document.getElementById('pj-emoji').hidden, null, { timeout: 5000 }).catch(() => {});
    const openState = await p.evaluate(() => ({
      shown: !document.getElementById('pj-emoji').hidden,
      expanded: document.getElementById('pj-emoji-btn').getAttribute('aria-expanded'),
      count: document.querySelectorAll('#pj-emoji button[data-emoji]').length,
    }));
    say('clicking the button opens the panel and sets aria-expanded', openState.shown && openState.expanded === 'true',
      'shown=' + openState.shown + ' expanded=' + openState.expanded);
    // Arm 3: the panel actually has emoji to pick.
    say('the panel is populated with emoji buttons', openState.count > 0, 'count=' + openState.count);

    // Arm 4 (the core): type into the composer, then a click inserts the picked
    // glyph AT THE CURSOR and the panel stays open.
    await p.locator('#pj-post').pressSequentially('hi ', { delay: 4 });
    const first = await p.evaluate(() => document.querySelector('#pj-emoji button[data-emoji]').dataset.emoji);
    await p.click('#pj-emoji button[data-emoji]');
    const afterInsert = await p.evaluate(() => ({
      value: document.getElementById('pj-post').value,
      stillOpen: !document.getElementById('pj-emoji').hidden,
    }));
    say('the picked emoji is inserted into the composer at the cursor',
      afterInsert.value === 'hi ' + first, JSON.stringify(afterInsert.value) + ' first=' + first);
    say('the panel stays open after a pick (add several in a row)', afterInsert.stillOpen === true);

    // Arm 5 (a11y): a KEYBOARD user can pick. Focus an emoji button and press
    // Enter must insert it - mousedown-only insertion left this unreachable while
    // the aria markup advertised access. Reds if the handler is mousedown-only.
    const kbGlyph = await p.evaluate(() => {
      const b = document.querySelectorAll('#pj-emoji button[data-emoji]')[3];
      b.focus();
      return b.dataset.emoji;
    });
    await p.keyboard.press('Enter');
    const afterKb = await p.evaluate(() => document.getElementById('pj-post').value);
    say('a keyboard pick (focus an emoji button + Enter) inserts the emoji',
      afterKb === 'hi ' + first + kbGlyph, JSON.stringify(afterKb) + ' kb=' + kbGlyph);

    // Arm 6: Escape closes the panel and clears aria-expanded.
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.getElementById('pj-emoji').hidden, null, { timeout: 5000 }).catch(() => {});
    const closed = await p.evaluate(() => ({
      hidden: document.getElementById('pj-emoji').hidden,
      expanded: document.getElementById('pj-emoji-btn').getAttribute('aria-expanded'),
    }));
    say('Escape closes the panel and resets aria-expanded', closed.hidden === true && closed.expanded === 'false',
      'hidden=' + closed.hidden + ' expanded=' + closed.expanded);

    // Arm 6: the whole feature loaded with no page error (also catches a JS
    // syntax error in the added block).
    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    bad('the check ran to completion', String(e && e.message ? e.message : e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }
  console.log((failures ? 'FAIL' : 'PASS') + '  emoji-picker-2254  (' + ran + ' assertions)');
  process.exit(failures ? 1 : 0);
})();
