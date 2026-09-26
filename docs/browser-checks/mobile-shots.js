'use strict';
/* #718: phone screenshots of the board, for everyone working on the mobile apps.
 *
 * Both native apps are shells around the board's web UI, so "does it fit on a
 * phone" is a question about web/index.html at phone sizes. This boots a
 * THROWAWAY board with seeded sample data, drives it to named screens, and
 * shoots every screen at four phone sizes, in light and dark, in Chromium and
 * WebKit. It flags horizontal overflow on the way.
 *
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules \
 *     node docs/browser-checks/mobile-shots.js [--out DIR] [--screens a,b]
 *       [--sizes se,iphone15,promax,android] [--themes light,dark]
 *       [--engines chromium,webkit] [--strict] [--list] [--keep]
 *       [--data sample|store] [--scale css|device]
 *
 * Output: DIR/<screen>--<size>--<theme>--<engine>.png plus DIR/report.md (every
 * shot, and every overflow found). Default DIR is a new temp folder, printed at
 * the end. --strict exits 1 when anything overflows. --list prints the screens.
 * --keep leaves the throwaway board running afterwards (address printed) so you
 * can explore it by hand; Ctrl-C stops it and deletes its data.
 * --data store seeds a clean fleet for App Store and Play screenshots instead
 * of the stress-test sample (no stopped agent, no overlong names, no code
 * block); --scale device saves at the device's pixels, not CSS pixels. The
 * App Store size is `appstore` (440x956 at 3x, which is 1320x2868): it is not in
 * the default sweep. ios/store/shoot.sh is the one command for the iOS set.
 *
 * 🛑 NEVER THE LIVE BOARD, AND NEVER THIS MAC'S ACCOUNTS. The board below is
 * started here, on a free port, with every data root in a temp dir and a fake
 * tmux. Its HOME and every home/config root the engine reads are temp dirs too:
 * the accounts modules read `AGENT_WORKFORCE_HOME || os.homedir()`, so a board
 * sandboxed on data roots alone still lists this Mac's real Claude emails and an
 * OpenAI key suffix in Settings (found and measured by Sonya, #718). Before every
 * screenshot a LEAK GUARD reads the page and stops the whole run, writing nothing
 * more, if it finds an email the board injected (not example.com / .org / .net, and
 * not one that ships in web/index.html), an API key (sk-, AIza, xai-), or this Mac's
 * home path, user name or host name (exit 3). The report is checked the same way. Screenshots end up on
 * GitHub; a real account must not. THIS IS THE ONLY SANCTIONED WAY TO TAKE
 * SCREENSHOTS FOR A PR OR #718: other checks here do not set these roots.
 *
 * ⚠️ WEBKIT IS NOT SAFARI. Playwright's WebKit is an engine approximation of
 * iOS Safari / WKWebView, not the real thing (no iOS simulator on this Mac yet),
 * and Chromium with a phone viewport is not an Android phone. Say so in reports.
 *
 * ADDING YOUR SCREENS: append to SCREENS below. Each entry is
 *   { name, owner, go: async (page, data) => { ...navigate to the screen... } }
 * plus `noServiceWorker: true` if `go` stubs a request with page.route.
 * `go` starts on a freshly loaded board at the phone size and theme (data has
 * `projectId`); leave the page showing the screen. Keep names short and unique
 * (they are file names). Sample data: 5 agents (working, idle, needs you,
 * stopped; one very long name and task), Ada's DM with a long reply and a code
 * block, a project room with posts and reactions, Cleo's pending ask. The
 * allow-card screen stubs one phone asking to connect (see it below).
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts (the board below also gets its own roots)
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');

/* The four phone sizes from the #718 plan. `dpr` is the device's pixel ratio;
   shots are saved at CSS pixels (scale: 'css') so files stay small and every
   size compares one to one. */
const SIZES = {
  se: { width: 375, height: 667, dpr: 2, label: 'iPhone SE' },
  iphone15: { width: 393, height: 852, dpr: 3, label: 'iPhone 15' },
  promax: { width: 430, height: 932, dpr: 3, label: 'iPhone Pro Max' },
  android: { width: 412, height: 915, dpr: 2.625, label: 'mid Android' },
  // The 6.9-inch iPhone screenshot App Store Connect requires: 1320x2868 at --scale device.
  appstore: { width: 440, height: 956, dpr: 3, label: 'App Store 6.9-inch' },
};
const DEFAULT_SIZES = ['se', 'iphone15', 'promax', 'android'];
const THEMES = ['light', 'dark'];
const ENGINES = ['chromium', 'webkit'];

/* Containers whose own horizontal overflow is flagged, besides the page itself.
   Missing selectors are skipped. Extend this list for your screen's scroller. */
const OVERFLOW_SELECTORS = ['html', 'body', 'main', '.view', '.panel', '[role="main"]'];

/* ------------------------------------------------------------------ screens */
/* The shared helpers the screens use. */
/* On a phone the areas sit behind the ☰ (#burger, controls #tabs): open it
   first when it is showing, then choose the area. */
async function openTab(page, tab) {
  if (await page.isVisible('#burger')) {
    await page.click('#burger');
    await page.waitForSelector(`[data-tab="${tab}"]`, { state: 'visible', timeout: 5000 });
  }
  await page.click(`[data-tab="${tab}"]`);
  // Arrived, or the shot fails: a click that stops switching must not photograph the last screen.
  await page.waitForSelector(`#panel-${tab}`, { state: 'visible', timeout: 5000 });
}

/* Deep links (web/index.html's ?tab / ?agent / ?project routing) reach a
   screen without depending on phone navigation; the frame shots use the ☰. */
/* 'load', not 'networkidle': some screens hold a connection open (live
   updates), so the network never goes idle there. */
const at = async (page, qs) => {
  await page.goto(page.url().split('?')[0] + qs, { waitUntil: 'load' });
  await page.waitForTimeout(900);
};

const SCREENS = [
  // Raiden: the app frame on a phone (top bar, navigation, agents list, home).
  { name: 'home', owner: 'Raiden', go: async () => {} },
  /* Both assert they got there: a renamed control must fail the shot, not
     quietly photograph the home screen again. */
  { name: 'nav-menu', owner: 'Raiden', go: async (page) => {
    await page.click('#burger');
    await page.waitForSelector('#burger[aria-expanded="true"]', { timeout: 5000 });
  } },
  { name: 'agents-list', owner: 'Raiden', go: async (page) => {
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('button.vt[data-layout="list"][aria-pressed="true"][aria-label="Show agents as a list"]', { timeout: 5000 });
  } },
  { name: 'agent-page', owner: 'Raiden', go: async (page) => {
    await at(page, '?agent=ada');
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
  } },
  // Scorpion: an agent's chat.
  { name: 'agent-chat', owner: 'Scorpion', go: async (page) => {
    await at(page, '?agent=ada');
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
  } },
  // Kano: projects, a room, and the waiting-on-you ask.
  { name: 'projects', owner: 'Kano', go: async (page) => openTab(page, 'projects') },
  { name: 'project-room', owner: 'Kano', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => { const r = document.querySelector('#pj-room'); if (r) r.scrollIntoView({ block: 'start' }); });
  } },
  { name: 'ask-waiting', owner: 'Kano', go: async (page) => {
    // The board re-renders cards on its tick, so scroll inside the page.
    await page.waitForSelector('.acard[data-agent="cleo"]', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('.acard[data-agent="cleo"]').scrollIntoView({ block: 'start' }));
  } },
  /* Where a push tap lands: the needs-you agent's page, shot once it has
     settled (the conversation scrolls to the top after load). */
  { name: 'push-landing', owner: 'Kano', go: async (page) => {
    await at(page, '?tab=detail&agent=cleo');
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1600);
  } },
  /* The Allow card (#askcard): one phone asking to connect. The throwaway
     board has Plus off and no tunnel, so /api/remote/pending is always empty;
     turning Plus on for real would start the tunnel. Instead the answer is
     stubbed IN THIS PAGE ONLY, in server.js's shape, and the page's own poll
     paints it. The email is example.com so the leak guard still judges it.
     ⚠️ noServiceWorker: the board's sw.js claims the page, and in WebKit a
     page.route never sees a controlled page's fetches (measured: the stub was
     never hit and the card stayed hidden), so this screen's context blocks it. */
  { name: 'allow-card', owner: 'Kano', noServiceWorker: true, go: async (page) => {
    const pending = { email: 'owner@example.com', snapshot: true, devices: [
      { device_id: 'd-sample-0001', name: 'iPhone', code: '482 913', first_seen: Math.floor(Date.now() / 1000) - 40, denied_at: 0 }] };
    await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pending) }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#askcard:not([hidden]) [data-ask="allow"]', { state: 'visible', timeout: 8000 });
  } },
  // Sonya: settings.
  { name: 'settings', owner: 'Sonya', go: async (page) => {
    await at(page, '?tab=settings');
    await page.waitForSelector('#panel-settings', { state: 'visible', timeout: 5000 });
  } },
  { name: 'settings-accounts', owner: 'Sonya', go: async (page) => {
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 5000 });
  } },
  /* The #718 phone-ready sweep's remaining screens (Raiden, 2026-09-25). Each
     asserts it arrived, for the same reason as the frame shots above. */
  { name: 'org-chart', owner: 'unowned', go: async (page) => {
    await page.click('button.vt[data-layout="org"]');
    await page.waitForSelector('button.vt[data-layout="org"][aria-pressed="true"]', { timeout: 5000 });
  } },
  { name: 'create-agent', owner: 'unowned', go: async (page) => {
    // A real tap (visible, not covered), the way a phone user reaches it; a hidden button fails the shot.
    await page.click('#new-agent', { timeout: 5000 });
    await page.waitForSelector('#panel-create', { state: 'visible', timeout: 5000 });
  } },
  { name: 'first-run', owner: 'unowned', go: async (page) => {
    await at(page, '?first-run=1');
    await page.waitForSelector('#firstrun', { state: 'visible', timeout: 5000 });
  } },
  { name: 'agent-files', owner: 'unowned', go: async (page) => {
    await at(page, '?tab=detail&agent=ada');
    await page.waitForSelector('#d-files-list .pj-doc', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('d-files').scrollIntoView({ block: 'start' }));
  } },
  { name: 'agent-files-all', owner: 'unowned', go: async (page) => {
    await at(page, '?tab=detail&agent=ada');
    await page.waitForSelector('#d-files-all', { state: 'visible', timeout: 8000 });
    await page.click('#d-files-all');
    await page.waitForSelector('#d-filesall-list .pj-doc', { state: 'visible', timeout: 5000 });
  } },
  { name: 'agent-profile', owner: 'unowned', go: async (page) => {
    await at(page, '?tab=detail&agent=ada');
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-profile', { state: 'visible', timeout: 5000 });
  } },
  { name: 'agent-instructions', owner: 'unowned', go: async (page) => {
    await at(page, '?tab=detail&agent=ada');
    await page.locator('#d-nav button[data-go="instr"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-instr', { state: 'visible', timeout: 5000 });
  } },
  // Tasks is Mona Lisa and April's lane: shot and reported on #3559, not fixed here.
  { name: 'tasks', owner: 'Mona Lisa / April', go: async (page) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
  } },
];

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const a = { out: null, screens: null, sizes: DEFAULT_SIZES, themes: THEMES, engines: ENGINES, strict: false, list: false, keep: false, data: 'sample', scale: 'css' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--out') a.out = v();
    else if (k === '--screens') a.screens = v().split(',');
    else if (k === '--sizes') a.sizes = v().split(',');
    else if (k === '--themes') a.themes = v().split(',');
    else if (k === '--engines') a.engines = v().split(',');
    else if (k === '--strict') a.strict = true;
    else if (k === '--list') a.list = true;
    else if (k === '--keep') a.keep = true;
    else if (k === '--data') a.data = v();
    else if (k === '--scale') a.scale = v();
    else throw new Error('unknown argument ' + k);
  }
  for (const s of a.sizes) if (!SIZES[s]) throw new Error('unknown size ' + s + ' (have ' + Object.keys(SIZES).join(', ') + ')');
  for (const t of a.themes) if (!THEMES.includes(t)) throw new Error('unknown theme ' + t);
  for (const e of a.engines) if (!ENGINES.includes(e)) throw new Error('unknown engine ' + e);
  if (!DATA_SETS[a.data]) throw new Error('unknown data set ' + a.data + ' (have ' + Object.keys(DATA_SETS).join(', ') + ')');
  if (!['css', 'device'].includes(a.scale)) throw new Error('unknown scale ' + a.scale + ' (have css, device)');
  if (a.screens) for (const s of a.screens) if (!SCREENS.find((x) => x.name === s)) throw new Error('unknown screen ' + s);
  return a;
}

/* ------------------------------------------------------------------ board */
function freePort() {
  return Number(execFileSync(process.execPath,
    ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());
}

/* Sample agents, as fake tmux panes. Names are invented; none is a real agent.
   A Braille spinner in the title reads as working; a non-Claude command reads as
   stopped; the shared fake screen reads as idle; cleo's ask comes from a
   self-report (engine/status.js). */
const AGENTS = [
  { claim: 'ada', title: '⠋ Drafting the release notes for the spring catalogue', name: 'Ada', role: 'Writer' },
  { claim: 'basil', title: '', name: 'Basil', role: 'Researcher' },
  { claim: 'cleo', title: '', name: 'Cleo', role: 'Project manager' },
  { claim: 'dmitri', title: '⠙ Reviewing a very long pull request title that should wrap or truncate cleanly on a small phone', name: 'Dmitri Alexandrovich-Longname', role: 'Senior reviewer and release coordinator' },
  { claim: 'esme', title: '', name: 'Esme', role: 'Bookkeeper', command: '-zsh' },
];

const LONG_REPLY = 'Here is the plan for tomorrow, in order. First I will finish the product copy for the '
  + 'twelve catalogue pages, then check every price against the spreadsheet you shared, and finally '
  + 'book the photographer for Thursday morning if the studio is free. A very long unbroken word to '
  + 'test wrapping: supercalifragilisticexpialidocious-and-then-some-more-characters-without-spaces.\n\n'
  + 'The script I will run:\n\n```js\nconst prices = await loadSheet(\'catalogue-2026.xlsx\');\n'
  + 'for (const row of prices) { if (row.price !== row.listed) console.log(\'mismatch\', row.sku, row.price, row.listed); }\n```\n\n'
  + 'Tell me if you want the photographer on a different day.';

/* The store set: a tidy fleet for App Store and Play screenshots, which people
   buying the app see. Same claims as the sample, so every screen's `go` works
   unchanged; four agents, each in a state a customer should see (two working,
   one needing you, one idle), nothing stopped and nothing overlong. */
/* Cleo first: the board lists cards in this order, and the agent waiting on
   you is the one the first store shot must show above the fold. */
const STORE_AGENTS = [
  { claim: 'cleo', title: '', name: 'Cleo', role: 'Project manager' },
  { claim: 'ada', title: '⠋ Writing the product copy for the spring catalogue', name: 'Ada', role: 'Writer' },
  { claim: 'basil', title: '⠙ Comparing supplier prices for the linen range', name: 'Basil', role: 'Researcher' },
  { claim: 'dmitri', title: '', name: 'Dmitri', role: 'Bookkeeper' },
];
const DATA_SETS = {
  sample: {
    agents: AGENTS,
    chat: [
      ['you', 'Morning Ada. What is left on the catalogue?'],
      ['ada', 'Morning! Three things, and none of them are blocked.'],
      ['you', 'Can you write it up properly so I can read it on my phone later?'],
      ['ada', LONG_REPLY],
    ],
    ask: 'The printer quoted two prices for the spring catalogue. May I accept the cheaper one (£1,240, five working days) or do you want the faster one (£1,610, two days)?',
    secondProject: { name: 'Quarterly accounts', agents: ['esme'] },
  },
  store: {
    agents: STORE_AGENTS,
    chat: [
      ['you', 'Morning Ada. How is the catalogue copy coming along?'],
      ['ada', 'Pages 1 to 8 are written and checked against the price sheet.'],
      ['you', 'Great. What is left?'],
      ['ada', 'Pages 9 to 12 need the new photos before I can caption them. The shoot is on Thursday, so I will have the full draft to you on Friday morning.'],
      ['you', 'Perfect, thank you.'],
    ],
    ask: 'The printer sent two quotes for the catalogue: $1,240 in five working days, or $1,610 in two. Shall I accept the cheaper one?',
    secondProject: { name: 'Quarterly accounts', agents: ['dmitri'], description: 'Close the quarter and send the accounts to the accountant.' },
    projectDescription: 'Get the spring catalogue written, priced, photographed and to the printer by the 3rd.',
    /* A Mac that is set up, which the empty sandbox is not: each agent gets a
       launch job and its own folder with instructions, and your messages were
       delivered. Without these the shots carry setup warnings no customer with
       a working Mac would see ("will not come back if you restart", "made
       before Kosmos recorded this", "could not deliver"). */
    setUp: true,
    askInProject: true,
    /* Made from the screen, as a person makes a project, so the room does not open on
       "Made by an agent or another program". And Ada's replies already read: the chat
       screen marks them read on the board, so otherwise whichever theme is shot first
       shows an unread count and the other does not. */
    madeOnScreen: true,
    dmRead: true,
    /* The sandbox has no Claude account on purpose (the leak guard insists),
       so the board truthfully says it cannot reach one. A customer's Mac can.
       In the PAGE only, the status answer's `connection` is set to connected;
       every other field is the board's own. */
    connected: true,
  },
};
let DATA = DATA_SETS.sample;   // run() picks the set before the board is seeded

/* Everything that can be written before the board starts, through the engine's
   own writers, so the files are the shapes the real producers make. The data
   roots are set in THIS process first: several engine modules resolve their
   paths once, at require time. */
function seedFiles(roots) {
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  process.env.AGENT_WORKFORCE_WORKERS = roots.WORKERS;
  // All four, not only the two the writers below read today: a module that goes back to
  // capturing LAUNCH or PROJECTS at require time would otherwise write into the real ones.
  process.env.AGENT_WORKFORCE_LAUNCH = roots.LAUNCH;
  process.env.AGENT_WORKFORCE_PROJECTS = roots.PROJECTS;
  const fleet = require(path.join(REPO, 'test-support', 'fleet'));
  const AGENTS = DATA.agents;
  fs.writeFileSync(path.join(roots.DATA, 'fake-panes'), AGENTS.map((a) => fleet.line({
    session: a.claim + '-discord', claim: a.claim, title: a.title, ...(a.command ? { command: a.command } : {}),
  })).join('\n') + '\n');
  fs.writeFileSync(path.join(roots.DATA, 'fake-sessions'), AGENTS.map((a) => a.claim + '-discord').join('\n') + '\n');
  fs.writeFileSync(path.join(roots.DATA, 'fake-screen'), fleet.SCREEN && fleet.SCREEN.idle ? fleet.SCREEN.idle : 'Worked for 1m 02s\n> \n');
  const store = require(path.join(REPO, 'engine', 'store'));
  for (const a of AGENTS) {
    const role = a.claim === 'ada' && LEAK_CONTROL === 'page' ? a.role + ', ' + PLANTED_EMAIL : a.role;
    store.writeProfile(a.claim, { displayName: a.name, role });
  }
  require(path.join(REPO, 'engine', 'firstrun')).complete();
  try { require(path.join(REPO, 'engine', 'tips')).set({ off: true }); } catch { /* tips optional */ }
  const chat = require(path.join(REPO, 'engine', 'chat'));
  const t0 = Date.now() - 3600e3;
  const stamp = (min) => new Date(t0 + min * 60e3).toISOString();
  /* These writers report a failure as { recorded: false, because } rather than throwing;
     a seed that silently did not land would be photographed as if it had. */
  const landed = (r, what) => { if (r && r.recorded === false) throw new Error('the seed could not write ' + what + ': ' + r.because); };
  DATA.chat.forEach(([who, text], i) => {
    const mine = who === 'you' ? (DATA.setUp ? { delivery: { state: 'placed' } } : {}) : { from: who };
    landed(chat.appendMessage(chat.DIRECT, 'ada', { text, at: stamp(i + 1), ...mine }), "Ada's chat");
  });
  if (DATA.setUp) {
    const create = require(path.join(REPO, 'engine', 'create'));
    for (const a of AGENTS) {
      fs.mkdirSync(path.dirname(create.plistPath(a.claim)), { recursive: true });
      // Only what readPlistJob reads is real: the agent CLI at 4, tmux at 5, the model at 7.
      // The other slots are placeholders, not a runnable job.
      fs.writeFileSync(create.plistPath(a.claim), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
        + '<key>Label</key><string>' + create.serviceLabel(a.claim) + '</string>'
        + '<key>ProgramArguments</key><array>' + ['/bin/bash', '-lc', 'start', a.claim, '/usr/local/bin/claude', '/usr/local/bin/tmux', a.claim, 'sonnet']
          .map((x) => '<string>' + x + '</string>').join('') + '</array>'
        + '<key>RunAtLoad</key><true/></dict></plist>\n');
      fs.mkdirSync(create.workerDir(a.claim), { recursive: true });
      fs.writeFileSync(path.join(create.workerDir(a.claim), 'CLAUDE.md'), '# ' + a.name + '\n\nYou are ' + a.name + ', the ' + a.role.toLowerCase() + '.\n');
    }
  }
  /* Ada's Files folder, for the agent-files screens: more rows than the
     agent page shows (AGENT_FILES_SHOWN, 10, so View All appears), one with
     a long name. */
  const adaFiles = require(path.join(REPO, 'engine', 'dmfiles')).filesDir('ada');
  fs.mkdirSync(adaFiles, { recursive: true });
  const fileNames = ['catalogue-copy-pages-1-to-8-final-reviewed-by-cleo.docx', 'prices.xlsx', 'photographer-brief.pdf',
    'notes.md', 'cover.png', 'linen-range.csv', 'spring-2026-print-schedule.pdf', 'draft-2.docx',
    'invoice-0412.pdf', 'studio-quote.pdf', 'page-9-layout.png', 'captions.md'];
  fileNames.forEach((f, i) => {
    fs.writeFileSync(path.join(adaFiles, f), 'x'.repeat(1024 * (i + 1)));
    const t = new Date(t0 + i * 60e3);
    fs.utimesSync(path.join(adaFiles, f), t, t);
  });
  landed(require(path.join(REPO, 'engine', 'selfreport')).record('cleo', {
    state: 'needs_you', because: DATA.ask,
  }), "Cleo's needs-you state");
}

async function waitForBoard(base, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(base + '/'); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function startBoard() {
  const early = Object.keys(require.cache).filter((f) => f.startsWith(path.join(REPO, 'engine') + path.sep));
  if (early.length) throw new Error('an engine module was loaded before the sandbox was set: ' + early[0]);
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-' + k.toLowerCase() + '-'));
  }

  /* Every home and config root the engine reads, sandboxed. HOME covers
     os.homedir(); the named ones cover code that reads them first.
     🛑 Set in THIS process too, BEFORE seedFiles requires any engine module:
     several resolve AGENT_WORKFORCE_HOME once, at require time (#3675). */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-home-'));
  roots.HOME = home;
  if (LEAK_CONTROL === 'account') {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: PLANTED_EMAIL } }));
  }
  const sealed = {
    HOME: home, AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_CONFIG_ROOT: path.join(home, 'config'),
    AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(home, '.claude.json'), AGENT_WORKFORCE_CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    AGENT_WORKFORCE_CLAUDE_SETTINGS: path.join(home, '.claude', 'settings.json'),
    AGENT_WORKFORCE_GEMINI_HOME: path.join(home, '.gemini'), AGENT_WORKFORCE_GROK_HOME: path.join(home, '.grok'),
    /* Not named here: CODEX_HOME, AGENT_WORKFORCE_CODEX_HOME, GEMINI_CLI_HOME, GROK_HOME and
       CLAUDE_CONFIG_DIR. lib-sandbox-home (required at the top) removes them, and naming them
       would put the board in the "operator named a home" mode (#1488), which no user runs; left
       unset they resolve under the sandboxed home above. */
    AGENT_WORKFORCE_SCAN_ROOTS: path.join(home, 'scan'),
    /* The board installs its agent browser (a ~100MB download) on start unless
       it is told it is a sandbox; every other self-booting check sets this. */
    AGENT_WORKFORCE_DRY_RUN: '1', AGENT_WORKFORCE_RUNNERS_DIR: path.join(home, 'runners'),
  };
  /* HOME is sealed in this process too (an engine writer can fall back to os.homedir()), and
     Playwright finds its browsers under the home. Pin its cache to the REAL one first, so the
     launches below do not depend on Playwright having been required before this point. */
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const realHome = os.homedir();
    process.env.PLAYWRIGHT_BROWSERS_PATH = process.platform === 'darwin' ? path.join(realHome, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(realHome, 'AppData', 'Local'), 'ms-playwright')
        : path.join(process.env.XDG_CACHE_HOME || path.join(realHome, '.cache'), 'ms-playwright');
  }
  Object.assign(process.env, sealed);
  const dropRoots = () => { for (const d of Object.values(roots)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } };
  try { seedFiles(roots); } catch (e) { dropRoots(); throw e; }   // a failed seed leaves no sandboxed HOME behind
  let port;
  try { port = freePort(); } catch (e) { dropRoots(); throw e; }
  const base = `http://127.0.0.1:${port}`;
  // Outside DATA, so a board that dies after boot still leaves its stderr to read (printed at the end).
  const stderrLog = path.join(os.tmpdir(), `mobile-shots-board-${process.pid}.log`);
  const stderrFd = fs.openSync(stderrLog, 'w');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, ...sealed, PORT: String(port), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(roots.DATA, 'fake-panes'),
      AGENT_WORKFORCE_FAKE_SESSIONS: path.join(roots.DATA, 'fake-sessions'),
      AGENT_WORKFORCE_FAKE_SCREEN: path.join(roots.DATA, 'fake-screen') },
    stdio: ['ignore', 'ignore', stderrFd],
  });
  fs.closeSync(stderrFd);
  if (!(await waitForBoard(base, 20000))) {
    srv.kill();
    let tail = '';
    try { tail = fs.readFileSync(stderrLog, 'utf8').trim().split('\n').slice(-5).join('\n'); } catch { /* none */ }
    try { fs.rmSync(stderrLog, { force: true }); } catch { /* best effort */ }
    dropRoots();
    throw new Error('the throwaway board did not come up on ' + base + (tail ? '; its stderr ended:\n' + tail : ''));
  }
  return { base, srv, roots, stderrLog };
}

/* After start: a project through the board's own API, then its room posts and
   reactions as message-log lines in the real writer's shape (engine/messages.js
   rowShaped); the agent-side /api/post route needs an agent's token. */
async function seed(base, roots) {
  const post = async (p, body) => {
    /* sec-fetch-site is what a browser sends and what server.js isViaScreen reads to tell
       the person's screen from another program. */
    const headers = { 'content-type': 'application/json', ...(DATA.madeOnScreen ? { 'sec-fetch-site': 'same-origin' } : {}) };
    const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('seed ' + p + ' answered ' + r.status);
    return r.json().catch(() => ({}));
  };
  const made = await post('/api/projects', { name: 'Launch the spring catalogue', agents: ['ada', 'basil', 'cleo'],
    ...(DATA.projectDescription ? { description: DATA.projectDescription } : {}) });
  const pid = made.project && made.project.id;
  if (!pid) throw new Error('seed: the board made no project');
  for (const s2 of ['Draft the product copy for every page', 'Check the prices against the spreadsheet', 'Book the photographer']) {
    await post('/api/project/' + pid + '/tasks', { sentence: s2, who: 'ada' });
  }
  await post('/api/projects', DATA.secondProject);
  const t0 = Date.now() - 1800e3;
  const stamp = (min) => new Date(t0 + min * 60e3).toISOString();
  const lines = [
    { kind: 'post', id: 'm1', project: pid, from: 'cleo', to: [], text: 'Kick-off: the catalogue goes to print on the 3rd. Ada has copy, Basil has research, I have the printer.', at: stamp(1), outcomes: {} },
    { kind: 'post', id: 'm2', project: pid, from: 'basil', to: [], text: 'Competitor prices are in the shared sheet, tab "March". Two of them undercut us on the linen range by about 8%.', at: stamp(4), outcomes: {} },
    { kind: 'post', id: 'm3', project: pid, from: 'ada', to: ['cleo'], text: 'Copy for pages 1-8 is done. Pages 9-12 need the new photos before I can caption them, so I am parked on those until Thursday.', at: stamp(9), outcomes: {} },
    { kind: 'reaction', project: pid, of: 'm3', emoji: '👍', op: 'add', from: 'cleo', at: stamp(10) },
    { kind: 'reaction', project: pid, of: 'm2', emoji: '🔥', op: 'add', from: 'ada', at: stamp(11) },
  ];
  /* The log lives in the store's own root (engine/messages.js: store.ROOT, which is
     DATA/<app>), not at the top of DATA: written there, the room showed no posts at all. */
  const storeRoot = require(path.join(REPO, 'engine', 'store')).ROOT;
  fs.appendFileSync(path.join(storeRoot, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  /* The store set's question names its project, as an agent on a project would, so it
     lights that project rather than counting as a needs-you with no project. */
  if (DATA.dmRead) await post('/api/agent/ada/seen');
  if (DATA.askInProject) {
    const r = require(path.join(REPO, 'engine', 'selfreport')).record('cleo', { state: 'needs_you', because: DATA.ask, project: pid });
    if (r && r.recorded === false) throw new Error('the seed could not write Cleo\'s needs-you state: ' + r.because);
  }
  return { projectId: pid };
}

/* Before ANY screenshot: a sealed board must have no accounts at all. The page
   guard below cannot see a bare key suffix; the accounts list can. */
async function preflight(base) {
  /* An unread list is not an empty one: a refused or unparseable answer stops
     the run exactly as a listed account does. */
  const r = await fetch(base + '/api/accounts');
  const body = r.ok ? await r.json().catch(() => null) : null;
  const rows = body && body.accounts;
  if (!Array.isArray(rows) || rows.length) {
    const err = new Error('LEAK GUARD: the throwaway board lists ' + (Array.isArray(rows) ? rows.length + ' account(s)' : 'accounts it would not show (HTTP ' + r.status + ')')
      + '; a sealed board must list none. No screenshots taken.');
    err.leak = true;
    throw err;
  }
}

/* ------------------------------------------------------------------ leak guard */
/* What must never appear in a shot: see lib-leak-guard.js, which holds the checks. */
/* The two controls tools/browser-checks.sh runs, each of which must exit 3:
   `account` plants a signed-in Claude account in the sandboxed home (the
   preflight must stop it), `page` puts an address in an agent's role (the page
   scan must stop it). The address is invented and not example.com. */
const LEAK_CONTROL = process.env.MSHOTS_LEAK_CONTROL || '';
const PLANTED_EMAIL = 'planted.leak@leak-control.test';
const { hitsIn } = require('./lib-leak-guard.js');
async function leaksOn(page) {
  const text = await page.evaluate(() => {
    if (!document.body) return '';
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll('input, textarea, select')) if (el.value && el.checkVisibility()) parts.push(el.value);
    for (const el of document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')) {
      if (!el.checkVisibility()) continue;
      for (const a of ['title', 'aria-label', 'alt', 'placeholder']) { const v = el.getAttribute(a); if (v) parts.push(v); }
    }
    return parts.join(' ');
  });
  return hitsIn(text);
}
/* ------------------------------------------------------------------ capture */
async function overflowOf(page) {
  return page.evaluate((sels) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.scrollWidth > el.clientWidth + 1) out.push({ sel, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    }
    /* The widest thing sticking out past the viewport, to say WHAT overflows.
       Skipped: anything wholly off screen (a drawer parked with a transform)
       and anything inside a sideways scroller (a chip row), which are laid out
       that way on purpose. Content cut off at the edge still counts. */
    const inScroller = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (/^(auto|scroll)$/.test(getComputedStyle(a).overflowX)) return true;
      }
      return false;
    };
    let worst = null;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.left >= vw || getComputedStyle(el).visibility === 'hidden' || inScroller(el)) continue;
      if (r.right > vw + 1 && (!worst || r.right > worst.right)) {
        worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className || '').slice(0, 60) };
      }
    }
    return { vw, containers: out, worst };
  }, OVERFLOW_SELECTORS);
}

/* The other two #718 phone-ready rules, measured on the whole page (not only
   the part on screen). A tap target is anything a finger presses; under 44 CSS
   px either way is Apple's floor. A checkbox or radio is judged by its label
   when it has one, since that is what the finger lands on. A link inside a
   sentence is exempt (WCAG 2.5.8's inline exception). A typing field under
   16px makes iOS Safari zoom the page on focus. */
const MIN_TAP_PX = 44;
const MIN_FIELD_FONT_PX = 16;
async function fitOf(page) {
  return page.evaluate(({ minTap, minFont }) => {
    const vw = document.documentElement.clientWidth;
    const shown = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const onPage = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw;
    const name = (el) => {
      const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : (el.classList[0] ? '.' + el.classList[0] : '')) + (t ? ' "' + t + '"' : '');
    };
    const inSentence = (el) => {
      if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
      const p = el.parentElement;
      return !!p && (p.textContent || '').trim().length > (el.textContent || '').trim().length + 10;
    };
    const taps = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('button, a[href], select, summary, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"]), textarea')) {
      if (el.disabled || !shown(el) || inSentence(el)) continue;
      let target = el;
      if (el.matches('input[type="checkbox"], input[type="radio"]')) target = el.closest('label') || el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (!onPage(r)) continue;
      if (r.width < minTap - 0.5 || r.height < minTap - 0.5) taps.push(name(target) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    const fields = [];
    for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="color"]), textarea, select, [contenteditable="true"], [contenteditable=""]')) {
      if (el.disabled || !shown(el) || !onPage(el.getBoundingClientRect())) continue;
      const fontPx = parseFloat(getComputedStyle(el).fontSize);
      if (fontPx < minFont - 0.01) fields.push(name(el) + ' ' + fontPx + 'px');
    }
    return { taps, fields };
  }, { minTap: MIN_TAP_PX, minFont: MIN_FIELD_FONT_PX });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) { for (const s of SCREENS) console.log(s.name.padEnd(20) + s.owner); return 0; }
  const { chromium, webkit } = require('playwright');
  const engines = { chromium, webkit };
  const out = args.out || fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-shots-'));
  fs.mkdirSync(out, { recursive: true });
  DATA = DATA_SETS[args.data];
  const screens = args.screens ? SCREENS.filter((s) => args.screens.includes(s.name)) : SCREENS;

  const board = await startBoard();
  const rows = [];
  let overflowCount = 0, errors = 0;
  try {
    const ctxData = await seed(board.base, board.roots);
    await preflight(board.base);
    for (const en of args.engines) {
      const browser = await engines[en].launch();
      try {
        for (const sz of args.sizes) {
          const s = SIZES[sz];
          for (const theme of args.themes) {
            for (const sc of screens) {
              /* A fresh context per screen: the board remembers choices (layout,
                 open sections) in localStorage, and one screen's clicks must not
                 decide what the next screen looks like. */
              const ctx = await browser.newContext({
                viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr,
                // isMobile is Chromium-only in Playwright (WebKit refuses it); both get touch.
                isMobile: en === 'chromium', hasTouch: true, colorScheme: theme,
                // A page.route stub needs the service worker off in WebKit (see allow-card).
                ...(sc.noServiceWorker || DATA.connected ? { serviceWorkers: 'block' } : {}),
              });
              if (DATA.connected) {
                await ctx.route('**/api/status', async (r) => {
                  const res = await r.fetch();
                  const body = await res.json().catch(() => null);
                  if (!body || typeof body !== 'object') return r.fulfill({ response: res });
                  body.connection = { ...(body.connection || {}), state: 'connected' };
                  return r.fulfill({ response: res, json: body });
                });
              }
              await ctx.addInitScript((t) => { try { localStorage.setItem('kosmos-theme', t); } catch { /* no storage */ } }, theme);
              const page = await ctx.newPage();
              const pageErrors = [];
              page.on('pageerror', (e) => pageErrors.push(String(e)));
              const file = `${sc.name}--${sz}--${theme}--${en}.png`;
              let note = '';
              let fit = { taps: [], fields: [] };
              try {
                await page.goto(board.base + '/', { waitUntil: 'load' });
                await page.waitForTimeout(900);
                if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
                await sc.go(page, ctxData);
                await page.waitForTimeout(250);
                const leaks = await leaksOn(page);
                if (leaks.length) {
                  const err = new Error('LEAK GUARD: this screen shows real data (' + leaks.length + ' hits, e.g. '
                    + leaks[0] + '). Stopping with no further shots.');
                  err.leak = true;
                  throw err;
                }
                await page.screenshot({ path: path.join(out, file), scale: args.scale });
                /* The page re-renders on its tick, so the scan above and the shot are two reads:
                   scan again, and a hit painted in between deletes the shot before anything
                   else can pick it up. */
                const late = await leaksOn(page);
                if (late.length) {
                  try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                  const err = new Error('LEAK GUARD: this screen shows real data (' + late.length + ' hits after the shot, e.g. '
                    + late[0] + '). Its shot is deleted. Stopping with no further shots.');
                  err.leak = true;
                  throw err;
                }
                const ov = await overflowOf(page);
                if (ov.containers.length || ov.worst) {
                  overflowCount++;
                  note = 'OVERFLOW ' + ov.containers.map((c) => `${c.sel} ${c.scrollWidth}>${c.clientWidth}`).join(', ')
                    + (ov.worst ? ` widest: ${ov.worst.tag}${ov.worst.id ? '#' + ov.worst.id : ''}${ov.worst.cls ? '.' + ov.worst.cls.split(' ')[0] : ''} to ${ov.worst.right}px of ${ov.vw}` : '');
                }
                fit = await fitOf(page);
              } catch (e) {
                if (e.leak) { await ctx.close(); throw e; }
                errors++;
                note = 'ERROR ' + String(e.message || e).split('\n')[0];
              }
              if (pageErrors.length) note += (note ? '; ' : '') + 'page error: ' + pageErrors.splice(0).join(' | ').slice(0, 200);
              /* report.json and report.md travel with the shots: everything this row carries (the
                 tap-target names, overflow and ERROR notes, page errors) passes the same checks,
                 once the note is complete. */
              const inReport = hitsIn(JSON.stringify(fit) + ' ' + note);
              if (inReport.length) {
                try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                await ctx.close();
                const err = new Error('LEAK GUARD: this screen\'s report would carry real data (' + inReport.length + ' hits, e.g. '
                  + inReport[0] + '). Its shot is deleted. Stopping with no further shots.');
                err.leak = true;
                throw err;
              }
              rows.push({ file, screen: sc.name, owner: sc.owner, size: sz, theme, engine: en, note, taps: fit.taps, fields: fit.fields });
              console.log((note ? 'FLAG  ' : 'ok    ') + file + (note ? '  ' + note : '')
                + `  taps<${MIN_TAP_PX}: ${fit.taps.length}  fields<${MIN_FIELD_FONT_PX}px: ${fit.fields.length}`);
              await ctx.close();
            }
          }
        }
      } finally { await browser.close(); }
    }
    if (args.keep) {
      console.log(`\n--keep: the throwaway board stays up at ${board.base} (data in ${board.roots.DATA}); Ctrl-C to stop.`);
      await new Promise((r) => { process.once('SIGINT', r); process.once('SIGTERM', r); });
    }
  } finally {
    const died = board.srv.exitCode !== null || board.srv.signalCode !== null;   // the board went away on its own (exit or signal)
    board.srv.kill();
    for (const d of Object.values(board.roots)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
    if (died || errors) {
      try {
        const tail = fs.readFileSync(board.stderrLog, 'utf8').trim().split('\n').slice(-10).join('\n');
        if (tail) console.log('\nthe throwaway board\'s stderr ended:\n' + tail);
      } catch { /* none */ }
    }
    try { fs.rmSync(board.stderrLog, { force: true }); } catch { /* best effort */ }
  }

  const md = ['# Mobile screenshots', '',
    `Throwaway board with the ${args.data} data set. WebKit is an engine approximation of iOS Safari, not Safari; Chromium at a phone size is not an Android phone.`, '',
    `Shots: ${rows.length}. Flagged: ${rows.filter((r) => r.note).length} (overflow ${overflowCount}, errors ${errors}).`, '',
    `| screen | owner | size | theme | engine | file | flag | taps<${MIN_TAP_PX} | fields<${MIN_FIELD_FONT_PX}px |`, '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.screen} | ${r.owner} | ${SIZES[r.size].label} ${SIZES[r.size].width}x${SIZES[r.size].height} | ${r.theme} | ${r.engine} | ${r.file} | ${r.note.replace(/\|/g, '/')} | ${r.taps.length} | ${r.fields.length} |`)];
  fs.writeFileSync(path.join(out, 'report.md'), md.join('\n') + '\n');
  // Every small target and field by name, for whoever fixes the screen.
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rows, null, 1) + '\n');
  console.log(`\n${rows.length} shots, ${overflowCount} with overflow, ${errors} errors -> ${out}`);
  /* tools/browser-checks.sh quotes a red's reason from lines starting FAIL. */
  if (errors) { console.error(`FAIL  mobile-shots: ${errors} shot(s) could not be taken; see the ERROR lines above`); return 2; }
  if (args.strict && overflowCount) { console.error(`FAIL  mobile-shots: ${overflowCount} shot(s) overflow sideways; see the FLAG lines above`); return 1; }
  return 0;
}

if (require.main === module) {
  run().then((code) => process.exit(code), (e) => {
    console.error('FAIL  mobile-shots: ' + (e.leak ? e.message : (e.stack || e)));
    process.exit(e.leak ? 3 : 2);
  });
}

