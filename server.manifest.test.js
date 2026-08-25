'use strict';

/**
 * The connect routes, driven against the real server.
 *
 * A separate file from `server.test.js` for the same reason as
 * `server.projects.test.js`: that file's blocks are a standing merge hazard,
 * and this feature can add a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE, plus one this feature adds: the
 * Claude config. `subscription` fixes its path at load and the real file is
 * the operator's live account -- and `connect.start()` DECIDES things by
 * reading it, so an unsandboxed run would decide from the operator's reality.
 * DRY_RUN is armed so nothing here can run a real program.
 *
 *   node --test server.manifest.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-manifest-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects'); // sandboxed whole (#634)
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
/* Both sandbox knobs travel together (#527): the scoped check resolves
   the DEFAULT account's record through accounts, whose HOME is its own
   seam; without this, a future default-dir scoped check in this file
   would read the operator's real ~/.claude.json while believing itself
   sandboxed. */
process.env.AGENT_WORKFORCE_HOME = HOME;
// The two sandbox seams travel together (launchSignin warns loudly otherwise,
// and a warning that fires on every green run trains people to ignore it).
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
// `/bin/echo` exists and is executable, which is all "Claude is installed"
// means to `start` -- so no test here ever reaches the download path.
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
/* ⚠️ A FAKE TMUX, NOT /bin/echo (#332). echo stubbed the writes and printed
   its arguments to the reads, which the parser refused, so every read fell
   through to the real tmux on the PATH and these tests measured the
   operator's live fleet. The fake answers reads from fixtures (none set here:
   an empty board) and echoes everything else, so write-side receipts hold. */
process.env.AGENT_WORKFORCE_TMUX_BIN = require('node:path').join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const nodePath2 = require('node:path');
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* #718, the home-screen third: the page links a manifest, the manifest is
   served as a manifest (not as the page), every icon it names is served as
   an image, and it launches the board standalone. Not the store third. */
test('the board is installable: manifest linked, served as its type, icons real, standalone at the root', async () => {
  const page = await (await fetch(base + '/')).text();
  assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest">/, 'the page does not link the manifest');
  assert.match(page, /<meta name="apple-mobile-web-app-capable" content="yes">/, 'iOS Safari reads this, not display:standalone');
  assert.match(page, /<meta name="theme-color" content="#[0-9a-f]{6}">/);
  const res = await fetch(base + '/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/manifest\+json/, 'served as the page or as plain JSON, a browser will not install from it');
  const m = JSON.parse(await res.text());
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name, 'no name under the icon');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'Chrome needs 192 and 512 to offer install: ' + sizes.join(','));
  for (const icon of m.icons) {
    const r = await fetch(base + icon.src);
    assert.equal(r.status, 200, icon.src + ' is named by the manifest and not served');
    assert.equal(r.headers.get('content-type'), 'image/png', icon.src + ' served as something other than an image');
    assert.ok(fs.existsSync(nodePath2.join(__dirname, 'web', icon.src)), icon.src + ' is not on disk');
  }
  /* A manifest is a JSON file a browser reads; the theme colour in it and
     the meta must agree, or the status bar changes colour on install. */
  const meta = /<meta name="theme-color" content="(#[0-9a-f]{6})">/.exec(page)[1];
  assert.equal(m.theme_color, meta, 'the manifest and the meta disagree on the theme colour');
});
