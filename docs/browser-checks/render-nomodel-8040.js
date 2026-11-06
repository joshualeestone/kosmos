// Browser-check-surface: create-msg acct-claude-msg createSayRefusal createKeptRestore
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
  const claudeHere = () => { fs.writeFileSync(claude, '#!/bin/sh\ncase "$*" in *version*) echo 2.0.0; exit 0;; esac\ncase "$CLAUDE_CONFIG_DIR" in *kept*) echo \'{"loggedIn": true, "authMethod": "claude.ai"}\'; exit 0;; esac\necho \'{"loggedIn": false, "authMethod": "none"}\'\nexit 1\n'); fs.chmodSync(claude, 0o755); };
  const claudeGone = () => fs.rmSync(claude, { force: true });
  const codex = path.join(roots.BIN, 'codex');
  fs.writeFileSync(codex, '#!/bin/sh\necho 1.0.0\nexit 0\n'); fs.chmodSync(codex, 0o755);
  claudeGone();
  /* An account on record, as a sign-in leaves one, in the sandboxed home. The address is made up. */
  const accountFile = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json');
  const seedAccount = () => { fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude'), { recursive: true }); fs.writeFileSync(accountFile, JSON.stringify({ oauthAccount: { emailAddress: 'kept@example.com' } })); };
  const unseedAccount = () => { fs.rmSync(accountFile, { force: true }); fs.rmSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude'), { recursive: true, force: true }); };
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
    return { in: inWindow && !!at && (at === e || e.contains(at)), at: at && (at.id || at.className || at.tagName), top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight };
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
  /* kosmos#8051 item 1: the kept form's line as a person and a screen reader meet it, and the sentence it should say. */
  const KEPT_LINE = 'This is where you left off before going to Settings. Start over';
  const keptLine = (p) => p.evaluate(() => { const el = document.getElementById('create-kept'); return { shown: !el.hidden && el.getBoundingClientRect().height > 0, text: el.textContent.replace(/\s+/g, ' ').trim(), described: document.getElementById('create-name').getAttribute('aria-describedby') }; });
  const keptLineRight = (k) => k.shown && k.text === KEPT_LINE && k.described === 'create-kept-why';
  const errs = [];
  try {
    for (const [size, viewport] of [['800-tall window', { width: 1280, height: 800 }], ['phone', { width: 390, height: 700 }]]) {
      const p = await b.newPage({ viewport });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));   // past the guided setup, which this does not walk

      // No Claude Code and no account: the account gate speaks first.
      claudeGone();
      await toNameStep(p);
      await pressCreate(p, 'AI Models');
      const said = (await p.locator('#create-msg').innerText()).trim();
      chk(said.startsWith('There is no Claude account signed in') && said.includes(PLACE), size + ': with no account and no Claude Code, the account refusal says what is wrong and where to go', JSON.stringify(said));
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

      // An account on record, no Claude Code: the runner's refusal, the other sentence naming the place.
      seedAccount();
      await toNameStep(p);
      await pressCreate(p, 'set up Claude Code');
      const saidRunner = (await p.locator('#create-msg').innerText()).trim();
      chk(saidRunner.startsWith('We could not find Claude Code on this computer') && saidRunner.includes('Kosmos will then set up Claude Code'), size + ': with an account and no Claude Code, the engine says so in its own words', JSON.stringify(saidRunner));
      chk((await seen(p, '#create-msg')).in && (await seen(p, '#create-msg button')).in, size + ': and that refusal and its link are in the window');
      // The account is put back on the return only when the person chose it: one they never chose is the old default, and
      // a new default they just connected should win. Read from what the return asks loadCreateExtras to keep.
      const keptAccount = async (choose, thenReset = false) => {
        await toNameStep(p);
        if (choose) await p.evaluate(() => ['create-account', 'create-model'].forEach((id) => document.getElementById(id).dispatchEvent(new Event('change'))));
        if (thenReset) await p.evaluate(() => resetCreateProvider());   // what a role re-pick (refillDetails) runs   // its row is hidden with one account; the change is what a person's pick fires
        await pressCreate(p, 'set up Claude Code');
        const value = await p.evaluate(() => document.getElementById('create-account').value);
        const model = await p.evaluate(() => document.getElementById('create-model').value);
        await p.evaluate(() => { const real = loadCreateExtras; window.__keptAsk = null; window.loadCreateExtras = (k) => { window.__keptAsk = k; window.loadCreateExtras = real; return real(k); }; });
        await p.locator('#create-msg button').click();
        await p.waitForTimeout(300);
        await p.evaluate(() => document.getElementById('new-agent').click());
        await p.waitForTimeout(300);
        return { value, ask: await p.evaluate(() => window.__keptAsk && window.__keptAsk.account), model, modelAsk: await p.evaluate(() => window.__keptAsk && window.__keptAsk.model) };
      };
      const untouched = await keptAccount(false);
      const reset = await keptAccount(true, true);
      chk(reset.ask === '' && reset.modelAsk === '', size + ': picks put back to the default by a role re-pick are not kept as theirs', JSON.stringify(reset));
      chk(untouched.value !== '' && untouched.ask === '', size + ': an account the person never chose is not put back on the return', JSON.stringify(untouched));
      chk(untouched.model !== '' && untouched.modelAsk === '', size + ': and nor is a model they never chose', JSON.stringify(untouched));
      const chosen = await keptAccount(true);
      chk(chosen.value !== '' && chosen.ask === chosen.value, size + ': CONTROL: an account the person chose is put back', JSON.stringify(chosen));
      chk(chosen.model !== '' && chosen.modelAsk === chosen.model, size + ': CONTROL: and a model they chose is put back', JSON.stringify(chosen));
      unseedAccount();

      // Refused, connect, come back: what they typed is still there, on the same step.
      claudeHere();
      await toNameStep(p);
      await p.fill('#create-instr', 'My own instructions, typed before the refusal.');
      await p.dispatchEvent('#create-instr', 'input');
      await pressCreate(p, 'no Claude account');
      await p.locator('#create-msg button').click().catch(() => {});
      await p.waitForTimeout(300);
      const second = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude-kept');   // the account they went to connect: a labelled one, so it has its own line in the menu
      fs.mkdirSync(second, { recursive: true });
      fs.writeFileSync(path.join(second, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'kept@example.com' } }));
      await p.evaluate(() => document.getElementById('new-agent').click());
      await p.waitForTimeout(800);
      const back = await p.evaluate(() => ({ name: document.getElementById('create-name').value, instr: document.getElementById('create-instr').value,
        step: !document.getElementById('cstep-name').hidden, panel: !document.getElementById('panel-create').hidden, msg: document.getElementById('create-msg').textContent, focus: document.activeElement && document.activeElement.id,
        accounts: [...document.getElementById('create-account').options].map((o) => ({ text: o.textContent, value: o.value })) }));
      chk(back.name === 'Nadia' && back.instr === 'My own instructions, typed before the refusal.', size + ': coming back by the link, the name and the instructions are there', JSON.stringify({ name: back.name, instr: back.instr.slice(0, 30) }));
      chk(back.step && back.panel, size + ': on the same step, not the three-way choice');
      chk(back.msg === '' && back.focus === 'create-name', size + ': the old refusal is gone and the keyboard is at the name', JSON.stringify({ msg: back.msg, focus: back.focus }));
      await p.waitForFunction(() => [...document.getElementById('create-account').options].some((o) => /kept@example\.com/.test(o.textContent)), null, { timeout: 8000 }).catch(() => {});
      const pickable = await p.evaluate(() => [...document.getElementById('create-account').options].map((o) => o.textContent));
      chk(pickable.some((t) => /kept@example\.com/.test(t)), size + ': and the account just connected can be picked', JSON.stringify(pickable));
      fs.rmSync(second, { recursive: true, force: true });
      let sent = null;
      await p.route('**/api/agents', (r) => { if (r.request().method() !== 'POST') return r.continue(); sent = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'refused', because: 'stopped by this check' }) }); });
      await pressCreate(p, 'Stopped by this check');
      await p.unroute('**/api/agents');
      chk(!!sent && sent.name === 'Nadia' && sent.instructions === 'My own instructions, typed before the refusal.', size + ': and pressing Create agent sends them', JSON.stringify(sent && { name: sent.name, hasInstr: !!sent.instructions }));
      // On OpenAI the return repaints (the model row is per account) with the model picked on OpenAI, or else the saved
      // OpenAI pick, as a plain New agent does: never one read off Claude, never nothing over a saved pick (rounds 6, 8).
      // loadCreateExtras' own saved-pick paint has used CREATE_PREF_OPENAI_MODEL up by now, so it starts at ''.
      const openaiKept = await p.evaluate(() => {
        const prov = document.getElementById('create-provider');
        const was = { value: prov.value, pref: CREATE_PREF_OPENAI_MODEL, paint: window.paintOpenaiCreateModel };
        const hasOpenai = [...prov.options].some((o) => o.value === 'openai');
        if (!hasOpenai) { const o = document.createElement('option'); o.value = 'openai'; o.textContent = 'OpenAI'; o.dataset.checkAdded = '1'; prov.appendChild(o); }
        let painted = 0;
        window.paintOpenaiCreateModel = () => { painted += 1; };
        prov.value = 'openai';
        const keys = [CREATE_PREF_KEYS.provider, CREATE_PREF_KEYS.model];
        const before = keys.map((k) => localStorage.getItem(k));
        localStorage.setItem(CREATE_PREF_KEYS.provider, 'openai');
        localStorage.setItem(CREATE_PREF_KEYS.model, 'gpt-saved');
        try {
          CREATE_PREF_OPENAI_MODEL = '';
          createKeptRestore({ provider: 'claude', account: '', model: 'claude-kept' });
          const fromClaude = { pref: CREATE_PREF_OPENAI_MODEL, painted };
          createKeptRestore({ provider: 'openai', account: '', model: '' });
          const untouched = { pref: CREATE_PREF_OPENAI_MODEL, painted };
          createKeptRestore({ provider: 'openai', account: '', model: 'gpt-kept' });
          return { fromClaude, untouched, fromOpenai: { pref: CREATE_PREF_OPENAI_MODEL, painted } };
        } finally {
          window.paintOpenaiCreateModel = was.paint; CREATE_PREF_OPENAI_MODEL = was.pref; prov.value = was.value;
          keys.forEach((k, i) => (before[i] === null ? localStorage.removeItem(k) : localStorage.setItem(k, before[i])));
          const added = prov.querySelector('option[data-check-added]'); if (added) added.remove();
        }
      });
      chk(openaiKept.fromClaude.pref === 'gpt-saved' && openaiKept.fromClaude.painted === 1, size + ': a model kept from Claude repaints with OpenAI\'s saved pick, not itself', JSON.stringify(openaiKept));
      chk(openaiKept.untouched.pref === 'gpt-saved' && openaiKept.untouched.painted === 2, size + ': and so does an OpenAI model they never changed', JSON.stringify(openaiKept));
      chk(openaiKept.fromOpenai.pref === 'gpt-kept' && openaiKept.fromOpenai.painted === 3, size + ': CONTROL: a model kept from OpenAI is put back', JSON.stringify(openaiKept));
      // CONTROL: without the link, New agent starts fresh, and so does the one after a return.
      await p.evaluate(() => { showTab('agents'); document.getElementById('new-agent').click(); });
      await p.waitForTimeout(300);
      const fresh = await p.evaluate(() => ({ kind: !document.getElementById('cstep-kind').hidden, name: document.getElementById('create-name').value }));
      await p.click('#cstep-kind [data-path="single"]');
      await p.waitForFunction(() => !document.getElementById('role-next').disabled, null, { timeout: 8000 });
      await p.click('#role-next');
      await p.waitForSelector('#create-name', { state: 'visible', timeout: 8000 });
      fresh.instr = await p.locator('#create-instr').inputValue();
      chk(fresh.kind && fresh.name === '' && !fresh.instr.includes('typed before the refusal'), size + ': CONTROL: a plain New agent still starts fresh', JSON.stringify({ ...fresh, instr: fresh.instr.slice(0, 30) }));

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
      await p.selectOption('#acct-provider-pick', 'openai');
      await p.waitForTimeout(200);
      await p.selectOption('#acct-provider-pick', 'claude');
      await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
      chk((await p.locator('#acct-claude-msg').textContent()).trim() === '', size + ': switching provider and back, the key\'s line is gone with its key box');
      await p.click('#acct-claude-pick-key');
      await p.fill('#acct-claude-key', 'not-a-key');
      await p.click('#acct-claude-go');
      await p.waitForFunction(() => /too short/.test(document.getElementById('acct-claude-msg').textContent), null, { timeout: 8000 });
      await p.selectOption('#acct-provider-pick', '');
      await p.waitForTimeout(200);
      await p.selectOption('#acct-provider-pick', 'claude');
      await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
      chk((await p.locator('#acct-claude-msg').textContent()).trim() === '', size + ': and so does clearing the provider and picking it again');
      await p.close();
    }
    // The kept form has an end: 30 minutes from the link. Past that a New agent starts plain, with the mark still set.
    {
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));
      claudeHere();
      const TYPED = 'My own instructions, typed before the refusal.';
      const newAgent = async () => { await p.evaluate(() => document.getElementById('new-agent').click()); await p.waitForTimeout(400); };
      await toNameStep(p);
      await p.fill('#create-instr', TYPED);
      await p.dispatchEvent('#create-instr', 'input');
      await pressCreate(p, 'no Claude account');
      const T0 = Date.now();
      await p.clock.setFixedTime(new Date(T0));
      await p.locator('#create-msg button').click();
      await p.clock.setFixedTime(new Date(T0 + 29 * 60e3));
      await newAgent();
      chk(await p.evaluate((t) => document.getElementById('create-name').value === 'Nadia' && document.getElementById('create-instr').value === t && !document.getElementById('cstep-name').hidden, TYPED), 'limit: CONTROL: 29 minutes after the link, the form is kept');
      // kosmos#8051 item 1: the kept form says why it is back, and the name field (where focus lands) is described by it.
      const keptNow = await keptLine(p);
      // In the hint's type, under the title: a size step below the role's blurb, and above it (review 3: `.panel p` had
      // out-ranked the class, so the line came out as a second blurb).
      const look = await p.evaluate(() => { const k = document.getElementById('create-kept'), bl = document.getElementById('create-blurb'), s = (e) => parseFloat(getComputedStyle(e).fontSize); return { kept: s(k), blurb: s(bl), above: !!(k.compareDocumentPosition(bl) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
      if (SHOTS) {
        await p.locator('#cstep-name').screenshot({ path: path.join(SHOTS, 'create-kept-light.png') });
        await p.emulateMedia({ colorScheme: 'dark' });
        await p.locator('#cstep-name').screenshot({ path: path.join(SHOTS, 'create-kept-dark.png') });
        await p.emulateMedia({ colorScheme: 'light' });
      }
      chk(look.kept < look.blurb && look.above, 'kept line: it reads as a hint under the title, smaller than the blurb and above it', JSON.stringify(look));
      chk(keptLineRight(keptNow), 'kept line: a kept form says it was kept, with Start over, and the name field is described by it', JSON.stringify(keptNow));
      await pressCreate(p, 'no Claude account');
      const T1 = T0 + 29 * 60e3;
      chk(await p.evaluate(() => document.getElementById('create-kept').hidden && !document.getElementById('create-name').hasAttribute('aria-describedby')), 'kept line: pressing Create agent on the kept form takes the line away');
      await p.locator('#create-msg button').click();
      await p.clock.setFixedTime(new Date(T1 + 30 * 60e3));
      chk(await p.evaluate((t) => CREATE_KEPT === t, T1), 'limit: CONTROL: the mark is still set when New agent is pressed, and only its age has run out');
      await p.evaluate(() => createKeptLine(true));   // the line is up, so the plain open below has something to take away
      await newAgent();
      const old = await p.evaluate(() => ({ kind: !document.getElementById('cstep-kind').hidden, name: document.getElementById('create-name').value, msg: document.getElementById('create-msg').textContent, kept: CREATE_KEPT }));
      chk(old.kind && old.name === '' && old.msg === '' && old.kept === 0, 'limit: 30 minutes after the link, New agent starts plain, on the three-way choice', JSON.stringify(old));
      chk(await p.evaluate(() => document.getElementById('create-kept').hidden && !document.getElementById('create-name').hasAttribute('aria-describedby')), 'kept line: a plain New agent past the window takes the line away, though it was showing');
      await p.click('#cstep-kind [data-path="single"]');
      await p.waitForFunction(() => !document.getElementById('role-next').disabled, null, { timeout: 8000 });
      await p.click('#role-next');
      await p.waitForSelector('#create-name', { state: 'visible', timeout: 8000 });
      const instrAfter = await p.locator('#create-instr').inputValue();
      chk(!instrAfter.includes('typed before the refusal'), 'limit: and the old instructions are gone', JSON.stringify(instrAfter.slice(0, 30)));
      await p.close();
    }

    // Coming back after connecting a provider: the form reads what is connected as a plain New agent does, and keeps what was typed.
    {
      const TYPED = 'My own instructions, typed before the refusal.';
      const OPENAI = { provider: 'openai', dir: '/nowhere/openai-kept', email: 'kept@example.com', isDefault: true, memoryShared: true, offerable: true, connection: { state: 'connected', badge: 'signed_in' } };
      const CLAUDE = { dir: '/nowhere/claude-kept', email: 'claude@example.com', isDefault: true, memoryShared: true, offerable: true, connection: { state: 'connected', badge: 'signed_in' } };
      const open = async () => {
        const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
        p.on('pageerror', (e) => errs.push(String(e)));
        await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));
        return p;
      };
      const typed = async (p) => { await p.fill('#create-instr', TYPED); await p.dispatchEvent('#create-instr', 'input'); };
      const leaveConnectAndReturn = async (p, accounts) => {
        await p.locator('#create-msg button').click();
        await p.route(/\/api\/accounts(\?.*)?$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { accounts } }) : r.continue()));
        await p.evaluate(() => document.getElementById('new-agent').click());
        await p.waitForTimeout(900);
      };
      const state = (p) => p.evaluate(() => { const v = (id) => document.getElementById(id).value; const why = document.getElementById('create-model-why'); return { prov: v('create-provider'), acct: v('create-account'), model: v('create-model'), name: v('create-name'), instr: v('create-instr'), reports: v('create-reports'), note: why && !why.hidden ? why.textContent : '', modelOff: document.getElementById('create-model').disabled }; });
      const pressAndRead = async (p) => {
        let sent = null;
        await p.route('**/api/agents', (r) => { if (r.request().method() !== 'POST') return r.continue(); sent = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'refused', because: 'stopped by this check' }) }); });
        await pressCreate(p, 'Stopped by this check');
        return sent;
      };

      // Nothing chosen, Claude refused, an OpenAI account connected: the form opens on it, as a plain New agent would.
      claudeHere();
      let p = await open();
      await toNameStep(p);
      await typed(p);
      await pressCreate(p, 'no Claude account');
      await leaveConnectAndReturn(p, [OPENAI]);
      let st = await state(p);
      chk(st.prov === 'openai' && st.acct === OPENAI.dir, 'return: a provider just connected is what the form is on, when none was chosen', JSON.stringify({ prov: st.prov, acct: st.acct }));
      chk(st.name === 'Nadia' && st.instr === TYPED, 'return: and the name and instructions are kept', JSON.stringify({ name: st.name, instr: st.instr.slice(0, 20) }));
      let sent = await pressAndRead(p);
      chk(!!sent && sent.provider === 'openai' && sent.account === OPENAI.dir && sent.name === 'Nadia' && sent.instructions === TYPED, 'return: and Create agent goes out on that account, past the old refusal', JSON.stringify(sent && { provider: sent.provider, account: sent.account }));
      await p.close();

      // CONTROL: the same answer on a plain New agent gives the same provider and account, so the two paths agree.
      p = await open();
      await p.route(/\/api\/accounts(\?.*)?$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { accounts: [OPENAI] } }) : r.continue()));
      await toNameStep(p);
      await p.waitForTimeout(600);
      st = await state(p);
      chk(st.prov === 'openai' && st.acct === OPENAI.dir, 'return: CONTROL: a plain New agent with that answer reads the same', JSON.stringify({ prov: st.prov, acct: st.acct }));
      await p.close();

      // Refused on OpenAI by choice, then connected: the model row is the account's, not the signed-out note.
      p = await open();
      await p.route('**/api/accounts/openai/models**', (r) => r.fulfill({ json: { ok: true, models: [{ key: 'mock-model', label: 'Mock model' }, { key: 'mock-other', label: 'Mock other' }] } }));
      await toNameStep(p);
      await typed(p);
      await p.selectOption('#create-provider', 'openai');
      await p.dispatchEvent('#create-provider', 'change');
      await pressCreate(p, 'no OpenAI sign-in');
      const noteBefore = (await state(p)).note;
      chk(/signed in/i.test(noteBefore), 'return: CONTROL: refused on OpenAI, the row says it waits for a sign-in', JSON.stringify(noteBefore));
      await leaveConnectAndReturn(p, [OPENAI]);
      st = await state(p);
      chk(st.prov === 'openai' && st.acct === OPENAI.dir, 'return: refused on OpenAI and connected, the form is on that account', JSON.stringify({ prov: st.prov, acct: st.acct }));
      chk(!st.modelOff && (await p.evaluate(() => [...document.getElementById('create-model').options].some((o) => o.value === 'mock-model'))) && !/signed in/i.test(st.note), 'return: and the model row offers that account\'s models', JSON.stringify({ note: st.note, modelOff: st.modelOff }));
      await p.close();

      // A person who chose keeps what they chose: the provider, against a Claude account appearing; and a Claude model and a manager.
      p = await open();
      await toNameStep(p);
      await p.selectOption('#create-provider', 'openai');
      await p.dispatchEvent('#create-provider', 'change');
      await pressCreate(p, 'no OpenAI sign-in');
      await leaveConnectAndReturn(p, [CLAUDE]);
      st = await state(p);
      chk(st.prov === 'openai', 'return: a provider chosen by hand is kept, whatever else was connected', JSON.stringify({ prov: st.prov }));
      await p.close();

      p = await open();
      await p.route('**/api/status', async (r) => { try { const resp = await r.fetch(); const j = await resp.json(); j.agents = [...(j.agents || []), { name: 'Boss', sessionName: 'boss', state: 'idle' }]; await r.fulfill({ response: resp, json: j }); } catch { /* the page closed while this was in flight (#6022) */ } });
      await toNameStep(p);
      await p.waitForFunction(() => [...document.getElementById('create-reports').options].some((o) => o.value === 'boss'), null, { timeout: 10000 }).catch(() => {});
      const chosenModel = await p.evaluate(() => { const m = document.getElementById('create-model'); const o = [...m.options].find((x) => !x.selected); m.value = o.value; m.dispatchEvent(new Event('change', { bubbles: true })); const rep = document.getElementById('create-reports'); rep.value = 'boss'; return { model: m.value, reports: rep.value }; });
      await pressCreate(p, 'no Claude account');
      await leaveConnectAndReturn(p, [CLAUDE]);
      st = await state(p);
      chk(st.prov === 'anthropic' && st.model === chosenModel.model, 'return: the model picked by hand is kept', JSON.stringify({ was: chosenModel.model, now: st.model }));
      chk(chosenModel.reports === 'boss' && st.reports === 'boss', 'return: and so is who it reports to', JSON.stringify({ was: chosenModel.reports, now: st.reports }));
      await p.close();
    }

    // A refused key's words that land late say nothing once the person has left the key step.
    {
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));
      claudeHere();
      await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await p.evaluate(() => { showTab('settings'); settingsOpen('accounts'); });
      let release = null;
      let answer = null;
      await p.route('**/api/accounts/claude/apikey', async (r) => { try { await new Promise((go) => { release = go; }); await r.fulfill({ status: 400, json: answer }); } catch { /* the page closed while this was held (#6022) */ } });
      const refused = { error: 'that key was refused' };
      const noCode = { error: 'we could not find Claude Code on this computer, so there is nothing to sign in to', needsRunner: true, provider: 'claude' };
      const press = async (a) => {
        answer = a; release = null;
        if (await p.isHidden('#acct-add-modal')) await p.click('#acct-add-open');
        await p.selectOption('#acct-provider-pick', 'claude');
        await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
        await p.click('#acct-claude-pick-key');
        await p.fill('#acct-claude-key', FAKE_KEY);
        await p.click('#acct-claude-go');
        await p.waitForFunction(() => document.getElementById('acct-claude-msg').textContent === 'Adding…', null, { timeout: 5000 });
        for (let i = 0; i < 50 && !release; i += 1) await p.waitForTimeout(50);
      };
      const land = async () => { release(); await p.waitForTimeout(300); };
      const line = () => p.evaluate(() => ({ text: document.getElementById('acct-claude-msg').textContent, seen: !!document.getElementById('acct-claude-msg').getClientRects().length, keyStep: !document.getElementById('acct-claude-key-step').hidden }));
      const awayAndBack = async () => { await p.selectOption('#acct-provider-pick', 'openai'); await p.waitForTimeout(150); await p.selectOption('#acct-provider-pick', 'claude'); await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 }); };

      await press(refused);
      await land();
      let l = await line();
      chk(l.keyStep && /that key was refused/i.test(l.text) && l.seen, 'late: CONTROL: an answer to a person still on the key step shows there', JSON.stringify(l));

      await press(refused);
      await awayAndBack();
      await land();
      l = await line();
      // kosmos#8051 item 3: back at the picker in the same visit, it says the key was not added, naming no key (it was silent).
      chk(!l.keyStep && l.text === 'The API key you entered was not added. That key was refused.' && l.seen && !l.text.includes(FAKE_KEY),
        'late: away and back before it lands, the picker says the key was not added, and why, naming no key', JSON.stringify(l));

      await press(refused);
      await p.selectOption('#acct-provider-pick', 'openai');
      await p.waitForTimeout(150);
      await land();
      await p.selectOption('#acct-provider-pick', 'claude');
      await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
      l = await line();
      chk(!l.keyStep && l.text === '', 'late: landing while on another provider, it is not there on the way back', JSON.stringify(l));

      // A Claude sign-in that starts meanwhile moves them to the subscription step (acctFlowPaint runs acctClaudeShowSub,
      // and does not clear the line). A refused answer then leaves no Adding line there.
      await press(refused);
      await p.evaluate(() => acctClaudeShowSub());
      await land();
      const moved = await p.evaluate(() => ({ sub: !document.getElementById('acct-claude-sub-step').hidden, text: document.getElementById('acct-claude-msg').textContent }));
      chk(moved.sub && moved.text === '', 'late: moved to the sign-in step by a sign-in, no Adding line is left behind', JSON.stringify(moved));
      await p.evaluate(() => acctClaudeStep());

      // Moved on to the subscription step before a no-Claude-Code answer lands: it must not pull them back to the picker.
      await press(noCode);
      await awayAndBack();
      await p.click('#acct-claude-pick-sub');
      await p.waitForSelector('#acct-claude-sub-step', { state: 'visible', timeout: 8000 });
      await land();
      const sub = await p.evaluate(() => ({ sub: !document.getElementById('acct-claude-sub-step').hidden, picker: !document.getElementById('acct-claude-pick').hidden,
        focus: document.activeElement && document.activeElement.id, text: document.getElementById('acct-claude-msg').textContent }));
      chk(sub.sub && !sub.picker && sub.focus !== 'acct-claude-pick-sub' && sub.text === '', 'late: on the subscription step when no Claude Code lands, they stay there, with no line', JSON.stringify(sub));

      await press(refused);
      await p.evaluate(() => { closeAcctAdd(); openAcctAdd(); });
      await p.selectOption('#acct-provider-pick', 'claude');
      await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
      await land();
      l = await line();
      chk(l.text === '', 'late: closed and reopened before it lands, no line', JSON.stringify(l));

      await press(noCode);
      await land();
      l = await line();
      chk(!l.keyStep && /could not find Claude Code/.test(l.text) && l.seen, 'late: CONTROL: no Claude Code still returns to the picker with its line', JSON.stringify(l));

      await press(noCode);
      await awayAndBack();
      await land();
      l = await line();
      chk(!l.keyStep && /could not find Claude Code/.test(l.text) && l.seen, 'late: and no Claude Code landing at the picker still says so, since it is true there', JSON.stringify(l));

      await press(refused);
      await p.evaluate(() => { closeAcctAdd(); openAcctAdd(); });
      await p.selectOption('#acct-provider-pick', 'claude');
      await p.waitForSelector('#acct-claude-pick', { state: 'visible', timeout: 8000 });
      await p.click('#acct-claude-pick-key');
      await land();
      l = await line();
      chk(l.keyStep && l.text === '', 'late: and a new visit\'s key step gets no line from the last visit\'s key', JSON.stringify(l));

      await press(noCode);
      await p.evaluate(() => { closeAcctAdd(); openAcctAdd(); });
      await p.selectOption('#acct-provider-pick', 'openai');
      await p.waitForTimeout(150);
      await land();
      l = await line();
      chk(l.text === '' && await p.isVisible('#acct-openai-flow') && await p.isHidden('#acct-claude-flow'), 'late: but it does not pull a person off another provider in a new visit', JSON.stringify(l));
      await p.close();
    }

    // The consolidated layout (#2842, #3053): the link and the return stay in it, with the rails.
    {
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));
      claudeHere();
      await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      await p.evaluate(() => { document.documentElement.setAttribute('data-layout', 'consolidated'); showTab('agents'); });
      const cons = () => p.evaluate(() => document.body.classList.contains('consolidated'));
      chk(await cons(), 'consolidated: CONTROL: this arm is in that layout');
      await p.evaluate(() => document.getElementById('rail-agents-new').click());
      await p.click('#cstep-kind [data-path="single"]');
      await p.waitForFunction(() => !document.getElementById('role-next').disabled, null, { timeout: 8000 });
      await p.click('#role-next');
      await p.waitForSelector('#create-name', { state: 'visible', timeout: 8000 });
      await p.fill('#create-name', 'Nadia');
      await p.dispatchEvent('#create-name', 'input');
      await pressCreate(p, 'no Claude account');
      chk((await seen(p, '#create-msg')).in, 'consolidated: the refusal is in the window', JSON.stringify(await seen(p, '#create-msg')));
      chk((await seen(p, '#create-msg button')).in, 'consolidated: and so is its link', JSON.stringify(await seen(p, '#create-msg button')));
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'create-refusal-consolidated.png') });
      await p.locator('#create-msg button').click().catch(() => {});
      await p.waitForTimeout(400);
      chk(await cons(), 'consolidated: the link does not drop the layout');
      chk(await p.evaluate(() => !document.getElementById('panel-settings').hidden && !document.getElementById('s-sec-accounts').hidden), 'consolidated: AI Models is showing');
      chk((await seen(p, '#acct-add-open')).in, 'consolidated: and its Add a provider is in the window');
      chk(await p.isVisible('#rail-agents-new'), 'consolidated: and the rail is still there');
      await p.evaluate(() => document.getElementById('rail-agents-new').click());
      await p.waitForTimeout(500);
      chk(await cons() && await p.evaluate(() => document.getElementById('create-name').value === 'Nadia' && !document.getElementById('cstep-name').hidden && !document.getElementById('panel-create').hidden), 'consolidated: coming back, the layout, the step and the name are all there');
      const consLine = await keptLine(p);
      chk(keptLineRight(consLine), 'consolidated: the kept form says it was kept, and the name field is described by it', JSON.stringify(consLine));
      await p.click('#create-kept-over');
      await p.waitForTimeout(400);
      chk(await cons() && await p.evaluate(() => !document.getElementById('cstep-kind').hidden && !document.getElementById('panel-create').hidden && document.getElementById('create-kept').hidden), 'consolidated: Start over keeps the layout and opens the three-way choice');
      await p.close();
    }
    // kosmos#8051 item 1: Start over, the way out of a kept form.
    {
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));
      claudeHere();
      const TYPED = 'Instructions I gave up on.';
      await toNameStep(p);
      await p.fill('#create-instr', TYPED);
      await p.dispatchEvent('#create-instr', 'input');
      await pressCreate(p, 'no Claude account');
      await p.locator('#create-msg button').click();
      await p.evaluate(() => document.getElementById('new-agent').click());
      await p.waitForTimeout(400);
      const before = await keptLine(p);
      chk(keptLineRight(before), 'start over: CONTROL: the kept form shows the line, as it should', JSON.stringify(before));
      await p.focus('#create-kept-over');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(400);
      const over = await p.evaluate(() => ({ kind: !document.getElementById('cstep-kind').hidden, name: document.getElementById('create-name').value, line: document.getElementById('create-kept').hidden, kept: CREATE_KEPT, focus: document.activeElement && document.activeElement.matches('#cstep-kind .nak-btn') }));
      chk(over.kind && over.name === '' && over.line && over.kept === 0, 'start over: it empties the form onto the three-way choice, and the line goes', JSON.stringify(over));
      chk(over.focus, 'start over: and the keyboard lands on the first choice, not the page', JSON.stringify(over));
      await p.close();
    }
    // kosmos#8051 item 2: a provider picked by hand while a saved Gemini-by-subscription pick's read is still out wins,
    // and the kept form's account still comes back. Before #8051 the early return skipped the restore.
    {
      const A = { dir: '/nowhere/claude-a-8051', email: 'a@example.com', isDefault: true, memoryShared: true, offerable: true, connection: { state: 'connected', badge: 'signed_in' } };
      const B = { dir: '/nowhere/claude-b-8051', email: 'b@example.com', isDefault: false, memoryShared: true, offerable: true, connection: { state: 'connected', badge: 'signed_in' } };
      const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.route('**/api/first-run', (r) => r.fulfill({ json: { done: true } }));
      await p.route(/\/api\/accounts(\?.*)?$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { accounts: [A, B] } }) : r.continue()));
      /* Not installed until the hold; held, then installed: so the saved Gemini-by-subscription pick IS usable when its read
         answers, and only the hand pick keeps the form off it (review 1: a control that can fail). */
      let hold = null;
      await p.route('**/api/antigravity', async (r) => { const late = !!hold; if (hold) await hold; await r.fulfill({ json: { enabled: true, supported: true, installed: late } }).catch(() => {}); });
      await toNameStep(p);
      await p.waitForTimeout(600);
      await p.selectOption('#create-account', B.dir);
      await p.dispatchEvent('#create-account', 'change');
      await p.route('**/api/agents', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'refused', because: 'connect one in ' + PLACE }) }) : r.continue()));
      await pressCreate(p, PLACE);
      await p.evaluate(() => localStorage.setItem('kosmos.create.provider', 'antigravity'));
      let release; hold = new Promise((r) => { release = r; });
      await p.locator('#create-msg button').click();
      /* Review 2: CREATE_ACCOUNTS still holds the first open's list, so the wait is for THIS open's answer (a new array:
         the fetch replaces it) as well as the saved pick's read still being out. Only then does the hand pick land. */
      await p.evaluate(() => { window.__accts8051 = CREATE_ACCOUNTS; document.getElementById('new-agent').click(); });
      await p.waitForFunction(() => !!AGY_ASKING && CREATE_ACCOUNTS !== window.__accts8051 && CREATE_ACCOUNTS.length === 2, null, { timeout: 8000 });
      const during = await p.evaluate(() => !!AGY_ASKING && CREATE_ACCOUNTS !== window.__accts8051);
      await p.selectOption('#create-provider', 'anthropic');
      await p.dispatchEvent('#create-provider', 'change');
      release();
      await p.waitForFunction(() => !AGY_ASKING, null, { timeout: 8000 });   // review 2: the read answered, not a fixed sleep
      await p.waitForTimeout(300);   // and the block it resumes has run
      const st = await p.evaluate(() => ({ prov: document.getElementById('create-provider').value, acct: document.getElementById('create-account').value, name: document.getElementById('create-name').value }));
      chk(during, '#8051: CONTROL: the hand pick lands while the saved pick\'s read is still out', JSON.stringify({ during }));
      chk(st.prov === 'anthropic', '#8051: CONTROL: the provider picked by hand wins over a saved pick that has become usable', JSON.stringify(st));
      chk(st.acct === B.dir && st.name === 'Nadia', '#8051: and the kept form still gets its account back', JSON.stringify(st));
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
