/* Drive-through of the update toast + confirm: the toast renders from a
   published newer version, clears the header controls, opens the drawn
   confirm with the exact frozen copy, used to surface the route's from-source
   refusal, and Later remembers per version. Sandboxed server + local release
   host. */
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
    // verdict. Wait for the UPDATE toast: the page's stale notice shares the
    // class (.utoast.stale) and sits beside it, so every read here names the
    // update one.
    await p.waitForSelector('.utoast:not(.stale)', { state: 'visible', timeout: 20000 });
    const txt = await p.locator('.utoast:not(.stale) .utxt').textContent();
    if (!/Update available/.test(txt) || !/Kosmos 9\.9\.9/.test(txt)) die('toast text wrong: ' + txt);

    // In the flow beside the mark; the checks below prove no overlap with the header controls either way.
    const boxes = {};
    for (const [k, sel] of [['toast', '.utoast:not(.stale)'], ['newagent', '#new-agent'], ['checked', '#checked']]) {
      boxes[k] = await p.locator(sel).boundingBox();
    }
    const overlap = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
    if (overlap(boxes.toast, boxes.newagent)) die('toast overlaps the New agent button');
    if (overlap(boxes.toast, boxes.checked)) die('toast overlaps the checked stamp');

    // The drawn placement (#47, pack 2e4e100): the notice lives INSIDE the
    // header's left group, in line beside the mark, not floating anywhere.
    // Without this pin, the clear-of-controls checks pass any placement.
    const placement = await p.evaluate(() => {
      const t = document.querySelector('.utoast:not(.stale)');
      const k = document.getElementById('klink');
      const inLeft = !!t.closest('.headleft');
      const tb = t.getBoundingClientRect();
      const kb = k.getBoundingClientRect();
      return { inLeft, rightOfMark: tb.left >= kb.right,
               sameBand: Math.abs((tb.top + tb.height / 2) - (kb.top + kb.height / 2)) < kb.height,
               staticPos: getComputedStyle(t).position === 'static' };
    });
    if (!placement.inLeft || !placement.rightOfMark || !placement.sameBand || !placement.staticPos) {
      die('desktop: the notice is not inline beside the mark ' + JSON.stringify(placement));
    }

    // The old absolute comment's warning, mechanized: a child in the flow
    // must not re-space the row. Measured 2026-08-17: zero x-shift on the
    // right group; the header grows 8px taller, the trade the pack's own
    // mobile comment blesses ("the header grows when an update is waiting"
    // over anything unclickable). Pin the x-shift at zero.
    const withToast = await p.evaluate(() => ({
      newagent: Math.round(document.getElementById('new-agent').getBoundingClientRect().x),
      checked: Math.round(document.getElementById('checked').getBoundingClientRect().x),
    }));
    // display:none, not an innerHTML round trip: rebuilding the markup from
    // a string would strip the buttons' listeners and kill the Install step
    // this drive runs later.
    await p.evaluate(() => { document.getElementById('utoast-slot').style.display = 'none'; });
    const sansToast = await p.evaluate(() => ({
      newagent: Math.round(document.getElementById('new-agent').getBoundingClientRect().x),
      checked: Math.round(document.getElementById('checked').getBoundingClientRect().x),
    }));
    await p.evaluate(() => { document.getElementById('utoast-slot').style.display = ''; });
    if (withToast.newagent !== sansToast.newagent || withToast.checked !== sansToast.checked) {
      die('the notice re-spaces the header row: ' + JSON.stringify({ withToast, sansToast }));
    }
    await p.screenshot({ path: path.join(OUT, 'update-toast.png') });

    // The toast's Install is GOLD (the pack's action colour): the neutral
    // .uacts button rule outweighed the gold class once, silently.
    const goldBg = await p.locator('#ut-install').evaluate((el) => getComputedStyle(el).backgroundColor);
    if (goldBg !== 'rgb(227, 179, 65)') die('toast Install lost the gold: ' + goldBg);

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

    // Not now closes; Later hides and remembers the version.
    await p.click('#uc-no');
    if (await p.isVisible('#updconfirm')) die('Not now did not close the confirm');
    await p.click('#ut-later');
    if (await p.isVisible('.utoast:not(.stale)')) die('Later did not hide the toast');
    const remembered = await laterVersion(p);
    if (remembered !== '9.9.9') die('Later did not remember the version: ' + remembered);

    // ...and it STAYS hidden across the next ticks.
    await p.waitForTimeout(6000);
    if (await p.isVisible('.utoast:not(.stale)')) die('the toast came back after Later');

    // Later is per VERSION (Mona Lisa's three facts, #780): a note left for an
    // older release does not silence a newer one...
    /* 🔑 WRITTEN IN THE OLD BARE-STRING SHAPE ON PURPOSE, and worth keeping that
       way: #1132 gave the note a floor and stores an object, but a person who
       pressed Later on an earlier build still has a bare version in their
       browser. This leg is the only place that exercises reading it. */
    await p.evaluate(() => localStorage.setItem('kosmos-update-later', '9.9.8'));
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForSelector('.utoast:not(.stale)', { state: 'visible', timeout: 20000 });
    // ...and Check for Update clears the note, through the real button.
    await p.click('#ut-later');
    if ((await laterVersion(p)) !== '9.9.9') die('Later did not re-note the current version');
    // While an update is on offer the footer's button reads Update, so the
    // fake host now says the running version is latest and the page asks
    // (the same TTL-bypassing route the button uses); the offer withdraws
    // and the footer offers Check for Update, the real button, which clears.
    served = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
    await p.evaluate(async () => { await fetch('/api/update/check', { method: 'POST' }).then((r) => r.text()); });
    await p.click('[data-tab="settings"]'); await p.waitForTimeout(300);
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
    await p.waitForSelector('.utoast:not(.stale)', { state: 'visible', timeout: 20000 });
    const mboxes = {};
    for (const [k, sel] of [['toast', '.utoast:not(.stale)'], ['newagent', '#new-agent'], ['checked', '#checked'], ['burger', '.burger']]) {
      const loc = p.locator(sel).first();
      mboxes[k] = (await loc.count()) && await loc.isVisible() ? await loc.boundingBox() : null;
    }
    for (const k of ['newagent', 'checked', 'burger']) {
      if (overlap(mboxes.toast, mboxes[k])) die('mobile: toast overlaps ' + k + ' ' + JSON.stringify(mboxes));
    }
    if (mboxes.toast.x < 0 || mboxes.toast.y < 0) die('mobile: toast off-screen ' + JSON.stringify(mboxes.toast));
    await p.screenshot({ path: path.join(OUT, 'update-toast-375.png') });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('TOAST DRIVE OK: render, geometry clear of header controls, frozen copy verbatim, opens on Not now, Update never pressed, Later per version and back for a newer one and cleared by Check for Update, 0 page errors; shots in ' + OUT);
  } finally {
    await b.close();
    srv.kill();
    rel.close();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
