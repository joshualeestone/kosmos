/* #1277: what the Settings update card says after an UNATTENDED attempt.
 *
 * `node --test` reads source; it cannot see the page. The engine arms for this
 * run the paint function extracted out of the file, which is better than a copy
 * and still not the page: it cannot catch a broken element id, a hidden ancestor,
 * a JS error earlier in boot that stops the function ever being called, or a
 * sentence that renders and is invisible.
 *
 * Three branches, and they are three different facts to a person: an ordinary
 * failure that will be retried, this version having used its three attempts, and
 * three DIFFERENT versions having failed here, which is the one that says
 * something about the machine rather than the release.
 *
 * Run with the durable playwright runtime:
 *   NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-auto-attempt-1277.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(REPO, 'web', 'index.html'), 'utf8');

/* Every /api/* answer the page asks for while booting, so the card paints. Only
   updateAttempt varies per case; everything else is a fixed floor, and if the
   page starts needing something new this check says so by going red rather than
   by silently rendering an empty card. */
function apiBody(route, attempt) {
  if (route.startsWith('/api/autoupdate')) return { on: true, ok: true };
  if (route.startsWith('/api/status')) {
    return {
      agents: [], counts: {}, connection: {}, version: '0.6.20',
      updateAttempt: attempt,
    };
  }
  return {};
}

async function paintFor(browser, attempt) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(apiBody(req.url, attempt)));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    /* Drive the real function through the real page rather than waiting on the
       board's own boot sequence, which needs far more of the product than this
       card. The element, its hidden flag and the branch logic are all the page's. */
    const out = await page.evaluate((a) => {
      if (typeof autoAttemptPaint !== 'function') return { missing: true };
      autoAttemptPaint(a);
      const el = document.getElementById('auto-attempt');
      if (!el) return { noElement: true };
      const cs = getComputedStyle(el);
      return {
        hidden: el.hidden,
        text: (el.textContent || '').trim(),
        display: cs.display,
        visibility: cs.visibility,
      };
    }, attempt);
    return { ...out, errors };
  } finally {
    await page.close();
    server.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const fail = [];
  try {
    const ended = '2026-09-01T03:00:00Z';
    const live = await paintFor(browser, { auto: true, endedAt: ended, version: '0.7.0', attempts: 1, streak: 1 });
    const perVersion = await paintFor(browser, { auto: true, endedAt: ended, version: '0.7.0', attempts: 3, streak: 1 });
    const perMachine = await paintFor(browser, { auto: true, endedAt: ended, version: '0.7.0', attempts: 3, streak: 3 });
    const running = await paintFor(browser, { auto: true, endedAt: null, version: '0.7.0', attempts: 1, streak: 1 });
    const manual = await paintFor(browser, { auto: false, endedAt: ended, version: '0.7.0', attempts: 1, streak: 1 });

    for (const [name, r] of [['live', live], ['perVersion', perVersion], ['perMachine', perMachine]]) {
      if (r.missing) fail.push(`${name}: autoAttemptPaint is not defined on the page`);
      else if (r.noElement) fail.push(`${name}: #auto-attempt is not in the document`);
      else {
        if (r.hidden !== false) fail.push(`${name}: the card stayed hidden, so the person sees nothing`);
        if (!r.text) fail.push(`${name}: rendered an EMPTY sentence`);
        /* Visible, not merely present. A sentence in a display:none ancestor is
           the same to a person as no sentence at all. */
        if (r.display === 'none' || r.visibility === 'hidden') {
          fail.push(`${name}: element is present but not visible (display=${r.display} visibility=${r.visibility})`);
        }
      }
      if (r.errors && r.errors.length) fail.push(`${name}: page errors ${JSON.stringify(r.errors.slice(0, 2))}`);
    }
    if (live.text && perVersion.text && live.text === perVersion.text) {
      fail.push('a board that used all three attempts says the SAME thing as one that failed once, '
        + 'so the terminal state reaches nobody');
    }
    if (perVersion.text && perMachine.text && perVersion.text === perMachine.text) {
      fail.push('three DIFFERENT versions failing reads identically to one bad version, which is a '
        + 'different fact with a different thing to do about it');
    }
    if (perMachine.text && !/three different versions/i.test(perMachine.text)) {
      fail.push(`the machine-level sentence does not say what happened: ${perMachine.text}`);
    }
    if (perVersion.text && /try again later/i.test(perVersion.text)) {
      fail.push('a stopped board promises a retry that will never come');
    }
    /* CONTROLS: the two cases that must render NOTHING. Without these, every
       assertion above is satisfied by a card that always shows something. */
    if (running.hidden !== true) fail.push('CONTROL: an attempt still RUNNING was announced as a result');
    if (manual.hidden !== true) fail.push('CONTROL: a MANUAL attempt was duplicated onto this card');

    if (fail.length) {
      console.error('AUTO-ATTEMPT DRIVE FAILED:\n  ' + fail.join('\n  '));
      process.exitCode = 1;
    } else {
      console.log('AUTO-ATTEMPT DRIVE OK: three branches distinct and visible, in-flight and manual '
        + 'both silent, 0 page errors');
    }
  } finally {
    await browser.close();
  }
})();
