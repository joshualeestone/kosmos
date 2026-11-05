// Browser-check-surface: create-msg acct-claude-msg createSayRefusal
/* kosmos#8040: someone with no model connected presses Create agent. The refusal sits below the button, and the press
 * shows the short progress screen, so the page came back at the top with the words off screen: a dead button. Now the
 * words are in the window at the moment they are said, and their own "Settings, AI Models" goes there. Measured at the
 * app's default 800-tall window and at a phone size, with getBoundingClientRect and elementFromPoint.
 * The other half: with no Claude Code, a pasted key's Add answers "we could not find Claude Code" and returns to the
 * picker. The line was inside the step that got hidden; now it shows where the person is looking.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-nomodel-8040.js
 * Sandboxed roots, removed on exit; kills only what it starts. The key is a made-up string and reaches nothing. */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
/* #5325: every folder this check makes is removed when it exits. */
const MADE = [];
const made = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); MADE.push(d); return d; };
process.on('exit', () => { for (const d of MADE) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();})"]).toString());
const PORT = freePort();

const SHOTS = process.env.KOSMOS_8040_SHOTS || '';
const PLACE = 'Settings, AI Models';
const FAKE_KEY = 'sk-ant-fake-8040-not-a-real-key-000000000000';

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS', 'RUNNERS', 'BIN']) roots[k] = made('nm8040-' + k.toLowerCase() + '-');
  /* The stand-in runners. The Claude one is put in place and taken away during the run, so the board reads Claude Code
     as here or gone (resolveBin asks each time). The stand-in says it is signed out, and never reaches a network. */
  const claude = path.join(roots.BIN, 'claude');
  const claudeHere = () => { fs.writeFileSync(claude, '#!/bin/sh\ncase "$*" in *version*) echo 2.0.0; exit 0;; esac\necho \'{"loggedIn": false, "authMethod": "none"}\'\nexit 1\n'); fs.chmodSync(claude, 0o755); };
  const claudeGone = () => fs.rmSync(claude, { force: true });
  const codex = path.join(roots.BIN, 'codex');
  fs.writeFileSync(codex, '#!/bin/sh\necho 1.0.0\nexit 0\n'); fs.chmodSync(codex, 0o755);
  claudeGone();
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_RUNNERS_DIR: roots.RUNNERS,
      AGENT_WORKFORCE_CLAUDE_BIN: claude, AGENT_WORKFORCE_CODEX_BIN: codex,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') }, // sandboxed whole (#634)
    stdio: 'ignore',
  });
  const stop = () => new Promise((r) => { if (srv.exitCode !== null || srv.signalCode !== null) r(); else { srv.once('exit', r); srv.kill(); setTimeout(r, 5000); } });
  const fail = [];
  const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
  await new Promise((r) => setTimeout(r, 1500));

  const b = await chromium.launch();
  /* Really on screen: inside the window, and the top thing at that point (not behind a sticky bar). */
  const seen = (p, sel) => p.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return { in: false, why: 'no element' };
    const r = e.getBoundingClientRect();
    if (!r.height || !r.width) return { in: false, why: 'no box' };
    const inWindow = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { in: inWindow && !!at && (at === e || e.contains(at)), top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight };
  }, sel);
  const toNameStep = async (p) => {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.getElementById('new-agent').click());
    await p.click('#cstep-kind [data-path="single"]');
    await p.waitForFunction(() => !document.getElementById('role-next').disabled, null, { timeout: 8000 });
    await p.click('#role-next');
    await p.waitForSelector('#create-name', { state: 'visible', timeout: 8000 });
    await p.fill('#create-name', 'Nadia');
    await p.dispatchEvent('#create-name', 'input');
  };
  const pressCreate = async (p, words) => {
    await p.click('#create-go');   // scrolls to the button, as a person does
    await p.waitForFunction((w) => new RegExp(w).test(document.getElementById('create-msg').textContent), words, { timeout: 15000 });
    await p.waitForTimeout(500);   // anything still repainting the form moves it now, not after the measure
  };
  const errs = [];
  try {
    for (const [size, viewport] of [['800-tall window', { width: 1280, height: 800 }], ['phone', { width: 390, height: 700 }]]) {
      const p = await b.newPage({ viewport });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));   // past the guided setup, which this does not walk

      // No Claude Code, no account.
      claudeGone();
      await toNameStep(p);
      await pressCreate(p, 'AI Models');
      const said = (await p.locator('#create-msg').innerText()).trim();
      chk(/signed in|could not find Claude Code/.test(said) && said.includes(PLACE), size + ': the refusal says what is wrong and where to go', JSON.stringify(said));
      const words = await seen(p, '#create-msg');
      chk(words.in, size + ': the words are really in the window when they are said', JSON.stringify(words));
      const link = await seen(p, '#create-msg button');
      chk(link.in, size + ': and so is the way to connect', JSON.stringify(link));
      chk(await p.evaluate(() => document.activeElement === document.getElementById('create-msg')), size + ': the keyboard is on the sentence, one Tab from the link');
      chk(fs.readdirSync(roots.WORKERS).length === 0, size + ': no agent was made');
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'create-refusal-' + viewport.height + '.png') });

      // CONTROL: this window is one where the sentence CAN be off screen, or the two lines above could not fail.
      const below = await p.evaluate(() => { window.scrollTo(0, 0); const r = document.getElementById('create-msg').getBoundingClientRect(); return { top: Math.round(r.top), h: window.innerHeight }; });
      chk(below.top >= below.h, size + ': CONTROL: from the top of the page the sentence is below the window', JSON.stringify(below));

      // The link goes to AI Models, where connecting happens.
      if (await p.locator('#create-msg button').count()) {   // a missing link is its own red above, not the end of the run
        await p.locator('#create-msg button').click();
        await p.waitForTimeout(400);
        chk(!(await p.isVisible('#create-msg')), size + ': the link has left the New agent page');
        chk(await p.evaluate(() => { const on = document.querySelector('#s-nav button[aria-current="true"]'); return !!on && on.dataset.go === 'accounts' && !document.getElementById('s-sec-accounts').hidden; }), size + ': AI Models is the section showing');
        chk(await p.isVisible('#acct-add-open'), size + ': and its Add a provider is there');
        chk((await seen(p, '#acct-add-open')).in, size + ': and it is in the window');
      }

      // Claude Code here, no account: the card's own sentence.
      claudeHere();
      await toNameStep(p);
      await pressCreate(p, 'no Claude account');
      const said2 = (await p.locator('#create-msg').innerText()).trim();
      chk(said2.startsWith('There is no Claude account signed in on this computer') && said2.includes(PLACE), size + ': the engine\'s own words are kept, in full', JSON.stringify(said2));
      chk((await seen(p, '#create-msg')).in && (await seen(p, '#create-msg button')).in, size + ': with Claude Code here, the refusal and its link are in the window too');

      // The name left empty (found on the Windows walk): this refusal comes first, and the sample name "Casey" looks filled in.
      await toNameStep(p);
      await p.fill('#create-name', '');
      await p.dispatchEvent('#create-name', 'input');
      const sample = () => p.evaluate(() => getComputedStyle(document.getElementById('create-name'), '::placeholder').color);
      const before = await sample();
      chk(!/rgba\(.*, 0\)|transparent/.test(before), size + ': CONTROL: before the press the sample name shows, so the next line can fail', before);
      await p.click('#create-go');
      await p.waitForFunction(() => /name/.test(document.getElementById('create-name-err').textContent), null, { timeout: 15000 });
      await p.waitForTimeout(500);
      const nameSaid = (await p.locator('#create-name-err').innerText()).trim();
      chk(nameSaid === 'Give the agent a name.', size + ': an empty name is refused in the engine\'s words', JSON.stringify(nameSaid));
      const nameAt = await seen(p, '#create-name-err');
      chk(nameAt.in, size + ': and the words are really in the window', JSON.stringify(nameAt));
      chk((await seen(p, '#create-name')).in, size + ': and so is the box');
      chk(await p.evaluate(() => { const i = document.getElementById('create-name'); return i.value === '' && document.activeElement === i && i.getAttribute('aria-invalid') === 'true'; }), size + ': the box is empty, marked refused, and the keyboard is in it');
      const after = await sample();
      chk(/rgba\(.*, 0\)|transparent/.test(after), size + ': and no sample name shows in it, so it reads as empty', after);
      chk((await p.locator('#create-msg').textContent()).trim() === '', size + ': CONTROL: this refusal is at the field, not under the button');
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'empty-name-' + viewport.height + '.png') });
      // The second press, with a name: the account refusal, in the window, and the name's refusal gone.
      await p.fill('#create-name', 'Nadia');
      await p.dispatchEvent('#create-name', 'input');
      await pressCreate(p, 'no Claude account');
      chk((await seen(p, '#create-msg')).in && (await seen(p, '#create-msg button')).in, size + ': the second press says the account refusal in the window, with its link');
      chk((await p.locator('#create-name-err').textContent()).trim() === '' && !(await p.evaluate(() => document.getElementById('create-name').classList.contains('bad'))), size + ': and the name is no longer marked refused');

      // OpenAI's own refusal, which the card measured at y=1014.
      await toNameStep(p);
      await p.selectOption('#create-provider', 'openai');
      await p.dispatchEvent('#create-provider', 'change');
      await pressCreate(p, 'no OpenAI sign-in');
      chk((await seen(p, '#create-msg')).in && (await seen(p, '#create-msg button')).in, size + ': OpenAI\'s refusal and its link are in the window too', JSON.stringify((await p.locator('#create-msg').innerText()).trim()));

      // The two other answers that come back to this line. CONTROL: a sentence that names no place gets no link.
      await toNameStep(p);
      await p.route('**/api/agents', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
      await pressCreate(p, 'could not reach the board');
      chk((await seen(p, '#create-msg')).in, size + ': a request that did not complete says so in the window');
      chk((await p.locator('#create-msg button').count()) === 0, size + ': CONTROL: a sentence that names no place has no link');
      await p.unroute('**/api/agents');
      await toNameStep(p);
      await p.route('**/api/agents', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"it broke"}' }) : r.continue()));
      await pressCreate(p, 'It broke');
      chk((await seen(p, '#create-msg')).in, size + ': a failed answer says so in the window');
      await p.unroute('**/api/agents');
      // An answer of outcome "refused" (the refusals above arrive as a failed status, so this branch needs its own arm).
      await toNameStep(p);
      await p.route('**/api/agents', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'refused', because: 'that cannot be made now' }) }) : r.continue()));
      await pressCreate(p, 'That cannot be made now');
      chk((await seen(p, '#create-msg')).in, size + ': a refused answer says so in the window');
      await p.unroute('**/api/agents');
      // CONTROL: a refusal about the name still lands at the name, not here.
      await toNameStep(p);
      await p.route('**/api/agents', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'refused', field: 'name', because: 'that name is taken' }) }) : r.continue()));
      await p.click('#create-go');
      await p.waitForFunction(() => /name is taken/.test(document.getElementById('create-name-err').textContent), null, { timeout: 15000 });
      chk(await p.evaluate(() => document.activeElement === document.getElementById('create-name')) && (await p.locator('#create-msg').textContent()).trim() === '' && (await seen(p, '#create-name')).in, size + ': CONTROL: a refusal about the name stays at the name field, in the window');
      await p.unroute('**/api/agents');
      // The one refusal said without leaving the form: a swarm's limit whose unit moved. Button at the window's foot.
      await toNameStep(p);
      await p.evaluate(() => {
        document.getElementById('create-go').scrollIntoView({ block: 'end' });
        SWARMS_ON = true;   // in one turn with the press: the status poll writes this back (the swarm path is per computer)
        document.querySelector('input[name="create-kind"][value="swarm"]').checked = true;
        document.getElementById('create-swarm-cap').dataset.mode = 'neither';
        document.getElementById('create-go').click();
      });
      await p.waitForFunction(() => /daily usage limit changed/.test(document.getElementById('create-msg').textContent), null, { timeout: 15000 });
      await p.waitForTimeout(500);
      chk((await seen(p, '#create-msg')).in, size + ': a swarm limit that moved says so in the window');

      // Item 2: no Claude Code, a pasted key, Add.
      claudeGone();
      const openKeyStep = async () => {
        await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
        await p.evaluate(() => { showTab('settings'); settingsOpen('accounts'); });
        await p.click('#acct-add-open');
        await p.selectOption('#acct-provider-pick', 'claude');
        await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
        await p.click('#acct-claude-pick-key');
        await p.fill('#acct-claude-key', FAKE_KEY);
      };
      await openKeyStep();
      await p.click('#acct-claude-go');
      await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
      await p.waitForTimeout(300);
      chk(await p.isVisible('#acct-claude-msg'), size + ': back at the picker, the message line is showing');
      const told = await p.locator('#acct-claude-msg').innerText();
      chk(/^We could not find Claude Code/.test(told.trim()), size + ': and it holds the server\'s answer, as a sentence', JSON.stringify(told));
      const toldAt = await seen(p, '#acct-claude-msg');
      chk(toldAt.in, size + ': and it is really in the window', JSON.stringify(toldAt));
      chk(await p.isVisible('#acct-claude-pick-sub') && !(await p.isVisible('#acct-claude-key-step')), size + ': CONTROL: this is the picker, with the key step hidden, the state that hid the words');
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'connect-refusal-' + viewport.height + '.png') });
      await p.click('#acct-claude-pick-key');
      chk((await p.locator('#acct-claude-msg').textContent()).trim() === '', size + ': choosing a way again starts clean');
      await p.click('#acct-claude-go').catch(() => {});
      await p.waitForFunction(() => /could not find Claude Code/.test(document.getElementById('acct-claude-msg').textContent), null, { timeout: 8000 });
      await p.evaluate(() => { closeAcctAdd(); openAcctAdd(); });
      chk((await p.locator('#acct-claude-msg').textContent()).trim() === '', size + ': opening the dialog again does not show the last visit\'s line');
      await p.evaluate(() => closeAcctAdd());
      for (const open of ['openAcctReauth', 'openAcctReauthOpenai']) {
        const left = await p.evaluate((fn) => { document.getElementById('acct-claude-msg').textContent = 'left over'; window[fn]('/nowhere', 'nobody'); const t = document.getElementById('acct-claude-msg').textContent; closeAcctAdd(); return t; }, open);
        chk(left === '', size + ': ' + open + ' does not show the last visit\'s line either', JSON.stringify(left));
      }

      // CONTROL: a refusal that stays on the key step still shows there, under Add.
      claudeHere();
      await openKeyStep();
      await p.fill('#acct-claude-key', 'not-a-key');
      await p.click('#acct-claude-go');
      await p.waitForFunction(() => { const t = document.getElementById('acct-claude-msg').textContent; return t && t !== 'Adding…'; }, null, { timeout: 8000 });
      chk(await p.isVisible('#acct-claude-key-step') && await p.isVisible('#acct-claude-msg'), size + ': CONTROL: a refused key stays on the key step, with its line showing', JSON.stringify(await p.locator('#acct-claude-msg').innerText()));
      await p.close();
    }
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } catch (e) {
    chk(false, 'the check ran to the end', String((e && e.stack) || e).slice(0, 500));
  } finally {
    await b.close();
    await stop();
  }
  console.log(fail.length ? 'render-nomodel-8040: ' + fail.length + ' FAILED' : 'render-nomodel-8040: OK (a refused Create agent and a refused key both show their words in the window)');
  process.exit(fail.length ? 1 : 0);
})();
