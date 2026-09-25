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
 *
 * Output: DIR/<screen>--<size>--<theme>--<engine>.png plus DIR/report.md (every
 * shot, and every overflow found). Default DIR is a new temp folder, printed at
 * the end. --strict exits 1 when anything overflows. --list prints the screens.
 * --keep leaves the throwaway board running afterwards (address printed) so you
 * can explore it by hand; Ctrl-C stops it and deletes its data.
 *
 * 🛑 NEVER THE LIVE BOARD, AND NEVER THIS MAC'S ACCOUNTS. The board below is
 * started here, on a free port, with every data root in a temp dir and a fake
 * tmux. Its HOME and every home/config root the engine reads are temp dirs too:
 * the accounts modules read `AGENT_WORKFORCE_HOME || os.homedir()`, so a board
 * sandboxed on data roots alone still lists this Mac's real Claude emails and an
 * OpenAI key suffix in Settings (found and measured by Sonya, #718). Before every
 * screenshot a LEAK GUARD reads the page and stops the whole run, writing nothing
 * more, if it finds an email outside example.com, an `sk-` key fragment, or this
 * Mac's home path, user name or host name (exit 3). Screenshots end up on
 * GitHub; a real account must not. THIS IS THE ONLY SANCTIONED WAY TO TAKE
 * SCREENSHOTS FOR A PR OR #718: other checks here do not set these roots.
 *
 * ⚠️ WEBKIT IS NOT SAFARI. Playwright's WebKit is an engine approximation of
 * iOS Safari / WKWebView, not the real thing (no iOS simulator on this Mac yet),
 * and Chromium with a phone viewport is not an Android phone. Say so in reports.
 *
 * ADDING YOUR SCREENS: append to SCREENS below. Each entry is
 *   { name, owner, go: async (page, data) => { ...navigate to the screen... } }
 * `go` starts on a freshly loaded board at the phone size and theme (data has
 * `projectId`); leave the page showing the screen. Keep names short and unique
 * (they are file names). Sample data: 5 agents (working, idle, needs you,
 * stopped; one very long name and task), Ada's DM with a long reply and a code
 * block, a project room with posts and reactions, Cleo's pending ask.
 */
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
};
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
  await page.waitForTimeout(300);
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
  { name: 'nav-menu', owner: 'Raiden', go: async (page) => { if (await page.isVisible('#burger')) await page.click('#burger'); } },
  { name: 'agents-list', owner: 'Raiden', go: async (page) => {
    const b = page.locator('[aria-label="List"], [data-layout="list"], button[title="List"]').first();
    if (await b.count()) await b.click();
  } },
  { name: 'agent-page', owner: 'Raiden', go: async (page) => at(page, '?agent=ada') },
  // Scorpion: an agent's chat.
  { name: 'agent-chat', owner: 'Scorpion', go: async (page) => {
    await at(page, '?agent=ada');
    const t = page.locator('#d-nav button[data-go="talk"]');
    if (await t.count()) await t.first().click();
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
    await page.evaluate(() => { const c = document.querySelector('.acard[data-agent="cleo"]'); if (c) c.scrollIntoView({ block: 'start' }); });
  } },
  // Sonya: settings.
  { name: 'settings', owner: 'Sonya', go: async (page) => at(page, '?tab=settings') },
  { name: 'settings-accounts', owner: 'Sonya', go: async (page) => at(page, '?tab=settings&sec=accounts') },
];

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const a = { out: null, screens: null, sizes: Object.keys(SIZES), themes: THEMES, engines: ENGINES, strict: false, list: false, keep: false };
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
    else throw new Error('unknown argument ' + k);
  }
  for (const s of a.sizes) if (!SIZES[s]) throw new Error('unknown size ' + s + ' (have ' + Object.keys(SIZES).join(', ') + ')');
  for (const t of a.themes) if (!THEMES.includes(t)) throw new Error('unknown theme ' + t);
  for (const e of a.engines) if (!ENGINES.includes(e)) throw new Error('unknown engine ' + e);
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

/* Everything that can be written before the board starts, through the engine's
   own writers, so the files are the shapes the real producers make. The data
   roots are set in THIS process first: several engine modules resolve their
   paths once, at require time. */
function seedFiles(roots) {
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  process.env.AGENT_WORKFORCE_WORKERS = roots.WORKERS;
  const fleet = require(path.join(REPO, 'test-support', 'fleet'));
  fs.writeFileSync(path.join(roots.DATA, 'fake-panes'), AGENTS.map((a) => fleet.line({
    session: a.claim + '-discord', claim: a.claim, title: a.title, ...(a.command ? { command: a.command } : {}),
  })).join('\n') + '\n');
  fs.writeFileSync(path.join(roots.DATA, 'fake-sessions'), AGENTS.map((a) => a.claim + '-discord').join('\n') + '\n');
  fs.writeFileSync(path.join(roots.DATA, 'fake-screen'), fleet.SCREEN && fleet.SCREEN.idle ? fleet.SCREEN.idle : 'Worked for 1m 02s\n> \n');
  const store = require(path.join(REPO, 'engine', 'store'));
  for (const a of AGENTS) store.writeProfile(a.claim, { displayName: a.name, role: a.role });
  require(path.join(REPO, 'engine', 'firstrun')).complete();
  try { require(path.join(REPO, 'engine', 'tips')).set({ off: true }); } catch { /* tips optional */ }
  const chat = require(path.join(REPO, 'engine', 'chat'));
  const t0 = Date.now() - 3600e3;
  const at = (min) => new Date(t0 + min * 60e3).toISOString();
  chat.appendMessage(chat.DIRECT, 'ada', { text: 'Morning Ada. What is left on the catalogue?', at: at(1) });
  chat.appendMessage(chat.DIRECT, 'ada', { text: 'Morning! Three things, and none of them are blocked.', at: at(2), from: 'ada' });
  chat.appendMessage(chat.DIRECT, 'ada', { text: 'Can you write it up properly so I can read it on my phone later?', at: at(3) });
  chat.appendMessage(chat.DIRECT, 'ada', { text: LONG_REPLY, at: at(4), from: 'ada' });
  require(path.join(REPO, 'engine', 'selfreport')).record('cleo', {
    state: 'needs_you', because: 'The printer quoted two prices for the spring catalogue. May I accept the cheaper one (£1,240, five working days) or do you want the faster one (£1,610, two days)?',
  });
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
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-' + k.toLowerCase() + '-'));
  }

  /* Every home and config root the engine reads, sandboxed. HOME covers
     os.homedir(); the named ones cover code that reads them first. The control
     switch leaves them unset, ONLY so the leak guard can be shown to fire.
     🛑 Set in THIS process too, BEFORE seedFiles requires any engine module:
     several resolve AGENT_WORKFORCE_HOME once, at require time (#3675). */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-home-'));
  roots.HOME = home;
  const sealed = process.env.MSHOTS_UNSEAL_FOR_CONTROL === '1' ? {} : {
    HOME: home, AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_CONFIG_ROOT: path.join(home, 'config'),
    AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(home, '.claude.json'), AGENT_WORKFORCE_CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), AGENT_WORKFORCE_CLAUDE_SETTINGS: path.join(home, '.claude', 'settings.json'),
    AGENT_WORKFORCE_CODEX_HOME: path.join(home, '.codex'), CODEX_HOME: path.join(home, '.codex'),
    AGENT_WORKFORCE_GEMINI_HOME: path.join(home, '.gemini'), GEMINI_CLI_HOME: home,
    AGENT_WORKFORCE_GROK_HOME: path.join(home, '.grok'), GROK_HOME: path.join(home, '.grok'),
    AGENT_WORKFORCE_SCAN_ROOTS: path.join(home, 'scan'),
  };
  const early = Object.keys(require.cache).filter((f) => f.startsWith(path.join(REPO, 'engine') + path.sep));
  if (early.length) throw new Error('an engine module was loaded before the sandbox was set: ' + early[0]);
  Object.assign(process.env, sealed);
  seedFiles(roots);
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, ...sealed, PORT: String(port), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(roots.DATA, 'fake-panes'),
      AGENT_WORKFORCE_FAKE_SESSIONS: path.join(roots.DATA, 'fake-sessions'),
      AGENT_WORKFORCE_FAKE_SCREEN: path.join(roots.DATA, 'fake-screen') },
    stdio: 'ignore',
  });
  if (!(await waitForBoard(base, 20000))) { srv.kill(); throw new Error('the throwaway board did not come up on ' + base); }
  return { base, srv, roots };
}

/* After start: a project through the board's own API, then its room posts and
   reactions as message-log lines in the real writer's shape (engine/messages.js
   rowShaped); the agent-side /api/post route needs an agent's token. */
async function seed(base, roots) {
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('seed ' + p + ' answered ' + r.status);
    return r.json().catch(() => ({}));
  };
  const made = await post('/api/projects', { name: 'Launch the spring catalogue', agents: ['ada', 'basil', 'cleo'] });
  const pid = made.project && made.project.id;
  if (!pid) throw new Error('seed: the board made no project');
  for (const s2 of ['Draft the product copy for every page', 'Check the prices against the spreadsheet', 'Book the photographer']) {
    await post('/api/project/' + pid + '/tasks', { sentence: s2, who: 'ada' });
  }
  await post('/api/projects', { name: 'Quarterly accounts', agents: ['esme'] });
  const t0 = Date.now() - 1800e3;
  const at = (min) => new Date(t0 + min * 60e3).toISOString();
  const lines = [
    { kind: 'post', id: 'm1', project: pid, from: 'cleo', to: [], text: 'Kick-off: the catalogue goes to print on the 3rd. Ada has copy, Basil has research, I have the printer.', at: at(1), outcomes: {} },
    { kind: 'post', id: 'm2', project: pid, from: 'basil', to: [], text: 'Competitor prices are in the shared sheet, tab "March". Two of them undercut us on the linen range by about 8%.', at: at(4), outcomes: {} },
    { kind: 'post', id: 'm3', project: pid, from: 'ada', to: ['cleo'], text: 'Copy for pages 1-8 is done. Pages 9-12 need the new photos before I can caption them, so I am parked on those until Thursday.', at: at(9), outcomes: {} },
    { kind: 'reaction', project: pid, of: 'm3', emoji: '👍', op: 'add', from: 'cleo', at: at(10) },
    { kind: 'reaction', project: pid, of: 'm2', emoji: '🔥', op: 'add', from: 'ada', at: at(11) },
  ];
  fs.appendFileSync(path.join(roots.DATA, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { projectId: pid };
}

/* Before ANY screenshot: a sealed board must have no accounts at all. The page
   guard below cannot see a bare key suffix; the accounts list can. */
async function preflight(base) {
  const r = await fetch(base + '/api/accounts');
  const body = await r.json().catch(() => null);
  const rows = Array.isArray(body) ? body : (body && (body.accounts || body.rows || body.list)) || [];
  if (!Array.isArray(rows) || rows.length) {
    const err = new Error('LEAK GUARD: the throwaway board lists ' + (Array.isArray(rows) ? rows.length : 'unreadable')
      + ' account(s); a sealed board must list none. No screenshots taken.');
    err.leak = true;
    throw err;
  }
}

/* ------------------------------------------------------------------ leak guard */
/* What must never appear in a shot: a real email (anything not example.com),
   an `sk-` style key fragment, this Mac's home path, user name or host name.
   Returns the offending strings. */
const REAL_HOME = os.homedir();
const REAL_USER = os.userInfo().username;
const REAL_HOST = os.hostname().replace(/\.local$/, '');
/* Email-shaped strings that ship verbatim in web/index.html (a placeholder such
   as josh@you.com, a pattern fragment) are the same product text for everyone,
   so they cannot leak anything; only data the board injects is judged. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEY_RE = /\bsk-[A-Za-z0-9_-]{2,}/g;
const SHIPPED_HTML = fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8');
const SHIPPED_EMAILS = new Set(SHIPPED_HTML.match(EMAIL_RE) || []);
/* e.g. the `sk-ant-` placeholder on the API key field. A real key matches a
   LONGER string (sk-ant-api03-...), which is not in this set, so it is still caught. */
const SHIPPED_KEYS = new Set(SHIPPED_HTML.match(KEY_RE) || []);
async function leaksOn(page) {
  const text = await page.evaluate(() => document.body ? document.body.innerText + ' ' + document.documentElement.outerHTML : '');
  const hits = new Set();
  for (const m of text.match(EMAIL_RE) || []) {
    if (!/@example\.(com|org|net)$/i.test(m) && !SHIPPED_EMAILS.has(m)) hits.add(m);
  }
  if (REAL_HOME.length > 1 && text.includes(REAL_HOME)) hits.add(REAL_HOME);
  if (REAL_USER && REAL_USER.length > 2 && new RegExp('\\b' + REAL_USER + '\\b').test(text)) hits.add('user:' + REAL_USER);
  if (REAL_HOST && REAL_HOST.length > 2 && text.includes(REAL_HOST)) hits.add('host:' + REAL_HOST);
  for (const m of text.match(KEY_RE) || []) if (!SHIPPED_KEYS.has(m)) hits.add(m.slice(0, 6) + '***');
  return [...hits];
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
    // The widest thing sticking out past the viewport, to say WHAT overflows.
    let worst = null;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > vw + 1 && (!worst || r.right > worst.right)) {
        worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className || '').slice(0, 60) };
      }
    }
    return { vw, containers: out, worst };
  }, OVERFLOW_SELECTORS);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) { for (const s of SCREENS) console.log(s.name.padEnd(20) + s.owner); return 0; }
  const { chromium, webkit } = require('playwright');
  const engines = { chromium, webkit };
  const out = args.out || fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-shots-'));
  fs.mkdirSync(out, { recursive: true });
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
                isMobile: en === 'chromium', hasTouch: true, colorScheme: theme,
              });
              await ctx.addInitScript((t) => { try { localStorage.setItem('kosmos-theme', t); } catch { /* no storage */ } }, theme);
              const page = await ctx.newPage();
              const pageErrors = [];
              page.on('pageerror', (e) => pageErrors.push(String(e)));
              const file = `${sc.name}--${sz}--${theme}--${en}.png`;
              let note = '';
              try {
                await page.goto(board.base + '/', { waitUntil: 'load' });
                await page.waitForTimeout(900);
                if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
                await sc.go(page, ctxData);
                await page.waitForTimeout(250);
                const leaks = await leaksOn(page);
                if (leaks.length) {
                  const err = new Error('LEAK GUARD: this screen shows real data (' + leaks.length + ' hits, e.g. '
                    + leaks[0].replace(/^(.).*(@.*)$/, '$1***$2') + '). Stopping with no further shots.');
                  err.leak = true;
                  throw err;
                }
                await page.screenshot({ path: path.join(out, file), scale: 'css' });
                const ov = await overflowOf(page);
                if (ov.containers.length || ov.worst) {
                  overflowCount++;
                  note = 'OVERFLOW ' + ov.containers.map((c) => `${c.sel} ${c.scrollWidth}>${c.clientWidth}`).join(', ')
                    + (ov.worst ? ` widest: ${ov.worst.tag}${ov.worst.id ? '#' + ov.worst.id : ''}${ov.worst.cls ? '.' + ov.worst.cls.split(' ')[0] : ''} to ${ov.worst.right}px of ${ov.vw}` : '');
                }
              } catch (e) {
                if (e.leak) { await ctx.close(); throw e; }
                errors++;
                note = 'ERROR ' + String(e.message || e).split('\n')[0];
              }
              if (pageErrors.length) note += (note ? '; ' : '') + 'page error: ' + pageErrors.splice(0).join(' | ').slice(0, 200);
              rows.push({ file, screen: sc.name, owner: sc.owner, size: sz, theme, engine: en, note });
              console.log((note ? 'FLAG  ' : 'ok    ') + file + (note ? '  ' + note : ''));
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
    board.srv.kill();
    for (const d of Object.values(board.roots)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  const md = ['# Mobile screenshots', '',
    'Throwaway board with sample data. WebKit is an engine approximation of iOS Safari, not Safari; Chromium at a phone size is not an Android phone.', '',
    `Shots: ${rows.length}. Flagged: ${rows.filter((r) => r.note).length} (overflow ${overflowCount}, errors ${errors}).`, '',
    '| screen | owner | size | theme | engine | file | flag |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.screen} | ${r.owner} | ${SIZES[r.size].label} ${SIZES[r.size].width}x${SIZES[r.size].height} | ${r.theme} | ${r.engine} | ${r.file} | ${r.note.replace(/\|/g, '/')} |`)];
  fs.writeFileSync(path.join(out, 'report.md'), md.join('\n') + '\n');
  console.log(`\n${rows.length} shots, ${overflowCount} with overflow, ${errors} errors -> ${out}`);
  if (errors) return 2;
  return args.strict && overflowCount ? 1 : 0;
}

if (require.main === module) {
  run().then((code) => process.exit(code), (e) => {
    console.error('mobile-shots: ' + (e.leak ? e.message : (e.stack || e)));
    process.exit(e.leak ? 3 : 2);
  });
}

