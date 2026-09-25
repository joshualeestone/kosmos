// Browser-check-surface: asblayer asb asb-nudge asb-dot asp asp-ask asp-in asp-say asp-x asp-fold asb-row asb-toggle setup-guide asp-busy asb-act asp-open
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
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
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
  /* The person's OWN agent called "Josh" (session josh-2) comes first: the guide must be found by its
     session name ("josh"), never by a display name the person's agent can share (B2's picture proves it). */
  fleet.install([fleet.agent('josh-2', { state: 'idle', displayName: 'Josh', role: 'Personal assistant' }),
    fleet.agent('josh', { state: 'idle', displayName: 'Josh', role: 'Setup guide' }),
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
    const consoleErrs = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    /* The guide's thread, answered here. */
    let thread = [{ from: 'josh', text: 'Want me to set up your first agent with you?', at: new Date().toISOString() }];
    const sent = [];
    let verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.route('**/api/agent/josh/thread', async (route) => {
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
    /* Asking for the guide on an install without one must not put a failed resource (a 404) in the console:
       every other browser check counts console errors as page errors (it went red in CI once). */
    chk(!consoleErrs.some((t) => /404|Failed to load resource/.test(t)), 'B1 asking for a guide that does not exist logs no failed resource', consoleErrs.join(' | '));

    // B1b: the guide is created AFTER the page loaded (a new install: end of first run, or the first
    // model connecting). The page keeps looking and the bubble arrives without a reload.
    seedGuide('josh');   // the slug, as createAgent records it (production shape, per Renet #3670)
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B1b a guide created after the page loaded shows up without a reload');

    // B2: a guide exists and the setting is on (the default): the bubble with the guide's picture, and the nudge.
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 8000), 'B2 with a guide, the bubble shows');
    const two = await bubble(page);
    chk(/\/api\/agent\/josh\/avatar\?v=/.test(two.src), 'B2 it shows the guide\'s picture', two.src);
    chk(two.nudge, 'B2 the nudge shows before the person has written to the guide');
    // B2b: the lookup itself, with the person's own "Josh" (session josh-2) placed FIRST: the guide is found by
    // its session name, never by a display name the person's agent can share.
    const b2b = await page.evaluate(() => {
      const keep = LAST;
      LAST = [{ name: 'Josh', sessionName: 'josh-2' }, { name: 'Josh', sessionName: 'josh' }];
      const row = asbGuideRow();
      LAST = keep;
      return row && row.sessionName;
    });
    chk(b2b === 'josh', 'B2b with the person\'s own "Josh" listed first, the guide is still the agent whose session is josh', String(b2b));
    chk(await waitFor(page, () => ASB.heard !== null && ASB.readOnce === true), 'B2 precondition: the first thread read has landed');
    chk(!(await bubble(page)).dot, 'B2 a reply already in the thread does not light the dot on load (control: B6 lights it for a new one)');
    /* Measured from the page's content edge (body.clientWidth). The root reserves a stable scrollbar
       gutter (scrollbar-gutter: stable), and a fixed element sits inside it, as the tip card does. */
    const pos = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { right: Math.round(document.body.clientWidth - r.right), bottom: Math.round(document.documentElement.clientHeight - r.bottom) }; });
    chk(pos.right === 16 && pos.bottom === 16, 'B2 it sits in the bottom-right corner', JSON.stringify(pos));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'bubble-light.png') }); }

    // B15: the corner is shared. On an agent's page the chat's Send button lives there: the bubble lifts
    // above it, Send is still what the pointer hits, and the open panel does not cover it either.
    await page.evaluate(() => { const a = document.querySelector('#grid [data-agent="beatrix"]'); if (a) a.click(); });
    chk(await waitFor(page, () => { const s = document.getElementById('d-send'); return !!s && s.getClientRects().length > 0; }), 'B15 precondition: an agent page with its Send button');
    await page.waitForTimeout(1700);   // a tick: the bubble re-measures the corner
    const b15 = await page.evaluate(() => {
      const hitAt = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && !!h.closest('#d-send'); };
      const s = document.getElementById('d-send').getBoundingClientRect(), a = document.getElementById('asb').getBoundingClientRect();
      return { sendReachable: hitAt(document.getElementById('d-send')), overlap: s.left < a.right && s.right > a.left && s.top < a.bottom && s.bottom > a.top, lifted: document.getElementById('asb').style.bottom };
    });
    chk(b15.sendReachable && !b15.overlap, 'B15 on an agent\'s page the bubble sits clear of Send, which still takes the click', JSON.stringify(b15));
    await page.click('#asb');
    await page.waitForTimeout(300);
    const b15p = await page.evaluate(() => { const r = document.getElementById('d-send').getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && !!h.closest('#d-send'); });
    chk(b15p, 'B15 with the chat open, the page\'s Send button is still reachable');
    await page.click('#asp-fold');
    // B17: a short window. The lift is capped, so the bubble and the open chat stay wholly on screen.
    await page.setViewportSize({ width: 1280, height: 420 });
    /* A tall control in the corner, so the lift the bubble wants is taller than the window: only the cap
       keeps it on screen (without one it goes off the top). */
    await page.evaluate(() => { const t = document.createElement('button'); t.dataset.check = 'b17'; t.textContent = 'tall'; t.style.cssText = 'position:fixed;right:0;bottom:0;width:120px;height:380px;z-index:1'; document.body.appendChild(t); });
    await page.waitForTimeout(1700);
    const b17 = await page.evaluate(() => { const r = document.getElementById('asb').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
    await page.click('#asb');
    await page.waitForTimeout(300);
    const b17p = await page.evaluate(() => { const r = document.getElementById('asp').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
    /* The tall control reaches into the page's bottom band, so the open chat must sit above it: its lower
       part is still what the pointer hits (the old band rule, which looked only at a control's top, left the
       chat covering it). */
    const b17hit = await page.evaluate(() => { const h = document.elementFromPoint(1200, innerHeight - 120);   /* in the band, above where Send alone would lift the chat */ return !!h && h.dataset.check === 'b17'; });
    chk(b17.top >= 0 && b17.bottom <= b17.vh && b17p.top >= 0 && b17p.bottom <= b17p.vh, 'B17 on a short window the lifted bubble and the open chat stay on screen', JSON.stringify({ b17, b17p }));
    chk(b17hit, 'B17 and the open chat does not cover a control reaching into the bottom band');
    await page.click('#asp-fold');
    await page.evaluate(() => document.querySelector('[data-check="b17"]').remove());
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);

    // B3: clicking it opens the chat in place, headed Josh and tagged as AI, and tells the guide the screen.
    pageReports.length = 0;
    await page.click('#asb');
    chk(await waitFor(page, () => !document.getElementById('asp').hidden), 'B3 the chat opens');
    await waitFor(page, () => document.querySelectorAll('#asp-th .asp-m.him').length > 0);   // the thread's first read
    const head = await page.evaluate(() => {
      const note = document.querySelector('.asp-note');
      const him = [...document.querySelectorAll('#asp-th .asp-m.him')], you = document.querySelector('#asp-th .asp-m.you');
      const rs = getComputedStyle(document.documentElement);
      return { who: document.querySelector('.asp-who b').textContent, tag: !!document.querySelector('#asp .asp-tag'),
        note: note ? note.textContent : '', noteShown: !!note && getComputedStyle(note).display !== 'none',
        him: him.map((m) => m.textContent), place: document.getElementById('asp-say').placeholder,
        himBg: him[0] ? getComputedStyle(him[0]).backgroundColor : null, agentMsg: rs.getPropertyValue('--agent-msg').trim(),
        focus: document.activeElement && document.activeElement.id };
    });
    /* #3738 (Josh 08:51): "Josh, Kosmos Guide", no pill, no footer, one opening message, the new placeholder. */
    chk(head.who === 'Josh, Kosmos Guide' && !head.tag && !head.noteShown, 'B3 headed "Josh, Kosmos Guide", with no pill and no footer line (#3738)', JSON.stringify(head));
    chk(head.him[0] === 'Hi, I\'m Josh\'s AI guide. Ask me anything about setting up Kosmos.' && head.him.length === 2 && head.place === 'Ask about Kosmos\u2026',
      'B3 the opening message is the first guide bubble, then the thread; the box says "Ask about Kosmos..."', JSON.stringify(head));
    chk(head.focus === 'asp-say', 'B3 and puts the cursor in the box', JSON.stringify(head));
    /* The two lines Josh cut are gone from the page, its scripts included, so no template or fallback can bring
       one back (a starting note in the panel's markup carried one after the paint had dropped it). */
    const cut = await page.evaluate(() => { const h = document.documentElement.innerHTML; return ['Hi, I built Kosmos', 'An AI that knows Kosmos'].filter((w) => h.includes(w)); });
    chk(cut.length === 0, 'B3 neither cut line is anywhere in the page (#3738)', JSON.stringify(cut));
    /* The guide's bubble is the DM's agent cream (the same token, read, not a copy of its value). */
    chk(await page.evaluate(() => { const t = document.createElement('div'); t.style.background = 'var(--agent-msg)'; document.body.appendChild(t); const v = getComputedStyle(t).backgroundColor; t.remove();
      return v === getComputedStyle(document.querySelector('#asp-th .asp-m.him')).backgroundColor; }), 'B3 the guide\'s bubbles are the DM agent cream (--agent-msg)', JSON.stringify(head));
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
    chk(await page.evaluate(() => { const t = document.createElement('div'); t.style.background = 'var(--usermsg-tint)'; document.body.appendChild(t); const v = getComputedStyle(t).backgroundColor; t.remove();
      return v === getComputedStyle(document.querySelector('#asp-th .asp-m.you')).backgroundColor; }), 'B5 the person\'s bubble is the DM blue (--usermsg-tint, #3738)');
    chk(sent.length === 1 && sent[0] === 'How do I make an agent?' && await page.evaluate(() => document.getElementById('asp-say').value === ''), 'B5 it went to the guide\'s thread once and the box emptied', JSON.stringify(sent));

    // B5b: unconfirmed and NOT kept in the thread: the box is the only copy, so the words stay, and it says so.
    verdict = { delivery: { state: 'unconfirmed' }, recorded: false };
    await page.fill('#asp-say', 'Is it working?');
    await page.keyboard.press('Enter');
    await waitFor(page, () => /still in the box/.test(document.getElementById('asp-msg').textContent));
    await waitFor(page, () => ASB.sending === false);   // the send (and its re-read) has finished before the next
    const b5b = await page.evaluate(() => ({ box: document.getElementById('asp-say').value, msg: document.getElementById('asp-msg').textContent }));
    chk(b5b.box === 'Is it working?' && /still in the box/.test(b5b.msg), 'B5b an unconfirmed send that was not kept leaves the words in the box and says so', JSON.stringify(b5b));
    // B5c: could_not keeps them too, with the reason as a sentence.
    verdict = { delivery: { state: 'could_not', because: 'the assistant is not running' }, recorded: false };
    await page.keyboard.press('Enter');
    await waitFor(page, () => /could not get that/.test(document.getElementById('asp-msg').textContent));
    await waitFor(page, () => ASB.sending === false);
    const b5c = await page.evaluate(() => ({ box: document.getElementById('asp-say').value, msg: document.getElementById('asp-msg').textContent }));
    chk(b5c.box === 'Is it working?' && /The assistant is not running/.test(b5c.msg), 'B5c a send that could not go keeps the words and gives the reason', JSON.stringify(b5c));
    verdict = { delivery: { state: 'placed' }, recorded: true };
    await page.fill('#asp-say', '');

    // B6: the minus folds it back to the bubble; a reply while folded lights the dot; opening clears it.
    await page.click('#asp-fold');
    const folded = await bubble(page);
    chk(!folded.panel && folded.bubble && !folded.nudge, 'B6 the minus folds it to the bubble, and the nudge is gone for good after writing', JSON.stringify(folded));
    chk(!folded.dot, 'B6 CONTROL: no dot before a reply');
    thread = thread.concat([{ from: 'josh', text: 'Click New agent, top left.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    chk((await bubble(page)).dot, 'B6 a reply while folded lights the gold dot');
    await page.click('#asb');
    await page.waitForTimeout(300);
    chk(!(await bubble(page)).dot && await page.evaluate(() => [...document.querySelectorAll('#asp-th .asp-m.him:not(.asp-open)')].length === 2), 'B6 opening it shows the reply and clears the dot');

    // B20 (#3733, Josh 08:23): while the guide is working on a reply, the chat shows the app's working row (the same
    // .act dots and "is working" the agent page uses) and the folded bubble shows the dots, so a message does not
    // feel lost. CONTROL: idle, neither shows.
    const guideState = (st) => fleet.install([fleet.agent('josh-2', { state: 'idle', displayName: 'Josh', role: 'Personal assistant' }),
      fleet.agent('josh', { state: st, displayName: 'Josh', role: 'Setup guide' }),
      fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
    /* A thread long enough to scroll, read to its end, so the arms below can see whether the row pushes a reply out of view. */
    for (let i = 0; i < 12; i++) thread = thread.concat([{ from: i % 2 ? 'josh' : 'you', text: 'Line ' + i + ' of an earlier conversation.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    await page.evaluate(() => { const th = document.getElementById('asp-th'); th.scrollTop = th.scrollHeight; });
    chk(await page.evaluate(() => { const th = document.getElementById('asp-th'); return th.scrollHeight > th.clientHeight + 40; }), 'B20 precondition: the thread scrolls');
    guideState('working');
    chk(await waitFor(page, () => { const b = document.getElementById('asp-busy'); return !!b && !b.hidden && b.querySelectorAll('.act i').length === 3 && /Josh is working/.test(b.textContent); }, 12000),
      'B20 the guide working: the open chat shows the working row', await page.evaluate(() => document.getElementById('asp-busy').outerHTML.slice(0, 200)));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'asb-working-open.png') }); }
    // B20: the dots keep ONE node across paints (#3421): a rebuilt node restarts their loop every tick.
    await page.evaluate(() => { document.querySelector('#asp-busy .act').__kept = true; });
    await page.waitForTimeout(3500);
    chk(await page.evaluate(() => !!document.querySelector('#asp-busy .act') && document.querySelector('#asp-busy .act').__kept === true), 'B20 the working dots are not rebuilt across ticks (one continuous animation)');
    // B20: a reply that lands while the board still says working: the row steps aside for it.
    thread = thread.concat([{ from: 'josh', text: 'Here you go.', at: new Date().toISOString() }]);
    await page.evaluate(() => asbPoll(true));
    chk(await page.evaluate(() => document.getElementById('asp-busy').hidden), 'B20 a reply that has landed outranks the stale "working" from the last board snapshot');
    /* The row took the thread's height while it showed; the thread stayed at its end, so the reply is in view. */
    const inView = await page.evaluate(() => { const th = document.getElementById('asp-th'), last = th.lastElementChild;
      const a = th.getBoundingClientRect(), b = last.getBoundingClientRect(); return { text: last.textContent, bottom: Math.round(b.bottom), thBottom: Math.round(a.bottom) }; });
    chk(inView.text === 'Here you go.' && inView.bottom <= inView.thBottom + 1, 'B20 the reply that lands under the working row is in view, not scrolled under it', JSON.stringify(inView));
    /* The next snapshot still says working: its announcement goes to its own region and leaves the reply's alone. */
    await page.evaluate(() => tick());
    await waitFor(page, () => !document.getElementById('asp-busy').hidden, 6000);
    const lives = await page.evaluate(() => ({ reply: document.getElementById('asp-live').textContent, busy: document.getElementById('asp-live-busy').textContent }));
    chk(lives.reply === 'Here you go.' && lives.busy === 'Josh is working', 'B20 "working" again does not replace the reply a screen reader has yet to read', JSON.stringify(lives));
    await page.click('#asp-fold');
    await page.evaluate(() => tick());   // the next board snapshot, forced: it is newer than the reply, so "working" counts again
    chk(await waitFor(page, () => { const a = document.querySelector('#asb .asb-act'); return !!a && !a.hidden && getComputedStyle(a).display !== 'none'; }, 6000)
      && await page.evaluate(() => /Josh is working/.test(document.getElementById('asb').getAttribute('aria-label'))),
      'B20 folded, the bubble shows the working dots and says so to a screen reader');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'asb-working-folded.png'), clip: { x: 1100, y: 700, width: 180, height: 160 } });
    guideState('idle');
    chk(await waitFor(page, () => { const a = document.querySelector('#asb .asb-act'); return !!a && a.hidden; }, 12000), 'B20 CONTROL: idle, the dots go');
    await page.click('#asb');
    chk(await page.evaluate(() => document.getElementById('asp-busy').hidden), 'B20 CONTROL: and no working row in the chat');
    // B20: the guide's sign-in broken: the chat says so (busyRow's line), and the folded bubble shows no working dots.
    guideState('auth_failed');
    chk(await waitFor(page, () => { const b = document.getElementById('asp-busy'); return !!b && !b.hidden && /sign-in isn.t working/.test(b.textContent) && !b.querySelector('.act'); }, 12000), 'B20 a broken sign-in says so in the chat, not silence');
    await page.click('#asp-fold');
    await page.waitForTimeout(400);
    chk(await page.evaluate(() => document.querySelector('#asb .asb-act').hidden), 'B20 and the folded bubble shows no working dots for it');
    guideState('idle');
    await page.click('#asb');
    await waitFor(page, () => document.getElementById('asp-busy').hidden, 12000);

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

    // B12: the board refuses a page report with 409 (it could not write the report, or could not check
    // just now). That is not "no guide": the chat stays open and the bubble does not blink away.
    await page.route('**/api/setup-guide/page', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"we could not tell the setup guide which screen you are on"}' }));
    await page.click('#asb');
    await page.waitForTimeout(2500);
    const b12 = await bubble(page);
    chk(b12.panel && await page.evaluate(() => ASB.guide === 'josh'), 'B12 a refused page report (409) keeps the guide and the open chat', JSON.stringify(b12));
    await page.unroute('**/api/setup-guide/page');
    await page.click('#asp-fold');

    // B13: the settings read fails once at load; it is read again and the bubble arrives without a reload.
    let settingsFailed = 0;
    /* Only the assistant's own read fails: the first settings GET once the page knows the guide (other
       parts of the app read /api/settings too, and failing one of theirs would test nothing here). */
    await page.route('**/api/settings', async (route) => {
      const knowsGuide = await page.evaluate(() => typeof ASB !== 'undefined' && !!ASB.guide && !ASB.setting).catch(() => false);
      if (route.request().method() === 'GET' && settingsFailed === 0 && knowsGuide) { settingsFailed++; return route.abort(); }
      return route.continue();
    });
    await boot();
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000) && settingsFailed === 1, 'B13 a settings read that failed at load is retried and the bubble arrives', 'failed=' + settingsFailed);
    await page.unroute('**/api/settings');

    // B16: the tips cannot be read. The Setup assistant switch lives in the same Help box and must still be
    // there ("Don't show this again" promises it is), while the tips row hides (CONTROL: B1, no guide, no row).
    /* The page retries a failed tips read every second (tipsCheck), and a retry that succeeds repaints the
       row before this arm reads it: hold the retry off for the arm, then let it run again. */
    await page.evaluate(() => { TIPS_LOAD_NEXT = Date.now() + 1e9; TIPS_STATE = { ok: false, seen: [], off: true }; paintTipsToggle(); showTab('settings'); document.querySelector('#s-nav button[data-go="mac"]').click(); });
    await page.waitForTimeout(300);
    const b16 = await page.evaluate(() => ({ box: document.getElementById('tips-box').hidden, tipsRow: document.getElementById('tips-row').hidden, asbRow: document.getElementById('asb-row').hidden }));
    chk(b16.box === false && b16.asbRow === false && b16.tipsRow === true, 'B16 with the tips unreadable, the Help box still offers the Setup assistant switch', JSON.stringify(b16));
    await page.evaluate(() => { TIPS_LOAD_NEXT = 0; showTab('agents'); });

    // B14: a new agent takes the guide's name (its folder has no guide marker). The board answers 409
    // "not-guide"; unlike a check it could not make (B12), that means the guide is gone.
    const marker14 = path.join(path.dirname(instructions.fileFor('josh')), setupAssistant.GUIDE_MARKER);
    chk((await bubble(page)).bubble, 'B14 precondition: the bubble is showing');
    fs.rmSync(marker14, { force: true });
    await page.evaluate(() => asbPoll(true));
    chk(await waitFor(page, () => document.getElementById('asb').hidden && ASB.guide === null, 6000), 'B14 a folder that is not the guide\'s (a new agent took the name) is not used as the guide');
    fs.writeFileSync(marker14, 'josh\n');   // the real guide back, for the arms after
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B14 CONTROL: the marked guide is found again');

    // B19: the guide goes while the person is typing. Send says why, keeps their words, and the chat closes a
    // moment later rather than vanishing with the message unread.
    await page.click('#asb');
    await waitFor(page, () => !document.getElementById('asp').hidden);
    unseed();
    await page.fill('#asp-say', 'Are you there?');
    await page.keyboard.press('Enter');
    chk(await waitFor(page, () => /not on this computer any more/.test(document.getElementById('asp-msg').textContent) && !document.getElementById('asp').hidden), 'B19 a send refused because the guide went says so in the open chat');
    chk(await page.evaluate(() => document.getElementById('asp-say').value === 'Are you there?'), 'B19 and the words stay in the box');
    chk(await waitFor(page, () => document.getElementById('asp').hidden && ASB.guide === null, 8000), 'B19 then the chat closes with the guide gone');
    seedGuide('josh');
    chk(await waitFor(page, () => { const b = document.getElementById('asb'); return b && !b.hidden; }, 15000), 'B19 CONTROL: the guide back, the bubble returns');

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
