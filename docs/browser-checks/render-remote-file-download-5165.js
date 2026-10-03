'use strict';

/**
 * Over Kosmos+ a file click downloads to the device you are on (#5165). A Kosmos+ user on a Windows laptop clicked a
 * .pptx an agent made in a project's Files list, and Kosmos tried to open it on the HOST computer, where nobody was.
 * The real web/index.html is served with every /api call answered by a stub (no board runs). File rows are put in
 * the page's real lists and clicked, so the page's own delegated handlers answer:
 *   R1  over Kosmos+ (the page reached as kosmos-remote.test) a click on a file in the project rail, the project's
 *       Documents view, a cited file in the project thread, and an agent's Files list each makes the BROWSER download
 *       that file from its download route (a navigation, not the page's own look at it), and nothing is POSTed;
 *   R2  over Kosmos+ every button that would open a window on the board's computer (the project's folder from
 *       Documents and from project settings, an agent's Files folder, the conversations folders, the Kosmos folder
 *       from Settings and from the update offer, an agent's Terminal, and the Accessibility settings) POSTs nothing
 *       and says where it opens;
 *   R3  over Kosmos+ a file the board refuses (gone since the list was drawn) is SAID under the list, in the board's
 *       own sentence, rather than left to the browser's downloads;
 *   L1  CONTROL at the computer (127.0.0.1): every file surface above still POSTs open and downloads nothing, and
 *       every button above still asks the board to act. This is the arm that keeps R1 and R2 from passing on a page
 *       that simply stopped answering clicks, or whose guard was inverted.
 *   W   every arm above again with the page served as a WINDOWS board serves it (the platform marker filled with
 *       win32, so the page speaks of File Explorer): the user who found this was on Windows (Josh, 12:48), and the
 *       rule must not depend on the board's platform.
 * Against web/index.html from before #5165, R1 to R3 FAIL (the click POSTs open-file from kosmos-remote.test):
 *   FILEGET_HTML=/path/to/old/index.html node docs/browser-checks/render-remote-file-download-5165.js
 * Needs no URL. ENGINES=chromium,webkit adds WebKit, the Mac app's engine.
 *
 *   ENGINES=chromium,webkit HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-remote-file-download-5165.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-remote-file-download-5165: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const HTML = fs.readFileSync(process.env.FILEGET_HTML || path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const PROJECT = 'p5165';
const AGENT = 'ana';
const DECK = 'out/Q3 deck.pptx';
const FOLDER_SENTENCE = 'That folder is on the computer Kosmos runs on, not on this device, so it opens only there.';
const TERMINAL_SENTENCE = 'The Terminal window opens on the computer Kosmos runs on, not on this device.';
const SETTINGS_SENTENCE = 'Those settings open on the computer Kosmos runs on, not on this device.';
const GONE = 'gone.pptx';
const GONE_SAID = 'That file is not there any more, or it was moved.';

const PLATFORM_MARKER = '__KOSMOS_PLATFORM__';   // server.js PAGE_PLATFORM_MARKER: the board fills it in
if (!HTML.includes(PLATFORM_MARKER)) {
  console.log('FAIL  render-remote-file-download-5165: the page no longer carries ' + PLATFORM_MARKER + ', so the Windows arm cannot serve it as Windows');
  process.exit(1);
}

async function openPage(engine, origin, platform) {
  const page = HTML.split(PLATFORM_MARKER).join(platform);
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const asked = [];   // the download requests and EVERY POST the clicks made: "METHOD path?query" (the page's own
                     // background reads are GETs to other routes, so they stay out)
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e && e.message)));
  /* The browser's own download (the anchor) is recorded from Playwright's download event as DOWNLOAD, never from the
     route: measured 2026-10-03, an <a download> request does not pass through page.route in Chromium or WebKit, so
     the route sees only the page's look and R1 cannot pass on the look alone. Headless WebKit also fires no download
     event for it (measured the same day), so there the page's own act is what is recorded: every click() on an anchor
     carrying `download`, as ANCHOR <url>. R1 asks Chromium for the real DOWNLOAD and WebKit for the ANCHOR. */
  pg.on('download', (d) => { try { const u = new URL(d.url()); asked.push('DOWNLOAD ' + u.pathname + u.search); } catch { asked.push('DOWNLOAD ?'); } d.cancel().catch(() => {}); });
  await pg.exposeFunction('__fileget5165Anchor', (href) => { try { const u = new URL(href); asked.push('ANCHOR ' + u.pathname + u.search); } catch { asked.push('ANCHOR ?'); } });
  await pg.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) window.__fileget5165Anchor(this.href);
      return click.apply(this, arguments);
    };
  });
  await pg.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: page });
    if (/\/(file-)?download$/.test(u.pathname)) {
      asked.push(req.method() + ' ' + u.pathname + u.search);   // the page's own look (?check=1)
      if (u.searchParams.get('name') === GONE) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, because: 'that file is not there any more, or it was moved' }) });
      // As the route does: the page's look (?check=1) is 204 with no body; only the download carries the file.
      if (u.searchParams.get('check') === '1') return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="f.bin"' }, body: 'PK' });
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && u.pathname.startsWith('/api/')) {
      asked.push(req.method() + ' ' + u.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await pg.goto(origin + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof kplusRemote === 'function' && typeof pjById === 'function');
  const served = await pg.evaluate(() => (typeof onWindows === 'function' && onWindows()) ? 'win32' : 'other');
  if (served !== (platform === 'win32' ? 'win32' : 'other')) throw new Error('the page served as ' + platform + ' reads its platform as ' + served);
  await pg.evaluate(({ PROJECT, AGENT }) => {
    /* The page's own state, as if this project and this agent were open. */
    PROJECTS = [{ id: PROJECT, name: 'Deck room', folder: '/Users/someone/Kosmos/Deck room', agents: [] }];
    PJ_CURRENT = PROJECT;
    PJ_VIEW = 'docs';   // the Documents view's message line writes only while it is the view showing
    CURRENT = { sessionName: AGENT };
  }, { PROJECT, AGENT });
  return { browser, pg, asked, errors };
}

/* Waits until `ready()` holds or `ms` passes: the download and its look are asynchronous, so a fixed sleep would be
   a timing assertion. Returns whether it held. */
async function settle(ready, ms = 4000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await ready()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return ready();
}

/* A file row in one of the page's real lists, clicked: the delegated handler on the list answers. The click is a REAL
   one (Playwright's mouse), so the download starts inside a user gesture as it does for a person; the row's hidden
   ancestors are shown for the click and put back after. `until` (optional) is waited for before the row is taken
   away; without it a short settle lets anything that would happen, happen. */
async function clickRow(pg, listId, name, cls, until) {
  const placed = await pg.evaluate(({ listId, name, cls }) => {
    const list = document.getElementById(listId);
    if (!list) return 'no #' + listId;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (cls === 'refgo') b.dataset.ref = name; else b.dataset.doc = name;
    b.textContent = name;
    b.setAttribute('data-fileget-test', '');
    b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;display:block;visibility:visible;';
    list.appendChild(b);
    window.__filegetShown = [];
    for (let n = list; n && n !== document.documentElement; n = n.parentElement) {
      if (n.hidden || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') {
        window.__filegetShown.push([n, n.hidden, n.getAttribute('style')]);
        n.hidden = false;
        n.style.setProperty('display', 'block', 'important');
        n.style.setProperty('visibility', 'visible', 'important');
      }
    }
    return '';
  }, { listId, name, cls });
  if (placed) return placed;
  await pg.click('[data-fileget-test]', { timeout: 3000 });
  if (until) await settle(until); else await pg.waitForTimeout(400);
  await pg.evaluate(() => {
    document.querySelectorAll('[data-fileget-test]').forEach((n) => n.remove());
    for (const [n, hidden, style] of (window.__filegetShown || [])) {
      n.hidden = hidden;
      if (style === null) n.removeAttribute('style'); else n.setAttribute('style', style);
    }
    window.__filegetShown = [];
  });
  return '';
}

async function clickButton(pg, id, msgId) {
  const res = await pg.evaluate(({ id, msgId }) => {
    const b = document.getElementById(id);
    if (!b) return { missing: true };
    b.click();
    return { missing: false };
  }, { id, msgId });
  await pg.waitForTimeout(400);
  const said = await pg.evaluate((msgId) => { const m = document.getElementById(msgId); return m ? m.textContent : null; }, msgId);
  return { ...res, said };
}

async function runRemote(engine, platform, say) {
  const { browser, pg, asked, errors } = await openPage(engine, 'http://kosmos-remote.test', platform);
  engine = engine + ' (' + platform + ' board)';
  try {
    say(await pg.evaluate(() => kplusRemote()) === true, engine + ' R0: the page reached as kosmos-remote.test counts as Kosmos+');
    for (const [where, listId, name, cls, downloaded] of ROWS) {
      const want = engine.startsWith('webkit') ? downloaded.replace(/^DOWNLOAD /, 'ANCHOR ') : downloaded;
      asked.length = 0;
      const missing = await clickRow(pg, listId, name, cls, () => asked.includes(want));
      const opened = asked.filter((a) => /^POST /.test(a));
      say(!missing && asked.includes(want) && opened.length === 0,
        engine + ' R1: over Kosmos+ a click on a file in ' + where + ' downloads it and asks the board to open nothing',
        missing || JSON.stringify(asked));
    }
    for (const [where, listId, , cls, , , msgId] of ROWS) {
      asked.length = 0;
      const said = () => pg.evaluate((id) => { const m = document.getElementById(id); return m ? m.textContent : null; }, msgId);
      let gone = null;   // the value the wait SAW: a later read can race the page's own list poll clearing the line
      await clickRow(pg, listId, GONE, cls, async () => { const t = await said(); if (t === GONE_SAID) gone = t; return gone === GONE_SAID; });
      if (gone === null) gone = await said();
      say(gone === GONE_SAID && !asked.some((a) => /^POST /.test(a)),
        engine + ' R3: over Kosmos+ a file the board refuses in ' + where + ' is said under it in the board\u2019s own sentence',
        JSON.stringify({ said: gone, asked }));
    }
    for (const [what, id, msgId, sentence] of BUTTONS) {
      asked.length = 0;
      const r = await clickButton(pg, id, msgId);
      say(!r.missing && !asked.some((a) => /^POST /.test(a)) && r.said === sentence,
        engine + ' R2: over Kosmos+ the button for ' + what + ' asks the board for nothing and says where it opens',
        r.missing ? 'no #' + id : JSON.stringify({ asked, said: r.said }));
    }
    say(errors.length === 0, engine + ' R: no page errors', errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}
const BUTTONS = [
      ['the project folder from Documents', 'docs-finder', 'docs-msg', FOLDER_SENTENCE],
      ['the project folder from project settings', 'pjs-reveal', 'pjs-reveal-msg', FOLDER_SENTENCE],
      ['an agent\u2019s Files folder', 'd-files-finder', 'd-filesall-msg', FOLDER_SENTENCE],
      ['the project conversations folder', 'pjs-chats-reveal', 'pjs-chats-msg', FOLDER_SENTENCE],
      ['the task conversations folder', 'tk-chats-reveal', 'tk-chats-msg', FOLDER_SENTENCE],
      ['the Kosmos folder from Settings', 'set-reveal', 'set-reveal-msg', FOLDER_SENTENCE],
      ['the Kosmos folder from the update offer', 'upd-open-folder', 'upd-open-folder-msg', FOLDER_SENTENCE],
      ['an agent\u2019s Terminal', 'd-open-terminal', 'd-open-terminal-msg', TERMINAL_SENTENCE],
      ['the Accessibility settings', 'set-a11y-open', 'set-machine-msg', SETTINGS_SENTENCE],
];
const ROWS = [
      ['project rail', 'pj-docs', DECK, 'pj-doc', 'DOWNLOAD /api/project/' + PROJECT + '/file-download?name=' + encodeURIComponent(DECK), 'POST /api/project/' + PROJECT + '/open-file', 'pj-docs-msg'],
      ['Documents view', 'docs-list', DECK, 'pj-doc', 'DOWNLOAD /api/project/' + PROJECT + '/file-download?name=' + encodeURIComponent(DECK), 'POST /api/project/' + PROJECT + '/open-file', 'docs-msg'],
      ['a cited file in the thread', 'pj-room', DECK, 'refgo', 'DOWNLOAD /api/project/' + PROJECT + '/file-download?name=' + encodeURIComponent(DECK), 'POST /api/project/' + PROJECT + '/open-file', 'pj-room-msg'],
      ['an agent\u2019s Files', 'd-files-list', 'report.pptx', 'pj-doc', 'DOWNLOAD /api/agent/' + AGENT + '/files/download?name=report.pptx', 'POST /api/agent/' + AGENT + '/files/open', 'd-files-msg'],
];

async function runLocal(engine, platform, say) {
  const { browser, pg, asked, errors } = await openPage(engine, 'http://127.0.0.1:59965', platform);
  engine = engine + ' (' + platform + ' board)';
  try {
    say(await pg.evaluate(() => kplusRemote()) === false, engine + ' L0: the page at 127.0.0.1 is at the computer');
    for (const [where, listId, name, cls, , want] of ROWS) {
      asked.length = 0;
      const missing = await clickRow(pg, listId, name, cls, () => asked.includes(want));
      await pg.waitForTimeout(300);   // anything that would ALSO download has had its chance
      say(!missing && asked.includes(want) && !asked.some((a) => /download/.test(a)),
        engine + ' L1: CONTROL at the computer a click on a file in ' + where + ' still opens it here and downloads nothing',
        missing || JSON.stringify(asked));
    }
    for (const [what, id, msgId, sentence] of BUTTONS) {
      asked.length = 0;
      const r = await clickButton(pg, id, msgId);
      say(!r.missing && asked.some((a) => /^POST /.test(a)) && r.said !== sentence,
        engine + ' L1: CONTROL at the computer the button for ' + what + ' still asks the board to act',
        r.missing ? 'no #' + id : JSON.stringify({ asked, said: r.said }));
    }
    say(errors.length === 0, engine + ' L: no page errors', errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

(async () => {
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  for (const engine of ENGINES) {
    try {
      for (const platform of ['darwin', 'win32']) {
        await runRemote(engine, platform, say);
        await runLocal(engine, platform, say);
      }
    } catch (e) {
      say(false, engine + ': ran to the end', String(e && e.message).split('\n')[0]);
    }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
