/* Drive-through of the update toast + confirm: the toast renders from a
   published newer version, clears the header controls, opens the drawn
   confirm with the exact frozen copy, used to surface the route's from-source
   refusal, and a stored Later still quiets its version. #3955: the toast is
   now the one-line chip "An update is available" with Update. Sandboxed
   server + local release host. */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

/**
 * The version "Later" remembered, from either stored shape.
 *
 * 🛑 THIS CHECK WENT RED ON A CORRECT PRODUCT, and that is the failure worth
 * naming rather than the one-line fix. It asserted the note EQUALLED "9.9.9",
 * which pinned the representation instead of the claim. #1132 gave Later a time
 * floor, so the note became `{v, at}` and back-compat kept reading bare strings.
 * The version was remembered exactly as this check intends; the check was
 * describing yesterday's storage format.
 *
 * ⭐ A CHECK KEYED TO A REPRESENTATION FAILS WHEN SOMEBODY IMPROVES IT, which is
 * the moment you least want a red board: it reads as a regression, it blocks a
 * cut, and the cheapest way out is to weaken the assertion. Ask what the product
 * PROMISES (Later remembers which version you dismissed) and assert that.
 */
async function laterVersion(p) {
  return p.evaluate(() => {
    const raw = localStorage.getItem('kosmos-update-later');
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? (o.v || null) : raw;
    } catch { return raw; }
  });
}

/* Run with the durable playwright runtime:
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node \
 *     docs/browser-checks/render-update-toast.js
 * Sandboxes every root the server writes to and runs its own local release
 * host; kills only the processes it started. */
const REPO = path.resolve(__dirname, '..', '..');
/* Screenshots go to SHOT_DIR or a fresh temp dir, never into the repo (#630):
   they differ byte for byte run to run and dirtied the shared checkout under
   every cut. The path is printed at the end so a person can find them. */
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'toast-shots-'));
/* A free port, asked of the kernel, never a number (#708): the gate got this
   in #633 and the self-booting checks still carried fixed ports, so two agents
   running the same check collided exactly as before. */
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();
const RELPORT = freePort();

(async () => {
  let served = '9.9.9'; // what the fake release host says is latest; the Later leg withdraws the offer by serving the running version
  const rel = http.createServer((req, res) => {
    if (req.url === '/dist/latest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: served }));
    } else { res.writeHead(404); res.end(); }
  }).listen(RELPORT, '127.0.0.1');

  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-drive-' + k.toLowerCase() + '-'));
  }
  /* ⚠️ HALF RESTATED, SAID PLAINLY. The first leg (the toast appears, its text,
     its geometry) follows the product's ruling below and is green. The later
     legs (the from-source refusal, the dialog's copy, Later per version) assert
     a dialog the product no longer has and are red; carded rather than
     restated to a guess. */
  /* AN INSTALLED LAYOUT, NOT A SOURCE RUN. A board running from its source
     never offers an update (Josh, 2026-08-23 13:03: the toast said Install and
     pressing it met a refusal), so status serves `update: null` unless
     engine/update.js's installedRoot() finds runtime/bin/node beside an app/
     that holds server.js. This check was red from the moment that landed and
     nobody ran it. The board here is booted from a throwaway install layout
     whose app/ is a symlink to this checkout, with symlinks preserved so
     __dirname stays inside the layout. That is the shipped case, exercised. */
  /* #3574 (0.6.93 cut, 3b red): this check's board is its own, so a fresh sandbox shows the
     first-visit tips, and the Settings tip card sits over #upd-btn and takes the click.
     Tips are not what this check tests, so turn them off in THIS sandbox's store, the way
     render-help-tips-3574.js seeds its own. The path comes from engine/tips.js's FILE(), so
     it cannot drift from where the board reads it. */
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  const tipsFile = require(path.join(REPO, 'engine', 'tips')).FILE();
  fs.mkdirSync(path.dirname(tipsFile), { recursive: true });
  fs.writeFileSync(tipsFile, JSON.stringify({ seen: [], off: true }));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-drive-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'runtime', 'bin', 'node'), '#!/bin/sh\nexec node "$@"\n', { mode: 0o755 });
  fs.symlinkSync(REPO, path.join(home, 'app'));
  const srv = spawn('node', ['--preserve-symlinks', '--preserve-symlinks-main', path.join(home, 'app', 'server.js')], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_WORKFORCE_RELEASE_BASE: `http://127.0.0.1:${RELPORT}/dist`,
      AGENT_WORKFORCE_DATA: roots.DATA,
      AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH,
      AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'), // sandboxed whole (#634): the board refuses a real tmux beside sandboxed dirs
    },
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); rel.close(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    // The first status tick pokes the release host; the second renders the
    // verdict. Wait for the update chip (#3955): the engine-stale notice keeps the
    // .utoast.stale look, so every read here names the chip.
    await p.waitForSelector('.uchip', { state: 'visible', timeout: 20000 });
    // #3955 (Mona Lisa's mock A): one line, no version number, one action.
    const txt = (await p.locator('.uchip').innerText()).replace(/\s+/g, ' ').trim();
    if (txt !== 'An update is available Update') die('chip text wrong: ' + txt);

    // #5018: floating over the page under the header; the checks below prove no overlap with New agent either way.
    // #3051: the agent-status stamp (#checked) moved off the header row into the user
    // menu, so it is no longer a header-row peer the toast could collide with or re-space;
    // it is dropped from this check's geometry set (measuring a hidden element is vacuous).
    const boxes = {};
    for (const [k, sel] of [['toast', '.uchip'], ['newagent', '#new-agent']]) {
      boxes[k] = await p.locator(sel).boundingBox();
    }
    const overlap = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
    if (overlap(boxes.toast, boxes.newagent)) die('toast overlaps the New agent button');

    // The placement since #5018 (Josh: "i would much rather they appear over the content"): the notice lives in
    // the floating stack centred under the navigation, below the header, and the header keeps its height. Without
    // this pin, the clear-of-controls checks pass any placement. (2026-08-17 to #5018 it sat inline beside the mark.)
    const headH = () => p.evaluate(() => document.querySelector('.apphead header').getBoundingClientRect().height);
    const placement = await p.evaluate(() => {
      const t = document.querySelector('.uchip');
      const hb = document.querySelector('.apphead header').getBoundingClientRect();
      const tb = t.getBoundingClientRect();
      const centre = (b) => b.left + b.width / 2;
      return { inStack: !!t.closest('#topnotes'), belowHeader: tb.top >= hb.bottom, centred: Math.abs(centre(tb) - centre(hb)) < 2 };
    });
    if (!placement.inStack || !placement.belowHeader || !placement.centred) {
      die('desktop: the notice does not float centred under the header ' + JSON.stringify(placement));
    }

    // A floating notice must not re-space anything: New agent stays where it is and the header keeps its height.
    const withToast = await p.evaluate(() => ({
      newagent: Math.round(document.getElementById('new-agent').getBoundingClientRect().x),
    }));
    withToast.headH = await headH();
    // display:none, not an innerHTML round trip: rebuilding the markup from
    // a string would strip the buttons' listeners and kill the Install step
    // this drive runs later.
    await p.evaluate(() => { document.getElementById('utoast-slot').style.display = 'none'; });
    const sansToast = await p.evaluate(() => ({
      newagent: Math.round(document.getElementById('new-agent').getBoundingClientRect().x),
    }));
    sansToast.headH = await headH();
    await p.evaluate(() => { document.getElementById('utoast-slot').style.display = ''; });
    if (withToast.newagent !== sansToast.newagent || withToast.headH !== sansToast.headH) {
      die('the notice re-spaces the header row: ' + JSON.stringify({ withToast, sansToast }));
    }
    await p.screenshot({ path: path.join(OUT, 'update-toast.png') });

    // The chip's Update is GOLD (the pack's action colour; the neutral button rule outweighed it once, silently).
    const goldBg = await p.locator('#ut-install').evaluate((el) => getComputedStyle(el).backgroundColor);
    if (goldBg !== 'rgb(227, 179, 65)') die('the chip\'s Update lost the gold: ' + goldBg);

    // Install opens the confirm with the frozen copy, word for word.
    await p.click('#ut-install');
    await p.waitForSelector('#updconfirm', { state: 'visible' });
    const title = (await p.locator('#uc-t').textContent()).trim();
    const bodyTx = (await p.locator('#uc-small').textContent()).replace(/\s+/g, ' ').trim();
    if (title !== 'Update Kosmos?') die('confirm title: ' + title);
    if (bodyTx !== 'Kosmos closes for a few seconds while it updates. Your agents keep working the whole time.')
      die('confirm body drifted: ' + bodyTx);
    const goTxt = (await p.locator('#uc-go').textContent()).trim();
    const noTxt = (await p.locator('#uc-no').textContent()).trim();
    if (goTxt !== 'Update' || noTxt !== 'Not now') die('confirm buttons: ' + noTxt + ' / ' + goTxt);
    // It opens on the harmless answer (Mona Lisa's ruling on #780).
    const opened = await p.evaluate(() => document.activeElement && document.activeElement.id);
    if (opened !== 'uc-no') die('the confirm did not open focused on Not now: ' + opened);
    await p.screenshot({ path: path.join(OUT, 'update-confirm.png') });

    // The trap holds at BOTH wrap boundaries, with real keypresses: Tab on
    // the last stop wraps to the first; Shift+Tab on the first wraps back.
    await p.locator('#uc-go').focus();
    await p.keyboard.press('Tab');
    let active = await p.evaluate(() => document.activeElement && document.activeElement.id);
    if (active !== 'uc-no') die('Tab from the last stop escaped the confirm to: ' + active);
    await p.keyboard.press('Shift+Tab');
    active = await p.evaluate(() => document.activeElement && document.activeElement.id);
    if (active !== 'uc-go') die('Shift+Tab from the first stop escaped the confirm to: ' + active);

    /* RETIRED (#780): the leg that pressed Update and read the route's
       from-source refusal. A source-run board no longer offers an update at
       all (Josh, 2026-08-23 13:03), so that state cannot arise, and this
       board is an installed layout on purpose, where Update would start a
       real install. Update is not pressed here. */

    // Not now closes. #3955: the chip has no Later; a Later pressed on an older page (a note in this
    // browser) still quiets its version for its window, which is the reading kept below.
    await p.click('#uc-no');
    if (await p.isVisible('#updconfirm')) die('Not now did not close the confirm');
    if ((await p.locator('.uchip button').count()) !== 1) die('the chip grew a second button back (it has one action, Update)');
    await p.evaluate(() => localStorage.setItem('kosmos-update-later', JSON.stringify({ v: '9.9.9', at: Date.now() })));
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForTimeout(6000);
    if (await p.isVisible('.uchip')) die('a Later note for this version did not quiet the chip');
    const remembered = await laterVersion(p);
    if (remembered !== '9.9.9') die('the Later note was lost: ' + remembered);

    // Later is per VERSION (Mona Lisa's three facts, #780): a note left for an
    // older release does not silence a newer one...
    /* 🔑 WRITTEN IN THE OLD BARE-STRING SHAPE ON PURPOSE, and worth keeping that
       way: #1132 gave the note a floor and stores an object, but a person who
       pressed Later on an earlier build still has a bare version in their
       browser. This leg is the only place that exercises reading it. */
    await p.evaluate(() => localStorage.setItem('kosmos-update-later', '9.9.8'));
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForSelector('.uchip', { state: 'visible', timeout: 20000 });
    // ...and Check for Update clears the note, through the real button.
    await p.evaluate(() => localStorage.setItem('kosmos-update-later', JSON.stringify({ v: '9.9.9', at: Date.now() })));
    // (setup only: the note is written here so the Check for Update leg below has one to clear)
    // While an update is on offer the footer's button reads Update, so the
    // fake host now says the running version is latest and the page asks
    // (the same TTL-bypassing route the button uses); the offer withdraws
    // and the footer offers Check for Update, the real button, which clears.
    served = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    await p.evaluate(async () => { await fetch('/api/update/check', { method: 'POST' }).then((r) => r.text()); });
    await p.evaluate(() => showTab('settings')); await p.waitForTimeout(300);
    await p.click('#s-nav button[data-go="updates"]'); await p.waitForTimeout(300);
    await p.waitForFunction(() => { const b = document.getElementById('upd-btn'); return b && !b.hidden && b.getBoundingClientRect().height > 0 && /Check for Update/.test(b.innerText); }, null, { timeout: 15000 });
    await p.click('#upd-btn');
    await p.waitForTimeout(1500);
    const cleared = await p.evaluate(() => localStorage.getItem('kosmos-update-later'));
    if (cleared !== null) die('Check for Update did not clear the Later note: ' + cleared);

    // Mobile pass: at 375 the toast must still clear whatever header
    // controls are visible.
    await p.setViewportSize({ width: 375, height: 812 });
    await p.evaluate(() => localStorage.removeItem('kosmos-update-later'));
    served = '9.9.9'; // the offer is back for the mobile pass
    await p.evaluate(async () => { await fetch('/api/update/check', { method: 'POST' }).then((r) => r.text()); });
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForSelector('.uchip', { state: 'visible', timeout: 20000 });
    const mboxes = {};
    for (const [k, sel] of [['toast', '.uchip'], ['newagent', '#new-agent'], ['burger', '.burger']]) {
      const loc = p.locator(sel).first();
      mboxes[k] = (await loc.count()) && await loc.isVisible() ? await loc.boundingBox() : null;
    }
    for (const k of ['newagent', 'burger']) {
      if (overlap(mboxes.toast, mboxes[k])) die('mobile: toast overlaps ' + k + ' ' + JSON.stringify(mboxes));
    }
    if (mboxes.toast.x < 0 || mboxes.toast.y < 0) die('mobile: toast off-screen ' + JSON.stringify(mboxes.toast));
    // #3955: nor past the right edge, and the page does not scroll sideways because of it.
    const edge = await p.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }));
    if (mboxes.toast.x + mboxes.toast.width > edge.vw) die('mobile: the chip runs past the right edge ' + JSON.stringify({ toast: mboxes.toast, edge }));
    if (edge.sw > edge.vw) die('mobile: the page scrolls sideways ' + JSON.stringify(edge));
    await p.screenshot({ path: path.join(OUT, 'update-toast-375.png') });

    // #5140 (day-one): a brand-new user on a phone, past the welcome, with no agents yet. Their first action is New
    // agent, and a floating notice must not sit on it. The pass above dismisses the welcome with Escape, where New
    // agent is not shown at all, so its "toast overlaps newagent" test had nothing to compare (newagent: null). Here the
    // welcome is completed, the way a person finishes it, and New agent must render (CONTROL) before "not covered" counts.
    await p.evaluate(async () => { await fetch('/api/first-run/complete', { method: 'POST' }).then((r) => r.text()); });
    await p.evaluate(() => localStorage.removeItem('kosmos-update-later'));
    // The passes above end in Settings > Updates and a reload keeps that page; a new user lands on the agents board.
    await p.goto(`http://127.0.0.1:${PORT}/?tab=agents`, { waitUntil: 'networkidle' });
    await p.waitForSelector('.uchip', { state: 'visible', timeout: 20000 });
    // --topnotes-clear is written by a ResizeObserver after layout; measure once it holds the notice's clearance.
    await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--topnotes-clear').trim() !== '0px'
      && getComputedStyle(document.documentElement).getPropertyValue('--topnotes-clear').trim() !== '', null, { timeout: 10000 }).catch(() => {});
    const empty = await p.evaluate(() => {
      const box = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
      const na = box(document.getElementById('new-agent')); const chip = box(document.querySelector('.uchip'));
      const hit = na ? document.elementFromPoint(na.left + na.width / 2, na.top + na.height / 2) : null;
      const cover = na && chip && na.left < chip.right && chip.left < na.right && na.top < chip.bottom && chip.top < na.bottom;
      return { tab: new URLSearchParams(location.search).get('tab'), emptyBoard: !!document.querySelector('#grid > .pj-empty'), boardShown: !document.getElementById('boardbar').hidden, welcomeShown: !document.getElementById('firstrun').hidden, newAgent: na && [Math.round(na.left), Math.round(na.top), Math.round(na.width), Math.round(na.height)],
        chip: chip && [Math.round(chip.left), Math.round(chip.top), Math.round(chip.width), Math.round(chip.height)], cover: !!cover,
        takesClick: !!(hit && document.getElementById('new-agent').contains(hit)) };
    });
    if (!empty.emptyBoard || !empty.boardShown || empty.welcomeShown || !empty.newAgent || !empty.chip) die('CONTROL #5140: past the welcome on an empty board at 375, New agent and the update notice must both render, on the agents board ' + JSON.stringify(empty));
    if (empty.cover || !empty.takesClick) die('#5140: on an empty board at 375 the update notice covers New agent, a new user\'s first action ' + JSON.stringify(empty));
    console.log('PASS  #5140: empty board at 375, the update notice clears New agent and New agent takes the click ' + JSON.stringify(empty));
    await p.screenshot({ path: path.join(OUT, 'update-toast-375-empty.png') });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('TOAST DRIVE OK: the one-line chip (#3955), geometry clear of header controls, frozen copy verbatim, opens on Not now, Update never pressed, a stored Later per version and back for a newer one and cleared by Check for Update, 0 page errors; shots in ' + OUT);
  } finally {
    await b.close();
    srv.kill();
    rel.close();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
