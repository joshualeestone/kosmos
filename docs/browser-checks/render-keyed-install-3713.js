// Browser-check-surface: fr-keyed-install acct-keyed-install
'use strict';
/**
 * kosmos#3713: Connect installs the Gemini CLI and the Grok CLI itself, the way it installs
 * OpenAI's Codex, so Connect works on a fresh computer. HERMETIC (file://, fetch stubbed): the
 * runner install is a fake job that reports downloading, then present (or failed). Asserts:
 *   - first run, Grok: a missing grok offers the download; once installed, Grok's box opens
 *     on its choice (sign in with Grok, or a key), not a key-only box;
 *   - Settings, Gemini: a missing gemini shows the download step instead of the key step, with
 *     the tool named and its size; Download shows progress, then the key step by itself;
 *   - Settings, Grok: the same, ending on Grok's choice;
 *   - controls: a tool that is present shows no download step; switching provider while a
 *     download box is open drops it, and a finished download from the old visit paints nothing;
 *   - a tool that went missing after the key step opened: Add leads to the download step.
 *   - review pass 1: leaving first run stops the watcher; coming back joins a download still
 *     under way; Not now returns focus to Connect, and the download step takes focus; on
 *     Windows nothing offers a download (it would be refused), the screen says so instead.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-keyed-install-3713.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-keyed-install-3713: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-keyed-install-3713: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__missing = { gemini: true, grok: true };
    window.__jobs = {};
    window.__installs = [];
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const inst = u.match(/\/api\/runners\/(gemini|grok)\/install$/);
      if (inst && opts && opts.method === 'POST') {
        window.__installs.push(inst[1]);
        window.__jobs[inst[1]] = { ticks: 0, phase: 'downloading', receivedBytes: 5e6, totalBytes: inst[1] === 'gemini' ? 20772697 : 42511097 };
        return enc({ job: window.__jobs[inst[1]] });
      }
      if (/\/api\/runners(\?|$)/.test(u)) {
        window.__gets = (window.__gets || 0) + 1;
        const out = {};
        for (const r of ['gemini', 'grok']) {
          const job = window.__jobs[r];
          if (job) { job.ticks += 1; if (job.ticks >= 2) { window.__missing[r] = false; delete window.__jobs[r]; } }
          out[r] = { present: !window.__missing[r] && !window.__jobs[r], downloadBytes: r === 'gemini' ? 20772697 : 42511097, job: window.__jobs[r] || null };
        }
        return enc({ runners: out });
      }
      const key = u.match(/\/api\/accounts\/(gemini|grok)\/apikey$/);
      if (key && opts && opts.method === 'POST') {
        if (window.__missing[key[1]]) return enc({ needsRunner: true, error: 'we could not find the runner' }, 400);
        return enc({ error: 'that does not look like a key' }, 400);
      }
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: [] });
      return enc({});
    };
  });
  await page.goto(PAGE);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => q((n) => new Promise((r) => setTimeout(r, n)), ms);

  // ---- first run, Grok
  await q(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false; frGo(5); });
  await wait(150);
  const f1 = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 300));
    return { shown: !document.getElementById('fr-keyed-install').hidden, ask: document.getElementById('fr-keyed-install-t').textContent,
      box: !document.getElementById('fr-apikey-flow').hidden };
  });
  chk(f1.shown && !f1.box && /xAI's Grok CLI/.test(f1.ask) && /43 MB/.test(f1.ask), 'first run: a missing grok offers to download xAI\'s Grok CLI, naming its size', JSON.stringify(f1));
  const f2 = await q(async () => {
    document.getElementById('fr-keyed-install-go').click();
    await new Promise((r) => setTimeout(r, 3500));
    return { installHidden: document.getElementById('fr-keyed-install').hidden, box: !document.getElementById('fr-apikey-flow').hidden,
      sub: !document.getElementById('fr-grok-sub').hidden, head: document.getElementById('fr-apikey-t').textContent,
      focus: document.activeElement && document.activeElement.id };
  });
  chk(f2.installHidden && f2.box && f2.sub && /Sign in with your Grok subscription/.test(f2.head) && f2.focus === 'fr-grok-sub-go',
    'first run: once grok is installed, Grok\'s box opens on its sign-in, with the key beside it', JSON.stringify(f2));

  // ---- Settings (frClose lifts first run's inert, the page's own way)
  await q(() => { frClose(); });
  const s1 = await q(async () => {
    openAcctAdd(); acctPick('google');
    await new Promise((r) => setTimeout(r, 300));
    return { install: !document.getElementById('acct-keyed-install').hidden, key: !document.getElementById('acct-apikey-flow').hidden,
      ask: document.getElementById('acct-keyed-install-t').textContent };
  });
  chk(s1.install && !s1.key && /Google's Gemini CLI/.test(s1.ask) && /21 MB/.test(s1.ask),
    'Settings: a missing gemini shows the download step instead of the key step, with the tool and its size', JSON.stringify(s1));

  const s2 = await q(async () => {
    const seen = [];
    const m = document.getElementById('acct-keyed-install-msg');
    const obs = new MutationObserver(() => seen.push(m.textContent));
    obs.observe(m, { childList: true, characterData: true, subtree: true });
    document.getElementById('acct-keyed-install-go').click();
    await new Promise((r) => setTimeout(r, 3500));
    obs.disconnect();
    return { seen, install: !document.getElementById('acct-keyed-install').hidden, key: !document.getElementById('acct-apikey-flow').hidden,
      head: document.getElementById('acct-apikey-head').textContent };
  });
  chk(s2.seen.some((x) => /Downloading… 5 of 21 MB/.test(x)), 'Settings: the download shows its progress', JSON.stringify(s2.seen));
  chk(!s2.install && s2.key && /Google API key for Gemini/.test(s2.head), 'Settings: once gemini is installed, the key step shows by itself', JSON.stringify(s2));

  // Control: the tool is present now, so a fresh visit shows no download step.
  const s3 = await q(async () => {
    closeAcctAdd(); openAcctAdd(); acctPick('google');
    await new Promise((r) => setTimeout(r, 300));
    return { install: !document.getElementById('acct-keyed-install').hidden, key: !document.getElementById('acct-apikey-flow').hidden };
  });
  chk(!s3.install && s3.key, 'control: with gemini present, Settings goes straight to the key step', JSON.stringify(s3));

  // A switch while a download box is open: the box goes, and the old download paints nothing.
  const s4 = await q(async () => {
    window.__missing.grok = true;
    acctPick('xai');
    await new Promise((r) => setTimeout(r, 300));
    const before = { install: !document.getElementById('acct-keyed-install').hidden, grok: !document.getElementById('acct-grok-flow').hidden };
    document.getElementById('acct-keyed-install-go').click();
    await new Promise((r) => setTimeout(r, 200));
    acctPick('google');
    await new Promise((r) => setTimeout(r, 3500));
    return { before, install: !document.getElementById('acct-keyed-install').hidden, key: !document.getElementById('acct-apikey-flow').hidden,
      grok: !document.getElementById('acct-grok-flow').hidden, head: document.getElementById('acct-apikey-head').textContent };
  });
  chk(s4.before.install && !s4.before.grok, 'Settings: a missing grok shows the download step, not Grok\'s choice', JSON.stringify(s4.before));
  chk(!s4.install && s4.key && !s4.grok && /Gemini/.test(s4.head), 'Settings: switching provider mid-download drops the box, and the finished download paints nothing', JSON.stringify(s4));

  const s5 = await q(async () => {
    acctPick('xai');
    await new Promise((r) => setTimeout(r, 300));
    return { install: !document.getElementById('acct-keyed-install').hidden, grok: !document.getElementById('acct-grok-flow').hidden,
      pick: !document.getElementById('acct-grok-pick').hidden, key: !document.getElementById('acct-apikey-flow').hidden };
  });
  chk(!s5.install && s5.grok && s5.pick && !s5.key, 'Settings: with grok installed (it finished in the engine), Grok\'s choice shows', JSON.stringify(s5));

  // The tool went missing after the key step opened: Add leads to the download step, not an error.
  const s6 = await q(async () => {
    acctPick('google');
    await new Promise((r) => setTimeout(r, 300));
    window.__missing.gemini = true;
    document.getElementById('acct-apikey-key').value = 'AIza-typed';
    document.getElementById('acct-apikey-go').click();
    await new Promise((r) => setTimeout(r, 300));
    return { install: !document.getElementById('acct-keyed-install').hidden, key: !document.getElementById('acct-apikey-flow').hidden,
      msg: document.getElementById('acct-apikey-msg').textContent, go: document.getElementById('acct-apikey-go').disabled };
  });
  chk(s6.install && !s6.key && !/not installed/.test(s6.msg), 'Settings: a tool gone missing before Add leads to the download step', JSON.stringify(s6));

  // ---- review pass 1
  const setWin = (on) => q((w) => { const m = document.querySelector('meta[name="kosmos-platform"]'); m.content = w ? 'win32' : '__KOSMOS_PLATFORM__'; }, on);
  await q(() => { closeAcctAdd(); window.__missing.gemini = true; window.__jobs = {}; const fr = document.getElementById('firstrun'); fr.hidden = false; frGo(5); });
  await wait(150);
  const r1 = await q(async () => {
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('fr-keyed-install-go').click();
    await new Promise((r) => setTimeout(r, 150));
    frClose();
    const at = window.__gets;
    await new Promise((r) => setTimeout(r, 2600));
    return { after: window.__gets - at, firstrun: document.getElementById('firstrun').hidden, live: !!window.__jobs.gemini };
  });
  chk(r1.firstrun && r1.after <= 1 && r1.live, 'leaving first run stops the download watcher (the download itself carries on)', JSON.stringify(r1));
  const r2 = await q(async () => {
    const fr = document.getElementById('firstrun'); fr.hidden = false; frGo(5);
    await new Promise((r) => setTimeout(r, 150));
    const posts = window.__installs.length;
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 3800));
    return { joinedWithoutAClick: window.__installs.length === posts + 1, open: !document.getElementById('fr-apikey-flow').hidden,
      installHidden: document.getElementById('fr-keyed-install').hidden };
  });
  chk(r2.joinedWithoutAClick && r2.open && r2.installHidden, 'coming back while it is still downloading joins it, and the key box opens when it is done', JSON.stringify(r2));
  const r3 = await q(async () => {
    window.__missing.grok = true; window.__jobs = {};
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 300));
    const onDownload = document.activeElement && document.activeElement.id;
    document.getElementById('fr-keyed-install-no').click();
    return { onDownload, after: document.activeElement && document.activeElement.id };
  });
  chk(r3.onDownload === 'fr-keyed-install-go' && r3.after === 'fr-grok-connect', 'Not now returns focus to the Connect that opened it', JSON.stringify(r3));
  await setWin(true);
  const r4 = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 300));
    return { install: !document.getElementById('fr-keyed-install').hidden, msg: document.getElementById('fr-apikey-msg').textContent };
  });
  chk(!r4.install && /cannot install it on Windows yet/.test(r4.msg) && /"grok"/.test(r4.msg), 'on Windows, first run says it plainly and offers no download that would be refused', JSON.stringify(r4));
  const r5 = await q(async () => {
    frClose(); openAcctAdd(); window.__missing.gemini = true; acctPick('google');
    await new Promise((r) => setTimeout(r, 300));
    const before = { install: !document.getElementById('acct-keyed-install').hidden, key: !document.getElementById('acct-apikey-flow').hidden };
    document.getElementById('acct-apikey-key').value = 'AIza-typed';
    document.getElementById('acct-apikey-go').click();
    await new Promise((r) => setTimeout(r, 300));
    return { before, install: !document.getElementById('acct-keyed-install').hidden, msg: document.getElementById('acct-apikey-msg').textContent };
  });
  chk(!r5.before.install && r5.before.key && !r5.install && /cannot install it on Windows yet/.test(r5.msg), 'on Windows, Settings shows no download step, and Add says plainly it cannot install', JSON.stringify(r5));
  await setWin(false);
  const r6 = await q(async () => {
    closeAcctAdd(); openAcctAdd(); acctPick('google');
    await new Promise((r) => setTimeout(r, 300));
    return { install: !document.getElementById('acct-keyed-install').hidden, focus: document.activeElement && document.activeElement.id };
  });
  chk(r6.install && r6.focus === 'acct-keyed-install-go', 'Settings: the download step takes focus (what had it may be hidden)', JSON.stringify(r6));

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) {
    for (const f of fail) console.error('  FAIL  ' + f);
    console.log('\nrender-keyed-install-3713: ' + fail.length + ' FAILED');
    process.exit(1);
  }
  console.log('render-keyed-install-3713: Gemini and Grok Connect download their command-line tools, on first run and in Settings.');
})().catch((e) => { console.error('FAIL  render-keyed-install-3713 crashed: ' + (e && e.stack || e)); process.exit(1); });
