// Browser-check-surface: asblayer asb asb-nudge asp asp-in asp-say asp-msg asp-note asb-row setup-guide hosted
'use strict';

/**
 * The setup assistant on Kosmos's own model, the bubble side (#3660; Josh 2026-09-24 18:07 "let's do it").
 * With no guide agent yet, the bubble asks the hosted assistant (POST /api/setup-guide/hosted) instead of
 * a guide's thread, but only where the board says it can (GET /api/setup-guide `hosted`, true only when a
 * connector exists at a real path).
 *
 * 🛑 NOTHING HERE MAY REACH THE PRODUCTION COORDINATOR. The connector is a fake that only records that it
 * ran, and the hosted route is answered by the check itself; H12 asserts the fake never ran.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-assistant-hosted-3660.js [shots-dir]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asbh-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TUNNEL_STATE = mkroot('tunnel-');
/* The fake connector: it exists (so the board says hosted), and if anything ever runs it, it leaves a mark. */
const TUNNEL_DIR = mkroot('bin-');
const FAKE_TUNNEL = path.join(TUNNEL_DIR, 'kosmos-tunnel');
const RAN = path.join(TUNNEL_DIR, 'ran');
fs.writeFileSync(FAKE_TUNNEL, '#!/bin/sh\ntouch "' + RAN + '"\necho "error: unrecognized subcommand" >&2\nexit 2\n', { mode: 0o755 });
const NO_TUNNEL = path.join(TUNNEL_DIR, 'absent-kosmos-tunnel');
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const instructions = require('../../engine/instructions');
const setupAssistant = require('../../engine/setup-assistant');
const tipsStore = require('../../engine/tips');

const SHOTS = process.argv[2] || null;
const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
function seedGuide(name) {
  const dir = path.dirname(instructions.fileFor(name));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# ' + name + '\n');
  fs.writeFileSync(path.join(dir, setupAssistant.GUIDE_MARKER), name + '\n');
  setupAssistant.markSetupAssistantSeeded({ name, via: 'browser-check' });
}
const unseed = () => fs.rmSync(setupAssistant.flagPath(), { force: true });

const state = (page) => page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
  const b = document.getElementById('asb');
  const note = document.querySelector('#asp .asp-note');
  return { layer: !!document.getElementById('asblayer'), bubble: vis('asb'), nudge: vis('asb-nudge'), panel: vis('asp'),
    src: b ? (b.querySelector('img').getAttribute('src') || '') : '', note: note ? note.textContent : '',
    you: [...document.querySelectorAll('#asp-th .asp-m.you')].map((m) => m.textContent),
    him: [...document.querySelectorAll('#asp-th .asp-m.him')].map((m) => m.textContent),
    msg: (document.getElementById('asp-msg') || {}).textContent || '', box: (document.getElementById('asp-say') || {}).value || '',
    live: (document.getElementById('asp-live') || {}).textContent || '' };
});
const waitFor = (page, fn, ms = 6000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  fs.writeFileSync(tipsStore.FILE(), JSON.stringify({ seen: [], off: true }));
  unseed();
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const badResponses = [];
    page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/setup-guide\/hosted$/.test(r.url())) badResponses.push(r.status() + ' ' + r.url()); });
    /* The hosted route, answered here. `answer` is what the next question gets. */
    const asked = [];
    let answer = { status: 200, body: { reply: 'Click New agent at the top, then pick what it should do.', remaining: 29 } };
    await page.route('**/api/setup-guide/hosted', async (route) => {
      asked.push(JSON.parse(route.request().postData() || '{}'));
      route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
    });
    const pageReports = [];
    const threadPosts = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/setup-guide/page')) pageReports.push(r.url());
      if (r.method() === 'POST' && /\/api\/agent\/[^/]+\/thread$/.test(r.url())) threadPosts.push(r.url());
    });
    const boot = async () => {
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    };

    // H1 CONTROL first: no connector at a real path, so no hosted assistant and no bubble.
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = NO_TUNNEL;
    const off = await (await fetch(URL + '/api/setup-guide')).json();
    chk(off.ok === false && off.reason === 'none' && off.hosted === false, 'H1 CONTROL: with no connector the board says no guide and not hosted', JSON.stringify(off));
    await boot();
    await page.waitForTimeout(2500);
    chk(!(await state(page)).bubble, 'H1 CONTROL: and no bubble is drawn');

    // H1: a connector exists, so with no guide the hosted assistant stands in.
    process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_TUNNEL;
    const on = await (await fetch(URL + '/api/setup-guide')).json();
    chk(on.ok === false && on.reason === 'none' && on.hosted === true, 'H1 precondition: the board says no guide, hosted', JSON.stringify(on));
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000), 'H1 with no guide but a connector, the bubble shows');
    const h1 = await state(page);
    chk(h1.src === '/icons/setup-guide-avatar.jpg', 'H1 with the bundled picture of Josh', h1.src);
    chk(await page.evaluate(async () => { const r = await fetch('/icons/setup-guide-avatar.jpg'); const n = (await r.arrayBuffer()).byteLength; return r.ok && /image\//.test(r.headers.get('content-type') || '') && n > 1000; }), 'H1 and the picture is served');
    chk(await waitFor(page, () => !document.getElementById('asb-nudge').hidden, 4000), 'H1 and the nudge shows before the person has asked anything');

    // H2: the chat says where it runs, greets, and reports no screen to a guide that does not exist.
    await page.click('#asb');
    chk(await waitFor(page, () => !document.getElementById('asp').hidden), 'H2 the chat opens');
    const h2 = await state(page);
    chk(h2.note === 'An AI in Josh\'s voice, on Kosmos\'s own AI until you connect yours. Josh isn\'t typing live.', 'H2 it says it runs on Kosmos\'s own AI until they connect theirs', h2.note);
    chk(await page.evaluate(() => /I built Kosmos/.test(document.querySelector('#asp-th .asp-empty')?.textContent || '')), 'H2 and greets as the guide does');
    await page.waitForTimeout(1800);
    chk(pageReports.length === 0, 'H2 no screen report goes to a guide that does not exist (its 404 would reset the bubble)', JSON.stringify(pageReports));

    // H3: a question goes to the hosted route with the screen, and the answer shows.
    await page.fill('#asp-say', 'How do I make an agent?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => [...document.querySelectorAll('#asp-th .asp-m.him')].some((m) => /New agent/.test(m.textContent))), 'H3 the answer shows in the chat');
    const h3 = await state(page);
    chk(asked.length === 1 && JSON.stringify(asked[0].messages) === JSON.stringify([{ role: 'user', content: 'How do I make an agent?' }]) && asked[0].page && asked[0].page.screen === 'board',
      'H3 it asked once, with the question and the screen it was asked on', JSON.stringify(asked));
    chk(h3.box === '' && h3.you.length === 1 && h3.live === 'Click New agent at the top, then pick what it should do.', 'H3 the box empties and the answer is read out', JSON.stringify(h3));
    chk(h3.msg === '', 'H3 CONTROL: with plenty left, no count is shown', h3.msg);
    chk(threadPosts.length === 0, 'H3 and nothing is written to any agent\'s thread', JSON.stringify(threadPosts));

    // H4: the second question carries the conversation, and a low allowance is said.
    answer = { status: 200, body: { reply: 'Yes, from its page.', remaining: 3 } };
    await page.fill('#asp-say', 'Can I rename it later?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => /3 questions left today/.test(document.getElementById('asp-msg').textContent)), 'H4 with 3 left today, it says so');
    chk(asked.length === 2 && asked[1].messages.length === 3 && asked[1].messages[1].role === 'assistant', 'H4 the second question carries the conversation', JSON.stringify(asked[1].messages));

    // H5: a refusal keeps the words in the box, shows the board's sentence, and asks nothing new of the thread.
    answer = { status: 429, body: { error: "you've reached today's limit for the setup assistant. It resets at midnight.", code: 'assistant_limit' } };
    await page.fill('#asp-say', 'One more?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => /today's limit/.test(document.getElementById('asp-msg').textContent)), 'H5 a refusal shows the board\'s sentence');
    const h5 = await state(page);
    chk(h5.box === 'One more?' && h5.you.length === 2 && !h5.you.includes('One more?'), 'H5 and the words stay in the box, not in the chat', JSON.stringify(h5));
    chk(/^You've reached today's limit/.test(h5.msg), 'H5 the sentence starts with a capital', h5.msg);

    // H6: the conversation survives a reload in the same window.
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000), 'H6 precondition: the bubble is back after a reload');
    chk(await waitFor(page, () => !document.getElementById('asb-nudge').hidden === false, 3000), 'H6 and no nudge once the person has asked');
    await page.click('#asb');
    chk(await waitFor(page, () => document.querySelectorAll('#asp-th .asp-m').length === 4), 'H6 the earlier conversation is still there', JSON.stringify((await state(page)).you));
    await page.click('#asp-fold');

    // H7: Settings shows the switch while the hosted assistant stands in.
    await page.evaluate(() => showTab('settings'));
    chk(await waitFor(page, () => document.getElementById('asb-row') && !document.getElementById('asb-row').hidden), 'H7 Settings shows the Setup assistant switch');
    await page.evaluate(() => showTab('agents'));

    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.click('#asb'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'asb-hosted.png') }); await page.click('#asp-fold'); }

    // H8: a guide is made (the person connected a model): the bubble moves to it, with its picture, and
    // questions go to its thread, not the hosted route.
    fleet.install([fleet.agent('josh', { state: 'idle', displayName: 'Josh', role: 'Setup guide' }),
      fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
    seedGuide('josh');
    await page.route('**/api/agent/josh/thread', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(route.request().method() === 'POST' ? { delivery: { state: 'placed' }, recorded: true } : { messages: [], olderCount: 0 }) }));
    const jpg = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'icons', 'setup-guide-avatar.jpg'));
    await page.route('**/api/agent/josh/avatar*', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpg }));
    await page.evaluate(() => { ASB.nextFind = 0; });
    chk(await waitFor(page, () => ASB.guide === 'josh' && /\/api\/agent\/josh\/avatar/.test(document.querySelector('#asb img').getAttribute('src') || ''), 20000), 'H8 once a guide exists the bubble moves to it, with its picture');
    await page.click('#asb');
    const before8 = asked.length;
    await page.fill('#asp-say', 'Hello guide');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => document.getElementById('asp-say').value === ''), 'H8 precondition: the question was sent');
    chk(asked.length === before8 && threadPosts.some((u) => /\/api\/agent\/josh\/thread$/.test(u)), 'H8 and it went to the guide\'s thread, not the hosted route', JSON.stringify({ asked: asked.length - before8, threadPosts }));
    chk((await state(page)).note === 'An AI that knows Kosmos, in Josh\'s voice. Josh isn\'t typing live.', 'H8 the note is the guide\'s own again');
    await page.click('#asp-fold');

    // H9: an app whose connector predates the assistant (501): it says so once, then steps aside.
    unseed();
    fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
    await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* */ } });
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden && ASB.hosted === true; }, 8000), 'H9 precondition: hosted again with the guide gone');
    answer = { status: 501, body: { error: 'the setup assistant arrives with the next Kosmos update', unsupported: true } };
    await page.click('#asb');
    await page.fill('#asp-say', 'Hello?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => /arrives with the next Kosmos update/.test(document.getElementById('asp-msg').textContent)), 'H9 an old connector: it says the assistant arrives with the next update');
    await page.waitForTimeout(2500);
    const h9 = await page.evaluate(() => ({ panel: !document.getElementById('asp').hidden, send: document.getElementById('asp-send').disabled }));
    chk(h9.panel && h9.send, 'H9 the sentence stays up long enough to read, with nothing more to send', JSON.stringify(h9));
    chk(await waitFor(page, () => document.getElementById('asb').hidden && document.getElementById('asp').hidden, 9000), 'H9 then the bubble steps aside');
    await page.evaluate(() => showTab('settings'));
    chk(await waitFor(page, () => document.getElementById('asb-row').hidden), 'H9 and the Settings switch goes with it',
      JSON.stringify(await page.evaluate(() => ({ hidden: document.getElementById('asb-row').hidden, guide: ASB.guide, hosted: ASB.hosted, off: ASB.hostedOff, setting: ASB.setting }))));
    await page.evaluate(() => showTab('agents'));

    // H10: the switch off hides the hosted bubble too (the same setting as the guide's).
    await fetch(URL + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupAssistant: { on: false } }) });
    answer = { status: 200, body: { reply: 'ok', remaining: 20 } };
    await boot();
    await page.waitForTimeout(3000);
    chk(!(await state(page)).bubble && await page.evaluate(() => ASB.hosted === true), 'H10 switched off, the hosted assistant shows no bubble (it is still hosted)');
    await fetch(URL + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupAssistant: { on: true } }) });

    chk(!fs.existsSync(RAN), 'H12 the real connector path never ran: nothing reached a coordinator');
    chk(badResponses.length === 0, 'H11 no failed resource other than the refusals the check asked for', badResponses.join(' | '));
    chk(errs.length === 0, 'H11 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall assistant-hosted checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });
