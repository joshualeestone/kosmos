/* #1303 group C: the composer goes back to ONE LINE after a send.
 *
 * Josh, 2026-08-28: "if it expands to two lines for the message that I'm
 * sending, or three lines, or however many lines, and I send it, it stays stuck
 * at that height instead of reverting back to a single line... It ends up
 * consuming a huge amount of the page and then I can't get it to go back down."
 *
 * 🛑 WHY A BROWSER CHECK WHEN web.composer-height-1303c.test.js ALREADY EXISTS.
 * That test runs in JSDOM and asserts `el.style.height`, on a fixture that
 * models growth by ASSIGNING '60px'. It can prove the value cleared and it can
 * prove the reset function writes a height. It CANNOT see a three-line box that
 * stayed three lines tall, because nothing in JSDOM lays anything out:
 * `scrollHeight` is 0 there, so the one quantity Josh actually complained about
 * does not exist.
 *
 * ⭐ Angel put it exactly right when she asked for this file: the JSDOM test
 * READS TEXT, and the rendered height is the one thing only a browser can
 * observe. This types real characters into a real textarea, lets the real
 * `input` handler grow it, and measures the box.
 *
 * 🔑 THE SETUP CONTROL IS THE WHOLE TEST. If the box never grew, then "it is one
 * line after the send" is true of a box that was one line all along, and every
 * assertion below would pass against nothing. That arm is asserted FIRST and
 * named so a failure says which half broke.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-composer-reset.js
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
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE member, never a live agent. The room refuses a post when nobody is
     on the project, and naming a real session here would type into that agent's
     live pane. Sandboxing the store is not sandboxing delivery. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'composer-discord', claim: 'composer', title: '✳ idle' }));
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'composer-discord\n');

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
        body: JSON.stringify({ name: 'Composer Reset' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      await fetch('/api/project/' + body.project.id + '/agent/composer', { method: 'POST',
        headers: { 'content-type': 'application/json' } });
    });

    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Composer Reset').first().click();
    await p.waitForSelector('#pj-room', { state: 'visible' });
    /* Wait for the CONDITION, not for a duration. A fixed sleep is a guess about
       a machine that may have four browsers on it, and a gate that reddens a
       correct build is the one people learn to re-run. */
    await p.waitForFunction(() => {
      const el = document.getElementById('pj-post');
      return el && el.getBoundingClientRect().height > 0;
    }, null, { timeout: 15000 });

    const boxH = () => p.evaluate(() => {
      const el = document.getElementById('pj-post');
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    });

    const base = await boxH();
    say('the composer is present and has a height', base > 0, 'base=' + base);

    /* 🛑 TYPED, NOT FILLED, AND THE DIFFERENCE IS THE WHOLE CHECK.
       `p.fill()` sets the value and fires one `input` event, which I had taken
       from a comment as equivalent to typing. It is not safe to assume here:
       `pjGrowComposer` has SEVEN call sites, including repaint hooks, so a box
       that grew after a fill does not prove the INPUT path ran. Real keystrokes
       remove the assumption instead of asserting it, and Josh's sentence is
       "it expands to two lines for the message that I'm sending" - which is
       typing. */
    const long = 'This is a deliberately long message for the composer so that it wraps onto '
      + 'several lines in the box, which is the state Josh described, where the composer '
      + 'grows as you type and then stays that tall after the message has gone.';
    await p.locator('#pj-post').pressSequentially(long, { delay: 4 });
    /* The wait IS the growth assertion: if the box never grew this times out and
       says so, rather than a sleep expiring and a later line reporting equality. */
    await p.waitForFunction((b) => {
      const el = document.getElementById('pj-post');
      return el && Math.round(el.getBoundingClientRect().height) > b + 4;
    }, base, { timeout: 15000 }).catch(() => {});
    const grown = await boxH();

    /* 🔑 THE SETUP CONTROL. Everything below is meaningless if this fails: a box
       that never grew is trivially one line after a send. */
    say('the composer GREW while typing, so the rest of this check means something',
      grown > base + 4, 'base=' + base + ' grown=' + grown);

    await p.click('#pj-post-go');
    /* Wait for the box to EMPTY, which is the observable the send produces, then
       measure the height. Waiting on the height directly would be waiting for
       the thing under test. */
    await p.waitForFunction(() => {
      const el = document.getElementById('pj-post');
      return el && el.value === '';
    }, null, { timeout: 15000 }).catch(() => {});

    const after = await boxH();
    const value = await p.inputValue('#pj-post');

    say('the composer emptied on send', value === '', JSON.stringify(value));
    /* ⚠️ THE ASSERTION JSDOM CANNOT MAKE. Not "height was written", not "value is
       empty": the RENDERED BOX is back to the height it had before typing. */
    say('the composer went back to ONE LINE, at its pre-typing height',
      Math.abs(after - base) <= 2, 'base=' + base + ' grown=' + grown + ' after=' + after);

    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    bad('the check ran to completion', String(e && e.message ? e.message : e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }
  console.log((failures ? 'FAIL' : 'PASS') + '  render-composer-reset  (' + ran + ' assertions)');
  process.exit(failures ? 1 : 0);
})();
