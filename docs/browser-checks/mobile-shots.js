'use strict';
/* #718: phone screenshots of the board, for everyone working on the mobile apps.
 *
 * Both native apps are shells around the board's web UI, so "does it fit on a
 * phone" is a question about web/index.html at phone sizes. This boots a
 * THROWAWAY board with seeded sample data, drives it to named screens, and
 * shoots every screen at four phone sizes by default, in light and dark, in
 * Chromium and WebKit. --sizes replaces that list and also accepts `desktop`
 * (1280x800). It flags horizontal overflow on the way.
 *
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules \
 *     node docs/browser-checks/mobile-shots.js [--out DIR] [--screens a,b]
 *       [--sizes se,iphone15,promax,android,android360,desktop] [--themes light,dark]
 *       [--engines chromium,webkit] [--strict] [--list] [--keep]
 *       [--data sample|store|marketing] [--faces DIR] [--scale css|device] [--remote]
 *
 * Output: DIR/<screen>--<size>--<theme>--<engine>.png plus DIR/report.md (every
 * shot, and every overflow found). Default DIR is a new temp folder, printed at
 * the end. --strict exits 1 when anything overflows. --list prints the screens.
 * --keep leaves the throwaway board running afterwards (address printed) so you
 * can explore it by hand; Ctrl-C stops it and deletes its data.
 * --remote opens the board as the phone apps do, over Kosmos+ (kosmos#5510): at an address that is not this
 * computer's, so the board takes its remote phone layout (html.kremote: the Kosmos+ bar and its menu, agents
 * as a list of cards). The Android app ALWAYS shows that layout (it opens <computer>.kosmosplus.com), so
 * shots of the Android app need --remote; without it you get the board as it looks at the computer itself.
 * The address is a made-up host served from the throwaway board through the browser's own router, so nothing
 * leaves this computer. Two differences from a real phone, neither shown by any screen today: a board redirect is
 * followed by the router (the page never sees the 3xx), and the made-up http host is not a secure context, so no
 * service worker registers.
 * --app-tabs (kosmos#6846) is --remote as the iPhone app with its native tab bar shows the board: the app adds the class
 * `kapptabs` to the page at document start, so the bar is the app's own header (no Kosmos+ mark, no two lines, the
 * computer switcher and the person's face). The app-* screens are meant for it.
 * --data marketing (#5782) is the store fleet with a shape, for installkosmos.com's product shots: Cleo leads and the
 * others report to her (the org chart draws a team), the person is a made-up "Sam Rivera" (the hub shows an initial),
 * and the tasks are spread across the team, each agent reporting what it is on. --faces DIR seeds pictures from a
 * folder of <claim>.jpg|png|webp|gif (the four with licensed faces: cleo, dana, eli, farah; the others keep their
 * initial) and you.<ext>, through the engine's own picture writers.
 * 🛑 The leak guard reads page TEXT, not images: --faces must only ever hold made-up or licensed faces (the site's own
 * meet/faces), never a photo of a real person from this Mac. desktop2x is 1280x800 always saved at 2x.
 * --data store seeds a clean fleet for App Store and Play screenshots instead
 * of the stress-test sample (no stopped agent, no overlong names, no code
 * block); --scale device saves at the device's pixels, not CSS pixels. The
 * App Store size is `appstore` (440x956 at 3x, which is 1320x2868): it is not in
 * the default sweep. The iOS store set now comes from the app itself (ios/store/shoot-app.sh, #6262), which
 * boots this board with --keep --data store --remote and opens it in the iOS simulator.
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
 * plus `noServiceWorker: true` if `go` stubs a request with page.route, and
 * `phoneOnly: true` if the screen exists only at a phone width (the desktop size and tablets over 56rem skip it), and
 * `desktopOnly: true` if it exists only at a desktop width (the phone sizes and tablets under 960px skip it; the consolidated
 * view, for one, starts at 960px).
 * One board serves every screen of a run, so a `go` that writes to the board's server store (a PUT, a
 * saved setting) must undo it in `after` (settings-recommender does, #4545), or it changes every screen
 * shot after it; the consolidated screens stub the READ instead (kosmos#4594).
 * `after: async (page, data) => {}` runs after the shot, whatever happened, to put back what `go` changed.
 * `verify: async (page, data) => {}` runs right after the shot to check it is the screen meant: a throw
 * DELETES the shot and makes the row an ERROR (consAgentsStill), so a wrong picture never reaches a review.
 * `go` starts on a freshly loaded board at the size and theme (data has
 * `projectId`, and `chatAgent` / `askAgent`: use those, never a literal agent id,
 * so the screen works under --data store too); leave the page showing the screen. Keep names short and unique
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
// #6205: bound every browser/context close so a dead engine fails the run in seconds instead of hanging it.
const { closeContextBounded, closeBrowserBounded, childPidsOf, withTimeout, CTX_CLOSE_MS } = require('./lib-bounded-close.js');
/* kosmos#6543: a fresh engine after this many screens. WebKit (playwright 1.62.1, webkit build 2336, on a Mac) stops
   navigating in the 64th context of one browser: that goto never sends a request (none open, none sent) and times
   out on 'load', and the close after it wedges (the #6205 hang). Measured on a two-line static page with no Kosmos in
   it (63 loads, then a timeout on every one); Chromium loaded 72 of 72 the same way. A full run opens about 70 webkit
   contexts per size, so the same screens failed every run (first-run-model and agent-files at se, light). Every engine
   is relaunched, not only webkit: one rule is simpler, and a relaunch costs about a second. Well under 63, so a
   screen that opens a page or two of its own cannot reach the limit. */
const CONTEXTS_PER_ENGINE = 40;

const REPO = path.resolve(__dirname, '..', '..');

/* The four phone sizes from the #718 plan, the App Store size, and a desktop size. `dpr` is the
   device's pixel ratio; by default shots are saved at CSS pixels so files stay
   small and every size compares one to one (--scale device for store images). */
const SIZES = {
  se: { width: 375, height: 667, dpr: 2, label: 'iPhone SE' },
  iphone15: { width: 393, height: 852, dpr: 3, label: 'iPhone 15' },
  promax: { width: 430, height: 932, dpr: 3, label: 'iPhone Pro Max' },
  android: { width: 412, height: 915, dpr: 2.625, label: 'mid Android' },
  // A narrow Android phone (360 CSS px wide, the common small-Android width): the tightest width the Android app is opened at.
  android360: { width: 360, height: 800, dpr: 3, label: 'narrow Android' },
  // The 6.9-inch iPhone screenshot App Store Connect requires: 1320x2868 at --scale device.
  appstore: { width: 440, height: 956, dpr: 3, label: 'App Store 6.9-inch' },
  /* #6107: tablets, touch and not desktop, so the tap and field audits run. Not in the default sweep.
     tab8 is a small Android tablet (about 600 wide), the size that got the phone layout widened before #6107. */
  tab8: { width: 600, height: 960, dpr: 2, label: 'small Android tablet', tablet: true },
  tab8land: { width: 960, height: 600, dpr: 2, label: 'small Android tablet, landscape', tablet: true },
  ipadmini: { width: 744, height: 1133, dpr: 2, label: 'iPad mini', tablet: true },
  ipadminiland: { width: 1133, height: 744, dpr: 2, label: 'iPad mini, landscape', tablet: true },
  ipad11: { width: 834, height: 1194, dpr: 2, label: 'iPad Pro 11-inch', tablet: true },
  ipad11land: { width: 1194, height: 834, dpr: 2, label: 'iPad Pro 11-inch, landscape', tablet: true },
  ipad13: { width: 1024, height: 1366, dpr: 2, label: 'iPad Pro 13-inch', tablet: true },
  /* The landscape sizes (tab8land, ipadminiland, ipad11land) are touch screens held sideways at 960px+, so the board
     opens there on the one-screen view (#6107), as a real tablet does: a screen whose go waits on the tabbed
     Agents tab panel times out at those sizes unless MSHOTS_TABLET_LAYOUT=tabs is set (#boardbar shows in both layouts). They are opt-in, not in the sweep. */
  // claude-setup#100 (/design-shots): a computer screen, so one sanctioned run shoots a change at
  // desktop and phone. No touch and no mobile viewport, and the tap and field-font audits (phone
  // rules) are skipped for it. Not in the default sweep.
  desktop: { width: 1280, height: 800, dpr: 1, label: 'desktop', desktop: true },
  /* #5782: the same desktop at 2x, for marketing composites that are shown larger than 1280. Not in the default sweep. */
  desktop2x: { width: 1280, height: 800, dpr: 2, label: 'desktop at 2x', desktop: true, scale: 'device' },   // always saved at 2x (2560x1600), whatever --scale says
};
/* --remote's address (kosmos#5510): .test is reserved and never resolves, so a slip can only fail, never reach a real host. */
const REMOTE_BASE = 'http://kosmos-shots.kosmosplus.test';
/* Set once the board is up. Every stub below fetches through fetchBoard and passes requests on with fallback(), never
   route.fetch() or continue() bare: under --remote those would go to the made-up host, which does not exist (a page's
   own routes run before the context's proxy). fallback() hands the request to the proxy; without --remote it is the
   same as continue(). The Origin is the board's own, since the board refuses a write from any other site. */
const REMOTE = { on: false, board: '' };
const boardUrl = (u) => (REMOTE.on && u.startsWith(REMOTE_BASE) ? REMOTE.board + u.slice(REMOTE_BASE.length) : u);
function fetchBoard(route) {
  if (!REMOTE.on) return route.fetch();
  const headers = { ...route.request().headers() };
  if (headers.origin) headers.origin = REMOTE.board;
  if (headers.referer) headers.referer = boardUrl(headers.referer);
  return route.fetch({ url: boardUrl(route.request().url()), headers });
}
const DEFAULT_SIZES = ['se', 'iphone15', 'promax', 'android'];
/* Why a screen is not shot at a size, or '' when it is. A tablet (#6107) is a touch size like a phone, but a
   phone-only screen (the #burger menu, shown up to 56rem and hidden above) does not exist on a wider tablet; tab8,
   the iPad mini and the 11-inch iPad upright (600, 744, 834px) all still show it. The 896 below is that 56rem by
   value: today the only phoneOnly screen (nav-menu) keys on it. A desktop-only screen is skipped at phone sizes and
   at tablets under 960px: from 960px a tablet can show the one-screen view (and the desktop-only screens force it,
   openConsAgents), so it shoots those too, upright or sideways. */
const sizeSkipWhy = (s, sc) => (sc.phoneOnly && (s.desktop || (s.tablet && s.width > 896)) ? 'phone-only screen' : (sc.desktopOnly && !s.desktop && !(s.tablet && s.width >= 960) ? 'desktop-only screen' : ''));
/* #6542: `needsData: '<set>'` on a screen whose subject only exists in that data set (tasks-decision needs a question
   row, which only --data marketing has). Skipped, and listed as skipped with the reason, in any other run, rather than
   timing out as an ERROR in every full sweep. */
/* kosmos#6846: `needsAppTabs: true` on a screen of the iPhone app's own header (it exists only with --app-tabs), and
   `notInApp: true` on one that cannot exist there (the two lines' menu: the app hides them). Either is listed as
   skipped rather than timing out. */
const skipWhy = (s, sc, data, appTabs) => sizeSkipWhy(s, sc) || (sc.needsData && (data || 'sample') !== sc.needsData ? 'screen that needs --data ' + sc.needsData : '')
  || (sc.needsAppTabs && !appTabs ? 'screen that needs --app-tabs' : '') || (sc.notInApp && appTabs ? 'screen the app does not have (--app-tabs)' : '');
const THEMES = ['light', 'dark'];
const ENGINES = ['chromium', 'webkit'];

/* Containers whose own horizontal overflow is flagged, besides the page itself.
   Missing selectors are skipped. Extend this list for your screen's scroller. */
const OVERFLOW_SELECTORS = ['html', 'body', 'main', '.view', '.panel', '[role="main"]'];

/* ------------------------------------------------------------------ screens */
/* The shared helpers the screens use. */
/* On a phone the areas sit behind the ☰ (#burger, controls #tabs): open it
   first when it is showing, then choose the area. */
/* kosmos#6895: make a throwaway project with the chat agent and the ask agent on it, give the chat agent two tasks, then
   take the chat agent off it (its tasks stay with it). Answers the project's id. offProject6895Gone deletes it. */
const OFFPROJECT_6895 = 'Plan the autumn launch';
const ROLLUP_6501 = 'Autumn brochure';   // kosmos#6501: the task-rollup-6501 screen's throwaway project
const HOLDUNTIL_7184 = { task: 'Supplier order', at: 'Courier booking' };   // kosmos#7184: each hold screen's own throwaway project (#7185: a reused name inherits the last one's task activity)
async function offProject6895(page, data) {
  return page.evaluate(async ([name, chat, ask]) => {
    const call = (m, url, body) => fetch(url, { method: m, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const made = await (await call('POST', '/api/projects', { name, agents: [chat, ask] })).json().catch(() => ({}));
    const id = made && made.project && made.project.id;
    if (!id) throw new Error('offProject6895: the board made no project');
    for (const sentence of ['Write the autumn press release', 'Choose the cover photo']) {
      const r = await call('POST', '/api/project/' + encodeURIComponent(id) + '/tasks', { sentence, who: chat });
      if (r.status !== 200) throw new Error('offProject6895: a task was refused (' + r.status + ')');
    }
    const off = await call('DELETE', '/api/project/' + encodeURIComponent(id) + '/agent/' + encodeURIComponent(chat));
    if (off.status !== 200) throw new Error('offProject6895: taking the member off answered ' + off.status);
    return id;
  }, [OFFPROJECT_6895, data.chatAgent, data.askAgent]);
}
/* A screen's throwaway project, by name, deleted after its shot (kosmos#6501: one helper for every such screen). */
async function throwawayProjectGone(page, projectName) {
  const st = await page.evaluate(async (name) => {
    const all = await (await fetch('/api/projects')).json().catch(() => ({}));
    const list = Array.isArray(all) ? all : (all && Array.isArray(all.projects) ? all.projects : []);
    const p = list.find((x) => x && x.name === name);
    return p ? (await fetch('/api/project/' + encodeURIComponent(p.id), { method: 'DELETE' })).status : 200;
  }, projectName);
  if (st !== 200) throw new Error('could not delete the throwaway project "' + projectName + '" after the shot (' + st + ')');
}
async function offProject6895Gone(page) { await throwawayProjectGone(page, OFFPROJECT_6895); }
/* kosmos#7196: enough posts that the room scrolls (idempotent across sizes and themes, which share one board); the room
   at its newest row with the page at its top, as a room opens (the bug's own state); and the check that the newest row
   is above the composer, at a phone width only (the desktop layout never had the bug and is not capped). */
const BUSY_7196 = 'Busy room 7196';
/* Review 2: a throwaway project, not the shared sample one, so its 24 posts never reach another screen; `after`
   deletes it. Made once per shot (sizes and themes share one board), with its agent on it so the room takes posts. */
async function project7196(page, name, agent) {
  return page.evaluate(async ({ name, agent }) => {
    const list = await (await fetch('/api/projects')).json().catch(() => ({}));
    let p = (list.projects || []).find((x) => x && x.name === name);
    if (!p) {
      p = (await (await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json()).project;
      await fetch('/api/project/' + p.id + '/agent/' + encodeURIComponent(agent), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    }
    return { id: p.id, createdAt: p.createdAt };
  }, { name, agent });
}
/* The posts go straight into the store's log, as the seed writes the sample room (the room's POST refuses on this
   board: the design-shots run's first pass showed both rooms empty, "Nothing here yet"). Once per project id. */
const SEEDED_7196 = new Set();
/* Review 3: the seeded rows stay in the log after `after` deletes their project, and an agent's own pages list every row
   it sent, so they come from a name no other screen opens, never from data.chatAgent. */
const SENDER_7196 = 'shots7196';
function seedPosts7196({ id: pid, createdAt }, from, texts) {
  /* By id AND createdAt: a project's id comes from its name, so the throwaway made again for the next size has the same
     id, and keyed by id alone it was never seeded again (the third run's empty rooms). */
  if (SEEDED_7196.has(pid + '@' + createdAt)) return;
  SEEDED_7196.add(pid + '@' + createdAt);
  /* After the project's own createdAt (since #7185 no reader is given a room row stamped before it; #7233 is the shared
     seed's half of this), and never after now. One millisecond apart, starting just after createdAt. */
  const t0 = (Date.parse(createdAt) || Date.now() - 1000) + 1;
  const lines = texts.map((text, i) => ({ kind: 'post', id: 'r7196-' + pid + '-' + (i + 1), project: pid, from, to: [], text,
    at: new Date(Math.min(t0 + i, Date.now())).toISOString(), outcomes: {} }));
  const storeRoot = require(path.join(REPO, 'engine', 'store')).ROOT;
  fs.appendFileSync(path.join(storeRoot, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
async function busyProject7196(page, agent) {
  const made = await project7196(page, BUSY_7196, agent);
  seedPosts7196(made, SENDER_7196, Array.from({ length: 24 }, (_, i) => 'Room busy 7196 post ' + (i + 1) + ': a line or two of ordinary project talk, so the room scrolls.'));
  return made.id;
}
async function roomFloor7196(page) {
  await page.evaluate(() => { window.scrollTo(0, 0); const r = document.querySelector('#pj-room'); if (r) r.scrollTop = r.scrollHeight; });
  await page.waitForTimeout(250);
}
async function newestAbove7196(page, minPosts, postsOnly) {
  const m = await page.evaluate(({ minPosts, postsOnly }) => {
    const room = document.querySelector('#pj-room'), comp = document.querySelector('.pjmid .composer');
    /* Real posts, at every size (round 2: an empty room's "Nothing here yet" line passed as the newest row). */
    const posts = room ? room.querySelectorAll('.msg').length : 0;
    if (posts < minPosts) return { posts, minPosts, noPosts: true };
    if (postsOnly || !matchMedia('(max-width: 30rem)').matches) return null;
    const rows = room ? [...room.children].filter((e) => e.getBoundingClientRect().height > 0) : [];
    if (!rows.length || !comp) return { missing: true };
    return { last: Math.round(rows[rows.length - 1].getBoundingClientRect().bottom), comp: Math.round(comp.getBoundingClientRect().top) };
  }, { minPosts, postsOnly: !!postsOnly });
  if (m && (m.noPosts || m.missing || m.last > m.comp)) throw new Error('#7196: the room is not the one meant, or its newest row is under the composer: ' + JSON.stringify(m));
}
/* kosmos#7184: a throwaway project with three tasks; task 1 held from the screen until task 2 closes ('task') or until a
   time ('at'), then its page opened and scrolled to the hold row. */
async function holdUntil7184(page, data, kind) {
  const id = await page.evaluate(async ([name, chat, k]) => {
    const call = (m, url, body) => fetch(url, { method: m, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const made = await (await call('POST', '/api/projects', { name, agents: [chat] })).json().catch(() => ({}));
    const pid = made && made.project && made.project.id;
    if (!pid) throw new Error('task-holduntil-7184: the board made no project');
    const base = '/api/project/' + encodeURIComponent(pid);
    for (const sentence of ['Order the parts', 'Get the price approved', 'Book the courier']) {
      const r = await call('POST', base + '/tasks', { sentence });
      if (r.status !== 200 && r.status !== 201) throw new Error('task-holduntil-7184: adding a task answered ' + r.status);
    }
    const d = new Date(Date.now() + 2 * 86400000); d.setHours(9, 30, 0, 0);
    const until = k === 'task' ? { task: 2 } : { at: d.toISOString() };
    const h = await call('POST', base + '/task/1/hold', { onHold: true, until });
    if (h.status !== 200) throw new Error('task-holduntil-7184: the hold answered ' + h.status);
    return pid;
  }, [HOLDUNTIL_7184[kind], data.chatAgent, kind]);
  await openTab(page, 'projects');
  await page.click(`#pj-list .pj-row[data-project="${id}"]`);
  await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
  await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
  await page.waitForSelector('#tk-hold-until:not([hidden])', { state: 'visible', timeout: 8000 });
  await page.evaluate(() => document.getElementById('tk-hold-row').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
}
async function openTab(page, tab) {
  // kosmos#6846 (--app-tabs): the iPhone app opens a section from its native tab bar, through the board's own door.
  if (await page.evaluate(() => document.documentElement.classList.contains('kapptabs') && typeof window.kosmosAppTab === 'function')) {
    if (!(await page.evaluate((t) => window.kosmosAppTab(t), tab))) throw new Error('kosmosAppTab refused ' + tab);
    await page.waitForSelector(`#panel-${tab}`, { state: 'visible', timeout: 5000 });
    return;
  }
  // Over Kosmos+ (--remote) a phone has the Kosmos+ bar's own menu (#pnav) instead of the burger (kosmos#5510).
  if (await page.isVisible('#kplus-menu')) {
    await page.click('#kplus-menu');
    await page.waitForSelector(`#pnav [data-pnav-tab="${tab}"]`, { state: 'visible', timeout: 5000 });
    await page.click(`#pnav [data-pnav-tab="${tab}"]`);
    await page.waitForSelector(`#panel-${tab}`, { state: 'visible', timeout: 5000 });
    return;
  }
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
/* #4470: the new look, as the hidden switch (Settings > Advanced > Try the new look) turns it on: the page reads
   localStorage 'kosmos-look' before paint. Set it, reload, and wait for the attribute the new look keys on. */
const newLook = async (page) => {
  await page.evaluate(() => localStorage.setItem('kosmos-look', 'new'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-look') === 'new', null, { timeout: 8000 });
  if (await page.$('#firstrun:not([hidden])')) await page.keyboard.press('Escape');   // as the render check does after a reload
  await page.waitForTimeout(900);
};

/* #4594: the consolidated view without writing it. The page reads its layout from GET /api/style (paintStyles, also
   on later polls), so a page-only applyLayout was undone mid-shot; saving it with PUT /api/style would change the
   one board every later screen of this run is shot on. So the READ is stubbed in this screen's own context (gone
   with it) to say consolidated (stubConsolidatedStyle), and openConsAgents reloads the page. Screens that stub it set
   noServiceWorker. */
async function stubConsolidatedStyle(page) {
  /* #6027: this handler waits before it answers, so the answer can land after the browser closed; inside the try,
     its late rejection is caught instead of crashing the check after it passed. */
  await page.route('**/api/style', async (r) => {
    try {   // #6022: a late answer after close is caught, not a crash
      if (r.request().method() !== 'GET') return await r.fallback();
      let resp;
      try { resp = await fetchBoard(r); } catch { return await r.fallback(); }   // never leave the request hanging
      const j = await resp.json().catch(() => null);
      if (!j) return await r.fulfill({ response: resp });
      return await r.fulfill({ response: resp, json: { ...j, layout: 'consolidated' } });
    } catch { await r.abort().catch(() => {}); }
  });
}
async function openConsAgents(page) {
  await stubConsolidatedStyle(page);
  // #6107: on a sideways tablet the tablet's own choice wins over the board's, so it says one screen too (a run with
  // MSHOTS_TABLET_LAYOUT=tabs would otherwise keep these screens on tabs).
  await page.evaluate(() => { try { localStorage.setItem('kosmos-tablet-layout', 'consolidated'); } catch { /* storage refused */ } });
  await page.reload({ waitUntil: 'load' });   // 'load', per this file's rule; the next line is the real readiness signal
  await page.waitForFunction(() => document.documentElement.getAttribute('data-layout') === 'consolidated', null, { timeout: 8000 });
  /* The board's own boot can activate a project AFTER this opens Agents, which closes the Agents view
     (iteration 7: shots of a project passed). So open it, then require it to STAY open for a while,
     opening it again if the board took it back. */
  const shown = () => page.evaluate(() => {
    const p = document.getElementById('panel-cons-agents'); const sw = document.querySelector('#panel-cons-agents .cons-agents-lay');
    return !!(p && !p.hidden && p.getClientRects().length && sw && sw.getClientRects().length);
  });
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');   // the reload can bring it back
  // Stable = open on 4 samples in a row, 250 ms apart: a signal, not a fixed sleep.
  const stable = async () => { for (let i = 0; i < 4; i++) { if (!(await shown())) return false; await page.waitForTimeout(250); } return true; };
  let last = null;
  for (let tries = 0; tries < 6; tries++) {
    try {
      await page.click('#tabs .tab[data-tab="agents"]', { timeout: 5000 });
      await page.waitForSelector('#panel-cons-agents .cons-agents-lay', { state: 'visible', timeout: 5000 });
    } catch (e) { last = e; continue; }   // taken back before it showed (or never there): try again
    if (await stable()) return;
  }
  throw new Error('cons-agents: the Agents view did not stay open' + (last ? ' (last: ' + String(last.message || last).split('\n')[0] + ')' : ''));
}
/* A SCREENS `verify` hook, run right after the shot: the Agents view and its switch must still be on screen with
   the expected segment chosen, or the shot is deleted and the row is an ERROR, never a picture of something else. */
const consAgentsStill = (want) => async (page) => {
  const got = await page.evaluate(() => {
    const p = document.getElementById('panel-cons-agents'); const sw = document.querySelector('#panel-cons-agents .cons-agents-lay');
    const r = sw ? sw.getBoundingClientRect() : null;
    const on = sw ? sw.querySelector('[aria-checked="true"]') : null;
    return { panel: !!(p && !p.hidden && p.getClientRects().length), inView: !!(r && r.width && r.bottom > 0 && r.top < innerHeight), on: on ? on.dataset.conslay : null };
  });
  if (!got.panel || !got.inView || got.on !== want) throw new Error('the shot is not the Agents view with ' + want + ' chosen: ' + JSON.stringify(got));
};

/* #4637: two waiting requests for the connect screens, and an Allow that answers. */
async function connectPending(page) {
  let devices = [
    { device_id: 'd-sample-pc', name: 'windowsbox', code: '482 915', first_seen: Math.floor(Date.now() / 1000) - 30, denied_at: 0, joining_computer: 'windowsbox' },
    { device_id: 'd-sample-ph', name: 'iPhone', code: 'K7-4M', first_seen: Math.floor(Date.now() / 1000) - 90, denied_at: 0, joining_computer: null }];
  await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com', snapshot: true, devices }) }));
  await page.route('**/api/remote/devices/allow', (r) => { devices = devices.filter((d) => d.device_id !== 'd-sample-pc'); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
}
/* #4794: the computer WAITING to be allowed (Settings > Kosmos+), with the pairing code worked out. */
async function joinWaiting(page, confirmed, retry) {
  const remote = { configured: true, on: true, ok: true, enrolled: true, email: 'owner@example.com', status: { state: 'waiting-allow', because: 'waiting for one of your computers to allow this one' } };
  await page.route('**/api/remote', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().method() === 'GET' ? remote : { ok: true }) }));
  /* The devices list reads its own answer; unfaked, the throwaway board says on:false and the shot showed "Plus is off"
     beside a switch that is on. A computer waiting to be allowed has its switch on and no devices yet. */
  await page.route('**/api/remote/devices', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pending: [], allowed: [], email: 'owner@example.com', on: true }) }));
  await page.route('**/api/remote/join', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ supported: true, held: true, join_code: retry ? '' : '482 915', on: 'homemac', asked_of: ['homemac'], failed: false, confirmed: !!confirmed,
      confirm_expired: !!retry, needs_retry: !!retry }) }));
}
/* #5531: a connected computer, for Settings > Kosmos+ > Your company. The company's answers are stand-ins in the shape
   of #5530's contract; the consent words are the sample the contract carries. */
async function orgConnected(page, enrolled, extra) {
  const remote = { configured: true, on: true, ok: true, enrolled: true, email: 'owner@example.com', status: { state: 'up', address: 'sample.kosmosplus.com' } };
  await page.route('**/api/remote', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().method() === 'GET' ? remote : { ok: true }) }));
  await page.route('**/api/remote/devices', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pending: [], allowed: [], email: 'owner@example.com', on: true }) }));
  const ORG = { id: 'org_sample', name: 'Northwind Design', slug: 'northwind' };
  await page.route('**/api/org', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(enrolled ? { enrolled: true, org: ORG, role: 'member', enrolledAt: new Date().toISOString(), ...(extra || {}) } : { enrolled: false, org: null, role: null, enrolledAt: null }) }));
  await page.route('**/api/org/preview', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, org: ORG, role: 'member', consent: {
    reports: ['agent names, the AI provider and model each uses', 'project names', 'tokens and estimated cost per day', 'when you were last active', 'which company policy you have and when you were last backed up'],
    backsUp: ['agent folders and their files', 'transcripts', 'projects and what agents make'],
    readers: ['you', "your company's recovery role, only by restoring it, and every restore is logged and shown to you"],
    never: ['your chats are never shown in the console', 'keys and passwords'] } }) }));
}
/* #5359: a restart note made seven minutes ago, on this page's own route (engine/restartnote.js makes the real one). */
async function stubRebootNote(page) {
  const now = Date.now();
  const note = { lastAliveAt: new Date(now - 9 * 60000).toISOString(), bootAt: new Date(now - 7 * 60000).toISOString(), upAt: new Date(now - 60000).toISOString() };
  await page.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note }) }).catch(() => {}));
}
/* #5785: the Kosmos+ sign-in card mid-connect. `owned`: the automatic connect (address line, centred); otherwise a typed
   name (its field and the disabled button stay, "Signing in..." in the status line). */
async function plusSigningIn(page, owned) {
  await at(page, '?tab=settings&sec=plus');
  await page.waitForSelector('#plus-state2', { state: 'attached', timeout: 8000 });
  await page.evaluate((own) => {
    for (const id of ['plus-state1', 'plus-state3']) { const el = document.getElementById(id); if (el) el.hidden = true; }
    // As a real sign-in on this not-signed-in board: PLUS_SIGNIN_ACTIVE keeps state 2 up (paintPlus's not-enrolled
    // branch), PLUS_SI_REGISTERING as the register sets it (its enrolled branch).
    PLUS_SIGNIN_ACTIVE = true;
    PLUS_SI_REGISTERING = true;
    document.getElementById('plus-state2').hidden = false;
    plusSiShow('plus-si-register');
    document.getElementById('plus-si-title').textContent = 'Signing in...';
    if (own) {
      const field = document.getElementById('plus-si-name-field'); if (field) field.hidden = true;
      const go = document.getElementById('plus-si-register-go'); if (go) go.hidden = true;
      document.getElementById('plus-si-owned').hidden = false;
      document.getElementById('plus-si-owned-lead').textContent = 'Connecting this computer as';
      document.getElementById('plus-si-owned-addr').textContent = 'sample.kosmosplus.com';
      // A real automatic register hides the way out while it runs (it cannot be taken back): so does the shot.
      const out = document.getElementById('plus-si-cancel'); if (out && out.parentElement) out.parentElement.hidden = true;
    } else {
      document.getElementById('plus-si-owned').hidden = true;
      const field = document.getElementById('plus-si-name-field'); if (field) field.hidden = false;
      const name = document.getElementById('plus-si-name');
      if (name) { name.value = 'sample'; name.dispatchEvent(new Event('input', { bubbles: true })); }   // the count reads 6/32, as typed
      const go = document.getElementById('plus-si-register-go'); if (go) { go.hidden = false; go.disabled = true; }
    }
    plusSiKStart(own);
  }, owned);
  await page.waitForSelector('#plus-si-k canvas', { state: 'visible', timeout: 5000 });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1600);   // mid-gather, so the shot shows dots on their way into the K
  // Review 3: the card is still the one meant (no tick repainted it) at the moment of the shot.
  if (!(await page.isVisible('#plus-state2')) || !(await page.isVisible('#plus-si-k canvas'))) throw new Error('plus-signing-in: the sign-in card was repainted away before the shot');
}
async function plusSigningInEnd(page) {
  await page.evaluate(() => { PLUS_SI_REGISTERING = false; PLUS_SIGNIN_ACTIVE = false; if (typeof plusSiKStop === 'function') plusSiKStop(); });
}

/* #5800: what is at the centre of the held room's Reopen button: '' when the point is the button, else why not (gone,
   not laid out, outside the viewport, or the layer covering it). Read in project-room-held-5800's go, before the shot,
   and again in its verify, after it: the page re-renders on its tick, so the two are different reads, as the leak
   guard's two scans are. */
/* #6925: null when the summary post's label is seen (its centre is the label, inside the viewport), else why not.
   Same rule and edges as heldReopenAt below. */
const summaryLabelAt = () => {
  const e = document.querySelector('#pj-room .msg-closing');
  if (!e) return 'no label on the page';
  const r = e.getBoundingClientRect();
  if (!r.width || !r.height) return 'the label has no size';
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (y < 0 || y >= innerHeight || x < 0 || x >= innerWidth) return 'the label is outside the viewport';
  const top = document.elementFromPoint(x, y);
  return top && (top === e || e.contains(top)) ? null : 'something is drawn over the label: ' + (top ? top.tagName + '#' + top.id + '.' + top.className : 'nothing');
};
const heldReopenAt = () => {
  const b = document.querySelector('#pj-held [data-reopen-room]');
  if (!b) return 'gone (no Reopen button)';
  const r = b.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return 'not laid out (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')';
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'outside the viewport (its centre is at ' + Math.round(x) + ',' + Math.round(y) + ')';
  const top = document.elementFromPoint(x, y);
  if (top && b.contains(top)) return '';
  const named = top && (top.id ? top : top.closest('[id]'));   // the nearest element with an id names the layer
  return 'covered by ' + (named ? named.tagName.toLowerCase() + '#' + named.id : top ? top.tagName.toLowerCase() : 'nothing readable');
};

/* #3029: the subproject fixture for tasks-subprojects and tasks-subproject-picked, made once per run (there is no
   project delete here) and cached on data. Projects are found again by name and parent on a fresh read, so this
   does not depend on the create route's response shape. */
async function subprojectFixture(page, data) {
  if (data.subprojects) return data.subprojects;
  const made = await page.evaluate(async (topId) => {
    const post = (pth, b) => fetch(pth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const find = async (name, parent) => {
      const all = await (await fetch('/api/projects')).json();
      const list = Array.isArray(all) ? all : (all.projects || []);
      const hit = list.find((p) => p && p.name === name && (p.parent || null) === (parent || null));
      return hit ? hit.id : null;
    };
    // A new project's folder is named from its name, so two projects called Launch would share one folder (refused).
    // Each is made under a one-off name, which gives it its own folder, then renamed: a rename keeps the folder.
    // The one-off name is short (a folder name is capped at 60 characters) and unique to this run, and a project already
    // made by an earlier screen of the same run is found and reused, so a retry never meets its own folders.
    const runTag = Date.now().toString(36);
    let seq = 0;
    const make = async (name, parent) => {
      const existing = await find(name, parent);
      if (existing) return existing;
      const first = 'fixture ' + runTag + ' ' + (++seq);
      const r = await post('/api/projects', parent ? { name: first, parent } : { name: first });
      if (r.status !== 200 && r.status !== 201) throw new Error('could not make ' + name + ' (status ' + r.status + ': ' + ((await r.json().catch(() => ({}))).error || '') + ')');
      const made = await find(first, parent);
      if (!made) throw new Error('made ' + name + ' but could not read it back');
      const ren = await fetch('/api/project/' + encodeURIComponent(made), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (ren.status !== 200) throw new Error('could not name ' + name + ' (status ' + ren.status + ')');
      const id = await find(name, parent);
      if (!id) throw new Error('made ' + name + ' but could not read it back');
      return id;
    };
    const bookB = await make('Book B');
    const launchA = await make('Launch', topId);
    const launchB = await make('Launch', bookB);
    const grandchild = await make('Spring catalogue relaunch with the regional sales teams', launchA);
    for (const [id, sentence] of [[launchA, 'Draft the launch email'], [launchB, 'Book the venue'], [grandchild, 'Proof the catalogue pages']]) {
      const r = await post('/api/project/' + encodeURIComponent(id) + '/tasks', { sentence });
      if (r.status !== 200) throw new Error('could not add a task to ' + id + ' (status ' + r.status + ')');
    }
    return { bookB, launchA, launchB, grandchild };
  }, data.projectId);
  data.subprojects = made;
  return made;
}

/* #5444: the projects read with one project changed by `edit(proj)`, so a screen can show a state the throwaway board
   cannot reach on its own. Only the read is faked; the board is not changed, so no `after` is needed. */
async function editProjects(page, projectId, edit) {
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    // #6022: keep the fetch AND the answer inside one try, so a context teardown
    // between them aborts the route instead of crashing the check.
    try {
      const res = await route.fetch();
      const body = await res.json();
      for (const proj of body.projects || []) if (proj.id === projectId) edit(proj);
      await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-type': 'application/json' } });
    } catch { await route.abort().catch(() => {}); }
  });
}
/* #5444: open the seed's project, then its task 1's page. */
async function openTaskOne(page, projectId) {
  await openTab(page, 'projects');
  await page.click(`#pj-list .pj-row[data-project="${projectId}"]`);
  await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
  await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
}
/* kosmos#6727: an agent held on Claude Code's permission prompt, as its chat now shows it: one short card, and the card
   after each press (design review). The thread is stubbed in the screen's own context with what the route serves for
   the real bash capture (test-support/claude-screens), read by the engine itself; a press is answered "placed" by the
   stub, so no key reaches any pane. Three literal screens below call this, so each declares noServiceWorker (#6206). */
async function permCardGo(page, data, press) {
  const chatEng = require(path.join(REPO, 'engine', 'chat'));
  const screen = require('fs').readFileSync(path.join(REPO, 'test-support', 'claude-screens', 'permission-prompt-bash-2.1.296.txt'), 'utf8');
  const q = chatEng.questionIn(screen, 'claude');
  const body = { olderCount: 0, historyBecause: null, historyUnfilable: false, owes: null, presence: 'on', presenceBecause: null,
    asking: true, question: { text: q.text }, questionBecause: null, codexHooks: null, answerNote: null,
    options: chatEng.optionsIn(q.text), asked: chatEng.questionAbove(q.text),
    messages: [{ id: 'needs-you-question:' + data.chatAgent, at: null, text: q.text, from: data.chatAgent, delivery: null,
      kind: 'question', reported: false, permission: chatEng.permissionCard(screen) }] };
  await page.route('**/api/agent/*/thread*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(r.request().method() === 'GET' ? body : { delivery: { state: 'placed' }, recorded: true }) }));
  await at(page, '?agent=' + data.chatAgent);
  await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
  await page.waitForSelector('#d-dmthread .dmperm .dmperm-main', { state: 'visible', timeout: 8000 });
  if (press) {
    await page.locator('#d-dmthread .dmperm-main .dmchoice', { hasText: press }).click({ timeout: 5000 });
    await page.waitForFunction((w) => ((document.querySelector('#d-dmthread .dmperm-main .dmchoices-msg') || {}).textContent || '') === w,
      press === 'Allow' ? 'Allowed.' : 'Denied.', { timeout: 5000 });
  }
}

/* #6923: the three replaced-by screens share one body (see their entries in SCREENS). */
function replaced6923(which) {
  return { go: async (page, data) => {
    const post = (path, body) => page.evaluate(([pth, b]) => fetch(pth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) })), [path, body]);
    const base = '/api/project/' + encodeURIComponent(data.projectId);
    const add = async (sentence) => {
      const made = await post(base + '/tasks', { sentence });
      const n = made.status === 200 ? ((made.json.task && made.json.task.number) || made.json.number) : null;
      if (typeof n !== 'number') throw new Error('could not add the task (' + made.status + ')');
      return n;
    };
    const first = await add('Draft the onboarding email');
    const second = await add('Draft the onboarding email, shorter, after review');
    data.replacedPair = [first, second];
    const closed = await post(base + '/task/' + first + '/close', { replacedBy: second });
    if (closed.status !== 200) throw new Error('could not close it as replaced (' + closed.status + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    if (which === 'card') {
      // Finished tasks live on the project's Tasks view (behind View All), where the row says what replaced it.
      await at(page, '?tab=tasks');
      await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
      await page.evaluate((id) => openProjectTasks(id), data.projectId);
      await page.waitForSelector('details.tsk-fold > summary', { timeout: 8000 });
      await page.evaluate(() => { const d = document.querySelector('details.tsk-fold'); if (d && !d.open) d.querySelector('summary').click(); });   // the finished group, opened as a person would
      await page.waitForSelector('.tsk-replaced', { timeout: 8000 });
      await page.evaluate(() => document.querySelector('.tsk-replaced').scrollIntoView({ block: 'center' }));
      return;
    }
    await page.evaluate(async (num) => { await pjReload(); openTaskPage(num); }, which === 'replaced' ? first : second);
    await page.waitForSelector('#tk-state', { timeout: 8000 });
  }, verify: async (page, data) => {
    const [first, second] = data.replacedPair || [];
    if (which === 'card') {
      const seen = await page.evaluate(() => Array.from(document.querySelectorAll('.tsk-replaced')).map((x) => x.textContent));
      if (!seen.includes('Replaced by task ' + second)) throw new Error('the Tasks view shows ' + JSON.stringify(seen));
      return;
    }
    const t = await page.evaluate(() => (document.getElementById('tk-state') || {}).textContent || '');
    const want = which === 'replaced' ? 'Replaced by task ' + second : 'Replaces task ' + first;
    if (!t.includes(want)) throw new Error('the state line says: ' + JSON.stringify(t) + ', not ' + JSON.stringify(want));
    // Mona Lisa: the task number is a link to that task's page.
    const other = which === 'replaced' ? second : first;
    const linked = await page.evaluate((num) => !!document.querySelector('#tk-state button[data-sub="' + num + '"]'), other);
    if (!linked) throw new Error('task ' + other + ' is not a link in the state line');
  }, after: async (page, data) => {
    for (const num of data.replacedPair || []) {
      const st = await page.evaluate(([id, n]) => fetch('/api/project/' + encodeURIComponent(id) + '/task/' + n + '/close', { method: 'POST' }).then((r) => r.status), [data.projectId, num]);
      if (st !== 200) throw new Error('could not close task ' + num + ' after the shot (' + st + ')');
    }
    data.replacedPair = null;
  } };
}

/* kosmos#4658: open a project with federation live and the sealed-room key section's two reads answered. */
async function ownsealScreen(page, data, compare, waiting, allowed, ready) {
  await page.route('**/api/status*', async (r) => {
    try {
      const resp = await r.fetch();
      const j = await resp.json().catch(() => null);
      if (!j) return await r.fulfill({ response: resp });
      j.federationLive = true; j.kosmos_plus = true;
      return await r.fulfill({ response: resp, json: j });
    } catch { await r.abort().catch(() => {}); }
  });
  await page.route('**/api/federation/own-compare*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(compare) }));
  await page.route('**/api/federation/own-waiting*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(waiting) }));
  // kosmos#7028's list (the Remove rows): none unless the screen gives some.
  await page.route('**/api/federation/own-allowed*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(allowed || { computers: [] }) }));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-fed-ui') === 'show', null, { timeout: 15000 });
  await openTab(page, 'projects');
  await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
  await page.waitForSelector(ready || '#pj-fed-own .ownseal-code', { state: 'visible', timeout: 20000 });
  await page.evaluate(() => document.getElementById('pj-fed-own').scrollIntoView({ block: 'center' }));
}
// kosmos#4658 with #7028: the seal owner's section with one computer waiting and two let in (noon UTC in June of the
// year the shots are taken, so the rows carry no year).
const OWNREMOVE_YEAR = new Date().getFullYear();
const OWNREMOVE_ALLOWED = { computers: [
  { pub: 'pub-sample-3', mac: 'mac-sample-3', at: Date.UTC(OWNREMOVE_YEAR, 5, 1, 12) },
  { pub: 'pub-sample-4', mac: 'mac-sample-4', at: Date.UTC(OWNREMOVE_YEAR, 5, 15, 12) }] };
async function ownremoveScreen(page, data) {
  await ownsealScreen(page, data, { code: null }, { computers: [{ pub: 'pub-sample-1', mac: 'mac-sample-1', code: 'ABCDE-FGHJK', at: 1 }] },
    OWNREMOVE_ALLOWED, '#pj-fed-own [data-own-act="remove"]');
}

/* kosmos#7212 slice 2: stand the chat agent in as idle with a delivery stall 2 hours old, in the shape
   engine/deliverystreak.js stallOf gives the card. */
async function stallRoute(page, data, kind) {
  await page.route('**/api/status*', async (r) => {
    try {
      if (r.request().method() !== 'GET') { await r.continue(); return; }
      const res = await r.fetch();
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (!body || !Array.isArray(body.agents)) { await r.fulfill({ response: res }); return; }
      for (const a of body.agents) {
        if (a && a.sessionName === data.chatAgent) {
          const ds = require('../../engine/deliverystreak');
          if (kind === 'turn') {
            /* kosmos#7368: a Windows agent on one step for two hours with three messages waiting behind it. */
            a.state = 'working';
            a.deliveryStall = { since: new Date(Date.now() - 2 * 3600e3).toISOString(), count: 3, lastWhy: 'turn',
              step: 'running "npm install"', words: ds.WHY_WORDS.turn, next: ds.NEXT_WORDS.turn };
          } else {
            a.state = 'idle';
            a.deliveryStall = { since: new Date(Date.now() - 2 * 3600e3).toISOString(), count: 9, lastWhy: 'menu',
              words: ds.WHY_WORDS.menu };   // the engine's own words, never a copy
          }
        }
      }
      await r.fulfill({ response: res, body: JSON.stringify(body) });
    } catch { /* the page closed at teardown (#6022) */ }
  });
}
const SCREENS = [
  // Raiden: the app frame on a phone (top bar, navigation, agents list, home).
  { name: 'home', owner: 'Raiden', go: async () => {} },
  /* #5018: the login-expiry notice floating over the page under the header, with its account line, the agents'
     given names and its X. The advisory is stubbed onto this screen's own /api/status reads (gone with it). */
  /* #6320: the restart notice naming agents whose login job could not be checked, alone and beside one that can be
     fixed (#6714: compact notices in the floating stack). /api/register is stubbed on this screen's own page with
     made-up names from the sample fleet. */
  { name: 'restart-unknown', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/register', (route) => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, missing: [], unknown: ['pixel-moss', 'cleo-park'],
        agents: [{ name: 'pixel-moss', shownAs: 'Pixel' }, { name: 'cleo-park', shownAs: 'Cleo' }] }) })
      : route.continue());
    await at(page, '');
    await page.waitForSelector('#survival-slot .utoast.survival.unknown', { state: 'visible', timeout: 15000 });
  } },
  { name: 'restart-both', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/register', (route) => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, missing: ['roo-lane'], unknown: ['cleo-park'],
        agents: [{ name: 'roo-lane', shownAs: 'Roo' }, { name: 'cleo-park', shownAs: 'Cleo' }] }) })
      : route.continue());
    await at(page, '');
    await page.waitForSelector('#survival-slot .utoast.survival.unknown', { state: 'visible', timeout: 15000 });
  } },
  { name: 'restart-both-done', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/register', (route) => route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, missing: ['roo-lane'], unknown: ['cleo-park'],
        agents: [{ name: 'roo-lane', shownAs: 'Roo' }, { name: 'cleo-park', shownAs: 'Cleo' }] }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results: [{ name: 'roo-lane', shownAs: 'Roo', ok: true, started: true }] }) }));
    await at(page, '');
    await page.waitForSelector('#survival-slot [data-survival-fix]', { state: 'visible', timeout: 15000 });
    await page.click('#survival-slot [data-survival-fix]');
    // #6320: after the report replaces Roo's notice, the could-not-check notice for Cleo is still there. Wait for the
    // REPORT (Roo's button gone and the report shown), since Cleo's notice was already up before the click.
    await page.waitForFunction(() => { const w = document.getElementById('survival-slot'); const rep = document.getElementById('survival-report-slot');
      // The stub keeps Roo missing, so its notice comes back after the report (#6714 review 19): wait for the report only.
      return w && rep && !!rep.querySelector('.utoast.survival.done') && !!w.querySelector('.utoast.survival.unknown'); }, null, { timeout: 15000 });
  } },
  { name: 'login-notice', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    const adv = [{ agents: ['roo-lane', 'pixel-moss', 'cleo-park'], names: ['Roo', 'Pixel', 'Cleo'], provider: 'Claude', service: 'Claude Code-credentials',
      email: 'owner@example.com', daysLeft: 5, severity: 'notice', expired: false }];
    await page.route('**/api/status', async (route) => {
      let res, data;
      try { res = await fetchBoard(route); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      data.loginAdvisories = adv;
      /* #6022: the answer can be late too (a poll in flight at close); a late rejection is caught. */
      try { await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } }); } catch { await route.abort().catch(() => {}); }
    });
    await at(page, '');
    await page.waitForSelector('#login-adv-slot .login-adv', { state: 'visible', timeout: 12000 });
  } },
  /* #5359: the note that this computer restarted under a running Kosmos, floating in #topnotes. Its route is stubbed
     on this screen's own page (gone with it). Mona Lisa asked for it alone, under the login notice, and over the
     Settings tabs on a phone (#5301). */
  { name: 'reboot-notice', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => {
    await stubRebootNote(page);
    await at(page, '');
    await page.waitForSelector('#reboot-slot .utoast.reboot', { state: 'visible', timeout: 12000 });
  } },
  { name: 'reboot-with-login', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => {
    await stubRebootNote(page);
    await page.route('**/api/status', async (route) => {
      let res, data;
      try { res = await fetchBoard(route); data = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      data.loginAdvisories = [{ agents: ['roo-lane'], names: ['Roo'], provider: 'Claude', service: 'Claude Code-credentials',
        email: 'owner@example.com', daysLeft: 5, severity: 'notice', expired: false }];
      /* #6022: the answer can be late too (a poll in flight at close); a late rejection is caught. */
      try { await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } }); } catch { await route.abort().catch(() => {}); }
    });
    await at(page, '');
    await page.waitForSelector('#login-adv-slot .login-adv', { state: 'visible', timeout: 12000 });
    await page.waitForSelector('#reboot-slot .utoast.reboot', { state: 'visible', timeout: 12000 });
  } },
  { name: 'reboot-over-settings', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => {
    await stubRebootNote(page);
    await at(page, '?tab=settings');
    await page.waitForSelector('#panel-settings', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#reboot-slot .utoast.reboot', { state: 'visible', timeout: 12000 });
  } },
  /* #6160: the streak by the K mark. A throwaway board is on day 1 (no note), so /api/streak is stubbed on this
     screen's own page to a 12-day streak: once with the day's note showing, once with the label shown by hovering
     the mark. The counting itself is engine/streak-6160.test.js's. */
  { name: 'streak-congrats', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/streak', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 12, congrats: true }) }));
    await at(page, '');
    await page.waitForSelector('#streak-slot .utoast.streak', { state: 'visible', timeout: 12000 });
  } },
  { name: 'streak-hover', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/streak', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 12, congrats: false }) }));
    await at(page, '');
    await page.waitForSelector('#kstreak:not([hidden])', { state: 'attached', timeout: 12000 });
    // A touch size has no hover (the label is gated on (hover: hover)); there it shows the way a long press does.
    if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) await page.hover('#klink');
    else await page.evaluate(() => document.getElementById('kstreak').classList.add('show'));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('kstreak')).opacity === '1', null, { timeout: 5000 });
  } },
  /* Both assert they got there: a renamed control must fail the shot, not
     quietly photograph the home screen again. */
  // phoneOnly: the menu button (#burger) exists only at phone widths, so the desktop size skips it.
  { name: 'nav-menu', owner: 'Raiden', phoneOnly: true, notInApp: true, go: async (page) => {
    if (await page.isVisible('#kplus-menu')) {   // --remote: the Kosmos+ bar's menu (kosmos#5510)
      await page.click('#kplus-menu');
      await page.waitForSelector('#pnav:not([hidden])', { timeout: 5000 });
      // Its items fade in (pnav-drop); a shot taken mid-fade shows grey words that are not on any phone.
      await page.waitForFunction(() => document.getElementById('pnav').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 5000 });
      return;
    }
    await page.click('#burger');
    await page.waitForSelector('#burger[aria-expanded="true"]', { timeout: 5000 });
  } },
  // kosmos#6846: the iPhone app's own header (run with --app-tabs). One computer: the face only (Josh #6396).
  { name: 'app-header', owner: 'Mona Lisa', phoneOnly: true, needsAppTabs: true, go: async (page) => {
    await page.waitForSelector('#kapp-me', { state: 'visible', timeout: 8000 });
  } },
  // The face opens the phone menu at Settings.
  { name: 'app-header-menu', owner: 'Mona Lisa', phoneOnly: true, needsAppTabs: true, go: async (page) => {
    await page.click('#kapp-me');
    await page.waitForSelector('#pnav .pnav-level[data-level="settings"]:not([hidden])', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('pnav').getAnimations({ subtree: true }).every((a) => a.playState !== 'running'), null, { timeout: 5000 });
  } },
  // Two computers: this computer's name on the left (the board re-reads them, answered here with two).
  { name: 'app-header-two', owner: 'Mona Lisa', phoneOnly: true, needsAppTabs: true, noServiceWorker: true, go: async (page) => {
    await page.route('**/api/remote/computers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, domain: 'kosmosplus.example', computers: [
      { name: 'Studio Mac', address: 'studio.kosmosplus.example', this: true, online: true },
      { name: 'Desk Mini', address: 'desk.kosmosplus.example', this: false, online: true }] }) }));
    await page.evaluate(() => computersFetch().catch(() => {}));
    await page.waitForSelector('#kapp-comp', { state: 'visible', timeout: 8000 });
  } },
  // #4470: the new look (the hidden switch), on the Agents page as a grid and as a list, and on the project room.
  { name: 'nl-home', owner: 'Mona Lisa', go: async (page) => { await newLook(page); } },
  { name: 'nl-agents-list', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('button.vt[data-layout="list"][aria-pressed="true"][aria-label="Show agents as a list"]', { timeout: 5000 });
  } },
  { name: 'nl-project-room', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
  } },
  /* kosmos#6681: the invite sheet (Members "+", Invite someone outside), ask step, with its optional email field. The
     throwaway board has no Kosmos+, so the federation gate is stamped "show" here and kept so: a later poll's own stamp
     would hide the sheet mid-shot. */
  { name: 'fed-invite', owner: 'Mona Lisa', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-fed-ui', 'show');
      window.fedGateStamp = () => document.documentElement.setAttribute('data-fed-ui', 'show');   // eslint-disable-line no-undef
      fedInviteOpen(null);   // eslint-disable-line no-undef
    });
    await page.waitForSelector('#fedinv-ask', { state: 'visible', timeout: 8000 });
    await page.fill('#fedinv-label', 'Dana Ruiz');
  } },
  /* kosmos#6708: the done step for a code the coordinator bound to one address. The throwaway board has no coordinator,
     so the invite answer is stubbed in this screen's own context with the echo a binding coordinator gives. */
  { name: 'fed-invite-bound', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await page.route('**/api/federation/invite', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ code: 'KOS-SAMPLE-CODE-6708', expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), invite_id: 'inv-6708', email: 'dana@example.com' }) }));
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-fed-ui', 'show');
      window.fedGateStamp = () => document.documentElement.setAttribute('data-fed-ui', 'show');   // eslint-disable-line no-undef
      fedInviteOpen(null);   // eslint-disable-line no-undef
    });
    await page.waitForSelector('#fedinv-ask', { state: 'visible', timeout: 8000 });
    await page.fill('#fedinv-label', 'Dana Ruiz');
    await page.fill('#fedinv-email', 'dana@example.com');
    await page.click('#fedinv-make');
    await page.waitForFunction(() => /Only the Kosmos\+ account with/.test(document.getElementById('fedinv-until').textContent), { timeout: 8000 });
  } },
  /* kosmos#7339 (Mona Lisa): a starred agent's star, filled with the brightest gold. data.chatAgent is starred through
     the board's own route, the same PUT the star button sends (so it sorts first), and unstarred in `after`, which
     throws if the board refuses, so no later screen is shot with a starred agent first. star-grid-7339 shows the
     tile's corner star; star-list-7339 the list row's. */
  { name: 'star-grid-7339', owner: 'Mona Lisa', go: async (page, data) => {
    { const st = await page.evaluate(async (name) => (await fetch('/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, on: true }) })).status, data.chatAgent); if (st !== 200) throw new Error('#7339: the board answered ' + st + ' to the star'); }
    await page.reload(); await page.waitForSelector('#grid .astar.on', { timeout: 8000 });
  }, after: async (page, data) => {
    { const st = await page.evaluate(async (name) => (await fetch('/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, on: false }) })).status, data.chatAgent); if (st !== 200) throw new Error('#7339: the board answered ' + st + ' to the unstar'); }
  } },
  { name: 'star-list-7339', owner: 'Mona Lisa', go: async (page, data) => {
    { const st = await page.evaluate(async (name) => (await fetch('/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, on: true }) })).status, data.chatAgent); if (st !== 200) throw new Error('#7339: the board answered ' + st + ' to the star'); }
    await page.reload();
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('.lname .astar.on', { timeout: 8000 });
  }, after: async (page, data) => {
    { const st = await page.evaluate(async (name) => (await fetch('/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, on: false }) })).status, data.chatAgent); if (st !== 200) throw new Error('#7339: the board answered ' + st + ' to the unstar'); }
    await page.click('button.vt[data-layout="grid"]').catch(() => {});
  } },
  { name: 'agents-list', owner: 'Raiden', go: async (page) => {
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('button.vt[data-layout="list"][aria-pressed="true"][aria-label="Show agents as a list"]', { timeout: 5000 });
  } },
  { name: 'agent-page', owner: 'Raiden', go: async (page, data) => {
    await at(page, '?agent=' + data.chatAgent);
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
  } },
  /* kosmos#5820 (Angel): an agent that declared where it answers the person (`kosmos reply-channel`, #5805 part 2).
     Its page says so in the header, with Clear. Written to the board's store as the command would, and cleared in
     `after`. The shot is gated on Clear being SEEN at its centre (visible is not seen, #4524). */
  { name: 'agent-replychan-5820', owner: 'Angel', go: async (page, data) => {
    require(path.join(REPO, 'engine', 'replychannel')).set(data.chatAgent, 'the team Discord channel');
    data.replyChanSet = true;
    await at(page, '?agent=' + data.chatAgent);
    await page.waitForSelector('#d-replychan', { state: 'visible', timeout: 8000 });
    const seen = async () => page.evaluate(() => {
      const b = document.getElementById('d-replychan-clear');
      if (!b) return 'gone';
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return 'not laid out';
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'outside the viewport';
      const top = document.elementFromPoint(x, y);
      return top && b.contains(top) ? '' : 'covered by ' + (top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') : 'nothing');
    });
    let hit = await seen();
    for (const until = Date.now() + 3000; hit && Date.now() < until; hit = await seen()) await page.waitForTimeout(200);
    if (hit) throw new Error('the reply-channel Clear button is not seen: ' + hit);
  }, verify: async (page) => {
    const t = await page.evaluate(() => (document.getElementById('d-replychan-text') || {}).textContent || '');
    if (!/says it answers you on the team Discord channel/.test(t)) throw new Error('the reply-channel line says: ' + JSON.stringify(t));
    // After the shot: press Clear for real. The line goes, the answer is said, and focus lands on it.
    await page.click('#d-replychan-clear');
    await page.waitForSelector('#d-replychan', { state: 'hidden', timeout: 8000 });
    const after = await page.evaluate(() => { const m = document.getElementById('d-replychan-msg');
      return { said: m ? m.textContent : '', focused: document.activeElement === m }; });
    if (!/^Cleared\. Kosmos will remind /.test(after.said)) throw new Error('Clear said: ' + JSON.stringify(after.said));
    if (!after.focused) throw new Error('focus did not land on the Cleared message');
  }, after: async (page, data) => {
    if (!data.replyChanSet) return;
    require(path.join(REPO, 'engine', 'replychannel')).set(data.chatAgent, null);
    data.replyChanSet = false;
  } },
  // Scorpion: an agent's chat.
  { name: 'agent-chat', owner: 'Scorpion', go: async (page, data) => {
    await at(page, '?agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
  } },
  /* kosmos#7208 (Mona Lisa): two of the person's messages Kosmos is holding, as their rows say it now: the first waits
     for the agent's message box to clear, the second is queued behind it. The thread the board serves gets the two
     rows added on the way to the page; nothing is written to the board. */
  { name: 'agent-chat-held-7208', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await page.route('**/thread*', async (r) => {
      try {
        if (r.request().method() !== 'GET') { await r.continue(); return; }
        const res = await r.fetch();
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        if (!body || typeof body !== 'object') { await r.fulfill({ response: res }); return; }
        const now = Date.now();
        body.messages = (Array.isArray(body.messages) ? body.messages : []).concat([
          { at: new Date(now - 90e3).toISOString(), text: 'Can you send me the draft when it is ready?', delivery: { state: 'held', heldFor: 'input' } },
          { at: new Date(now - 30e3).toISOString(), text: 'And the notes from this morning too.', delivery: { state: 'held', behind: true, behindFor: 'input' } },
        ]);
        await r.fulfill({ response: res, body: JSON.stringify(body) });
      } catch { /* the page closed at teardown (#6022) */ }
    });
    await at(page, '?agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#d-dmthread .delivery.held', { state: 'visible', timeout: 5000 });
  } },
  /* kosmos#7212 slice 2: an agent no message has reached for half an hour (engine/deliverystreak.js). The board's
     /api/status answer is stood in on the way to the page: the chat agent reads idle with a deliveryStall, so its card
     says so and it counts as an Issue. Nothing is written to the board. */
  { name: 'agent-stall-7212', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await stallRoute(page, data);
    await at(page, '');
    await page.waitForSelector('text=Messages stuck', { timeout: 8000 });
  } },
  { name: 'agent-stall-7212-list', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await stallRoute(page, data);
    await at(page, '');
    await page.click('button.vt[data-layout="list"][aria-label="Show agents as a list"]');
    await page.waitForSelector('button.vt[data-layout="list"][aria-pressed="true"][aria-label="Show agents as a list"]', { timeout: 5000 });
    await page.waitForSelector('.lrow.attn[data-agent="' + data.chatAgent + '"]', { timeout: 8000 });   // the stalled row drawn
  } },
  { name: 'agent-stall-7212-page', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await stallRoute(page, data);
    await at(page, '?agent=' + data.chatAgent);
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
  } },
  /* kosmos#7368 (Mona Lisa): a Windows agent whose one step has run two hours with messages waiting behind it. The
     same stand-in as #7212's, with the turn's reason: the card says Messages stuck, the page names the step. */
  { name: 'agent-turnstuck-7368', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await stallRoute(page, data, 'turn');
    await at(page, '');
    await page.waitForSelector('text=Messages stuck', { timeout: 8000 });
  } },
  { name: 'agent-turnstuck-7368-page', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await stallRoute(page, data, 'turn');
    await at(page, '?agent=' + data.chatAgent);
    await page.waitForSelector('#panel-detail', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('text=has been on one step for', { timeout: 8000 });
  } },
  /* kosmos#7248 (Mona Lisa): the note for files of Kosmos's own that a crash left damaged, one with a good copy to put
     back and one without. The board's answer is stood in on the way to the page; nothing is written to the board. */
  { name: 'damaged-files-7248', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/board/damaged-files', async (r) => {
      try {
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [
          { file: 'projects.json', holds: 'your projects, their tasks and who is on them', problem: 'nul', backup: { file: 'projects.json.recovered-x', at: new Date(Date.now() - 3600e3).toISOString() } },
          { file: 'removed.json', holds: 'the agents you removed', problem: 'empty', backup: null },
        ] }) });
      } catch { /* the page closed at teardown (#6022) */ }
    });
    await at(page, '');
    await page.waitForSelector('#damaged-slot .dmg', { state: 'visible', timeout: 8000 });
    await page.mouse.move(1, 1);
  } },
  { name: 'agent-perm-card', owner: 'Mona Lisa', noServiceWorker: true, go: (page, data) => permCardGo(page, data, null) },
  { name: 'agent-perm-card-allowed', owner: 'Mona Lisa', noServiceWorker: true, go: (page, data) => permCardGo(page, data, 'Allow') },
  { name: 'agent-perm-card-denied', owner: 'Mona Lisa', noServiceWorker: true, go: (page, data) => permCardGo(page, data, 'Deny') },
  // #5481: the Mac app's refused mic, which becomes [X   Turn on in Settings] in the mic's place. A stand-in bridge
  // (the app's message handler) answers the press with the refusal the app sends; nothing reaches System Settings.
  { name: 'agent-chat-mic-settings', owner: 'Renet Tilley', go: async (page, data) => {
    await at(page, '?agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => {
      window.webkit = { messageHandlers: { kosmosVoice: { postMessage() {} } } };
      document.documentElement.classList.add('has-voice');
      document.getElementById('d-mic').click();
      window.kosmosVoiceEvent({ kind: 'error', reason: 'speech-denied', canOpenSettings: true });
      window.kosmosVoiceEvent({ kind: 'stopped' });
    });
    await page.waitForSelector('.voice-pill', { state: 'visible', timeout: 5000 });
  } },
  // Kano: projects, a room, and the waiting-on-you ask.
  { name: 'projects', owner: 'Kano', go: async (page) => openTab(page, 'projects') },
  /* kosmos#6966 / #6967 (Mona Lisa): the Projects GRID, where a card shows which AI its agents run on (the tally beside
     the count) and a long title takes two lines. The fixture fleet is all Claude, so the projects read is edited in the
     page: the seed's members get mixed providers (and two more members), the second project a long title and an unread
     count. The card, its CSS and the marks are the board's own. */
  { name: 'projects-grid-6966', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      try {
        const res = await route.fetch();
        const body = await res.json();
        const [first, second] = body.projects || [];
        if (first && Array.isArray(first.agents)) {
          const mix = ['Claude', 'Gemini', 'Grok', 'Claude'];
          first.agents.forEach((a, i) => { if (a && typeof a === 'object') a.provider = mix[i % mix.length]; });
          const extra = (sessionName, name, provider) => ({ ...first.agents[0], sessionName, name, provider, hasAvatar: false });
          if (first.agents[0]) {
            first.agents.push(extra('gus', 'Gus', 'OpenAI'), extra('juno', 'Juno', 'Meta Muse'));
            if (first.summary && Number.isFinite(first.summary.total)) first.summary.total += 2;   // the count says five too
          }
        }
        if (second) {
          second.name = 'Quarterly investor update and board deck for the October meeting';
          second.unread = 3;
          for (const a of second.agents || []) if (a && typeof a === 'object') a.provider = 'Claude';
        }
        await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-type': 'application/json' } });
      } catch { await route.abort().catch(() => {}); }
    });
    await page.evaluate(() => { try { localStorage.setItem('kosmos.layout.projects', 'grid'); } catch { /* shown below if not */ } });
    await page.reload({ waitUntil: 'networkidle' });
    await openTab(page, 'projects');
    await page.waitForSelector('#pj-list.asgrid .pjtally', { state: 'visible', timeout: 8000 });
    await page.mouse.move(1, 1);
  } },
  { name: 'project-room', owner: 'Kano', go: async (page, data) => {
    freshCommitments();
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => {
      const r = document.querySelector('#pj-room');
      if (!r) return;
      r.scrollIntoView({ block: 'start' });
      /* #6262: block 'start' puts the project's heading (above the thread) under the sticky top bar on a phone (the App
         Store shot showed the title cut in half), which no person sees on opening a room. Step back by whatever bar is
         pinned over the top edge; a full-screen overlay is not a bar. */
      let el = document.elementFromPoint(Math.round(innerWidth / 2), 2), pinned = 0;
      for (; el && el !== document.body; el = el.parentElement) {
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') { const b = el.getBoundingClientRect(); if (b.height < innerHeight / 2) pinned = b.bottom; break; }
      }
      if (pinned > 0) window.scrollBy(0, -(pinned + 8));
    });
    /* #5782: the click on the project row leaves the pointer where the room's first message lands, so every shot showed
       that message's hover bar. Park it in the corner, as the other screens here do. */
    await page.mouse.move(1, 1);
  } },
  /* kosmos#7214 (Mona Lisa): an agent's room post holding a markdown table of file names and sha256 hashes in code spans,
     the shape Josh saw run past the bubble. The room the board serves gets the post added on the way to the page, from
     chatAgent; nothing is written to the board. Scrolled to it, as room-notice-7189. */
  { name: 'room-table-7214', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await page.route('**/api/project/*/room', async (r) => {
      try {
        if (r.request().method() !== 'GET') { await r.continue(); return; }
        const res = await r.fetch();
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        if (!body || typeof body !== 'object') { await r.fulfill({ response: res }); return; }
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const hex = (n) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(i * 7 + n * 3) % 16]).join('');
        rows.push({ kind: 'post', id: 'table-7214', from: data.chatAgent, fromKind: 'agent', at: new Date().toISOString(),
          text: 'Here are the two files and their checksums, so you can confirm the copies match.\n\n'
            + '| File | sha256 |\n|---|---|\n'
            + '| `catalogue-proof-final.pdf` (214,952 bytes, 4 pages) | `' + hex(1) + '` |\n'
            + '| `price-list-2026.xlsx` (38,410 bytes) | `' + hex(2) + '` |\n\n'
            + 'Both match what the printer sent.' });
        body.rows = rows;
        await r.fulfill({ response: res, body: JSON.stringify(body) });
      } catch { /* the page closed at teardown (#6022) */ }
    });
    await SCREENS.find((s) => s.name === 'project-room').go(page, data);
    await page.waitForSelector('#pj-room .mdtable', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => { const t = document.querySelector('#pj-room .mdtable'); if (t) t.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(150);
  } },
  /* kosmos#7189 (Angel): a room notice from a job (an email digest) keeps its lines in the room's note band. Posted
     once through the board's own notice route (the board lives across themes and sizes), then the room is opened as
     project-room does and the note is scrolled into view. */
  { name: 'room-notice-7189', owner: 'Angel', go: async (page, data) => {
    await page.evaluate(async (id) => {
      const base = '/api/project/' + encodeURIComponent(id);
      const room = await (await fetch(base + '/room')).json().catch(() => ({}));
      if ((room.rows || []).some((r) => r && r.kind === 'note' && /Email cleanup/.test(r.text || ''))) return;
      await fetch(base + '/notice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'email digest', text: 'Email cleanup, 07:01 (mark-read only, nothing moved)\n- main inbox: 3 marked read\n- shop inbox: 0\n\nNothing needs you today.' }) });
    }, data.projectId);
    await SCREENS.find((s) => s.name === 'project-room').go(page, data);
    /* To the end of the room, as a person reading the newest row is: its composer at the foot of the screen. The
       composer is sticky, so it covers rows only while the room is scrolled part way (Mona Lisa's review asked
       which this was). Not the end of the page: on a phone the members, files and tasks stack below the room. */
    // The room's own scroller too, to its newest row, as the room opens.
    await page.evaluate(() => {
      for (const el of [document.querySelector('#pj-room'), ...document.querySelectorAll('#pj-room *')]) {
        if (!el) continue;
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
    });
    /* The room column, not the composer: a sticky composer already stuck to the foot of the screen reads as in view, so
       scrolling IT moves nothing (#7196). The column's own end puts the composer back in its place after the newest row. */
    await page.evaluate(() => { const c = document.querySelector('.pjmid'); if (c) c.scrollIntoView({ block: 'end' }); });
    await page.waitForTimeout(150);
  } },
  /* kosmos#7196 (Mona Lisa's conditions): a busy room at its newest row with the page at its top as the room opens, a
     short room, and the keyboard up (phone only: the visible height shrinks by a keyboard's 336px). Each verifies, at a
     phone width, that the newest row sits above the composer, so a shot of the bug never reaches the review. */
  { name: 'room-busy-7196', owner: 'Angel', go: async (page, data) => {
    const id = await busyProject7196(page, data.chatAgent);
    await SCREENS.find((s) => s.name === 'project-room').go(page, { ...data, projectId: id });
    await roomFloor7196(page);
  }, verify: async (page) => { await newestAbove7196(page, 24); },
  after: async (page) => { await throwawayProjectGone(page, BUSY_7196); } },
  { name: 'room-short-7196', owner: 'Angel', go: async (page, data) => {
    const made = await project7196(page, 'Short room', data.chatAgent);
    seedPosts7196(made, SENDER_7196, ['Just one message so far.']);
    const id = made.id;
    await SCREENS.find((s) => s.name === 'project-room').go(page, { ...data, projectId: id });
    await roomFloor7196(page);
  }, verify: async (page) => { await newestAbove7196(page, 1); },
  after: async (page) => { await throwawayProjectGone(page, 'Short room'); } },
  { name: 'room-keyboard-7196', owner: 'Angel', phoneOnly: true, go: async (page, data) => {
    const id = await busyProject7196(page, data.chatAgent);
    await SCREENS.find((s) => s.name === 'project-room').go(page, { ...data, projectId: id });
    const vp = page.viewportSize();
    page.__vp7196 = vp;
    await page.setViewportSize({ width: vp.width, height: vp.height - 336 });
    await page.waitForTimeout(300);
    await roomFloor7196(page);
  }, verify: async (page) => {
    /* Review 2: on a short phone (the SE, 667px) the page header above the room takes almost all of what the keyboard
       leaves, so with the page at its top no thread height can clear the composer. A stated limit of this fix (#7196),
       not checked there; the phone sizes from 700px up are. */
    await newestAbove7196(page, 24, !(page.__vp7196 && page.__vp7196.height >= 700));
  },
  after: async (page) => {
    if (page.__vp7196) { await page.setViewportSize(page.__vp7196); page.__vp7196 = null; }
    await throwawayProjectGone(page, BUSY_7196);
  } },
  /* kosmos#7272 (Renet): the room with the keyboard up WHILE TYPING, focus in the composer first, as on a phone. On a
     phone the room's header steps aside, so the newest post shows above the composer. */
  { name: 'room-typing-7272', owner: 'Renet Tilley', phoneOnly: true, go: async (page, data) => {
    const id = await busyProject7196(page, data.chatAgent);
    await SCREENS.find((s) => s.name === 'project-room').go(page, { ...data, projectId: id });
    const vp = page.viewportSize();
    page.__vp7272 = vp;
    await page.focus('#pj-post');
    await page.setViewportSize({ width: vp.width, height: vp.height - 336 });
    await page.waitForTimeout(300);
    await roomFloor7196(page);
  }, verify: async (page) => {
    await newestAbove7196(page, 24, false);
    // Where the rule applies (the phone room, 30rem and narrower), the header must actually be out of the way: a shot
    // named for it must not pass on the old layout. Wider sizes (the small tablet) show the room unchanged.
    const headH = await page.evaluate(() => { if (!matchMedia('(max-width: 30rem)').matches) return 0;
      const h = document.querySelector('#pj-one-view .pjmidhead'); return h ? h.getBoundingClientRect().height : 0; });
    if (headH > 0) throw new Error('the room header still shows while typing with the keyboard up (' + Math.round(headH) + 'px)');
  },
  after: async (page) => {
    if (page.__vp7272) { await page.setViewportSize(page.__vp7272); page.__vp7272 = null; }
    await throwawayProjectGone(page, BUSY_7196);
  } },
  /* kosmos#5391 (Mona Lisa): the project page header with Pause / Resume, and a paused project (header, Paused line,
     and the list card's badge). Paused through the page's own call, as the header button makes it, then reloaded. */
  { name: 'project-head', owner: 'Mona Lisa', go: async (page, data) => {
    // Not paused, whatever an earlier pass of project-paused left (the board lives across themes and sizes).
    await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: false }) }), data.projectId);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForFunction(() => { const b = document.querySelector('#pj-head-pause'); return b && !b.hidden && /Pause/.test(b.textContent); }, null, { timeout: 8000 });
  } },
  /* kosmos#6842 slice 2: Project settings with "What its finished tasks cost". The throwaway board has no transcripts, so
     the cost READ is stubbed with a fixture (two models, three pull requests, one older task not counted) and nothing is
     written to the board. */
  { name: 'project-settings-cost-6842', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page, data) => {
    const b = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 40 });
    const pr = (repo, n) => ({ repo, number: n, url: 'https://github.com/' + repo + '/pull/' + n, tasks: [1] });
    await page.route('**/api/project/*/receipts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, tasks: 12, notCounted: 1, failed: 0, unread: 0, partial: 0,
      models: { 'claude-opus-5-5': b(120000, 380000, 900000, 14000000), 'claude-sonnet-5-5': b(40000, 90000, 200000, 3000000) },
      prs: [pr('example/app', 412), pr('example/app', 415), pr('example/site', 88)], prsMore: 0 }) }));
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.click('#pj-settings-link');
    await page.waitForFunction(() => { const c = document.querySelector('#pjs-cost'); return c && /finished task/.test(c.textContent); }, null, { timeout: 8000 });
    await page.evaluate(() => document.getElementById('pjs-cost-field').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
  }, after: async (page) => { await page.unroute('**/api/project/*/receipts'); } },
  /* #6501: the project page with task 1 marked built, so its card reads "Task 1 (built)" and "Built, waiting for you to check
     it". Marked from the page (as the person) and cleared after, so no later screen shoots it built. */
  { name: 'project-built', owner: 'PigeonPete', go: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/built', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('project-built: could not mark task 1 built (status ' + st + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-tasklist .tkcard-built', { state: 'visible', timeout: 15000 });
    // On a phone the Tasks column is below the room: bring the built card into the shot.
    await page.evaluate(() => document.querySelector('#pj-tasklist .tkcard-built').closest('.tkcard').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
  }, after: async (page, data) => {
    await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/built', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }), data.projectId);
  } },
  /* kosmos#6994: the project's records under the Files list: three accounts, one with evidence 40 days old (stale).
     Written through the real routes and taken away after the shot, so no other screen sees them. */
  { name: 'project-records-6994', owner: 'Angel', go: async (page, data) => {
    const bad = await page.evaluate(async (id) => {
      const at = (rest) => '/api/project/' + encodeURIComponent(id) + '/records' + rest;
      const post = (rest, body) => fetch(at(rest), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
      const d = new Date(Date.now() - 40 * 86400000);
      const old = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const codes = [
        await post('/label', { label: 'accounts' }),
        await post('', { name: 'Acme Inc', status: 'active', source: 'https://crm.example.com/accounts/acme' }),
        await post('', { name: 'Globex', status: 'renewal due', confirmed: old, source: 'notes/globex.md' }),
        await post('', { name: 'Initech', status: 'prospect' }),
      ];
      return codes.filter((c) => c !== 200 && c !== 201);
    }, data.projectId);
    if (bad.length) throw new Error('project-records-6994: could not write the records (' + bad.join(', ') + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-records', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.getElementById('pj-records').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
  }, after: async (page, data) => {
    await page.evaluate(async (id) => {
      const at = (rest) => '/api/project/' + encodeURIComponent(id) + '/records' + rest;
      for (const name of ['Acme Inc', 'Globex', 'Initech']) {
        await fetch(at('/remove'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      }
      await fetch(at('/label'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '' }) });
    }, data.projectId);
  } },
  /* kosmos#6895: a throwaway project (offProject6895) whose tasks the chat agent holds after leaving it, so the cards and
     the task page name the holder "(not on this project)" and the page counts them. The project is deleted after the
     shot, so no other screen sees it. */
  { name: 'project-offproject-6895', owner: 'Baron Draxum', go: async (page, data) => {
    const id = await offProject6895(page, data);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${id}"]`);
    await page.waitForSelector('#pj-offproject', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.getElementById('pj-offproject').scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(300);
  }, after: async (page) => { await offProject6895Gone(page); } },
  { name: 'task-offproject-6895', owner: 'Baron Draxum', go: async (page, data) => {
    const id = await offProject6895(page, data);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${id}"]`);
    const card = page.locator('#pj-tasklist .tkcard', { hasText: 'not on this project' }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.click();
    await page.waitForFunction(() => /not on this project/.test((document.getElementById('tk-who') || {}).textContent || ''), null, { timeout: 15000 });
  }, after: async (page) => { await offProject6895Gone(page); } },
  { name: 'project-paused', owner: 'Mona Lisa', go: async (page, data) => {
    await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) }), data.projectId);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-paused', { state: 'visible', timeout: 8000 });
  }, after: async (page, data) => {   // review 1: put the project back, so no later screen shoots it paused
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: false }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not unpause the project after the shot (' + st + ')');
  } },
  /* kosmos#7210: a project set to Muted: the label beside its title, then its settings with the notification choice.
     Set from the page (as the person) and put back to All after, so no later screen shoots it muted. */
  { name: 'project-muted-7210', owner: 'Ice Cream Kitty', go: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: 'muted' }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('project-muted-7210: could not mute the project (status ' + st + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-head-notify', { state: 'visible', timeout: 8000 });
    /* Design review round 2 (Mona Lisa): one shot caught the room before its first read painted, so wait for the room to
       hold something. Any content, not one sentence: the sample room is empty only while #7185's filter hides rows that
       predate their project (kosmos#7225), and its messages come back once that is fixed. */
    await page.waitForFunction(() => ((document.getElementById('pj-room') || {}).textContent || '').trim().length > 0, null, { timeout: 8000 });
  }, after: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: 'all' }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not unmute the project after the shot (' + st + ')');
  } },
  { name: 'project-settings-notify-7210', owner: 'Ice Cream Kitty', go: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: 'mentions' }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('project-settings-notify-7210: could not set Mentions only (status ' + st + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.click('#pj-settings-link');
    await page.waitForSelector('#pjs-notify [aria-checked="true"][data-notify="mentions"]', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('pjs-notify').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
  }, after: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: 'all' }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not put the project back to All after the shot (' + st + ')');
  } },
  { name: 'projects-paused', owner: 'Mona Lisa', go: async (page, data) => {
    await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) }), data.projectId);
    await openTab(page, 'projects');
    await page.waitForSelector(`#pj-list .pj-row[data-project="${data.projectId}"] .pjpill.paused`, { timeout: 8000 });
  }, after: async (page, data) => {   // review 1: put the project back, so no later screen shoots it paused
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: false }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not unpause the project after the shot (' + st + ')');
  } },
  { name: 'ask-waiting', owner: 'Kano', go: async (page, data) => {
    // The board re-renders cards on its tick, so scroll inside the page.
    // A card in the grid, or a row in the list (--remote shows agents as a list only, kosmos#5510).
    const card = `.acard[data-agent="${data.askAgent}"], .lrow[data-agent="${data.askAgent}"]`;
    await page.waitForSelector(card + ' >> visible=true', { timeout: 5000 });
    await page.evaluate((c) => [...document.querySelectorAll(c)].find((e) => e.getClientRects().length).scrollIntoView({ block: 'start' }), card);
  } },
  /* Where a push tap lands: the needs-you agent's page, shot once it has
     settled (the conversation scrolls to the top after load). */
  { name: 'push-landing', owner: 'Kano', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.askAgent);
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
     never hit and the card stayed hidden), so this screen's context blocks it.
     #4524: since #3829's addendum the full card, with Allow, renders only on Settings > Kosmos Plus; every other view
     shows one compact line linking there. So this screen opens that view. Plus is off on the throwaway board (no
     connected panel), so the full card is the top card there; with a connected panel it sits above the panel
     (#plus-asks). The wait accepts either, and fails unless an Allow button is rendered visible and is itself what sits
     at its own centre point (below). */
  { name: 'allow-card', owner: 'Kano', noServiceWorker: true, go: async (page) => {
    /* #4568: a device's match code is always two symbols, a dash, two symbols (kosmos-relay's match_code, e.g. K7-3M).
       This stub said '482 913', a sign-in code's shape, and its seven boxes ran past the card (every phone size in the
       #4561 shots; 24px at se, measured by the check below).
       MSHOTS_COVER_CONTROL=spill plants a code that cannot fit, so the fit check below can be seen to fail. Since
       #4637 the code is one large line that wraps at a space, so '482 913' (the old control) fits and stopped firing
       (#4893); this one has no break point and is wider than the card at every phone size. */
    const code = COVER_CONTROL === 'spill' ? 'K7M3K7M3K7M3K7M3K7M3' : 'K7-3M';
    const pending = { email: 'owner@example.com', snapshot: true, devices: [
      { device_id: 'd-sample-0001', name: 'iPhone', code, first_seen: Math.floor(Date.now() / 1000) - 40, denied_at: 0 }] };
    await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pending) }));
    await at(page, '?tab=settings&sec=plus');
    const allow = '#askcard:not([hidden]) [data-ask="allow"], #plus-asks:not([hidden]) [data-ask="allow"]';
    await page.waitForSelector(allow, { state: 'visible', timeout: 8000 });
    // MSHOTS_COVER_CONTROL=overlay: a planted full-page layer, so the check below can be seen to fail.
    if (COVER_CONTROL === 'overlay') {
      await page.evaluate(() => { const d = document.createElement('div'); d.id = 'cover-control';
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647'; document.body.appendChild(d); });
    }
    /* Visible is not seen (#4524: the Community notice covered the whole card and this wait passed). The
       point at the first laid-out Allow button's centre must be that button (or inside it), so anything drawn
       over it, or the button being outside the viewport, fails the shot. Polled for up to 3 s, so a repaint
       between two reads is not a red. */
    const whatIsAt = (sel) => {
      const b = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!b) return 'gone (no Allow button is laid out)';
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'outside the viewport (its centre is at ' + Math.round(x) + ',' + Math.round(y) + ')';
      const top = document.elementFromPoint(x, y);
      if (top && b.contains(top)) return '';
      const named = top && (top.id ? top : top.closest('[id]'));   // the nearest element with an id names the layer
      return 'covered by ' + (named ? named.tagName.toLowerCase() + '#' + named.id : top ? top.tagName.toLowerCase() : 'nothing readable');
    };
    let hit = await page.evaluate(whatIsAt, allow);
    for (const until = Date.now() + 3000; hit && Date.now() < until; hit = await page.evaluate(whatIsAt, allow)) {
      await page.waitForTimeout(200);
    }
    if (hit) throw new Error('the Allow button is not seen: ' + hit);
    /* #4568: every laid-out request card's (.askreq) code boxes must sit inside that card's padding. The page-level
       overflow audit cannot see this: the row runs past the card, not past the page. */
    const fits = (sel) => {
      const laidOut = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const cards = [...new Set([...document.querySelectorAll(sel)].filter(laidOut).map((b) => b.closest('.askreq')))];
      if (!cards.length || cards.includes(null)) return 'no .askreq card around a laid-out Allow button';
      for (const card of cards) {
        const cs = getComputedStyle(card), r = card.getBoundingClientRect();
        const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const right = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const cells = [...card.querySelectorAll('.askcodebig')];   // #4637: one large code line, was a box per character
        if (!cells.length) return 'no code in a request card';   // the stub's request always has a code
        const over = cells.map((c) => { const b = c.getBoundingClientRect(); return Math.max(b.right - right, left - b.left); });
        const out = over.filter((d) => d > 0.5);
        if (out.length) return out.length + ' of ' + cells.length + ' codes leave the card, the farthest by ' + Math.round(Math.max(...out)) + 'px';
      }
      return '';
    };
    // Polled for up to 3 s, like the hit-test.
    let spill = await page.evaluate(fits, allow);
    for (const until = Date.now() + 3000; spill && Date.now() < until; spill = await page.evaluate(fits, allow)) {
      await page.waitForTimeout(200);
    }
    if (spill) throw new Error('the code does not fit its card: ' + spill);
  } },
  /* #4637: the "wants to connect" sheet (Mona Lisa's flow outline, #4754). Two requests: another of the person's
     computers joining (#4773's joining_computer) and a phone. connect-connected is after Allow on the computer;
     connect-notice is the strip on another page. Each asserts its words, so a wrong screen fails the shot. */
  { name: 'connect-sheet', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await connectPending(page); await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /Your computer "windowsbox" wants to join/.test((document.getElementById('plus-ask-rows') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  /* #4794: a joining computer whose code is not worked out yet: the quiet line in the code's place, Allow disabled. */
  { name: 'connect-wait', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/remote/pending', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com', snapshot: true,
      devices: [{ device_id: 'd-sample-wait', name: 'laptop', code: '', first_seen: Math.floor(Date.now() / 1000) - 20, denied_at: 0, joining_computer: 'laptop', code_wait: null }] }) }));
    await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /Working out the code with laptop/.test((document.getElementById('plus-ask-rows') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  /* #5531, #5791, kosmos#6380: Join Company or Family Account opened, a company code typed, before Connect Account (which joins at once). */
  { name: 'plus-org-connect', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => { await orgConnected(page, false); await at(page, '?tab=settings&sec=plus');
    // A computer with no company sees one button first (10-08): open it the person's way.
    await page.waitForSelector('#plus-org-open', { state: 'visible', timeout: 10000 });
    await page.click('#plus-org-open');
    await page.waitForSelector('#plus-org-code', { state: 'visible', timeout: 10000 });
    await page.fill('#plus-org-code', 'NW-JOIN-4821');
    await page.evaluate(() => document.getElementById('plus-org').scrollIntoView({ block: 'start' }));
  } },
  /* #5531: Your company, this Kosmos joined. */
  { name: 'plus-org-joined', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => { await orgConnected(page, true); await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-org-in', { state: 'visible', timeout: 10000 });
    await page.evaluate(() => document.getElementById('plus-org').scrollIntoView({ block: 'start' }));
  } },
  /* kosmos#6752: the joined view listing reviewer grants of the last 30 days, one of each kind: pending (made an hour
     ago), in effect (made three days ago) and removed. Times are made from now; the names are samples. */
  { name: 'plus-org-reviewers', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => {
    const now = Math.floor(Date.now() / 1000), day = 86400;
    await orgConnected(page, true, { reviewerGrants: [
      { who: 'jordan', grantedAt: now - 3 * day, effectiveAt: now - 2 * day },
      { who: 'alex', grantedAt: now - 2 * day, effectiveAt: now - day, removedAt: now - day / 2 },
      { who: 'sam.ortiz', grantedAt: now - 3600, effectiveAt: now - 3600 + day },
    // kosmos#6817: last confirmed three days ago, so the shot shows the "last confirmed" line too.
    ], reviewerGrantsAt: (now - 3 * day) * 1000 });
    await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-org-reviewers', { state: 'visible', timeout: 10000 });
    await page.evaluate(() => document.getElementById('plus-org').scrollIntoView({ block: 'start' }));
  } },
  /* kosmos#6817 (Mona Lisa): the board's notice that someone in the company was made a reviewer, in the floating stack
     on the agents tab, with See who and its x. Two unseen grants (one notice); the name is a sample. The page reads the
     grants once a minute, so the shot asks for that read itself rather than wait for it. */
  { name: 'reviewer-notice', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    const now = Math.floor(Date.now() / 1000), day = 86400;
    const reviewerGrants = [
      { who: 'jordan', grantedAt: now - 3 * day, effectiveAt: now - 2 * day },
      { who: 'sam.ortiz', grantedAt: now - 3600, effectiveAt: now - 3600 + day },
    ];
    await orgConnected(page, true, { reviewerGrants });
    await page.route('**/api/org/grants', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ enrolled: true, kind: 'company', reviewerGrants }) }));
    await at(page, '?tab=agents');
    await page.evaluate(() => { REVIEWER_NOTE.at = 0; reviewerNoteMaybe(); });
    await page.waitForSelector('#reviewer-slot .utoast.reviewer-note', { state: 'visible', timeout: 10000 });
  } },
  /* #5787 (Mona Lisa): the connected Kosmos+ pane, where every sign-in now lands: the connect block (line art, the
     address with Copy, the Scan to connect code, the store buttons greyed with Coming soon) at the top. */
  { name: 'plus-connected', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => { await orgConnected(page, false); await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-chip .plus-store', { state: 'visible', timeout: 10000 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(1, 1);
  } },
  /* kosmos#5958 slice 2: "Where each agent stands" in Settings > Automation, with three sample rows in three states
     and the last one open, so a closed row, an open row and a row with something waiting are all in one shot. The
     board's own answer names this computer's agents and is not a shot's business, so the read is answered HERE with
     sample names. Times are made from now (the page writes a time without its year, except in the first day or so of
     a year, when the oldest of these falls in the year before). */
  { name: 'community-ready', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page) => {
    const hour = 3600000;
    const row = (session, name, owner, more) => ({ session, name, switch: 'on', addressOk: true, block: 'present', connected: false, rereadOwed: false, account: 'yes', reminder: null, lastPost: null, held: 0, ...more, owner });
    const agents = [
      row('ava', 'Ava', { summary: 'Newest post is in the community', lines: [
        { text: 'The community section is in its instructions.' },
        { text: 'It has a community account.' },
        { text: 'Kosmos last went to remind it on ', at: Date.now() - 5 * hour, after: '. Delivered.' },
        { text: 'Its newest post, “Weekly ops”, is in the community.' },
      ] }),
      row('bo', 'Bo', { summary: 'No community section in its instructions · Has not posted yet', lines: [
        { text: 'No community section in its instructions. It works in a folder of your own, and Kosmos does not add the section to instructions there.' },
        { text: 'No community account yet. Kosmos makes one the first time something it wrote goes to the community.' },
        { text: 'Kosmos has no record of going to remind it.' },
        { text: 'It has not posted yet.' },
      ] }, { block: 'absent', account: 'none' }),
      row('cy', 'Cy', { summary: '2 items waiting for you · Has not posted yet', needsYou: '2 items waiting for you', lines: [
        { text: '2 items it wrote are under Waiting for you.', needsYou: true },
        { text: 'The community section is in its instructions.' },
        { text: 'It has a community account.' },
        { text: 'Kosmos last went to remind it on ', at: Date.now() - 2 * hour, after: '. Not sent: this computer had reached its hourly limit for messages to agents.' },
        { text: 'The last reminder that reached it was on ', at: Date.now() - 26 * hour, after: '.' },
        { text: 'It has not posted yet.' },
      ] }, { held: 2 }),
    ];
    await page.route('**/api/community/ready', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents }) }));
    await at(page, '?tab=settings&sec=automation');
    await page.waitForFunction(() => { const l = document.getElementById('community-ready-list'); return l && !l.hidden && l.querySelectorAll('.community-ready-row').length === 3; }, null, { timeout: 8000 });
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#community-ready-list .community-ready-row > details');
      const last = rows[rows.length - 1];
      last.open = true;
      document.getElementById('community-ready-head').scrollIntoView({ block: 'start' });
      // The shot is the viewport only. Where the list is taller than the screen (a phone), the open row's last line
      // is what must be in it: the heading goes off the top before the open row is cut off at the bottom.
      const line = last.querySelector('p:last-of-type');
      if (line && line.getBoundingClientRect().bottom > window.innerHeight) line.scrollIntoView({ block: 'end' });
    });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    // The shot is the screen meant: three rows, the last one open, and its last line on screen (not cut off below).
    const seen = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#community-ready-list .community-ready-row > details')];
      const last = rows[rows.length - 1];
      const line = last ? last.querySelector('p:last-of-type') : null;
      const r = line ? line.getBoundingClientRect() : null;
      return { rows: rows.length, open: !!(last && last.open), lastLineOnScreen: !!(r && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight) };
    });
    if (seen.rows !== 3 || !seen.open || !seen.lastLineOnScreen) throw new Error('community-ready: not the screen meant ' + JSON.stringify(seen));
  }, after: async (page) => { await page.unroute('**/api/community/ready'); } },
  /* #4794: the computer waiting to be allowed shows the same code and "The codes match". */
  { name: 'plus-join', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await joinWaiting(page); await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /Type this code there, then press Allow/.test((document.getElementById('plus-join') || {}).innerText || ''), null, { timeout: 10000 });
  } },
  /* kosmos#6314: the same waiting computer after "The codes match": the next action leads; #6404: the code stays large (it is typed there). */
  { name: 'plus-join-matched', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => { await joinWaiting(page, true); await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /type this code on homemac, your other computer, and press Allow/.test((document.getElementById('plus-join') || {}).innerText || ''), null, { timeout: 10000 });
  } },
  /* kosmos#6353: the same waiting computer after its code ran out: nothing restarts by itself, so it offers Try again. */
  { name: 'plus-join-retry', owner: 'Angel', noServiceWorker: true, go: async (page) => { await joinWaiting(page, false, true); await at(page, '?tab=settings&sec=plus');
    await page.waitForFunction(() => /A new code is needed to finish pairing/.test((document.getElementById('plus-join') || {}).innerText || '') && !!document.getElementById('plus-join-retry'), null, { timeout: 10000 });
  } },
  /* kosmos#6314: signed in on an account whose one computer is in use: "Add this computer to your account", with the
     price as Stripe gives it. Reached with the page's own functions; the list is a stand-in with the route's shape. */
  { name: 'plus-add-computer', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-state2', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => {
      for (const id of ['plus-state1', 'plus-state3']) { const el = document.getElementById(id); if (el) el.hidden = true; }
      PLUS_SIGNIN_ACTIVE = true;
      document.getElementById('plus-state2').hidden = false;
      plusSiBoughtPick({ addresses: [{ name: 'first', address: 'first.kosmosplus.com', state: 'in_use', first_free: true }], buy_url: 'https://login.kosmosplus.com/signin', price: '$20/month' });
    });
    await page.waitForFunction(() => /Each computer you add is \$20 a month/.test((document.getElementById('plus-si-bought-none') || {}).innerText || ''), null, { timeout: 8000 });
  }, after: async (page) => { await plusSigningInEnd(page); } },
  /* #5785: the sign-in card while this computer connects (the register step): the big K loader above "Signing in...",
     the "Connecting this computer as <name>.kosmosplus.com..." line under it. Put in that state with the page's own
     functions (no coordinator here); the loader is the real one, caught mid-animation. The sign-in flags are set as a
     real sign-in sets them, so the status tick does not repaint the card away mid-shot (and the shot fails if it did). */
  { name: 'plus-signing-in', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await plusSigningIn(page, true);
  }, after: async (page) => { await plusSigningInEnd(page); } },
  /* #5785 review 3: the same wait for a typed name: its field stays on screen, so the card keeps its left alignment. */
  { name: 'plus-signing-in-name', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await plusSigningIn(page, false);
  }, after: async (page) => { await plusSigningInEnd(page); } },
  /* kosmos#5995 item 4: the sign-in's email step with its "Name for this computer" box, as the page shows it once
     the name has been read. The read is answered HERE with a sample name: the board's own answer is this Mac's real
     name, which must not be in a shot (the leak guard would stop the run, rightly). Reached with the page's own
     functions, as the two screens above are; the sign-in flag keeps the card up across the status tick. */
  { name: 'plus-signin-email', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/remote/computer-name', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'Studio Mac', fromComputer: true }) }));
    await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-state2', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => {
      for (const id of ['plus-state1', 'plus-state3']) { const el = document.getElementById(id); if (el) el.hidden = true; }
      PLUS_SIGNIN_ACTIVE = true;
      document.getElementById('plus-state2').hidden = false;
      plusSiShow('plus-si-email');
      document.getElementById('plus-signin-email').value = 'you@example.com';
    });
    await page.waitForFunction(() => { const f = document.getElementById('plus-si-computer-field'); return f && !f.hidden && document.getElementById('plus-si-computer').value === 'Studio Mac'; }, null, { timeout: 8000 });
  }, after: async (page) => { await plusSigningInEnd(page); await page.unroute('**/api/remote/computer-name'); } },
  /* kosmos#6596 step 8: a sign-in refused because Kosmos+ answered with a different key, showing that key and the two
     choices. Reached with the page's own function and a sample key (never a real one); the sign-in flag keeps the card
     up across the status tick, as the sign-in screens above. */
  { name: 'plus-key-changed', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => {
    await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-state2', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => {
      for (const id of ['plus-state1', 'plus-state3']) { const el = document.getElementById(id); if (el) el.hidden = true; }
      PLUS_SIGNIN_ACTIVE = true;
      document.getElementById('plus-state2').hidden = false;
      plusSiKeyChanged('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE');
    });
    await page.waitForFunction(() => { const p = document.getElementById('plus-si-keychanged'); return p && !p.hidden && p.getClientRects().length > 0; }, null, { timeout: 8000 });
  }, after: async (page) => { await plusSigningInEnd(page); } },
  { name: 'connect-connected', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await connectPending(page); await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-ask-rows [data-ask="allow"][data-id="d-sample-pc"]', { state: 'visible', timeout: 8000 });
    await page.fill('#askcode-d-sample-pc', '482 915');   // #6404: the code typed from the joining computer
    await page.click('#plus-ask-rows [data-ask="allow"][data-id="d-sample-pc"]');
    await page.waitForFunction(() => /windowsbox is connected\./.test((document.getElementById('plus-ask-rows') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  { name: 'connect-notice', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => { await connectPending(page); await at(page, '');
    await page.evaluate(() => { if (typeof pollAsk === 'function') return pollAsk(); });
    await page.waitForFunction(() => /want to connect to your Kosmos/.test((document.getElementById('askcard') || {}).innerText || ''), null, { timeout: 8000 });
  } },
  // Sonya: settings.
  { name: 'settings', owner: 'Sonya', go: async (page) => {
    await at(page, '?tab=settings');
    await page.waitForSelector('#panel-settings', { state: 'visible', timeout: 5000 });
  } },
  /* #5206: Settings > Advanced, where every row is an on/off switch whose 44px target is a ::after past its 42x24
     box: the tap audit must count it as the finger reaches it. */
  { name: 'settings-advanced', owner: 'Mona Lisa', go: async (page) => {
    await at(page, '?tab=settings&sec=advanced');
    await page.waitForSelector('#look-toggle', { state: 'visible', timeout: 8000 });
  } },
  /* #6514: the Diagnostics row, below the fold on both sizes, so its Save diagnostics link is in the shot. */
  { name: 'settings-diagnostics', owner: 'Angel', go: async (page) => {
    await at(page, '?tab=settings&sec=advanced');
    await page.waitForSelector('#diag-save', { state: 'visible', timeout: 8000 });
    await page.$eval('#diag-row', (el) => el.scrollIntoView({ block: 'center' }));
  } },
  { name: 'settings-accounts', owner: 'Sonya', go: async (page) => {
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 5000 });
  } },
  /* #5407: AI Models with a login inside the notice's window (warning edge, its line, Sign in again as the gold main
     action), an ended one, and a good one (green, the control), as the server sends them; only the account list is
     stubbed, with example.com accounts. */
  { name: 'settings-accounts-expiring', owner: 'Renet Tilley', noServiceWorker: true, go: async (page) => {
    const DAY = 86400000;
    const row = (email, dir, conn) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email, label: email, dir,
      organization: null, isDefault: false, keyTail: null, memoryShared: true, offerable: true, apiKey: false,
      connection: { state: 'connected', badge: 'working', checkedLive: true, plan: null, ...conn } });
    const accounts = [
      row('soon@example.com', '/home/.claude-soon', { observedFrom: 'agent', observedAgeMs: 30000, loginExpiresInDays: 2, loginExpiresAt: Date.now() + 2 * DAY + 3600000 }),
      row('ended@example.com', '/home/.claude-ended', { badge: 'signed_in_unverified', loginEnded: true }),
      row('fine@example.com', '/home/.claude-fine', { observedFrom: 'login', loginValidUntil: Date.now() + 20 * DAY }),
    ];
    await page.route((u) => new URL(u).pathname === '/api/accounts', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ accounts }) }));
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#set-accounts .acct-box.acct-expiring', { state: 'visible', timeout: 12000 });
  } },
  /* #6176: AI Models with each Claude account's weekly AND five-hour readings: one with both (the second line under the
     first), one close to its five-hour limit, and one with only a weekly reading (the control). Only the account list
     is stubbed, with example.com accounts. */
  { name: 'settings-accounts-fivehour', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    // A pinned afternoon, so the shot always shows the time-only reset form, whatever hour it is taken.
    const H = 3600000, now = (() => { const d = new Date(); d.setHours(15, 0, 0, 0); return d.getTime(); })();
    await page.clock.setFixedTime(new Date(now));
    const row = (email, dir, extra) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email, label: email, dir,
      organization: null, isDefault: false, keyTail: null, memoryShared: true, offerable: true, apiKey: false,
      connection: { state: 'connected', badge: 'working', checkedLive: true, plan: null }, agentsHere: { names: [], complete: true }, ...extra });
    const accounts = [
      row('work@example.com', '/home/.claude-work', { weekly: { usedPct: 41, resetsAt: now + 60 * H, at: now - H }, fiveHour: { usedPct: 64, resetsAt: now + 2 * H, at: now - 3 * 60000 } }),
      row('busy@example.com', '/home/.claude-busy', { weekly: { usedPct: 22, resetsAt: now + 90 * H, at: now - H }, fiveHour: { usedPct: 86, resetsAt: now + H, at: now - 60000 } }),
      row('quiet@example.com', '/home/.claude-quiet', { weekly: { usedPct: 9, resetsAt: now + 120 * H, at: now - 5 * H }, fiveHour: null }),
    ];
    await page.route((u) => new URL(u).pathname === '/api/accounts', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ accounts }) }));
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#set-accounts .acct-usage-five', { state: 'visible', timeout: 12000 });
  } },
  /* #5977: Add a provider, Qwen picked: the address and model fields (labelled), and the panel for Qwen on this
     computer. The Ollama route is stubbed (needs_model: Ollama has qwen2.5:7b, Kosmos's 16k copy is not made yet), so
     the shot never depends on this Mac's own Ollama. */
  { name: 'settings-add-qwen', owner: 'PigeonPete', noServiceWorker: true, go: async (page) => {
    const local = page.__qwenLocal || { state: 'needs_model', because: 'Ollama has qwen2.5:7b', model: 'kosmos-qwen2.5-7b-16k:latest', download: null };
    await page.route((u) => new URL(u).pathname === '/api/accounts/qwen/local', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(local) }));
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => {
      openAcctAdd();
      const sel = document.getElementById('acct-provider-pick');
      sel.value = 'alibaba';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('#acct-qwen-local', { state: 'visible', timeout: 8000 });
  } },
  /* #7206: DeepSeek while its switch is OFF (the default): the Add a provider menu, opened, lists it as coming soon. */
  { name: 'settings-add-deepseek-soon', owner: 'Baron Draxum', noServiceWorker: true, go: async (page) => {
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => { openAcctAdd(); });
    await page.waitForFunction(() => { const o = document.querySelector('#acct-provider-pick option[value="deepseek"]'); return o && o.disabled; }, null, { timeout: 5000 });
    await page.evaluate(() => {
      const t = document.getElementById('acct-provider-pick').nextElementSibling.querySelector('.pcombo-trigger');
      t.click();
    });
    await page.waitForSelector('.pcombo-list:not([hidden]) [data-value="deepseek"]', { state: 'visible', timeout: 5000 });
  } },
  /* #7206: DeepSeek while its switch is ON: the key form. The board's answer to "is DeepSeek offered" is stubbed on, as
     the Qwen screens stub theirs, so this shoots the page and needs no switch on the throwaway board. */
  { name: 'settings-add-deepseek', owner: 'Baron Draxum', noServiceWorker: true, go: async (page) => {
    await page.route((u) => new URL(u).pathname === '/api/accounts/compat', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true,
        vendors: [{ id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'], keyPage: 'https://platform.deepseek.com/api_keys' }] }) })
      : route.continue()));
    await at(page, '?tab=settings&sec=accounts');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => { openAcctAdd(); });
    await page.waitForFunction(() => { const o = document.querySelector('#acct-provider-pick option[value="deepseek"]'); return o && !o.disabled; }, null, { timeout: 5000 });
    await page.evaluate(() => {
      const sel = document.getElementById('acct-provider-pick');
      sel.value = 'deepseek';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('#acct-compat-flow', { state: 'visible', timeout: 5000 });
  } },
  /* #5977: the same step while qwen2.5:7b downloads (the bar, and the sentence written once). */
  { name: 'settings-add-qwen-downloading', owner: 'PigeonPete', noServiceWorker: true, go: async (page, data) => {
    page.__qwenLocal = { state: 'needs_download', because: 'Ollama does not have qwen2.5:7b yet', model: 'kosmos-qwen2.5-7b-16k:latest',
      download: { running: true, completed: 1.9e9, total: 4.7e9, ok: null, because: '' } };
    await SCREENS.find((s) => s.name === 'settings-add-qwen').go(page, data);
    await page.waitForSelector('#acct-qwen-local-bar', { state: 'visible', timeout: 8000 });
  } },
  /* kosmos#7198 (Josh, 08:32): the login notice's Refresh login opens the Sign in again dialog right on the Agents page.
     The notice comes from the board's own status poll with its login advisories replaced; the account list is stubbed
     so the notice's folder is a listed account. example.com accounts only. */
  { name: 'login-notice-signin-dialog', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page) => {
    const adv = { agents: ['mona'], names: ['Mona'], daysLeft: 2, severity: 'warn', expired: false, service: 's-soon',
      provider: 'Claude', email: 'soon@example.com', dir: '/home/.claude-soon' };
    await page.route((u) => new URL(u).pathname === '/api/accounts', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ accounts: [{ provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'soon@example.com', label: 'soon@example.com',
        dir: '/home/.claude-soon', organization: null, isDefault: false, keyTail: null, memoryShared: true, offerable: true, apiKey: false,
        connection: { state: 'connected', badge: 'working', checkedLive: true, plan: null } }] }) }));
    await page.route((u) => new URL(u).pathname === '/api/status', async (route) => {
      try {
        const res = await fetchBoard(route); const data = await res.json();
        data.loginAdvisories = [adv];
        await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
      } catch { await route.abort().catch(() => {}); }
    });
    await at(page, '?tab=agents');
    await page.waitForSelector('#login-adv-slot button.login-adv-go', { state: 'visible', timeout: 12000 });
    await page.click('#login-adv-slot button.login-adv-go');
    await page.waitForSelector('#acct-add-modal:not([hidden])', { state: 'visible', timeout: 5000 });
  } },
  /* #4545: Settings > Automation with the Recommender ON, so its guards list shows, scrolled to
     that box. Turning it on is stored on this run's throwaway board (so asking twice is fine).
     This board runs server.js's real start, which arms live execution, so the Recommender's
     sweep would act on the seeded agents while it is on: `after` turns it off once the shot is
     taken, before any other screen. */
  { name: 'settings-recommender', owner: 'Mona Lisa', go: async (page) => {
    const put = await page.request.put(boardUrl(page.url().split('?')[0].replace(/\/$/, '')) + '/api/recommender-setting',   // page.request is not routed: boardUrl for --remote (#5510)
      { data: { on: true }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-recommender: could not turn the Recommender on (' + put.status() + ')');
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#rec-guards-row', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('rec-guards-row').closest('.dbox').scrollIntoView({ block: 'center' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, after: async (page) => {
    const put = await page.request.put(boardUrl(page.url().split('?')[0].replace(/\/$/, '')) + '/api/recommender-setting',   // page.request is not routed: boardUrl for --remote (#5510)
      { data: { on: false }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-recommender: could not turn the Recommender back off (' + put.status() + ')');
  } },
  /* #5080: the Language box in Settings > Automation, with Spanish (Latin America) chosen; put back to Automatic after. */
  { name: 'settings-language', owner: 'Mona Lisa', go: async (page) => {
    const put = await page.request.put(boardUrl(page.url().split('?')[0].replace(/\/$/, '')) + '/api/agent-language',   // page.request is not routed: boardUrl for --remote (#5510)
      { data: { choice: 'es-419' }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-language: could not choose Spanish (' + put.status() + ')');
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#agent-language', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('agent-language').closest('.dbox').scrollIntoView({ block: 'center' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, after: async (page) => {
    const put = await page.request.put(boardUrl(page.url().split('?')[0].replace(/\/$/, '')) + '/api/agent-language',
      { data: { choice: 'auto' }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-language: could not put it back to Automatic (' + put.status() + ')');
  } },
  /* #5382: the Assigner section with its failover row (shown while the Assigner is on, which is the default), with
     failover off (its default) and on. The second puts it back off after its shot. */
  { name: 'settings-assigner', owner: 'Mona Lisa', go: async (page) => {
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#asg-fo-toggle[aria-checked="false"]', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('asg-row').closest('.dbox').scrollIntoView({ block: 'center' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  } },
  { name: 'settings-assigner-failover', owner: 'Mona Lisa', go: async (page) => {
    const put = await page.request.put(page.url().split('?')[0].replace(/\/$/, '') + '/api/assigner-setting',
      { data: { failover: true }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-assigner-failover: could not turn failover on (' + put.status() + ')');
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#asg-fo-toggle[aria-checked="true"]', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('asg-row').closest('.dbox').scrollIntoView({ block: 'center' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, after: async (page) => {
    const put = await page.request.put(page.url().split('?')[0].replace(/\/$/, '') + '/api/assigner-setting',
      { data: { failover: false }, headers: { 'sec-fetch-site': 'same-origin' } });
    if (put.status() !== 200) throw new Error('settings-assigner-failover: could not turn failover back off (' + put.status() + ')');
  } },
  /* The #718 phone-ready sweep's remaining screens (Raiden, 2026-09-25). Each
     asserts it arrived, for the same reason as the frame shots above. */
  { name: 'org-chart', owner: 'unowned', go: async (page) => {
    await page.click('button.vt[data-layout="org"]');
    await page.waitForSelector('button.vt[data-layout="org"][aria-pressed="true"]', { timeout: 5000 });
  } },
  /* kosmos#6349: the consolidated rail's project notice, capped and with more below, so its bottom fades. Grown from
     copies of the notice's own row (no invented markup) until it outruns the cap; the layout is applied, not saved, and
     every screen starts on a freshly loaded board; the style read is stubbed (stubConsolidatedStyle). Desktop only: the consolidated view exists at >= 960px. */
  { name: 'rail-notice-more', owner: 'Angel', desktopOnly: true, noServiceWorker: true, go: async (page, data) => {
    await stubConsolidatedStyle(page);   // a later style read says consolidated too, so it cannot undo the layout mid-shot
    // #6107: on a sideways tablet the tablet's own choice wins over the board's, so it says one screen too (as openConsAgents).
    await page.evaluate(() => { try { localStorage.setItem('kosmos-tablet-layout', 'consolidated'); } catch { /* storage refused */ } });
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.evaluate(() => applyLayout('consolidated', true));
    await page.waitForFunction(() => { const b = document.getElementById('alist-pj-notice'); return !!(b && b.querySelector('.pnotice')); }, null, { timeout: 8000 });
    await page.evaluate(() => {
      const box = document.getElementById('alist-pj-notice'), row = box.querySelector('.pnotice');
      box.setAttribute('aria-live', 'off');
      for (let n = 0; n < 30 && box.scrollHeight <= box.clientHeight * 1.6; n++) box.appendChild(row.cloneNode(true));
    });
    await page.waitForFunction(() => document.getElementById('alist-pj-notice').hasAttribute('data-more'), null, { timeout: 5000 });
  }, verify: async (page) => {   // at the shot: still the consolidated layout, still faded
    const ok = await page.evaluate(() => document.documentElement.getAttribute('data-layout') === 'consolidated'
      && document.getElementById('alist-pj-notice').hasAttribute('data-more'));
    if (!ok) throw new Error('rail-notice-more: the shot is not of a faded rail notice in the consolidated layout');
  } },
  /* #4594: the consolidated view's Agents column and its Grid / Org chart segmented control. The
     consolidated view exists only at >= 960px, so these are desktop-only. */
  { name: 'cons-agents', owner: 'Ice Cream Kitty', desktopOnly: true, noServiceWorker: true, go: async (page) => {
    await openConsAgents(page);
    await page.waitForSelector('#panel-cons-agents .cons-agents-lay [data-conslay="grid"][aria-checked="true"]', { timeout: 5000 });
  }, verify: consAgentsStill('grid') },
  { name: 'cons-agents-org', owner: 'Ice Cream Kitty', desktopOnly: true, noServiceWorker: true, go: async (page) => {
    await openConsAgents(page);
    await page.click('#panel-cons-agents [data-conslay="org"]', { timeout: 5000 });
    await page.waitForSelector('#panel-cons-agents [data-conslay="org"][aria-checked="true"]', { timeout: 5000 });
  }, verify: consAgentsStill('org') },
  // The design review's ask (kosmos#4594): the keyboard focus ring on a segment. A real key press, so :focus-visible shows (a scripted
  // .focus() alone may not): focus Grid, ArrowRight moves to Org chart, chooses it and keeps focus there.
  { name: 'cons-agents-focus', owner: 'Ice Cream Kitty', desktopOnly: true, noServiceWorker: true, go: async (page) => {
    await openConsAgents(page);
    await page.focus('#panel-cons-agents [data-conslay="grid"]');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.conslay === 'org'
      && document.activeElement.matches(':focus-visible'), null, { timeout: 5000 });
  }, verify: async (page) => {
    await consAgentsStill('org')(page);
    const focused = await page.evaluate(() => !!document.activeElement && document.activeElement.dataset.conslay === 'org'
      && document.activeElement.matches(':focus-visible'));
    if (!focused) throw new Error('the focus shot lost its focus ring (Org chart is not focused-visible)');
  } },
  /* kosmos#6324: the team map from the consolidated layout's Agents rail head, open, for the project. Desktop only, as
     the consolidated view is. Opening the project closes the Agents view openConsAgents opened, which is the point. */
  { name: 'cons-teammap-6324', owner: 'April', desktopOnly: true, noServiceWorker: true, go: async (page, data) => {
    await openConsAgents(page);
    await page.evaluate((id) => { PJ_TEAMMAP_OPEN.delete(String(id)); openProject(id); }, data.projectId);
    await page.waitForFunction(() => { const b = document.getElementById('alist-teammap-btn'); return b && !b.hidden && b.getClientRects().length > 0; }, null, { timeout: 8000 });
    await page.click('#alist-teammap-btn', { timeout: 5000 });
    await page.waitForFunction(() => { const m = document.getElementById('alist-teammap'); return m && !m.hidden && m.querySelector('.pjtm-node'); }, null, { timeout: 5000 });
  }, verify: async (page) => {
    const ok = await page.evaluate(() => { const m = document.getElementById('alist-teammap'); return !!m && !m.hidden && m.getClientRects().length > 0 && !!m.querySelector('.pjtm-node'); });
    if (!ok) throw new Error('the rail team map is not open with its members');
  } },
  { name: 'create-agent', owner: 'unowned', go: async (page) => {
    // A real tap (visible, not covered), the way a phone user reaches it; a hidden button fails the shot.
    await page.click('#new-agent', { timeout: 5000 });
    await page.waitForSelector('#panel-create', { state: 'visible', timeout: 5000 });
  } },
  // #4556: New Agent's second screens, each reached by a real tap on its card from the first screen.
  { name: 'create-single', owner: 'Angel', go: async (page) => {
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="single"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-role', { state: 'visible', timeout: 5000 });
  } },
  /* #4470: Create an agent in the new look, for the side by side with 'create-single'. */
  { name: 'nl-create-single', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="single"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-role', { state: 'visible', timeout: 5000 });
  } },
  { name: 'create-team', owner: 'Angel', go: async (page) => {
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="team"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-team', { state: 'visible', timeout: 5000 });
  } },
  /* #4470: Create a Team in the new look, for the side by side with 'create-team'. */
  { name: 'nl-create-team', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="team"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-team', { state: 'visible', timeout: 5000 });
  } },
  { name: 'create-swarm', owner: 'Angel', go: async (page) => {
    // Shown only when the board can run swarms; a board that cannot fails this shot (the card is hidden).
    await page.click('#new-agent', { timeout: 5000 });
    await page.click('#cstep-kind [data-path="swarm"]', { timeout: 5000 });
    await page.waitForSelector('#cstep-role', { state: 'visible', timeout: 5000 });
  } },
  { name: 'first-run', owner: 'unowned', go: async (page) => {
    await at(page, '?first-run=1');
    await page.waitForSelector('#firstrun', { state: 'visible', timeout: 5000 });
  } },
  /* kosmos#7205: the setup choice screen the Mac app shows first (its dot field, the two-computer drawings, the three
     options). The app's bridge is stood in for (it only records), and ?mode=unreadable asks even after first run. */
  { name: 'setup-choice-7205', owner: 'Mona Lisa', go: async (page) => {
    await page.addInitScript(() => { window.webkit = { messageHandlers: { kosmosMode: { postMessage() {} }, kosmosBadge: { postMessage() {} } } }; });
    await at(page, '?mode=unreadable');
    await page.waitForSelector('#fr-choice', { state: 'visible', timeout: 8000 });
    await page.waitForTimeout(600);   // the dot field settles in
  } },
  /* kosmos#7205: Welcome with Back to the setup choice (as after the choice screen in the app). */
  { name: 'setup-welcome-back-7205', owner: 'Mona Lisa', go: async (page) => {
    // Back is offered only on the Mac app's bridge (frBackOffered), so the bridge is stood in, as setup-choice-7205 does.
    await page.addInitScript(() => { window.webkit = { messageHandlers: { kosmosMode: { postMessage() {} }, kosmosBadge: { postMessage() {} } } }; });
    await at(page, '?first-run=1');
    await page.waitForSelector('#firstrun', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => { FR_CHOSE_HERE = true; FR_FORCED = false; frGo(1); });
    await page.waitForSelector('#fr-alt:not([hidden])', { timeout: 5000 });
  } },
  /* kosmos#7205: Help make Kosmos better (pane 6), the Community switch in Josh's words. */
  { name: 'setup-community-7205', owner: 'Mona Lisa', go: async (page) => {
    await at(page, '?first-run=1&fr-step=6');
    await page.waitForSelector('#fr-s6-community-lbl', { state: 'visible', timeout: 5000 });
  } },
  /* #5977: first run's Model step (pane 5), scrolled to the Qwen row, which says it is added in Settings (or, on
     Windows, that it is coming there). */
  { name: 'first-run-model', owner: 'PigeonPete', go: async (page) => {
    await at(page, '?first-run=1&fr-step=5');
    await page.waitForSelector('#fr-pane-5', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => {
      const row = document.querySelector('#fr-pane-5 [data-pmark="qwen"]');
      if (row) row.closest('.llm').scrollIntoView({ block: 'center' });
    });
  } },
  { name: 'agent-files', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    /* On a phone the agent page opens on its conversation, which hides this short Files list
       by design (it shows under Profile and the other sections), so step into Profile first. */
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-files-list .pj-doc', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('d-files').scrollIntoView({ block: 'start' }));
  } },
  { name: 'agent-files-all', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    // View All sits under the same short list, so the same step into Profile.
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-files-all', { state: 'visible', timeout: 8000 });
    await page.click('#d-files-all');
    await page.waitForSelector('#d-filesall-list .pj-doc', { state: 'visible', timeout: 5000 });
  } },
  { name: 'agent-profile', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-profile', { state: 'visible', timeout: 5000 });
  } },
  /* #5153 slice 3: Profile's Recent work. Only this page's read of the agent's receipts is faked (the throwaway board
     has no transcripts); nothing on the board changes. Task names and numbers are invented. */
  { name: 'agent-recent-work', owner: 'Angel', noServiceWorker: true, go: async (page, data) => {
    const b = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 20 });
    const day = (d) => new Date(Date.now() - d * 86400e3).toISOString();
    const mine = (files, commands, models) => ({ who: data.chatAgent, provider: 'claude', available: true, transcriptsWithWork: 1, files, filesMore: 0, commands, models });
    const receipts = [
      { project: data.projectId, projectName: 'Launch the spring catalogue', number: 1, sentence: 'Draft the product copy for every page', closedAt: day(0.2),
        receipt: mine(['copy/home.md', 'copy/linen.md', 'copy/checkout.md'], 14, { 'claude-fable-5': b(48210, 21877, 310224, 4180552) }) },
      { project: data.projectId, projectName: 'Launch the spring catalogue', number: 2, sentence: 'Check the prices against the spreadsheet', closedAt: day(1),
        receipt: mine(['prices/spring.csv'], 3, { 'claude-fable-5': b(9120, 2210, 40500, 610000) }) },
      { project: data.projectId, projectName: 'Launch the spring catalogue', number: 3, sentence: 'Book the photographer', closedAt: day(3),
        receipt: { who: data.chatAgent, provider: 'claude', available: true, transcriptsWithWork: 0, files: [], commands: 0, models: {} } },
    ];
    await page.route('**/api/agent/*/receipts**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, receipts, more: true }) }));
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    /* The Tasks tab, as a board past its threshold has it (the sample board has three tasks): "Open the Tasks page"
       shows only while that tab is in the bar, read when Recent work is drawn, so it is drawn again after. */
    await page.evaluate(() => { tskTabGate(true); return paintAgentWork(CURRENT.sessionName); });
    await page.waitForSelector('#d-work-more:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('d-work').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    /* Compared without case: innerText follows text-transform, and the heading is an uppercase kicker. */
    const t = (await page.evaluate(() => document.getElementById('d-work').innerText)).toLowerCase();
    for (const want of ['Recent work', '3 files · 14 commands', 'at API prices', 'no activity found', 'Open the Tasks page']) {
      if (!t.includes(want.toLowerCase())) throw new Error('Recent work does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  { name: 'agent-instructions', owner: 'unowned', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-instr', { state: 'visible', timeout: 5000 });
    // #4550: Instructions is inside Profile now, below the profile block; the shot is of it.
    await page.evaluate(() => document.getElementById('d-sec-instr').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(200);
  } },
  // #4550: AI Settings (Runs on, Memory and Fresh start, the terminal, Remove).
  { name: 'agent-ai-settings', owner: 'Mona Lisa', go: async (page, data) => {
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="model"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-term', { state: 'visible', timeout: 5000 });
    await page.mouse.move(1, 1);
  } },
  // Tasks is Mona Lisa and April's lane: shot and reported on #3559, not fixed here.
  { name: 'tasks', owner: 'Mona Lisa / April', go: async (page) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
  } },
  /* #6482: the status groups themselves, scrolled to: on a phone the tiles fill the first screen, so the plain tasks
     shot never shows a group heading. */
  { name: 'tasks-groups', owner: 'Angel', go: async (page) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#tsk-groups .tsk-grp h3', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.querySelector('#tsk-groups .tsk-grp').scrollIntoView({ block: 'start' }));
  } },
  /* #3029: subprojects on the Tasks view, named by their chain. Two subprojects both called Launch (one under the
     fixture project, one under a new Book B) and a long grandchild, each with a task; made ONCE per run through the
     board's own API and reused by every size and theme. tasks-subprojects groups by project with nothing picked;
     tasks-subproject-picked picks the long grandchild, so the closed select, crumb and title show it. */
  /* #6492: the Tasks view scrolled to the row waiting on the person (on a phone the tiles fill the first screen), so
     its waiting line is in the shot. #6542: only --data marketing has a question row (the default data has none), so
     the screen says needsData and any other run lists it as skipped rather than timing out. It waits for
     .tsk-waiting-who, which both forms of that line carry (the merged one-line form, for a row with a known waiting
     age, and the who line alone), so a fixture change between the two forms does not break it. */
  { name: 'tasks-decision', owner: 'PigeonPete', needsData: 'marketing', go: async (page) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#tsk-groups .tsk-row .tsk-waiting-who', { state: 'attached', timeout: 8000 });
    await page.evaluate(() => { const r = document.querySelector('#tsk-groups .tsk-row .tsk-waiting-who').closest('.tsk-row'); r.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(300);
  } },
  /* #6480: a sub-project's page, where the trail above the heading ("Parent / Launch") still shows; the control for
     project-head, where a top-level project's lone crumb is hidden in today's look. */
  { name: 'subproject-head', owner: 'PigeonPete', go: async (page, data) => {
    const ids = await subprojectFixture(page, data);
    await openTab(page, 'projects');
    // The page read its projects before the fixture was made: read them again, then open the sub-project.
    await page.evaluate(async (id) => { await loadProjects(); openProject(id); }, ids.launchA);
    try {
      await page.waitForFunction(() => { const c = document.getElementById('pj-crumb'); return !!c && !!c.querySelector('.pj-crumb-lead') && c.getClientRects().length > 0; }, null, { timeout: 8000 });
    } catch (e) {   // say what was on screen instead, so a failed shot can be put right
      const seen = await page.evaluate(() => {
        const c = document.getElementById('pj-crumb'), n = document.getElementById('pj-one-name');
        return { cur: typeof PJ_CURRENT === 'undefined' ? 'n/a' : PJ_CURRENT, view: typeof PJ_VIEW === 'undefined' ? 'n/a' : PJ_VIEW,
          crumb: c ? c.innerHTML.slice(0, 160) : null, crumbRects: c ? c.getClientRects().length : null, name: n ? n.textContent : null };
      });
      throw new Error('subproject-head: no sub-project trail on screen ' + JSON.stringify(seen) + ' (wanted ' + ids.launchA + ')');
    }
  } },
  { name: 'tasks-subprojects', owner: 'Mona Lisa', go: async (page, data) => {
    await subprojectFixture(page, data);
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
    await page.selectOption('#tsk-by', 'project');
    await page.waitForFunction(() => document.querySelectorAll('#tsk-groups .tsk-grp h3').length > 1, null, { timeout: 5000 });
  } },
  { name: 'tasks-subproject-picked', owner: 'Mona Lisa', go: async (page, data) => {
    const ids = await subprojectFixture(page, data);
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
    await page.waitForFunction((id) => !!document.querySelector('#tsk-projsel option[value="' + id + '"]'), ids.grandchild, { timeout: 5000 });
    await page.selectOption('#tsk-projsel', ids.grandchild);
    await page.waitForFunction(() => document.getElementById('tsk-crumb').textContent.includes('›'), null, { timeout: 5000 });
  } },
  /* #5456: the Tasks view with a repeating task nobody is named on, under On a schedule (not Unassigned). The task is made
     and given its rule here, and the rule is cleared after the shot. The task is made ONCE per run and reused by every
     size and theme (there is no task delete), so each shot shows the same counts. */
  { name: 'tasks-scheduled', owner: 'Angel', go: async (page, data) => {
    const n = typeof data.scheduledTask === 'number' ? data.scheduledTask : await page.evaluate(async (id) => {
      const r = await fetch('/api/project/' + encodeURIComponent(id) + '/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentence: 'Check the price list every morning' }) });
      const j = await r.json().catch(() => ({}));
      return r.status === 200 ? ((j.task && j.task.number) || j.number || null) : 'status ' + r.status;
    }, data.projectId);
    if (typeof n !== 'number') throw new Error('could not add the task (' + n + ')');
    const st = await page.evaluate(([id, num]) => fetch('/api/project/' + encodeURIComponent(id) + '/task/' + num + '/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ every: 'day', at: '09:00' }) }).then((r) => r.status), [data.projectId, n]);
    if (st !== 200) throw new Error('could not set the repeat rule (' + st + ')');
    data.scheduledTask = n;
    await at(page, '?tab=tasks');
    await page.waitForSelector('#tsk-tiles [data-tile="scheduled"]', { state: 'visible', timeout: 8000 });
  }, after: async (page, data) => {
    if (typeof data.scheduledTask !== 'number') return;
    const st = await page.evaluate(([id, num]) => fetch('/api/project/' + encodeURIComponent(id) + '/task/' + num + '/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }).then((r) => r.status), [data.projectId, data.scheduledTask]);
    if (st !== 200) throw new Error('could not clear the repeat rule after the shot (' + st + ')');
  } },
  /* kosmos#5836 (Angel): a repeating task whose latest reading changed since the person was last told: its page's
     repeat line says both, the new value first. Its own task, closed in `after`, since what the
     person was told outlives the rule by design and would otherwise show on a later screen. */
  { name: 'task-told-5836', owner: 'Angel', go: async (page, data) => {
    const post = (path, body) => page.evaluate(([pth, b]) => fetch(pth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) })), [path, body]);
    const base = '/api/project/' + encodeURIComponent(data.projectId);
    const made = await post(base + '/tasks', { sentence: 'Check the supplier price every morning' });
    const n = made.status === 200 ? ((made.json.task && made.json.task.number) || made.json.number) : null;
    if (typeof n !== 'number') throw new Error('could not add the task (' + made.status + ')');
    data.toldTask = n;
    for (const [what, body] of [['repeat', { every: 'day', at: '09:00' }], ['told', { value: 'price is $40' }], ['ran', { note: 'checked the supplier page', value: 'price is $45' }]]) {
      const r = await post(base + '/task/' + n + '/' + what, body);
      if (r.status !== 200) throw new Error('could not ' + what + ' (' + r.status + ')');
    }
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async (num) => { await pjReload(); openTaskPage(num); }, n);
    await page.waitForSelector('#tk-repeat-line:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('tk-repeat-row').scrollIntoView({ block: 'center' }));
  }, verify: async (page) => {
    const t = await page.evaluate(() => (document.getElementById('tk-repeat-line') || {}).textContent || '');
    if (!/Its latest check found \u201cprice is \$45\u201d\. You were last told \u201cprice is \$40\u201d \(/.test(t)) throw new Error('the repeat line says: ' + JSON.stringify(t));
  }, after: async (page, data) => {
    if (typeof data.toldTask !== 'number') return;
    const st = await page.evaluate(([id, num]) => fetch('/api/project/' + encodeURIComponent(id) + '/task/' + num + '/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status), [data.projectId, data.toldTask]);
    if (st !== 200) throw new Error('could not close the task after the shot (' + st + ')');
    data.toldTask = null;
  } },
  /* #6923: a task closed as replaced by a later one, and the later one's page. Each screen adds its own pair of tasks,
     closes the first as replaced by the second, opens one of them, and closes both plainly after the shot. */
  { name: 'task-replaced-6923', owner: 'Angel', ...replaced6923('replaced') },
  { name: 'task-replaces-6923', owner: 'Angel', ...replaced6923('replaces') },
  { name: 'tasks-replaced-6923', owner: 'Angel', ...replaced6923('card') },
  /* #5053: one project's Tasks view, with its back chevron beside the title. The built-in seed's project name is long
     enough to wrap on a phone, so the shot shows the title wrapping beside the chevron (a store data set's may not). */
  { name: 'project-tasks', owner: 'PigeonPete', go: async (page, data) => {
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
    await page.evaluate((id) => openProjectTasks(id), data.projectId);
    await page.waitForSelector('#tsk-back:not([hidden])', { state: 'visible', timeout: 5000 });
  } },
  /* #5200: one open task's page (the seed's task 1), with its parts' Change who and Done links, for the phone tap
     audit: every control there should be a 44px target on a touch screen. */
  { name: 'task-page', owner: 'Mona Lisa', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#pj-task-view:not([hidden]) #tk-say', { state: 'visible', timeout: 8000 });
  } },
  /* kosmos#6501: a parent whose subtasks are all built or closed offers "Close them and this task", on its own page.
     A throwaway project (the shared one keeps its tasks for the other screens), deleted after the shot. */
  { name: 'task-rollup-6501', owner: 'PigeonPete', go: async (page, data) => {
    const id = await page.evaluate(async ([name, chat]) => {
      const call = (m, url, body) => fetch(url, { method: m, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const made = await (await call('POST', '/api/projects', { name, agents: [chat] })).json().catch(() => ({}));
      const pid = made && made.project && made.project.id;
      if (!pid) throw new Error('task-rollup-6501: the board made no project');
      const base = '/api/project/' + encodeURIComponent(pid);
      const tasks = [['Ship the autumn brochure', null], ['Draft the copy', 1], ['Lay out the pages', 1], ['Old proof', 1]];
      for (const [sentence, parent] of tasks) {
        const r = await call('POST', base + '/tasks', { sentence, who: chat, ...(parent ? { parent } : {}) });
        if (r.status !== 200) throw new Error('task-rollup-6501: a task was refused (' + r.status + ')');
      }
      for (const n of [2, 3]) {
        const r = await call('POST', base + '/task/' + n + '/built', {});
        if (r.status !== 200) throw new Error('task-rollup-6501: marking ' + n + ' built answered ' + r.status);
      }
      const c = await call('POST', base + '/task/4/close', {});
      if (c.status !== 200) throw new Error('task-rollup-6501: closing 4 answered ' + c.status);
      return pid;
    }, [ROLLUP_6501, data.chatAgent]);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${id}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#tk-subs-built:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('tk-subs-built').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
  }, after: async (page) => { await throwawayProjectGone(page, ROLLUP_6501); } },
  /* kosmos#7184: what a held task waits for, on its page: held (from the screen) until task 2 closes, or until a time two
     days ahead at 9:30 in the shot's own clock. A throwaway project, deleted after the shot. */
  { name: 'task-holduntil-7184', owner: 'Mona Lisa', go: async (page, data) => { await holdUntil7184(page, data, 'task'); },
    after: async (page) => { await throwawayProjectGone(page, HOLDUNTIL_7184.task); } },
  { name: 'task-holdtime-7184', owner: 'Mona Lisa', go: async (page, data) => { await holdUntil7184(page, data, 'at'); },
    after: async (page) => { await throwawayProjectGone(page, HOLDUNTIL_7184.at); } },
  /* kosmos#4787 slice 1b: the task page's Repeats control with a rule set (every Tuesday at 10:30am), scrolled to it. */
  { name: 'task-repeat', owner: 'Mona Lisa', go: async (page, data) => {
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ every: 'week', on: 'tue', at: '10:30' }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not set the repeat rule (' + st + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#tk-repeat-line:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('tk-repeat-row').scrollIntoView({ block: 'center' }));
  }, after: async (page, data) => {   // put the task back to a one-off, so no later screen shows the rule
    const st = await page.evaluate((id) => fetch('/api/project/' + encodeURIComponent(id) + '/task/1/repeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }).then((r) => r.status), data.projectId);
    if (st !== 200) throw new Error('could not clear the repeat rule after the shot (' + st + ')');
  } },
  /* #5444: Token Usage while it reads (the #5362 spinner beside the reading line). The usage read is held open, so
     the shot is the loading state and never the figures. */
  { name: 'usage-loading', owner: 'Mona Lisa', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/usage*', () => {});   // never answered: the page stays on its reading line
    await at(page, '?tab=settings&sec=usage');
    await page.waitForSelector('#usage-msg .spin', { state: 'visible', timeout: 8000 });
  }, verify: async (page) => {
    const t = await page.evaluate(() => document.getElementById('usage-msg').innerText);
    if (!/Reading the transcripts/.test(t)) throw new Error('Token Usage is not on its reading line: ' + JSON.stringify(t));
  } },
  /* #5444 (#4787 slice 2): a daily task whose rule was set three days ago and has never run, so its line leads with
     the missed runs in red. The fields come from the engine's own taskrepeat.fieldsOf, so the words are the board's. */
  { name: 'task-missed', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    const taskrepeat = require(path.join(REPO, 'engine', 'taskrepeat'));
    await editProjects(page, data.projectId, (proj) => {
      for (const t of proj.tasks || []) {
        if (t.number !== 1) continue;
        t.repeat = taskrepeat.normalise({ every: 'day', at: '09:00' });
        t.repeatSetAt = new Date(Date.now() - 3 * 864e5).toISOString();
        Object.assign(t, taskrepeat.fieldsOf(t));
      }
    });
    await openTaskOne(page, data.projectId);
    await page.waitForSelector('#tk-repeat-line.missed:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('tk-repeat-row').scrollIntoView({ block: 'center' }));
  }, verify: async (page) => {
    const t = await page.evaluate(() => document.getElementById('tk-repeat-line').innerText);
    if (!/^Missed /.test(t)) throw new Error('the repeat line does not lead with a missed run: ' + JSON.stringify(t));
  } },
  /* #5444 (#5287): a joined project's header, with who shared it and what they wrote. The owner name is invented. */
  { name: 'project-shared', owner: 'Mona Lisa', noServiceWorker: true, go: async (page, data) => {
    await editProjects(page, data.projectId, (proj) => {
      proj.shared = { owner: 'harbourstudio', description: 'Our spring range, from first sketches to the shop pages.' };
      // As the join route makes it (server.js /api/federation/join: made via 'screen'), so the header shows no
      // "Made by an agent ... on this computer" line, which a project joined from another computer never has.
      proj.made = { via: 'screen', by: null };
    });
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-shared:not([hidden])', { state: 'visible', timeout: 8000 });
  }, verify: async (page) => {
    const t = await page.evaluate(() => document.getElementById('pj-one-shared').innerText);
    if (!t.includes('Shared by harbourstudio.kosmosplus.com.')) throw new Error('the project header does not say who shared it: ' + JSON.stringify(t));
    if (await page.isVisible('#pj-one-made')) throw new Error('a joined project shows a Made by line it would not have');
  } },
  /* kosmos#4658 part B: the sealed-room key section in a project's Members card, both sides. Federation is turned
     on through the status poll, and the two reads the section makes are answered with fixed codes. */
  { name: 'ownseal-waiting-4658', owner: 'Baron Draxum', noServiceWorker: true, go: async (page, data) => {
    await ownsealScreen(page, data, { code: 'K7M3P-Q9RXA' }, { computers: [] });
  } },
  /* The line above the room on a phone (Mona's review): the waiting computer's project at the top of the page. */
  { name: 'ownseal-room-line-4658', owner: 'Baron Draxum', noServiceWorker: true, phoneOnly: true, go: async (page, data) => {
    await ownsealScreen(page, data, { code: 'K7M3P-Q9RXA' }, { computers: [] });
    await page.waitForSelector('#pj-fed-own-phone:not([hidden])', { state: 'visible', timeout: 10000 });
    await page.evaluate(() => document.getElementById('pj-fed-own-phone').scrollIntoView({ block: 'start' }));
  } },
  { name: 'ownseal-allow-4658', owner: 'Baron Draxum', noServiceWorker: true, go: async (page, data) => {
    await ownsealScreen(page, data, { code: null }, { computers: [
      { pub: 'pub-sample-1', mac: 'mac-sample-1', code: 'ABCDE-FGHJK', at: 1 },
      { pub: 'pub-sample-2', mac: 'mac-sample-2', code: '23456-789AB', at: 2 }] });
  } },
  /* kosmos#4658 with #7028: the computers the room let in, each with Remove, under the waiting one; and the dialog
     Remove opens (asked first, the #761 dialog). */
  { name: 'ownremove-rows-4658', owner: 'Baron Draxum', noServiceWorker: true, go: async (page, data) => {
    await ownremoveScreen(page, data);
  } },
  { name: 'ownremove-dialog-4658', owner: 'Baron Draxum', noServiceWorker: true, go: async (page, data) => {
    await ownremoveScreen(page, data);
    await page.click('#pj-fed-own [data-own-act="remove"][data-own-pub="pub-sample-4"]');
    await page.waitForSelector('#mem-modal:not([hidden])', { state: 'visible', timeout: 10000 });
  } },
  /* #4470: the Tasks view in the new look, for the side by side with 'tasks'. */
  { name: 'nl-tasks', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await at(page, '?tab=tasks');
    await page.waitForSelector('#panel-tasks', { state: 'visible', timeout: 5000 });
  } },
  /* #4470, the Projects list in the new look: its grid (the default) and its roadmap, and the roadmap with the look off
     to set beside it. */
  { name: 'nl-projects', owner: 'Mona Lisa', go: async (page) => { await newLook(page); await openTab(page, 'projects'); } },
  { name: 'projects-roadmap', owner: 'Mona Lisa', go: async (page) => {
    await openTab(page, 'projects');
    await page.click('#pj-list-view button.vt[data-layout="roadmap"]');
    await page.waitForSelector('#pj-list-view button.vt[data-layout="roadmap"][aria-pressed="true"]', { timeout: 5000 });
  } },
  { name: 'nl-projects-roadmap', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await openTab(page, 'projects');
    await page.click('#pj-list-view button.vt[data-layout="roadmap"]');
    await page.waitForSelector('#pj-list-view button.vt[data-layout="roadmap"][aria-pressed="true"]', { timeout: 5000 });
  } },
  /* #4470, a project's Documents screen (opened from the project page's Files), with the look off and on. */
  { name: 'project-docs', owner: 'Mona Lisa', go: async (page, data) => {
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.click('#pj-docs-all');
    await page.waitForSelector('#pj-docs-view', { state: 'visible', timeout: 8000 });
    /* Shown by hand, as in nl-project-docs, so the pair compares the switch like for like. */
    await page.evaluate(() => { const sw = document.getElementById('docs-seg'); if (sw) sw.hidden = false; });
  } },
  { name: 'nl-project-docs', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.click('#pj-docs-all');
    await page.waitForSelector('#pj-docs-view', { state: 'visible', timeout: 8000 });
    /* The sample room has no files, so the folder / conversation switch is hidden; shown by hand for the shot. */
    await page.evaluate(() => { const sw = document.getElementById('docs-seg'); if (sw) sw.hidden = false; });
  } },
  /* #4470: an agent's page in the new look, for the side by side with 'agent-chat' and 'agent-profile'. */
  { name: 'nl-agent-chat', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await at(page, '?agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="talk"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-talk', { state: 'visible', timeout: 5000 });
  } },
  /* #4470: Settings in the new look, for the side by side with 'settings'. */
  { name: 'nl-settings', owner: 'Mona Lisa', go: async (page) => {
    await newLook(page);
    await at(page, '?tab=settings');
    await page.waitForSelector('#panel-settings', { state: 'visible', timeout: 5000 });
  } },
  { name: 'nl-agent-profile', owner: 'Mona Lisa', go: async (page, data) => {
    await newLook(page);
    await at(page, '?tab=detail&agent=' + data.chatAgent);
    await page.locator('#d-nav button[data-go="profile"]').first().click({ timeout: 5000 });
    await page.waitForSelector('#d-sec-profile', { state: 'visible', timeout: 5000 });
  } },
  /* #4994: what deleting an agent does to its community account, on the three screens that say it.
     leftover-delete is the REAL engine's plan (engine/delete-leftover.js), for the removed agent `rex` that seedFiles
     writes when this screen is asked for (folder, auto-start file, removed record, a community key, and a Trash). The
     two Community lists are stubbed READS in this screen's own context, in the routes' shapes
     (communitystore.moderationQueue rows; communitymine.mine() rows), so nothing on the board is written. */
  { name: 'leftover-delete', owner: 'Angel', go: async (page) => {
    await page.waitForSelector('#removed-toggle', { state: 'visible', timeout: 8000 });
    if ((await page.getAttribute('#removed-toggle', 'aria-expanded')) !== 'true') await page.click('#removed-toggle');
    await page.click(`[data-delete-leftover="${LEFTOVER.claim}"]`, { timeout: 5000 });
    await page.waitForSelector('#del-modal:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.mouse.move(1, 1);
  }, verify: async (page) => {
    const t = await page.evaluate(() => { const m = document.getElementById('del-modal'); return m && !m.hidden ? m.innerText : ''; });
    for (const want of ['Its community account: anything it posted there stays up', 'Its community account does not come back']) {
      if (!t.includes(want)) throw new Error('the delete confirmation does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  { name: 'community-held-deleted', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    const rows = [
      { id: 'c-ada-1', entry: 'comment', status: 'held', remotePostId: '1b2c3d4e-0000-4000-8000-000000004994', author: { type: 'agent', name: 'Ada' }, body: 'Same here, a template made the weekly report much quicker.', receivedAt: '2026-10-01T08:00:00Z' },
      { id: 'c-rex-1', entry: 'comment', status: 'held', remotePostId: '1b2c3d4e-0000-4000-8000-000000004994', notSent: true, author: { type: 'agent', name: LEFTOVER.name }, body: 'I tried this on the catalogue and it worked.', receivedAt: '2026-10-01T08:05:00Z' },
    ];
    await page.route('**/api/community/moderation**', (r) => {
      const status = new URL(r.request().url()).searchParams.get('status');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queue: rows.filter((x) => !status || x.status === status) }) });
    });
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#community-held-list li[data-id="c-rex-1"]', { state: 'visible', timeout: 8000 });
    /* The heading at the top, unless that leaves the deleted agent's row cut off (a phone): then that row in the middle.
       Checked again after a pause and redone (up to 3 s), since the list repaints on its own poll. */
    const place = () => page.evaluate(() => {
      document.getElementById('community-held-head').scrollIntoView({ block: 'start' });
      const li = document.querySelector('#community-held-list li[data-id="c-rex-1"]');
      if (li && li.getBoundingClientRect().bottom > innerHeight) li.scrollIntoView({ block: 'center' });
    });
    const whole = () => page.evaluate(() => {
      const li = document.querySelector('#community-held-list li[data-id="c-rex-1"]');
      const r = li ? li.getBoundingClientRect() : null;
      return !!(r && r.top >= 0 && r.bottom <= innerHeight);
    });
    await page.mouse.move(1, 1);
    for (const until = Date.now() + 3000; ;) {
      await place();
      await page.waitForTimeout(400);
      if (await whole() || Date.now() > until) break;
    }
  }, verify: async (page) => {
    const got = await page.evaluate(() => {
      const li = document.querySelector('#community-held-list li[data-id="c-rex-1"]');
      const r = li ? li.getBoundingClientRect() : null;
      return { text: li ? li.innerText : '', inView: !!(r && r.top >= 0 && r.bottom <= innerHeight),
        at: r ? [Math.round(r.top), Math.round(r.bottom), innerHeight, Math.round(scrollY)] : null };
    });
    if (!got.text.includes('Its agent was deleted, so releasing it never sends it to the public community.')) throw new Error('the deleted agent\'s held row does not say it is never sent: ' + JSON.stringify(got.text));
    if (!got.inView) throw new Error('the deleted agent\'s held row is not wholly on screen (top, bottom, viewport, scrollY): ' + JSON.stringify(got.at));
  } },
  /* #7211: what Settings shows in place of every post and comment: the count, each agent's community page, and the
     rows folded away (closed). The answer is the board's own shape (engine/communitymine.js summary). */
  { name: 'community-index', owner: 'April', noServiceWorker: true, go: async (page) => {
    const base = { deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, agentNameUnclaimed: false, deleteRetrying: false };
    const posts = [
      { id: 'p-ada-1', title: 'Writing captions before the photos arrive', agent: 'Ada', postedAt: '2026-10-25T11:00:00.000Z', state: 'sent', ...base, canDelete: true },
      { id: 'p-ivo-1', title: 'A slow runner changed our test order', agent: 'Ivo', postedAt: '2026-10-24T11:00:00.000Z', state: 'sent', ...base, canDelete: true },
    ];
    const summary = { posts: 412, comments: 1438, agents: [
      { agent: 'Ada', name: 'Ada-writes', posts: 230, comments: 801 },
      { agent: 'Ivo', name: 'Ivo-ops', posts: 182, comments: 637 },
    ] };
    await page.route('**/api/community/mine', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ posts, comments: [], summary }) }));
    await at(page, '?tab=settings&sec=automation');
    await page.waitForSelector('#community-mine-summary:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('community-mine-head').scrollIntoView({ block: 'start' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = await page.evaluate(() => ({
      line: document.getElementById('community-mine-summary').textContent,
      links: document.getElementById('community-mine-links').textContent,
      closed: document.getElementById('community-mine-all').open === false,
    }));
    // The count is written in the page's own number format (toLocaleString), so the expected line is built the same way.
    const want = await page.evaluate(() => 'Your agents have ' + (412).toLocaleString() + ' posts and ' + (1438).toLocaleString() + ' comments in the community.');
    if (t.line !== want) throw new Error('the summary line reads ' + JSON.stringify(t.line));
    if (!/Ada, Ivo\.$/.test(t.links)) throw new Error('the links line reads ' + JSON.stringify(t.links));
    if (!t.closed) throw new Error('the fold is open by default');
  } },
  { name: 'community-mine-deleted', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    const base = { deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, agentNameUnclaimed: false, deleteRetrying: false };
    const posts = [
      { id: 'p-rex-2', title: 'Three tries at the weekly report template', agent: LEFTOVER.claim + ' (deleted agent)', postedAt: '2026-10-01T09:00:00.000Z', state: 'not_sent', ...base, canDelete: false },
      { id: 'p-rex-1', title: 'What I learned pricing the linen range', agent: LEFTOVER.claim + ' (deleted agent)', postedAt: '2026-09-30T15:00:00.000Z', state: 'sent', ...base, canDelete: true },
      { id: 'p-ada-1', title: 'Writing captions before the photos arrive', agent: 'Ada', postedAt: '2026-09-29T11:00:00.000Z', state: 'sent', ...base, canDelete: true },
    ];
    // #7211: with the board's summary, as a board on this branch answers.
    const summary = { posts: 2, comments: 0, agents: [{ agent: 'Ada', name: 'Ada-writes', posts: 1, comments: 0 }] };
    await page.route('**/api/community/mine', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ posts, comments: [], summary }) }));
    await at(page, '?tab=settings&sec=automation');
    // #7211: the rows are in a fold, closed by default; this shot is of the rows, so it opens it.
    await page.waitForSelector('#community-mine-all:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => { document.getElementById('community-mine-all').open = true; });
    await page.waitForSelector('#community-mine-list li[data-id="p-rex-2"]', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('community-mine-head').scrollIntoView({ block: 'start' }));
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = await page.evaluate(() => { const l = document.getElementById('community-mine-list'); return l && !l.hidden ? l.innerText : ''; });
    for (const want of ['Not sent. It stayed on this computer.', LEFTOVER.claim + ' (deleted agent)']) {
      if (!t.includes(want)) throw new Error('the community list does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },  /* #5153: a closed task's change receipt. The board is NOT changed (review 4: a real close would show task 1 closed on
     every later pass of every other screen): this page's own read of the projects marks task 1 closed, and the receipt's
     answer is faked, since the throwaway board has no agent transcripts to read. The folder is invented, never this Mac's. */
  { name: 'task-receipt', owner: 'Angel', noServiceWorker: true, go: async (page, data) => {
    const b = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 40 });
    const receipt = { version: 1, closedAt: new Date(Date.now() - 3600e3).toISOString(), retries: { reopened: 1, handoffs: 1 }, agents: [
      { who: data.chatAgent, provider: 'claude', available: true, transcriptsWithWork: 2, commands: 14, filesMore: 0,
        folder: '/Users/ada/Kosmos/spring-catalogue', models: { 'claude-fable-5': b(48210, 21877, 310224, 4180552) },
        files: ['copy/home.md', 'copy/linen-range.md', 'copy/checkout.md', 'prices/spring.csv'] },
      { who: data.askAgent, provider: 'codex', available: false, because: 'provider' },
    ] };
    await page.route('**/api/project/*/task/*/receipt', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receipt) }));
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      let res, body;
      try { res = await fetchBoard(route); body = await res.json(); } catch { await route.abort().catch(() => {}); return; }
      for (const proj of body.projects || []) {
        if (proj.id !== data.projectId) continue;
        for (const t of proj.tasks || []) {
          if (t.number !== 1) continue;
          t.closedAt = receipt.closedAt;
          if (t.progress) t.progress.closed = true;
        }
      }
      try { await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-type': 'application/json' } }); } catch { await route.abort().catch(() => {}); }   // #6022
    });
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-one-view', { state: 'visible', timeout: 8000 });
    await page.evaluate(async () => { await pjReload(); openTaskPage(1); });
    await page.waitForSelector('#tk-receipt:not([hidden]) .tkr-agent', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => {
      const b = document.querySelector('#tk-receipt .tkr-files-btn');
      if (b) b.click();   // the files list open, as a person would have it
      document.getElementById('tk-receipt').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    /* Compared without case: innerText follows text-transform, and the heading is the column's uppercase kicker. */
    const t = (await page.evaluate(() => document.getElementById('tk-receipt').innerText)).toLowerCase();
    for (const want of ['Receipt', 'ran 14 commands', 'at API prices', 'not available for Codex agents yet', 'put back 1 time']) {
      if (!t.includes(want.toLowerCase())) throw new Error('the receipt does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },  /* #5153 slice 4: the undo list under a closed task's receipt, opened, with each kind of row. Only this page's reads
     are faked (the receipt screen's, plus the undo plan); the board is not changed. Paths are invented. */
  { name: 'task-undo', owner: 'Angel', noServiceWorker: true, go: async (page, data) => {
    const f = (name, extra) => ({ path: '/Users/ada/Kosmos/spring-catalogue/' + name, shown: name, agent: data.chatAgent, action: 'restore', copyId: 'x', ok: true, ...extra });
    const plan = { on: true, ready: true, savedRoot: '/Users/ada/Library/Application Support/Kosmos/undo-saved', files: [
      f('copy/home.md'), f('copy/linen-range.md'), f('copy/new-page.md', { action: 'move-aside' }),
      f('prices/spring.csv', { ok: false, why: 'shared' }), f('copy/checkout.md', { ok: false, why: 'changed-since' }) ] };
    await page.route('**/api/project/*/task/*/undo', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) }));
    await SCREENS.find((x) => x.name === 'task-receipt').go(page, data);
    await page.waitForSelector('#tk-undo:not([hidden]) [data-undo="open"]', { state: 'visible', timeout: 8000 });
    await page.click('#tk-undo [data-undo="open"]');
    await page.waitForSelector('#tk-undo .tku-list', { state: 'visible', timeout: 5000 });
    await page.evaluate(() => document.getElementById('tk-undo').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = (await page.evaluate(() => document.getElementById('tk-undo').innerText)).toLowerCase();
    for (const want of ['undo', 'goes back to how it was before this task', 'moved into kosmos’s undo folder', 'another agent also edited it', 'changed after the task closed', 'undo the chosen files']) {
      if (!t.includes(want)) throw new Error('the undo list does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  /* #5153 slice 4: the undo switch in Settings > Advanced, shown on (only this page's read of the setting is faked). */
  { name: 'settings-undo', owner: 'Angel', noServiceWorker: true, go: async (page) => {
    await page.route('**/api/undo-setting', (r) => (r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ on: true, ok: true }) }) : r.fallback()));
    await at(page, '?tab=settings&sec=advanced');
    await page.waitForSelector('#undo-toggle:not([hidden])', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => document.getElementById('undo-row').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = (await page.evaluate(() => document.getElementById('undo-row').innerText)).toLowerCase();
    for (const want of ['keep a copy before an agent edits a file', 'turning this off deletes them', 'private files such as .env included']) {
      if (!t.includes(want)) throw new Error('the undo switch row does not say "' + want + '": ' + JSON.stringify(t.slice(0, 400)));
    }
  } },
  /* kosmos#5752 slice 3 (PigeonPete): an agent not on the project was refused a task write, and the room offers the
     person "Add <name> to this project". The refused row is the one the board writes (engine/messages.js
     logRoomRefusal), appended to this throwaway board's log; the agent is the second project's, a live board agent that
     is not on this one. `after` takes that exact line out again, so no other screen's room shows it in any pass (the
     passes share one board: a row left in would reach project-room's dark and phone shots). */
  { name: 'project-room-refused-5752', owner: 'PigeonPete', go: async (page, data) => {
    const storeRoot = require(path.join(REPO, 'engine', 'store')).ROOT;
    data.refusedLine = JSON.stringify({ kind: 'refused', from: data.outsider, to: data.projectId,
      project: data.projectId, because: 'that agent is not on this project, so it cannot change its tasks', doing: 'record a run of a task',
      addable: true, at: new Date().toISOString() });
    fs.appendFileSync(path.join(storeRoot, 'messages.jsonl'), data.refusedLine + '\n');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-room [data-add-member]', { state: 'visible', timeout: 10000 });
    await page.evaluate(() => { const b = document.querySelector('#pj-room [data-add-member]'); if (b) b.closest('.msg-valve').scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(300);
  }, verify: async (page) => {
    const t = await page.evaluate(() => { const b = document.querySelector('#pj-room [data-add-member]'); return b ? b.closest('.msg-valve').innerText : ''; });
    for (const want of ['tried to record a run of a task here and Kosmos stopped it', 'to this project']) {
      if (!t.includes(want)) throw new Error('the refused row does not say "' + want + '": ' + JSON.stringify(t.slice(0, 300)));
    }
  }, after: async (page, data) => {
    if (!data.refusedLine) return;
    const file = path.join(require(path.join(REPO, 'engine', 'store')).ROOT, 'messages.jsonl');
    const kept = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== data.refusedLine);
    fs.writeFileSync(file, kept.join('\n'));
    data.refusedLine = null;
  } },
  /* kosmos#5800 (Angel): the loop guard is holding the room, and the strip at the top of the sticky composer (#pj-held) says why and
     who can end it, with a Reopen button. A hold is a valve row plus agent posts filling the room's budget
     (engine/messages.js roomHeld), so both are appended in the shapes sendPost writes, and `after` takes exactly those
     lines out again, as the #5752 screen above does. */
  { name: 'project-room-held-5800', owner: 'Angel', go: async (page, data) => {
    const storeRoot = require(path.join(REPO, 'engine', 'store')).ROOT;
    /* #6420: the room's budget scales with its size (engine/messages.js roomCap), so the seed fills THIS project's
       budget, sized as the room route and the valve size it (messages.roomRecipientsOf). */
    const msgs = require(path.join(REPO, 'engine', 'messages'));
    const proj = require(path.join(REPO, 'engine', 'projects')).readAll().find((x) => x && x.id === data.projectId);
    if (!proj) throw new Error('#6420: the seeded project ' + data.projectId + ' is not in the registry, so its budget cannot be read');
    const size = msgs.roomRecipientsOf(proj.agents);
    const cap = msgs.roomCap(require(path.join(REPO, 'engine', 'limits')).caps(), size);
    const to = Array.from({ length: cap }, (_, i) => 'member' + (i + 1));
    const ago = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
    data.heldLines = [
      JSON.stringify({ kind: 'post', id: 'm5800001', from: data.chatAgent, project: data.projectId, to,
        outcomes: Object.fromEntries(to.map((n) => [n, 'placed'])), text: 'Handing the draft back for one more pass.', at: ago(6) }),
      JSON.stringify({ kind: 'valve', from: data.chatAgent, to: data.projectId, project: data.projectId,
        because: 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.',
        stopped: true, at: ago(4) }),
      /* #6925: one agent's summary that went through the hold (#6920 stores closing: true), so the shot shows its label. */
      JSON.stringify({ kind: 'post', id: 'm5800002', from: data.chatAgent, project: data.projectId, to: ['member1'],
        outcomes: { member1: 'placed' }, closing: true, at: ago(2),
        text: 'Where we landed: the draft goes back for one more pass on the second section, the figures stay as they are, '
          + 'and the summary at the top is rewritten in plain words. Nothing else is open here; I will wait for you before posting again.' }),
    ];
    fs.appendFileSync(path.join(storeRoot, 'messages.jsonl'), data.heldLines.join('\n') + '\n');
    // The premise, checked here rather than read off a later timeout: the room reads held at its own size.
    if (!msgs.roomHeld(data.projectId, Date.now(), size)) throw new Error('#6420: the seed did not hold the room at its own budget (' + cap + ')');
    await openTab(page, 'projects');
    await page.click(`#pj-list .pj-row[data-project="${data.projectId}"]`);
    await page.waitForSelector('#pj-held [data-reopen-room]', { state: 'visible', timeout: 10000 });
    /* NO SCROLL, on purpose: the shot is taken where a held room OPENS, which is the case the strip exists for. The first
       shots of this screen (strip then above the sticky composer in the flow) passed a visible-wait yet showed no strip,
       because at the opening scroll the composer covered it: visible is not seen (#4524). The strip now sits inside the
       composer; gate the SHOT here, as the #4524 screen does, since the runner calls verify only after the picture. The
       point at the Reopen button's centre must be that button: anything drawn over it, or the button outside the
       viewport, fails before the shot. Polled for up to 3 s, so a repaint between two reads is not a red; verify reads
       it again after the shot, so a move that is still there then fails too. */
    // MSHOTS_COVER_CONTROL=overlay: a planted full-page layer, so the check below can be seen to fail.
    if (COVER_CONTROL === 'overlay') {
      await page.evaluate(() => { const d = document.createElement('div'); d.id = 'cover-control';
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647'; document.body.appendChild(d); });
    }
    let hit = await page.evaluate(heldReopenAt);
    for (const until = Date.now() + 3000; hit && Date.now() < until; hit = await page.evaluate(heldReopenAt)) await page.waitForTimeout(200);
    if (hit) throw new Error('the Reopen button is not seen: ' + hit);
  }, verify: async (page) => {
    // After the shot, one read, no poll: a failure here deletes the shot, so a move between the read in go and the
    // picture that is still there now fails the row (one that reverted before this read is not seen).
    const seen = await page.evaluate(heldReopenAt);
    if (seen) throw new Error('the Reopen button is not seen after the shot: ' + seen);
    const t = await page.evaluate(() => { const b = document.querySelector('#pj-held [data-reopen-room]'); return b ? b.closest('.msg-valve').innerText : ''; });
    for (const want of ['Your agents\' posts will most likely not go through until you post something yourself or reopen the room.', 'Reopen the room',
      'An agent whose post was held can still send one summary to wrap things up.']) {   // #6925
      if (!t.includes(want)) throw new Error('the hold strip does not say "' + want + '": ' + JSON.stringify(t.slice(0, 300)));
    }
    // #6925: the summary post carries its label.
    const label = await page.evaluate(() => { const e = document.querySelector('#pj-room .msg-closing'); return e ? e.innerText : ''; });
    if (!/one summary while the room was held/.test(label)) throw new Error('#6925: the summary post has no label: ' + JSON.stringify(label));
  }, after: async (page, data) => {
    if (!data.heldLines) return;
    const file = path.join(require(path.join(REPO, 'engine', 'store')).ROOT, 'messages.jsonl');
    const kept = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !data.heldLines.includes(l));
    fs.writeFileSync(file, kept.join('\n'));
    data.heldLines = null;
  } },
  /* #6925 (Mona Lisa's design review): the same held room, scrolled so the summary post that went through the hold is
     in frame with its label. project-room-held-5800 is taken where the room opens, which leaves that post below the
     fold on a phone. Same seed and cleanup. The label's centre must be the label before the shot (polled) and after it
     (one read), as the Reopen button's is on that screen (summaryLabelAt).
     MEASURED failing arm, 10-22 19:45: the first version only centred the post, and on an iPhone 15 the held strip in
     the composer covered the label; both phone shots failed "something is drawn over the label: SPAN#.pj-held-why".
     So after centring, the PAGE is scrolled to the end of the room column (.pjmid), the way a person scrolls: on a phone,
     scrolling over the room at its end carries on into the page, which brings the newest post clear of the sticky
     composer. Measured by Mona Lisa on #6960 at 393x852: the newest post then ends at 585 with the composer at 606. The
     centring stays: the summary is the newest post, so centring it puts the room's own scroller at its end, which the
     page scroll needs. scrollIntoView alone is not enough (with block 'nearest' it stops at the window's bottom edge,
     under the sticky composer). The first fix lifted the room's own scroller, or the window by the overlap, so the
     label stayed covered and #6960 was filed as a layout defect; it was this screen's scroll, not a layout defect. */
  { name: 'project-room-held-summary-6925', owner: 'Ice Cream Kitty', go: async (page, data) => {
    const held = SCREENS.find((s) => s.name === 'project-room-held-5800');
    await held.go(page, data);
    const scrolled = await page.evaluate(() => {
      const e = document.querySelector('#pj-room .msg-closing');
      if (!e) return 'no label on the page';
      e.closest('[data-mid]').scrollIntoView({ block: 'center' });
      // Then the page, to the room column's end (in today's desktop layout the page does not scroll, so it clamps).
      const mid = e.closest('.pjmid');
      if (!mid) return 'no .pjmid around the room';
      window.scrollTo(0, window.scrollY + mid.getBoundingClientRect().bottom - window.innerHeight);
      return null;
    });
    if (scrolled) throw new Error('#6925: the summary screen could not scroll to the label: ' + scrolled);
    let miss = await page.evaluate(summaryLabelAt);
    for (const until = Date.now() + 3000; miss && Date.now() < until; miss = await page.evaluate(summaryLabelAt)) await page.waitForTimeout(200);
    if (miss) throw new Error('#6925: the summary label is not seen: ' + miss);
  }, verify: async (page) => {
    // After the shot, one read, no poll (as project-room-held-5800's verify): a repaint that moved the label away
    // between the read in go and the picture fails the row, so a shot without the label is never kept.
    const seen = await page.evaluate(summaryLabelAt);
    if (seen) throw new Error('#6925: the summary label is not seen after the shot: ' + seen);
    const label = await page.evaluate(() => { const e = document.querySelector('#pj-room .msg-closing'); return e ? e.innerText : ''; });
    if (!/one summary while the room was held/.test(label)) throw new Error('#6925: the summary post has no label: ' + JSON.stringify(label));
  }, after: async (page, data) => SCREENS.find((s) => s.name === 'project-room-held-5800').after(page, data) },
  /* #6178: Settings > AI Models with "On your other computers". That section reads each other computer only from this
     computer's own Kosmos+ address over https, so this screen serves the board at https://laptop.kosmosplus.com (a
     route onto the throwaway board) and answers three made-up other computers: studio with two example.com accounts
     (82%, and one with no reading) and an agent on each, workshop behind its gate (this browser not let in), oldmac
     with a Kosmos from before #6178. Nothing here is real, and nothing reaches the network. */
  { name: 'settings-accounts-other', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page) => {
    const board = new URL(page.url()).origin;
    const HOME = 'https://laptop.kosmosplus.com';
    const now = Date.now();
    const computers = { ok: true, domain: 'kosmosplus.com', computers: [
      { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true, updating: false, lastSeen: Math.floor(now / 1000) },
      { name: 'studio', address: 'studio.kosmosplus.com', this: false, online: true, updating: false, lastSeen: Math.floor(now / 1000) },
      { name: 'workshop', address: 'workshop.kosmosplus.com', this: false, online: true, updating: false, lastSeen: Math.floor(now / 1000) },
      { name: 'oldmac', address: 'oldmac.kosmosplus.com', this: false, online: true, updating: false, lastSeen: Math.floor(now / 1000) },
    ] };
    const cors = { 'access-control-allow-origin': HOME, 'access-control-allow-credentials': 'true', vary: 'Origin', 'content-type': 'application/json' };
    const studio = {
      checkedAt: new Date(now).toISOString(),
      agents: [
        { sessionName: 'ada', name: 'Ada', state: 'working', runner: 'claude', acct: 'a0' },
        { sessionName: 'roo', name: 'Roo', state: 'idle', runner: 'claude', acct: 'a1' },
      ],
      accountsWeekly: [
        { key: 'a0', email: 'person@example.com', isDefault: true, weekly: { usedPct: 82, resetsAt: now + 3 * 864e5, at: now - 3600e3 }, blocked: null },
        { key: 'a1', email: 'work@example.com', weekly: null, blocked: null },
      ],
    };
    await page.route(HOME + '/**', async (r) => {
      try {   // #6022: a late answer after close is caught, not a crash
        const u = new URL(r.request().url());
        if (u.pathname === '/api/remote/computers') return await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(computers) });
        const resp = await r.fetch({ url: board + u.pathname + u.search });
        return await r.fulfill({ response: resp });
      } catch { await r.abort().catch(() => {}); }
    });
    await page.route('https://studio.kosmosplus.com/**', (r) => r.fulfill({ status: 200, headers: cors, body: JSON.stringify(studio) }));
    await page.route('https://workshop.kosmosplus.com/**', (r) => r.fulfill({ status: 401, headers: cors, body: '{}' }));
    await page.route('https://oldmac.kosmosplus.com/**', (r) => r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ agents: [] }) }));
    await page.goto(HOME + '/?tab=settings&sec=accounts', { waitUntil: 'load' });
    if (await page.$('#firstrun:not([hidden])')) await page.keyboard.press('Escape');
    await page.waitForSelector('#s-sec-accounts', { state: 'visible', timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll('#set-other .ao-acct').length >= 2
      && /older Kosmos/.test(document.getElementById('set-other').textContent), null, { timeout: 20000 });
    await page.evaluate(() => document.getElementById('set-other-wrap').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
  }, verify: async (page) => {
    const t = await page.evaluate(() => (document.getElementById('set-other') || {}).textContent || '');
    for (const want of ['82% of its weekly limit used', 'Its agents on studio: Ada', 'not let in on workshop', 'oldmac has an older Kosmos']) {
      if (!t.includes(want)) throw new Error('the other computers section does not say "' + want + '"');
    }
  } },
  /* kosmos#6590 (S-7d branch c): the browsers waiting to connect on Settings > Kosmos+, where the person types the
     code each browser shows. The section shows only under the board-v2 marker, which a throwaway board does not have,
     so the waiting list is answered here (two browsers); the rest of the page is the real one. */
  { name: 'plus-waiting-6590', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page) => {
    const now = Math.floor(Date.now() / 1000);
    const waiting = { v2: true, count: 2, ctAlarm: false, ctFinding: null, waiting: [
      { knockId: 'AbCdEfGhIjKlMnOpQrStUv', firstSeen: now - 90, uaClass: 'iPhone or iPad', net: '203.0.113.0', vouched: false },
      { knockId: 'ZbCdEfGhIjKlMnOpQrStUw', firstSeen: now - 30, uaClass: 'Windows', net: '2001:db8:1::', vouched: false }] };
    await page.route('**/api/remote/waiting', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(waiting) }));
    await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-waiting .waitreq', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => { const el = document.getElementById('plus-waiting'); if (el) el.scrollIntoView({ block: 'start' }); });
  } },
  /* kosmos#6590 (c4): the same section while the tunnel pauses new browsers for a certificate warning. */
  { name: 'plus-waiting-paused-6590', owner: 'Ice Cream Kitty', noServiceWorker: true, go: async (page) => {
    const waiting = { v2: true, count: 0, waiting: [], ctAlarm: true, ctFinding: 'a'.repeat(64) };
    await page.route('**/api/remote/waiting', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(waiting) }));
    await at(page, '?tab=settings&sec=plus');
    await page.waitForSelector('#plus-waiting [data-wait="ctack"]', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => { const el = document.getElementById('plus-waiting'); if (el) el.scrollIntoView({ block: 'start' }); });
  } },
];

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const a = { out: null, screens: null, sizes: DEFAULT_SIZES, themes: THEMES, engines: ENGINES, strict: false, list: false, keep: false, data: 'sample', scale: 'css', remote: false, appTabs: false };
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
    else if (k === '--remote') a.remote = true;
    else if (k === '--app-tabs') { a.appTabs = true; a.remote = true; }   // kosmos#6846: the iPhone app's own header
    else if (k === '--faces') a.faces = v();
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
/* Cleo, the agent waiting on you, must lead the first store shot. Nothing on the
   store screens is overlong; the Files folder below is shared with the sample
   set and is not in a store shot. */
const STORE_AGENTS = [
  { claim: 'cleo', title: '', name: 'Cleo', role: 'Project manager' },
  { claim: 'dana', title: '⠋ Writing the product copy for the spring catalogue', name: 'Dana', role: 'Writer' },
  { claim: 'eli', title: '⠙ Comparing supplier prices for the linen range', name: 'Eli', role: 'Researcher' },
  { claim: 'farah', title: '', name: 'Farah', role: 'Bookkeeper' },
];
const DATA_SETS = {
  sample: {
    agents: AGENTS,
    chatAgent: 'ada',   // the DM, files and profile screens
    askAgent: 'cleo',   // the needs-you question and the push landing
    projectAgents: ['ada', 'basil', 'cleo'],
    room: [['cleo', [], 'Kick-off: the catalogue goes to print on the 3rd. Ada has copy, Basil has research, I have the printer.'],
      ['basil', [], 'Competitor prices are in the shared sheet, tab "March". Two of them undercut us on the linen range by about 8%.'],
      ['ada', ['cleo'], 'Copy for pages 1-8 is done. Pages 9-12 need the new photos before I can caption them, so I am parked on those until Thursday.']],
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
    chatAgent: 'dana',
    askAgent: 'cleo',
    projectAgents: ['dana', 'eli', 'cleo'],
    room: [['cleo', [], 'Kick-off: the catalogue goes to print on the 3rd. Dana has copy, Eli has research, I have the printer.'],
      ['eli', [], 'Competitor prices are in the shared sheet, tab "March". Two of them undercut us on the linen range by about 8%.'],
      ['dana', ['cleo'], 'Copy for pages 1 to 8 is done. Pages 9 to 12 need the new photos before I can caption them, so I am parked on those until Thursday.']],
    chat: [
      ['you', 'Morning Dana. How is the catalogue copy coming along?'],
      ['dana', 'Pages 1 to 8 are written and checked against the price sheet.'],
      ['you', 'Great. What is left?'],
      ['dana', 'Pages 9 to 12 need the new photos before I can caption them. The shoot is on Thursday, so I will have the full draft to you on Friday morning.'],
      ['you', 'Perfect, thank you.'],
    ],
    ask: 'The printer sent two quotes for the catalogue: $1,240 in five working days, or $1,610 in two. Shall I accept the cheaper one?',
    secondProject: { name: 'Quarterly accounts', agents: ['farah'], description: 'Close the quarter and send the accounts to the accountant.' },
    projectDescription: 'Get the spring catalogue written, priced, photographed and to the printer by the 3rd.',
    /* A Mac that is set up, which the empty sandbox is not: each agent gets a
       launch job and its own folder with instructions, and your messages were
       delivered. Without these the shots carry setup warnings no customer with
       a working Mac would see ("will not come back after a restart", "made
       before Kosmos recorded this", "could not deliver"). */
    setUp: true,
    askInProject: true,
    /* Made from the screen, as a person makes a project, so the room does not open on
       "Made by an agent or another program". And the chat agent's replies already read: the chat
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
/* #5782: the marketing set, for installkosmos.com's product shots: the store fleet with a shape. Cleo is the
   project manager and the other three report to her, so the org chart draws a team, not four loose dots. Pictures
   come from --faces (a folder of <claim>.jpg|.png and you.jpg|.png), never from the repo and never a real person
   from this Mac: the leak guard still reads every page. */
DATA_SETS.marketing = {
  ...DATA_SETS.store,
  /* Farah shows as Farid: the four pictures the site already publishes (meet/faces) are two women and two men. */
  /* reportsTo is the profile key (the claim), the same key server.js walks for loops; the chart matches it to the card. */
  /* #6051: four more made-up people, so a desktop board fills two rows rather than half the frame. They have no
     --faces picture (the site has four licensed faces), so they show the app's own initial, as a real team's
     newer agents do. Working ones carry a spinner title, the same signal the fleet's own working agents carry. */
  agents: STORE_AGENTS.concat([
    { claim: 'maya', title: '⠹ Drafting this week\'s newsletter', name: 'Maya', role: 'Marketing' },
    { claim: 'theo', title: '', name: 'Theo', role: 'Customer support' },
    { claim: 'iris', title: '⠸ Laying out the lookbook pages', name: 'Iris', role: 'Designer' },
    { claim: 'ravi', title: '', name: 'Ravi', role: 'Analyst' },
  ]).map((a) => (a.claim === 'cleo' ? a : { ...a, ...(a.claim === 'farah' ? { name: 'Farid' } : {}), reportsTo: 'cleo' })),
  /* The person at the hub: a made-up name, so the hub shows an initial (Josh's ruled empty-disc rule otherwise). */
  you: { name: 'Sam Rivera', does: 'Runs a small home goods business' },
  /* The work spread across the team, and each agent's own report of what it is on (engine/commitments, the record an
     agent writes), so a task card says who is doing it instead of "has not reported what it is working on yet". */
  tasks: [['Draft the product copy for every page', 'dana'], ['Check the prices against the spreadsheet', 'eli'], ['Book the photographer', 'cleo']],
  /* #6051 (Josh 10-13: "let's not show this as a bunch of agents we can't read. It should be mocked up to look full and
     working."): the sandbox agents have never run, so every card read "Not yet read" with its model squeezed to "Cla...".
     In the PAGE only (the same /api/status rewrite as `connected`), each agent gets a model and a measured memory
     reading in the engine's own shapes (modelDisplayName's names; status.js measuredResult). State is untouched: the
     board's own Working / Question / Idle stay what the fleet seeds. */
  busy: {
    /* A Claude row names its model id: its limit and whether that limit is assumed come from the engine's own
       limitFor (status.js), so the reading is the one a real card would carry. A codex row carries the window codex
       reports; a gemini row says its window is assumed, as the engine's own Gemini reader does; a muse row carries
       no reading at all, because Kosmos does not read Muse's memory yet (status.js, the Muse pane's context). */
    cleo: { model: 'claude-opus-5-5', modelName: 'Claude Opus 5.5', tokens: 305000 },
    dana: { model: 'claude-sonnet-5-5', modelName: 'Claude Sonnet 5.5', tokens: 590000 },
    eli: { modelName: 'GPT 5.2', runner: 'codex', tokens: 84000, ceiling: 400000 },
    farah: { model: 'claude-haiku-5-5', modelName: 'Claude Haiku 5.5', tokens: 110000 },
    maya: { model: 'claude-sonnet-5-5', modelName: 'Claude Sonnet 5.5', tokens: 485000 },
    theo: { modelName: 'Gemini 3 Pro', runner: 'gemini', tokens: 140000, ceiling: 1048576, assumed: true },   // the engine's assumed Gemini window (status.js GEMINI_TEXT_WINDOW)
    iris: { model: 'claude-opus-5-5', modelName: 'Claude Opus 5.5', tokens: 665000 },
    ravi: { runner: 'muse' },   // no name (modelLine says Meta Muse) and no reading: Kosmos does not read Muse's memory
  },
  commitments: {
    dana: 'Task 1 of Launch the spring catalogue: copy for pages 9 to 12, once the photos are in',
    eli: 'Task 2 of Launch the spring catalogue: checking the linen prices against the March sheet',
    cleo: 'Task 3 of Launch the spring catalogue: booking the photographer for Thursday',
  },
};
/* #6051: give each card named in `busy` (by its claim) a model and a measured memory reading, in the shapes the engine
   itself produces (engine/status.js measuredResult), so the page renders them exactly as it would a running agent.
   Walks the whole status body for objects carrying a sessionName, in arrays or under keys, and patches each one. */
const BUSY_SEEN = new Set();   // #6051: the busy claims a status read actually matched, checked when the run ends
function busyCards(body, busy) {
  const patch = (c) => {
    const key = String(c.claim || String(c.sessionName || '').replace(/-discord$/, '')).toLowerCase();
    const b = busy[key];
    if (!b) return;
    const lim = b.model ? require(path.join(REPO, 'engine', 'status')).limitFor(b.model) : null;
    const ceiling = lim ? lim.limit : b.ceiling;
    const assumed = lim ? lim.assumed : b.assumed === true;
    const raw = Math.round((b.tokens / ceiling) * 100);   // measuredResult's arithmetic: clamp the percent, flag the excess
    const percent = Math.min(100, raw);
    BUSY_SEEN.add(key);
    if (b.modelName) { c.modelName = b.modelName; c.plannedModelName = b.modelName; }   // modelLine reads the planned one on a stopped card
    // A Muse card with no model of its own says "Meta Muse" (modelLine's fallback); the sandbox's seeded Claude model
    // must not stand in for it.
    else if (b.runner === 'muse') { c.modelName = null; c.plannedModelName = null; }
    if (b.runner) c.runner = b.runner;   // modelLine names a codex agent's model without the Claude prefix
    c.context = b.runner === 'muse'
      ? { tokens: null, percent: null, confidence: 'none', notYet: false, because: 'Kosmos does not read how full Muse\u2019s memory is yet' }
      : { tokens: b.tokens, percent, overCeiling: raw > 100, notYet: false, ceiling, ceilingAssumed: assumed,
          confidence: 'structured',
          because: assumed ? 'measured, against a limit we have assumed rather than watched' : 'measured, against a limit we have watched it hit' };
  };
  const walk = (v) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== 'object') return;
    if ('sessionName' in v) { patch(v); return; }   // a card, whether it sits in an array or under a key
    for (const x of Object.values(v)) walk(x);
  };
  walk(body);
}
let FACES_DIR = null;   // --faces: pictures for the seeded agents and the person
/* #5782 review: an agent's report is a claim stamped when it is made, and the board calls it stale after 30 minutes
   (engine/commitments.js STALE_AFTER_MS). A long sweep or a --keep board would then show "last reported N minutes ago"
   on every task card, so a screen that shows tasks re-reports first, exactly as a working agent keeps reporting. */
function freshCommitments() {
  if (!DATA.commitments) return;
  const commitments = require(path.join(REPO, 'engine', 'commitments'));
  for (const [agent, what] of Object.entries(DATA.commitments)) commitments.report(agent, [{ id: 'c-' + agent, what }]);
}
let DATA = DATA_SETS.sample;   // run() picks the set before the board is seeded
/* #4994: the removed agent the leftover-delete screen opens the delete confirmation for. Invented. Seeded only when
   that screen is asked for (run() sets SEED_LEFTOVER), so every other screen's board has no "Show removed agents". */
const LEFTOVER = { claim: 'rex', name: 'Rex', role: 'Writer' };
let SEED_LEFTOVER = false;

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
    const role = a.claim === DATA.chatAgent && LEAK_CONTROL === 'page' ? a.role + ', ' + PLANTED_EMAIL : a.role;
    store.writeProfile(a.claim, { displayName: a.name, role, ...(a.reportsTo ? { reportsTo: a.reportsTo } : {}) });
  }
  /* #5782: --faces, through the engine's own picture writers (the same doors Settings uses). A folder with no
     picture for someone leaves them on their initial, as today. */
  if (DATA.you) require(path.join(REPO, 'engine', 'you')).save(DATA.you);   // throws, with its reason, on a bad record
  if (FACES_DIR) {
    const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    const pick = (key) => Object.keys(TYPES).map((e) => path.join(FACES_DIR, key + e)).find((f) => fs.existsSync(f));
    const named = (f, what, fn) => { try { return fn(); } catch (e) { throw new Error('--faces ' + path.basename(f) + ' could not be saved as ' + what + ': ' + e.message); } };
    let used = 0;
    for (const a of AGENTS) {
      const f = pick(a.claim);   // keyed by the claim (farah.jpg), not the display name
      if (f) { named(f, a.claim + "'s picture", () => store.saveAvatar(a.claim, TYPES[path.extname(f).toLowerCase()], fs.readFileSync(f))); used += 1; }
    }
    const yf = pick('you');
    if (yf) { named(yf, 'your picture', () => require(path.join(REPO, 'engine', 'you')).savePicture(TYPES[path.extname(yf).toLowerCase()], fs.readFileSync(yf))); used += 1; }
    if (!used) console.log('mobile-shots: --faces ' + FACES_DIR + ' has no <claim>.jpg|png|webp|gif for ' + AGENTS.map((a) => a.claim).join(', ') + ' or you: no pictures seeded');
  }
  require(path.join(REPO, 'engine', 'firstrun')).complete();
  /* #4820: an existing install no longer owes a one-time Community notice (#4524 marked it seen here so it
     could not cover the first shot), so there is nothing to mark. */
  try { require(path.join(REPO, 'engine', 'tips')).set({ off: true }); } catch { /* tips optional */ }
  const chat = require(path.join(REPO, 'engine', 'chat'));
  const t0 = Date.now() - 3600e3;
  const stamp = (min) => new Date(t0 + min * 60e3).toISOString();
  /* These writers report a failure as { recorded: false, because } rather than throwing;
     a seed that silently did not land would be photographed as if it had. */
  const landed = (r, what) => { if (r && r.recorded === false) throw new Error('the seed could not write ' + what + ': ' + r.because); };
  DATA.chat.forEach(([who, text], i) => {
    const mine = who === 'you' ? (DATA.setUp ? { delivery: { state: 'placed' } } : {}) : { from: who };
    landed(chat.appendMessage(chat.DIRECT, DATA.chatAgent, { text, at: stamp(i + 1), ...mine }), 'the DM');
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
  if (SEED_LEFTOVER) seedLeftover(landed);
  /* The chat agent's Files folder, for the agent-files screens: more rows than the
     agent page shows (AGENT_FILES_SHOWN, 10, so the list is capped; View All shows with any file), one with
     a long name. */
  const chatFiles = require(path.join(REPO, 'engine', 'dmfiles')).filesDir(DATA.chatAgent);
  fs.mkdirSync(chatFiles, { recursive: true });
  const fileNames = ['catalogue-copy-pages-1-to-8-final-reviewed-by-cleo.docx', 'prices.xlsx', 'photographer-brief.pdf',
    'notes.md', 'cover.png', 'linen-range.csv', 'spring-2026-print-schedule.pdf', 'draft-2.docx',
    'invoice-0412.pdf', 'studio-quote.pdf', 'page-9-layout.png', 'captions.md'];
  fileNames.forEach((f, i) => {
    fs.writeFileSync(path.join(chatFiles, f), 'x'.repeat(1024 * (i + 1)));
    const t = new Date(t0 + i * 60e3);
    fs.utimesSync(path.join(chatFiles, f), t, t);
  });
  // The store set records this after the project exists, naming it (seed below).
  if (!DATA.askInProject) {
    landed(require(path.join(REPO, 'engine', 'selfreport')).record(DATA.askAgent, {
      state: 'needs_you', because: DATA.ask,
    }), "the ask agent's needs-you state");
  }
}

/* #4994: a removed agent with something left on disk, as remove.js leaves one: its folder, its auto-start file and
   its removed record (the fields recordRemoval writes). Plus a community key in the community folder the board uses
   (communitysend's own path, so hasAccount finds it) and a Trash on the sandboxed home, so the plan is the Trash
   case. The key is invented, and the board's community address is a dead one (startBoard), so nothing is sent. */
function seedLeftover(landed) {
  const create = require(path.join(REPO, 'engine', 'create'));
  const store = require(path.join(REPO, 'engine', 'store'));
  const communitysend = require(path.join(REPO, 'engine', 'communitysend'));
  const { claim, name, role } = LEFTOVER;
  fs.mkdirSync(create.workerDir(claim), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(claim), 'CLAUDE.md'), '# ' + name + '\n\nYou are ' + name + ', the ' + role.toLowerCase() + '.\n');
  fs.writeFileSync(path.join(create.workerDir(claim), 'notes.md'), 'Catalogue notes.\n'.repeat(200));
  fs.mkdirSync(path.dirname(create.plistPath(claim)), { recursive: true });
  fs.writeFileSync(create.plistPath(claim), '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
    + '<key>Label</key><string>' + create.serviceLabel(claim) + '</string>'
    + '<key>ProgramArguments</key><array>' + ['/bin/bash', '-lc', 'start', claim, '/usr/local/bin/claude', '/usr/local/bin/tmux', claim, 'sonnet']
      .map((x) => '<string>' + x + '</string>').join('') + '</array>'
    + '<key>RunAtLoad</key><true/></dict></plist>\n');
  const removedAt = new Date(Date.now() - 2 * 86400e3).toISOString();
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: claim, shownAs: name, removedAt, stopped: true,
    leftRunningByChoice: false, label: create.serviceLabel(claim), plist: create.plistPath(claim), ours: true }], null, 2) + '\n');
  const keysFile = communitysend._paths.keysFile();
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, JSON.stringify({ [claim]: { apiKey: 'sample-community-key-4994' } }, null, 2) + '\n', { mode: 0o600 });
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.Trash'), { recursive: true });
  if (!communitysend.hasAccount(claim)) landed({ recorded: false, because: 'hasAccount does not see the seeded key' }, 'the leftover agent\'s community key');
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
    /* #4632: the catalogue the picker downloads. The harness passes its local copy; run alone,
       a dead port, so this board never asks installkosmos.com (#4253). */
    KOSMOS_CATALOGUE_BASE: process.env.KOSMOS_CATALOGUE_BASE || 'http://127.0.0.1:9/',
    /* #4994: the community the board sends to, a dead address as tools/browser-checks.sh sets it. A throwaway board
       reads the switch as on (no file is Josh's default), and leftover-delete seeds a community key. */
    AGENT_WORKFORCE_COMMUNITY_URL: process.env.AGENT_WORKFORCE_COMMUNITY_URL || 'http://127.0.0.1:9/',
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
  const made = await post('/api/projects', { name: 'Launch the spring catalogue', agents: DATA.projectAgents,
    ...(DATA.projectDescription ? { description: DATA.projectDescription } : {}) });
  const pid = made.project && made.project.id;
  if (!pid) throw new Error('seed: the board made no project');
  const taskList = DATA.tasks || ['Draft the product copy for every page', 'Check the prices against the spreadsheet', 'Book the photographer'].map((t) => [t, DATA.chatAgent]);
  for (const [s2, who] of taskList) {
    await post('/api/project/' + pid + '/tasks', { sentence: s2, who });
  }
  freshCommitments();
  await post('/api/projects', DATA.secondProject);
  const t0 = Date.now() - 1800e3;
  const stamp = (min) => new Date(t0 + min * 60e3).toISOString();
  /* kosmos#7233: since #7185 no reader is given a room row stamped before its project's createdAt (an earlier project of
     that name wrote it). The rows below are stamped from t0, half an hour back, so the project is dated one minute
     before t0, through the projects module's own write. 31 minutes old is still inside the first 24 hours, so a
     project's "new" state (roomLive and the 24-hour window) reads as it did before; the room simply has its posts. */
  const projects = require(path.join(REPO, 'engine', 'projects'));
  projects.mutate(pid, (p) => ({ ...p, createdAt: new Date(t0 - 60e3).toISOString() }));
  if (projects.readAll().find((p) => p.id === pid).createdAt !== new Date(t0 - 60e3).toISOString()) {
    throw new Error('seed: the project could not be dated before its room rows (kosmos#7233), so every room shot would be empty');
  }
  const lines = [
    // A data set's `room` is exactly three posts: the times and the two reactions below name them.
    ...DATA.room.map(([from, to, text], i) => ({ kind: 'post', id: 'm' + (i + 1), project: pid, from, to, text, at: stamp([1, 4, 9][i]), outcomes: {} })),
    { kind: 'reaction', project: pid, of: 'm3', emoji: '👍', op: 'add', from: DATA.askAgent, at: stamp(10) },
    { kind: 'reaction', project: pid, of: 'm2', emoji: '🔥', op: 'add', from: DATA.chatAgent, at: stamp(11) },
  ];
  /* The log lives in the store's own root (engine/messages.js: store.ROOT, which is
     DATA/<app>), not at the top of DATA: written there, the room showed no posts at all. */
  const storeRoot = require(path.join(REPO, 'engine', 'store')).ROOT;
  fs.appendFileSync(path.join(storeRoot, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (DATA.dmRead) await post('/api/agent/' + DATA.chatAgent + '/seen');
  /* The store set's question names its project, as an agent on a project would, so it
     lights that project rather than counting as a needs-you with no project. */
  if (DATA.askInProject) {
    const r = require(path.join(REPO, 'engine', 'selfreport')).record(DATA.askAgent, { state: 'needs_you', because: DATA.ask, project: pid });
    if (r && r.recorded === false) throw new Error('the seed could not write the ask agent\'s needs-you state: ' + r.because);
  }
  return { projectId: pid, chatAgent: DATA.chatAgent, askAgent: DATA.askAgent, outsider: DATA.secondProject.agents[0] };   // outsider: kosmos#5752
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
const COVER_CONTROL = process.env.MSHOTS_COVER_CONTROL || '';
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
   16px makes iOS Safari zoom the page on focus.
   #5206: a control whose BOX is under 44 can still be a 44 target, the standard way: a ::after (or ::before) laid
   past it, or padding taken back by a negative margin. What counts is where a finger lands, so a small box is probed:
   scrolled into view, each edge of a 44x44 square centred on it must hit the control (document.elementFromPoint).
   Only a control every probe reaches passes; a probe that hits something else, or an off-screen point, fails it. */
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
    const sx = window.scrollX, sy = window.scrollY;
    // scrollIntoView moves every scrollable ancestor, not only the window: each one's place is kept and put back, so
    // nothing after the audit (a screen's verify, its after-step) sees a moved page.
    const moved = new Map();
    const remember = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (!moved.has(a) && (a.scrollTop || a.scrollLeft || a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth)) moved.set(a, [a.scrollLeft, a.scrollTop]); };
    /* Probes sit on the four edge midpoints of the 44x44 square, half a pixel in. Corners are not probed: a rounded
       hit area (border-radius clips hit-testing) would fail a corner a finger never needs. The far edges are
       half-open, so a 43px reach fails rather than passes. */
    const reaches = (target) => {
      remember(target);
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = target.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = minTap / 2 - 0.5;
      const pts = [];
      if (r.height < minTap - 0.5) pts.push([cx, cy - h], [cx, cy + h]);
      if (r.width < minTap - 0.5) pts.push([cx - h, cy], [cx + h, cy]);
      return pts.every(([x, y]) => {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === target || target.contains(hit));
      });
    };
    for (const el of document.querySelectorAll('button, a[href], select, summary, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"]), textarea')) {
      if (el.disabled || !shown(el) || inSentence(el)) continue;
      let target = el;
      if (el.matches('input[type="checkbox"], input[type="radio"]')) target = el.closest('label') || el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (!onPage(r)) continue;
      if ((r.width < minTap - 0.5 || r.height < minTap - 0.5) && !reaches(target)) taps.push(name(target) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    /* A hit area that reaches past its control (a ::after, padding taken back) paints above its neighbours, so it
       can take taps meant for them. That is the risk the reach probe above rewards, so it is measured too: inside
       every control's own box (every 3px, its edges included), a tap must land on that control. A point
       answered by ANOTHER control is a cover; a non-control ancestor (the row a button sits in) is not. */
    const covers = [];
    // The nearest ANCESTOR in its own layer: positioned out of the flow (fixed, absolute, sticky) or an
    // open dialog / popover. Two controls answer each other's points as STACKING only when they sit in different
    // layers (a menu over the page); two in the same layer overlapping is a hit area, however positioned (round 3).
    const layerOf = (n) => {
      if (n && n.nodeType === 1 && getComputedStyle(n).position === 'fixed') return n;   // a fixed control escapes its parent: its own layer (round 4)
      for (n = n && n.parentElement; n && n.nodeType === 1; n = n.parentElement) {   // otherwise ancestors only: an absolute control is in its container's layer
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') return n;
        try { if (n.matches('dialog[open]') || n.matches(':popover-open')) return n; } catch { /* an engine without :popover-open */ }
      }
      return null;
    };
    const layered = (top, under) => layerOf(top) !== layerOf(under);
    // label too: a label row takes a tap for its control, so it can be covered (Angel, #5218 review).
    const SEL = 'button, a[href], select, summary, label, [role="button"], [role="tab"], [role="link"], input:not([type="hidden"]), textarea';
    const controlOf = (n) => (n && n.closest ? n.closest(SEL) : null);
    for (const el of document.querySelectorAll(SEL)) {
      if (el.disabled || !shown(el) || !onPage(el.getBoundingClientRect())) continue;
      remember(el);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      // Every 3px across the box (capped at 4000 points), half a pixel in from each edge: a neighbour's hit area
      // usually takes a thin strip along one edge, which a handful of sample points misses (a 15-point grid passed
      // the room's header at 44px where render-room-msgbox-2806's pixel scan found 64px taken; measured).
      const pts = [];
      const step = Math.max(3, Math.sqrt((r.width * r.height) / 4000));
      for (let x = r.left + 0.5; x < r.right - 0.5; x += step) for (let y = r.top + 0.5; y < r.bottom - 0.5; y += step) pts.push([x, y]);
      for (const x of [r.left + 0.5, r.right - 0.5]) for (let y = r.top + 0.5; y < r.bottom; y += step) pts.push([x, y]);
      for (const y of [r.top + 0.5, r.bottom - 0.5]) for (let x = r.left + 0.5; x < r.right; x += step) pts.push([x, y]);
      // Only the part of the box a finger can see: an ancestor that clips (overflow other than visible) hides the rest,
      // and a point there answers whatever is beyond the clip (round 4: a false red).
      // Only ancestors that really clip it: a fixed control escapes all of them; an absolute one escapes those between
      // it and its containing block (the nearest positioned ancestor). Round 5: clipping by every ancestor skipped an
      // escaped control entirely, a false green.
      let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      // transform, filter, perspective, will-change of those, and contain paint/layout/strict/content also make an
      // ancestor the containing block, for fixed descendants too (round 6). body's overflow belongs to the viewport and
      // clips nothing, so it is skipped (round 6).
      const containsAll = (cs) => cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none'
        || /transform|filter|perspective/.test(cs.willChange || '') || /paint|layout|strict|content/.test(cs.contain || '');
      let pos = getComputedStyle(el).position;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const cb = containsAll(cs);
        if (pos === 'fixed' && !cb) continue;                             // a fixed control escapes this ancestor
        if (pos === 'absolute' && cs.position === 'static' && !cb) continue;   // neither its containing block nor a clip for it
        if (a === document.body) { pos = cb ? 'static' : pos; continue; }
        // contain paint/strict/content clips to the box like overflow does (round 6, T6).
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain || '')) { const b = a.getBoundingClientRect(); clip = { left: Math.max(clip.left, b.left), top: Math.max(clip.top, b.top), right: Math.min(clip.right, b.right), bottom: Math.min(clip.bottom, b.bottom) }; }
        pos = (cs.position === 'fixed' || cs.position === 'absolute') ? cs.position : 'static';
      }
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) continue;
        const hit = document.elementFromPoint(x, y);
        const other = controlOf(hit);
        // An ANCESTOR answering inside this control is skipped (this control is part of it). A DESCENDANT is not: a
        // child's hit area reaching over its own card is a cover like any other (Angel, #5218 review).
        if (!other || other === el || other.contains(el)) continue;
        // A control and its own label answer for each other (a custom checkbox: an invisible input over its label).
        if ((other.labels && [...other.labels].includes(el)) || (el.labels && [...el.labels].includes(other))) continue;
        // A point OUTSIDE the other control's drawn box is a hit area reaching past it (a ::after). A point INSIDE
        // it is either a box grown over its neighbour (padding taken back by a negative margin: a hit area too) or a
        // control drawn on top in another layer (an open menu, a dialog): only the second is stacking, so it is told
        // apart by layer, not by geometry (review round 2: padding hit areas read clean before).
        const o = other.getBoundingClientRect();
        const inBox = x >= o.left - 1 && x < o.right + 1 && y >= o.top - 1 && y < o.bottom + 1;   // 1px: a snapped shared edge
        if (inBox && el.contains(other)) continue;   // a control inside this one, drawn where it is (a label's own input)
        if (inBox && layered(other, el)) continue;
        if (inBox && Math.abs(x - o.left) <= 1.5 || inBox && Math.abs(x - o.right) <= 1.5 || inBox && Math.abs(y - o.top) <= 1.5 || inBox && Math.abs(y - o.bottom) <= 1.5) continue;   // the shared edge itself
        covers.push(name(el) + ' covered by ' + name(other)); break;
      }
    }
    for (const [a, [l, t]] of moved) a.scrollTo({ left: l, top: t, behavior: 'instant' });   // instant: a smooth box would still be moving
    window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
    const fields = [];
    for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="color"]), textarea, select, [contenteditable="true"], [contenteditable=""]')) {
      if (el.disabled || !shown(el) || !onPage(el.getBoundingClientRect())) continue;
      const fontPx = parseFloat(getComputedStyle(el).fontSize);
      if (fontPx < minFont - 0.01) fields.push(name(el) + ' ' + fontPx + 'px');
    }
    return { taps, fields, covers };
  }, { minTap: MIN_TAP_PX, minFont: MIN_FIELD_FONT_PX });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  // A control with a mistyped name would arm nothing and pass; refuse it instead.
  if (COVER_CONTROL && !['overlay', 'spill'].includes(COVER_CONTROL)) {
    throw new Error('MSHOTS_COVER_CONTROL must be overlay or spill, not ' + COVER_CONTROL);
  }
  // #6107: the same for the sideways-tablet layout choice: a typo would silently shoot one screen.
  if (process.env.MSHOTS_TABLET_LAYOUT && !['tabs', 'consolidated'].includes(process.env.MSHOTS_TABLET_LAYOUT)) {
    throw new Error('MSHOTS_TABLET_LAYOUT must be tabs or consolidated, not ' + process.env.MSHOTS_TABLET_LAYOUT);
  }
  if (args.list) { for (const s of SCREENS) console.log(s.name.padEnd(20) + s.owner); return 0; }
  const screens = args.screens ? SCREENS.filter((s) => args.screens.includes(s.name)) : SCREENS;
  // The overlay control is planted by allow-card and (#5800) project-room-held-5800 only; spill by allow-card only. On
  // any other screen it would arm nothing and pass.
  const armsControl = COVER_CONTROL === 'overlay' ? ['allow-card', 'project-room-held-5800'] : ['allow-card'];
  if ((COVER_CONTROL === 'overlay' || COVER_CONTROL === 'spill') && !screens.some((s) => armsControl.includes(s.name))) {
    throw new Error('MSHOTS_COVER_CONTROL=' + COVER_CONTROL + ' needs the ' + armsControl.join(' or ') + ' screen');
  }
  // The long code is about 450px wide (1.9rem mono), inside the desktop card, so spill with no phone size would arm nothing and pass.
  if (COVER_CONTROL === 'spill' && args.sizes.every((sz) => SIZES[sz].desktop)) {
    throw new Error('MSHOTS_COVER_CONTROL=spill needs a phone size');
  }
  /* Nothing to shoot is not a pass: every requested screen is skipped at the sizes asked for (skipWhy:
     phone-only at desktop or a tablet over 56rem, desktop-only at a phone or a tablet under 960px, or a screen whose needsData is another --data set, #6542). Decided before any browser or board starts (tools.mobile-shots-desktop.test.js). */
  const planned = args.sizes.reduce((n, sz) => n + screens.filter((sc) => !skipWhy(SIZES[sz], sc, args.data, args.appTabs)).length, 0);
  if (!planned) throw new Error('no shot would be taken: every requested screen is skipped at these sizes (phone-only at desktop or a tablet over 56rem, desktop-only at a phone or a tablet under 960px) or needs another --data set (needsData, #6542)');
  // Test hook (tools.mobile-shots-desktop.test.js): report the plan and stop, before any browser or board.
  if (process.env.MSHOTS_PLAN_ONLY === '1') { console.log(`planned ${planned} screen(s) per theme and engine`); return 0; }
  const { chromium, webkit } = require('playwright');
  const engines = { chromium, webkit };
  const out = args.out || fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-shots-'));
  fs.mkdirSync(out, { recursive: true });
  DATA = DATA_SETS[args.data];
  /* #6051: a data set with a busy table names every one of its agents there, and nothing else, so a typo on either
     side fails here instead of quietly bringing back a "Not yet read" card. */
  if (DATA.busy) {
    const claims = DATA.agents.map((a) => a.claim).sort().join(',');
    const keys = Object.keys(DATA.busy).sort().join(',');
    if (claims !== keys) throw new Error('--data ' + args.data + ': the busy table names ' + keys + ' but the agents are ' + claims);
    if (!DATA.connected) throw new Error('--data ' + args.data + ': a busy table is applied in the connected status rewrite, so it needs connected: true');
  }
  FACES_DIR = args.faces ? path.resolve(args.faces) : null;
  if (FACES_DIR && !(fs.existsSync(FACES_DIR) && fs.statSync(FACES_DIR).isDirectory())) throw new Error('--faces ' + FACES_DIR + ' is not a folder');
  SEED_LEFTOVER = screens.some((s) => s.name === 'leftover-delete');

  const board = await startBoard();
  if (DATA.busy) {
    /* #6051: every busy row can produce its reading. Here, not at the start: status.js may only load once the
       sandbox is set (the leak guard refuses an engine module loaded before it). */
    const { limitFor } = require(path.join(REPO, 'engine', 'status'));
    for (const [k, b] of Object.entries(DATA.busy)) {
      if (b.runner === 'muse') continue;   // no reading by design
      if (b.model && b.ceiling) throw new Error('--data ' + args.data + ': busy ' + k + ' gives both a model and a ceiling; the model decides');
      const ceiling = b.model ? (limitFor(b.model) || {}).limit : b.ceiling;
      if (!(Number.isFinite(ceiling) && ceiling > 0)) throw new Error('--data ' + args.data + ': busy ' + k + ' has no memory limit (limitFor does not know ' + (b.model || 'its model') + ' and no ceiling is given)');
    }
  }
  const rows = [];
  const skipped = [];   // phone-only screens at desktop, desktop-only ones at a phone size: listed in both reports, never silently absent
  let overflowCount = 0, errors = 0;
  try {
    Object.assign(REMOTE, { on: args.remote, board: board.base });   // --remote: where fetchBoard sends the stubs (#5510)
    const ctxData = await seed(board.base, board.roots);
    await preflight(board.base);
    for (const en of args.engines) {
      /* #6205: the engine's own pid(s), so a wedged close can be force-killed by pid (never a pattern). Playwright's
         Browser from launch() exposes no process(), so read node's child table across the launch (this loop is
         sequential, so the only lasting new child is the engine); closeBrowserBounded reaps that pid's whole process
         tree, since webkit/firefox launch through a wrapper and the real engine is a grandchild.
         Two reads after the launch, intersected (#6205 review): the engine persists in both, while each childPidsOf's
         own transient `ps` child (ps -A lists itself as our child, then exits) differs between reads, so it drops out. */
      const launchEngine = async () => {
        const childrenBefore = childPidsOf(process.pid);
        const b = await engines[en].launch();
        const after1 = childPidsOf(process.pid);
        const after2 = childPidsOf(process.pid);
        return { b, pids: after1.filter((p) => after2.includes(p) && !childrenBefore.includes(p)) };
      };
      let { b: browser, pids: enginePids } = await launchEngine();
      let contextsOnEngine = 0;   // kosmos#6543: see CONTEXTS_PER_ENGINE
      // #6205 (review): once a close times out, this browser is wedged; stop using it and let the finally force-kill
      // the engine, rather than opening another context on it (an unbounded newContext would reintroduce the hang).
      let wedged = false;
      try {
        for (const sz of args.sizes) {
          if (wedged) break;
          const s = SIZES[sz];
          for (const theme of args.themes) {
            if (wedged) break;
            for (const sc of screens) {
              if (wedged) break;
              const why = skipWhy(s, sc, args.data, args.appTabs);
              if (why) {
                // The same shape as a shot row, so report.json stays one kind of entry.
                skipped.push({ file: null, screen: sc.name, owner: sc.owner, size: sz, theme, engine: en, note: '', taps: [], fields: [], audited: false, skipped: why });
                console.log(`skip  ${sc.name}--${sz}--${theme}--${en}: a ${why}`);
                continue;
              }
              /* A fresh context per screen: the board remembers choices (layout,
                 open sections) in localStorage, and one screen's clicks must not
                 decide what the next screen looks like. */
              // kosmos#6543: a fresh engine before this one reaches the context count WebKit stops navigating at.
              if (contextsOnEngine >= CONTEXTS_PER_ENGINE) {
                await closeBrowserBounded(browser, enginePids);
                browser = null;   // closed: the finally below must not close it again if the relaunch throws
                ({ b: browser, pids: enginePids } = await launchEngine());
                contextsOnEngine = 0;
              }
              contextsOnEngine++;
              let ctx;
              try {
                // #6205 (review): bound newContext too. A wedged browser hangs here unbounded otherwise; a timeout
                // means the engine is dead, so abandon this engine and let the finally force-kill it.
                ctx = await withTimeout(browser.newContext({
                  viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr,
                  // isMobile is Chromium-only in Playwright (WebKit refuses it); both get touch on a phone.
                  isMobile: !s.desktop && en === 'chromium', hasTouch: !s.desktop, colorScheme: theme,
                  // A page.route stub needs the service worker off in WebKit (see allow-card).
                  ...(sc.noServiceWorker || DATA.connected ? { serviceWorkers: 'block' } : {}),
                }), CTX_CLOSE_MS, 'browser.newContext()');
              } catch (e) {
                // Only a TIMEOUT is the wedge this bounds. A real newContext rejection (an option the engine
                // refuses, a crashed engine) is not a hang, so it propagates out of the run as it did before this
                // change (#6205 review), rather than being relabelled "did not return" and hidden.
                if (!e || !e.timedOut) throw e;
                console.log('FLAG  mobile-shots: ' + en + ' newContext timed out (wedged engine); abandoning this engine');
                errors++;
                wedged = true;
                break;
              }
              /* #6107: MSHOTS_TABLET_LAYOUT=tabs (or consolidated) sets a sideways tablet's own layout choice before the
                 page loads, so the tabbed board can be shot on a landscape iPad too (its default is one screen). */
              if (process.env.MSHOTS_TABLET_LAYOUT) {
                // Only when nothing is chosen yet: an init script re-runs on every reload, and a screen that sets its own
                // choice before reloading (openConsAgents) must keep it.
                await ctx.addInitScript((v) => { try { if (!localStorage.getItem('kosmos-tablet-layout')) localStorage.setItem('kosmos-tablet-layout', v); } catch { /* storage refused */ } }, process.env.MSHOTS_TABLET_LAYOUT);
              }
              /* --remote (kosmos#5510): every request to the made-up Kosmos+ host is answered by the throwaway board
                 itself, so the page's own address is not loopback (kplusRemote() true -> html.kremote) while every
                 byte still comes from this board. Registered FIRST so the stubs below, registered after it, win
                 (Playwright tries the newest route first); they fetch through fetchBoard, which points back at the board. */
              // kosmos#6846: what the iPhone app's WKUserScript does at document start when it shows its native tab bar.
              // The init script can run before <html> exists, so the class lands as soon as it does (render-apptabs-6846).
              if (args.appTabs) await ctx.addInitScript(() => {
                const add = () => { const h = document.documentElement; if (h) h.classList.add('kapptabs'); return !!h; };
                if (!add()) new MutationObserver((m, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true });
              });
              if (args.remote) {
                await ctx.route(REMOTE_BASE + '/**', (r) => fetchBoard(r).then((res) => r.fulfill({ response: res }).catch(() => {}), () => r.abort().catch(() => {})).catch(() => {}));   // board gone: fail now, not at the screen's timeout; a late answer after close is quiet (#6022)
              }
              if (DATA.connected) {
                await ctx.route('**/api/status', async (r) => {
                  try {   // #6022: a poll can be in flight at close; caught, not a crash
                    const res = await fetchBoard(r);
                    const body = await res.json().catch(() => null);
                    if (!body || typeof body !== 'object') return await r.fulfill({ response: res });
                    body.connection = { ...(body.connection || {}), state: 'connected' };
                    if (DATA.busy) busyCards(body, DATA.busy);   // #6051: page only, like `connected`
                    return await r.fulfill({ response: res, json: body });
                  } catch { await r.abort().catch(() => {}); }
                });
              }
              await ctx.addInitScript((t) => { try { localStorage.setItem('kosmos-theme', t); } catch { /* no storage */ } }, theme);
              // #6403: the switcher's one-time tip is not part of any screen here. This runs on every load, so a screen that
              // wants the tip clears the key after load and then drives a one-computer read followed by a two-computer
              // read (the tip shows on the first change to two computers in a page, which the boot read has already made).
              await ctx.addInitScript(() => { try { localStorage.setItem('kosmos.switcherTipSeen', '1'); } catch { /* no storage */ } });
              const page = await ctx.newPage();
              const pageErrors = [];
              page.on('pageerror', (e) => pageErrors.push(String(e)));
              const file = `${sc.name}--${sz}--${theme}--${en}.png`;
              let note = '';
              let fit = { taps: [], fields: [], covers: [] };
              let audited = false;   // true only once the phone audits have actually run on this screen
              try {
                await page.goto((args.remote ? REMOTE_BASE : board.base) + '/', { waitUntil: 'load' });
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
                await page.screenshot({ path: path.join(out, file), scale: SIZES[sz].scale || args.scale });
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
                if (!s.desktop) { fit = await fitOf(page); audited = true; }
              } catch (e) {
                if (e.leak) { await closeContextBounded(ctx); throw e; }
                errors++;
                note = 'ERROR ' + String(e.message || e).split('\n')[0];
              }
              // kosmos#4594: a screen's verify says the shot is the screen meant; if not, the shot goes and the row errors.
              let shotGone = false;
              if (sc.verify && !/ERROR/.test(note)) {
                try { await sc.verify(page, ctxData); } catch (e) {
                  try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                  shotGone = true;
                  errors++;
                  note += (note ? '; ' : '') + 'ERROR verify (shot deleted): ' + String(e.message || e).split('\n')[0];
                }
              }
              /* A screen that changed the board's state puts it back here, whatever happened above,
                 so no later screen photographs it (#4545). A failure to is a flag on this row (counted
                 once: a row whose go() already errored is one errored screen, not two). */
              if (sc.after) {
                try { await sc.after(page, ctxData); } catch (e) { if (!/ERROR/.test(note)) errors++; note += (note ? '; ' : '') + 'ERROR after: ' + String(e.message || e).split('\n')[0]; }
              }
              if (pageErrors.length) note += (note ? '; ' : '') + 'page error: ' + pageErrors.splice(0).join(' | ').slice(0, 200);
              /* report.json and report.md travel with the shots: everything this row carries (the
                 tap-target names, overflow and ERROR notes, page errors) passes the same checks,
                 once the note is complete. */
              const inReport = hitsIn(JSON.stringify(fit) + ' ' + note);
              if (inReport.length) {
                try { fs.rmSync(path.join(out, file), { force: true }); } catch { /* best effort */ }
                await closeContextBounded(ctx);
                const err = new Error('LEAK GUARD: this screen\'s report would carry real data (' + inReport.length + ' hits, e.g. '
                  + inReport[0] + '). Its shot is deleted. Stopping with no further shots.');
                err.leak = true;
                throw err;
              }
              rows.push({ file: shotGone ? null : file, deleted: shotGone, screen: sc.name, owner: sc.owner, size: sz, theme, engine: en, note, taps: fit.taps, fields: fit.fields, covers: fit.covers || [], audited, skipped: null });
              console.log((note ? 'FLAG  ' : 'ok    ') + file + (note ? '  ' + note : '')
                + (!audited ? '  phone audits: n/a'
                  : `  taps<${MIN_TAP_PX}: ${fit.taps.length}  fields<${MIN_FIELD_FONT_PX}px: ${fit.fields.length}  covers: ${(fit.covers || []).length}`));
              // #6205 (review): a timed-out close means this browser is wedged. Count it as an error (so a partial
              // shot set with screens dropped cannot read as green, like the newContext-wedge path above), log it,
              // and stop the engine so the next newContext does not hang.
              if (!(await closeContextBounded(ctx))) {
                console.log('FLAG  mobile-shots: ' + en + ' context close wedged after ' + file + '; abandoning this engine');
                errors++;
                wedged = true;
                break;
              }
            }
          }
        }
      } finally { if (browser) await closeBrowserBounded(browser, enginePids); }
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
    `Throwaway board with the ${args.data} data set. WebKit is an engine approximation of iOS Safari, not Safari; Chromium at a phone size is not an Android phone. Phone audits read n/a where they did not run (the desktop size, or a screen that errored).`, '',
    `Shots: ${rows.filter((r) => r.file).length}${rows.some((r) => !r.file) ? ` (plus ${rows.filter((r) => !r.file).length} deleted by its verify)` : ''}. Flagged: ${rows.filter((r) => r.note).length} (overflow ${overflowCount}, errors ${errors}).`, '',
    `Skipped (phone-only at the desktop size, desktop-only at a phone size, or a screen that needs another --data set): ${skipped.length ? skipped.map((k) => `${k.screen}--${k.size}--${k.theme}--${k.engine} (${k.skipped})`).join(', ') : 'none'}.`, '',
    `| screen | owner | size | theme | engine | file | flag | taps<${MIN_TAP_PX} | fields<${MIN_FIELD_FONT_PX}px | covers |`, '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.screen} | ${r.owner} | ${SIZES[r.size].label} ${SIZES[r.size].width}x${SIZES[r.size].height} | ${r.theme} | ${r.engine} | ${r.file || '(deleted)'} | ${r.note.replace(/\|/g, '/')} | ${r.audited ? r.taps.length : 'n/a'} | ${r.audited ? r.fields.length : 'n/a'} | ${r.audited ? (r.covers || []).length : 'n/a'} |`)];
  fs.writeFileSync(path.join(out, 'report.md'), md.join('\n') + '\n');
  // Every small target and field by name, for whoever fixes the screen.
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify([...rows, ...skipped], null, 1) + '\n');
  console.log(`\n${rows.length} shots, ${overflowCount} with overflow, ${errors} errors, ${skipped.length} skipped -> ${out}`);
  /* tools/browser-checks.sh quotes a red's reason from lines starting FAIL. */
  if (errors) { console.error(`FAIL  mobile-shots: ${errors} shot(s) could not be taken; see the ERROR lines above`); return 2; }
  /* #6051: a busy agent no status read ever matched would have shot as "Not yet read" without a word: fail instead. */
  const unmatched = DATA.busy && rows.some((r) => !r.skipped) ? Object.keys(DATA.busy).filter((k) => !BUSY_SEEN.has(k)) : [];
  if (unmatched.length) { console.error('FAIL  mobile-shots: the busy table never reached ' + unmatched.join(', ') + ' (no status card matched them); those cards are not as the busy table says'); return 2; }
  if (args.strict && overflowCount) { console.error(`FAIL  mobile-shots: ${overflowCount} shot(s) overflow sideways; see the FLAG lines above`); return 1; }
  return 0;
}

if (require.main === module) {
  run().then((code) => process.exit(code), (e) => {
    console.error('FAIL  mobile-shots: ' + (e.leak ? e.message : (e.stack || e)));
    process.exit(e.leak ? 3 : 2);
  });
}

