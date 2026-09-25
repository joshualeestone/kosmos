// Browser-check-surface: asblayer asb asb-nudge asb-dot asp asp-ask asp-in asp-say asp-x asp-fold asb-row asb-toggle setup-guide
'use strict';

/**
 * The setup assistant bubble (#3034, Josh 2026-09-24: 16:05 bottom-right app-wide, context aware;
 * 18:02 "I love it", plus the first-x choice and a Settings switch to bring it back).
 *
 * The board is real (the guide lookup, the setting, the page-context reports); the chat thread is
 * answered by a route here, because delivering to a live agent is the direct-message route's own job
 * and has its own checks. Every "shows only when" arm has a control that shows it from the same state.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-assistant-bubble-3034.js [shots-dir]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-asb-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

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

const bubble = (page) => page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
  const b = document.getElementById('asb');
  return { layer: !!document.getElementById('asblayer'), bubble: vis('asb'), nudge: vis('asb-nudge'), panel: vis('asp'), ask: vis('asp-ask'),
    dot: !!b && !b.querySelector('.asb-dot').hidden && vis('asb'), src: b ? (b.querySelector('img').getAttribute('src') || '') : '' };
});
const waitFor = (page, fn, ms = 6000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);

(async () => {
  fleet.install([fleet.agent('Josh', { state: 'idle', displayName: 'Josh', role: 'Setup guide' }),
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  /* Tips quiet: they are their own feature with their own check, and a tip must not cover the corner. */
  fs.writeFileSync(tipsStore.FILE(), JSON.stringify({ seen: [], off: true }));
  unseed();
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const setting = async (patch) => (await fetch(URL + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupAssistant: patch }) })).json();
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    /* The guide's thread, answered here. */
    let thread = [{ from: 'Josh', text: 'Hi, I built Kosmos. Want me to set up your first agent with you?', at: new Date().toISOString() }];
    const sent = [];
    let verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.route('**/api/agent/Josh/thread', async (route) => {
      const r = route.request();
      if (r.method() === 'POST') {
        const body = JSON.parse(r.postData() || '{}');
        sent.push(body.text);
        if (verdict.recorded) thread = thread.concat([{ from: 'you', text: body.text, at: new Date().toISOString() }]);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(verdict) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: thread, olderCount: 0 }) });
    });
    const pageReports = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/setup-guide/page')) pageReports.push(JSON.parse(r.postData() || '{}')); });
    const boot = async () => {
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    };

    // B1: no guide on this computer, so nothing is drawn at all (control: B2, the same board with a guide).
    await boot();
    await page.waitForTimeout(3800);
    const none = await bubble(page);
    chk(!none.layer && !none.bubble, 'B1 with no setup guide, no bubble and no layer', JSON.stringify(none));
    chk(await page.evaluate(() => document.getElementById('asb-row').hidden === true), 'B1 and no Setup assistant row in Settings');

    // B1b: the guide is created AFTER the page loaded (a new install: end of first run, or the first
    // model connecting). The page keeps looking and the bubble arrives without a reload.
    seedGuide('Josh');
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B1b a guide created after the page loaded shows up without a reload');

    // B2: a guide exists and the setting is on (the default): the bubble with the guide's picture, and the nudge.
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000), 'B2 with a guide, the bubble shows');
    const two = await bubble(page);
    chk(/\/api\/agent\/Josh\/avatar\?v=/.test(two.src), 'B2 it shows the guide\'s picture', two.src);
    chk(two.nudge, 'B2 the nudge shows before the person has written to the guide');
    await page.waitForTimeout(1600);   // past a tick: the first read of the thread has landed
    chk(!(await bubble(page)).dot, 'B2 a reply already in the thread does not light the dot on load (control: B6 lights it for a new one)');
    /* Measured from the page's content edge (body.clientWidth). The root reserves a stable scrollbar
       gutter (scrollbar-gutter: stable), and a fixed element sits inside it, as the tip card does. */
    const pos = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { right: Math.round(document.body.clientWidth - r.right), bottom: Math.round(document.documentElement.clientHeight - r.bottom) }; });
    chk(pos.right === 16 && pos.bottom === 16, 'B2 it sits in the bottom-right corner', JSON.stringify(pos));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'bubble-light.png') }); }

    // B3: clicking it opens the chat in place, headed Josh and tagged as AI, and tells the guide the screen.
    pageReports.length = 0;
    await page.click('#asb');
    chk(await waitFor(page, () => !document.getElementById('asp').hidden), 'B3 the chat opens');
    await waitFor(page, () => document.querySelectorAll('#asp-th .asp-m.him').length > 0);   // the thread's first read
    const head = await page.evaluate(() => ({ who: document.querySelector('.asp-who b').textContent, tag: document.querySelector('.asp-tag').textContent,
      note: document.querySelector('.asp-note').textContent, him: [...document.querySelectorAll('#asp-th .asp-m.him')].map((m) => m.textContent),
      focus: document.activeElement && document.activeElement.id }));
    chk(head.who === 'Josh' && head.tag === 'JOSH\'S AI' && head.note === 'An AI that knows Kosmos, in Josh\'s voice. Josh isn\'t typing live.', 'B3 headed Josh, tagged JOSH\'S AI, and says Josh isn\'t typing live', JSON.stringify(head));
    chk(head.him.length === 1 && head.focus === 'asp-say', 'B3 it shows the guide\'s thread and puts the cursor in the box', JSON.stringify(head));
    for (let i = 0; i < 8 && !pageReports.some((p) => p.screen === 'board'); i++) await page.waitForTimeout(250);
    chk(pageReports.some((p) => p.screen === 'board'), 'B3 the guide is told the person is on the board', JSON.stringify(pageReports));
    const usable = await page.evaluate(() => { const b = document.getElementById('new-agent') || document.getElementById('rail-agents-new'); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && !!hit.closest('#new-agent, #rail-agents-new'); });
    chk(usable, 'B3 the page stays usable beside it (New agent is still under the pointer)');
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'panel-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: path.join(SHOTS, 'panel-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }

    // B4: moving to another screen while it is open tells the guide the new one.
    pageReports.length = 0;
    await page.click('#tabs [data-tab="projects"]');
    for (let i = 0; i < 12 && !pageReports.some((p) => p.screen === 'projects'); i++) await page.waitForTimeout(250);
    chk(pageReports.some((p) => p.screen === 'projects'), 'B4 the guide is told when the screen changes', JSON.stringify(pageReports));
    await page.click('#tabs [data-tab="agents"]');

    // B5: sending goes to the guide's own thread, the box empties, and the nudge never returns.
    await page.fill('#asp-say', 'How do I make an agent?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => [...document.querySelectorAll('#asp-th .asp-m.you')].some((m) => m.textContent === 'How do I make an agent?')), 'B5 the message shows in the chat');
    chk(sent.length === 1 && sent[0] === 'How do I make an agent?' && await page.evaluate(() => document.getElementById('asp-say').value === ''), 'B5 it went to the guide\'s thread once and the box emptied', JSON.stringify(sent));

    // B5b: unconfirmed and NOT kept in the thread: the box is the only copy, so the words stay, and it says so.
    verdict = { delivery: { state: 'unconfirmed' }, recorded: false };
    await page.fill('#asp-say', 'Is it working?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const b5b = await page.evaluate(() => ({ box: document.getElementById('asp-say').value, msg: document.getElementById('asp-msg').textContent }));
    chk(b5b.box === 'Is it working?' && /still in the box/.test(b5b.msg), 'B5b an unconfirmed send that was not kept leaves the words in the box and says so', JSON.stringify(b5b));
    // B5c: could_not keeps them too, with the reason as a sentence.
    verdict = { delivery: { state: 'could_not', because: 'the assistant is not running' }, recorded: false };
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const b5c = await page.evaluate(() => ({ box: document.getElementById('asp-say').value, msg: document.getElementById('asp-msg').textContent }));
    chk(b5c.box === 'Is it working?' && /The assistant is not running/.test(b5c.msg), 'B5c a send that could not go keeps the words and gives the reason', JSON.stringify(b5c));
    verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.fill('#asp-say', '');

    // B6: the minus folds it back to the bubble; a reply while folded lights the dot; opening clears it.
    await page.click('#asp-fold');
    const folded = await bubble(page);
    chk(!folded.panel && folded.bubble && !folded.nudge, 'B6 the minus folds it to the bubble, and the nudge is gone for good after writing', JSON.stringify(folded));
    chk(!folded.dot, 'B6 CONTROL: no dot before a reply');
    thread = thread.concat([{ from: 'Josh', text: 'Click New agent, top left.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    chk((await bubble(page)).dot, 'B6 a reply while folded lights the gold dot');
    await page.click('#asb');
    await page.waitForTimeout(300);
    chk(!(await bubble(page)).dot && await page.evaluate(() => [...document.querySelectorAll('#asp-th .asp-m.him')].length === 2), 'B6 opening it shows the reply and clears the dot');

    // B7: the first x asks once; Close for now keeps it and records the ask; a later x just closes.
    await page.click('#asp-x');
    const ask = await bubble(page);
    chk(ask.panel && ask.ask, 'B7 the first x asks Close the assistant?');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ask-light.png') });
    await page.click('#asp-close-now');
    await page.waitForTimeout(300);
    const kept = await bubble(page);
    const s7 = (await (await fetch(URL + '/api/settings')).json()).setupAssistant;
    chk(!kept.panel && kept.bubble && s7.asked === true && s7.on === true, 'B7 Close for now closes it, keeps the bubble, and remembers it asked', JSON.stringify({ kept, s7 }));
    await page.click('#asb');
    await page.click('#asp-x');
    await page.waitForTimeout(200);
    const again = await bubble(page);
    chk(!again.panel && !again.ask && again.bubble, 'B7 a later x just closes, without asking again', JSON.stringify(again));

    // B8: Don't show this again turns it off; the Settings switch reads that and brings it back.
    await setting({ asked: false });
    await boot();
    await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000);
    await page.click('#asb');
    await page.click('#asp-x');
    await page.click('#asp-close-off');
    await page.waitForTimeout(300);
    const off = await bubble(page);
    const s8 = (await (await fetch(URL + '/api/settings')).json()).setupAssistant;
    chk(!off.bubble && !off.panel && s8.on === false && s8.asked === true, 'B8 Don\'t show this again hides it and turns it off', JSON.stringify({ off, s8 }));
    await page.evaluate(() => showTab('settings'));
    await page.evaluate(() => { const b = document.querySelector('[data-sec="mac"], [data-sec="computer"]'); if (b) b.click(); });
    const row = await page.evaluate(() => ({ hidden: document.getElementById('asb-row').hidden, on: document.getElementById('asb-toggle').getAttribute('aria-checked'),
      head: document.getElementById('tips-box').querySelector('.dlab').textContent }));
    chk(row.hidden === false && row.on === 'false' && row.head === 'Help', 'B8 Settings shows the Setup assistant switch, off, under Help', JSON.stringify(row));
    await page.evaluate(() => document.getElementById('asb-toggle').click());
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }), 'B8 switching it on brings the bubble back at once');
    chk((await (await fetch(URL + '/api/settings')).json()).setupAssistant.on === true, 'B8 and the board remembers it is on');

    // B9: first run is its own full-screen flow, so the bubble steps out of it (control: B8's last arm).
    await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false; });
    chk(await waitFor(page, () => document.getElementById('asb').hidden), 'B9 during first run the bubble is hidden');
    await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; });
    chk(await waitFor(page, () => !document.getElementById('asb').hidden), 'B9 CONTROL: it comes back when first run is gone');

    // B10: the guide goes while the chat is FOLDED: the next thread read asks the board first, is told
    // there is no guide, and the page stops using the name (a new agent that took it must never get the
    // guide's chat or light its dot). CONTROL: the bubble is showing just before.
    chk(!(await bubble(page)).panel && (await bubble(page)).bubble, 'B10 precondition: folded, bubble showing');
    unseed();
    await page.evaluate(() => asbPoll(true));
    chk(await waitFor(page, () => document.getElementById('asb').hidden && document.getElementById('asp').hidden, 6000), 'B10 a guide gone while folded: the next read notices and the bubble goes');
    chk(await page.evaluate(() => ASB.guide === null), 'B10 and the page no longer holds the name');
    // B10b: and a fresh page with no guide shows none.
    await boot();
    await page.waitForTimeout(3800);
    chk(!(await bubble(page)).bubble, 'B10b once the board names no guide, a fresh page shows no bubble');

    chk(errs.length === 0, 'B11 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall assistant-bubble checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });
