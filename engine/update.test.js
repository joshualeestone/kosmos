const test = require('node:test');
const assert = require('node:assert/strict');
const update = require('./update');
const { version: RUNNING } = require('../package.json');

test.beforeEach(() => { update.resetCache(); update.setFetcher(null); update.setBase(null); });

test('newer(): strictly numeric dotted-triple, and unknown loses', () => {
  assert.equal(update.newer('0.1.1', '0.1.0'), true);
  assert.equal(update.newer('0.2.0', '0.1.9'), true);
  assert.equal(update.newer('1.0.0', '0.9.9'), true);
  assert.equal(update.newer('0.1.0', '0.1.0'), false);
  assert.equal(update.newer('0.1.0', '0.1.1'), false);
  // ⚠️ Unknown NEVER wins: a corrupted manifest cannot pop a toast.
  assert.equal(update.newer('banana', '0.0.0'), false);
  assert.equal(update.newer('0.2', '0.1.0'), false);
  assert.equal(update.newer('0.1.1-rc1', '0.1.0'), false);
  assert.equal(update.newer('', '0.1.0'), false);
  assert.equal(update.newer('1e3.0.0', '0.1.0'), false);
});

test('available() reports a newer published version, and only a newer one', async () => {
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  await update.refresh();
  assert.deepEqual(update.available(), { version: '99.0.0' });

  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.available(), null, 'the running version showed as an update');

  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '0.0.1' }) }));
  await update.refresh();
  assert.equal(update.available(), null, 'an OLDER published version showed as an update');
});

test('every failure is soft: no network, bad status, bad JSON, bad shape', async () => {
  for (const [label, f] of [
    ['a thrown fetch', async () => { throw new Error('offline'); }],
    ['a non-ok response', async () => ({ ok: false, json: async () => ({}) })],
    ['unparseable JSON', async () => ({ ok: true, json: async () => { throw new Error('nope'); } })],
    ['a version that is not a string', async () => ({ ok: true, json: async () => ({ version: 42 }) })],
    ['a malformed version string', async () => ({ ok: true, json: async () => ({ version: 'latest' }) })],
  ]) {
    update.resetCache();
    update.setFetcher(f);
    await update.refresh().catch(() => { /* the thrown-fetch case */ });
    assert.equal(update.available(), null, `${label} produced an update notice`);
  }
});

test('a down host is asked once per cache window, not once per status tick', async () => {
  let calls = 0;
  update.setFetcher(async () => { calls += 1; return { ok: false, json: async () => ({}) }; });
  await update.refresh();
  // poke() must see the fresh (miss) cache and not fetch again.
  update.poke();
  update.poke();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 1, 'poke() re-fetched inside the cache window');

  // ⚠️ And a host that THROWS (offline, DNS, abort), not just one that
  // answers badly: the attempt stamp used to sit after the await, so a
  // rejecting fetch never stamped and the five-second status poll asked a
  // dead host forever.
  update.resetCache();
  let throws = 0;
  update.setFetcher(async () => { throws += 1; throw new Error('offline'); });
  await update.refresh().catch(() => { });
  update.poke();
  update.poke();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(throws, 1, 'a throwing fetch is retried inside the cache window');
});

/* ---------------------------------------------------------------------------
 * update-control: reachability, checkNow, and the 15-minute TTL.
 * ------------------------------------------------------------------------ */

test('reachability is its own fact: could-not-reach never reads as up-to-date', async () => {
  // Never looked: not reached, and LOOKED false -- the boot contract the
  // card's Checking arm renders (asserted against what lastLook actually
  // emits, not a hand-built literal).
  assert.deepEqual(update.lastLook(), { reached: false, readable: false, at: 0, looked: false });
  // A look that got an answer (even "nothing newer") is reached.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  const after = update.lastLook();
  assert.equal(after.reached, true, 'a successful look did not read as reached');
  assert.equal(after.looked, true, 'a completed look still reads as first-look-in-flight');
  assert.ok(after.at > 0, 'the look left no timestamp');
  assert.equal(update.available(), null, 'CONTROL: no offer, which is exactly the up-to-date case');
  // The next look fails: reached flips false even though a cached answer exists.
  update.setFetcher(async () => { throw new Error('offline'); });
  await update.refresh().catch(() => {});
  assert.equal(update.lastLook().reached, false,
    'an unreachable host still read as reached (would render "up to date" while offline)');
});

test('checkNow bypasses the TTL and answers fresh, with reachability', async () => {
  // Prime the cache with a fresh successful look...
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.lastLook().reached, true);
  // ...then change the world: poke() would sit on the TTL, checkNow asks anyway.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.poke();
  // Settled first: poke's refresh is async, and an unsettled assertion
  // would pass even with the TTL gate deleted (the control could not fail).
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(update.available(), null,
    'CONTROL: poke inside the TTL refreshed anyway, so checkNow proves nothing');
  const out = await update.checkNow();
  assert.deepEqual(out, { running: RUNNING, latest: '99.0.0', reached: true, readable: true });
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'the fresh answer did not land in the cache the toast reads');
  // And a checkNow that cannot reach says so rather than throwing.
  update.setFetcher(async () => { throw new Error('offline'); });
  const down = await update.checkNow();
  assert.equal(down.reached, false);
  assert.equal(down.running, RUNNING, 'the running version vanished from an unreachable answer');
});

test('a reachable host with an unusable answer is readable:false, never up-to-date material', async () => {
  // The captive-portal shape: 200 with a splash page (unparseable body).
  update.setFetcher(async () => ({ ok: true, json: async () => { throw new Error('html'); } }));
  await update.refresh();
  const look = update.lastLook();
  assert.equal(look.reached, true, 'a host that answered read as unreached');
  assert.equal(look.readable, false, 'an unusable answer read as usable');
  // And a non-ok answer (CDN 404/500): the host WAS reached; blaming the
  // network would name the wrong leg.
  update.setFetcher(async () => ({ ok: false, json: async () => ({}) }));
  await update.refresh();
  assert.equal(update.lastLook().reached, true, 'an errored answer read as could-not-reach');
  assert.equal(update.lastLook().readable, false, 'an errored answer read as usable');
  assert.equal(update.available(), null, 'CONTROL: no offer, the exact case the card maps');
  // And a good answer flips readable back.
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: RUNNING }) }));
  await update.refresh();
  assert.equal(update.lastLook().readable, true);
});

test('the fifteen-minute promise, asserted on the exported value', () => {
  assert.equal(update.TTL, 15 * 60 * 1000, 'the check interval drifted from the promised fifteen minutes');
});

/* ---- the automatic half of the update switch --------------------------
   Josh, 2026-08-22: "the switch should be on the updates to be automatically
   update Kosmos". These fix WHEN it fires, and the three refusals matter more
   than the fire: this is the one path in the product that runs software with
   nobody watching. */

function autoSetup({ latest, pref, root }) {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: latest }) }));
  update.setInstalledRoot(() => root);
  update.setAutoPref(() => pref);
  let started = 0;
  update.setInstallRunner(() => { started += 1; });
  return () => started;
}

test.afterEach(() => {
  update.setInstalledRoot(null);
  update.setAutoPref(null);
  update.setInstallRunner(null);
});

test('a look that finds a newer version installs it when the switch is on', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 1, 'the switch is on and a newer version went uninstalled');
});

test('the switch off means the same look installs nothing', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: false, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 0, 'software installed itself against the person\'s choice');
  // and the offer is still THERE -- off means "do not install", not "do not tell me".
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'turning off automatic updates also silenced the notice, which is a different setting');
});

test('an unreadable preference installs nothing', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: false, ok: false }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 0);
});

test('a from-source checkout is never auto-installed over', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: null });
  await update.refresh();
  assert.equal(started(), 0, 'the installer was pointed at a working tree');
});

test('nothing newer, nothing installed', async () => {
  const started = autoSetup({ latest: RUNNING, pref: { on: true, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  assert.equal(started(), 0);
});

test('a preference that throws costs the update notice nothing', async () => {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => { throw new Error('bad mount'); });
  update.setInstallRunner(() => {});
  await update.refresh();
  assert.deepEqual(update.available(), { version: '99.0.0' },
    'a preference we could not read broke the notice that does not depend on it');
});

test('repeated looks cannot stack installers', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: '/opt/kosmos' });
  await update.refresh();
  await update.refresh();
  await update.refresh();
  assert.equal(started(), 1, 'three looks ran three installers over each other');
});

test('an automatic install that keeps failing does not retry every look', async () => {
  /**
   * 🛑 THE LOOP THIS CLOSES IS UNATTENDED, WHICH IS WHAT MAKES IT BAD. A
   * machine that cannot install -- no write permission, a full disk, a blocked
   * release host -- would spawn a fresh `curl | sh` on every fifteen-minute
   * look, forever, with nobody watching. `beginInstall` releases its
   * single-flight flag on a non-zero exit so a PERSON can press Install again,
   * and that release is exactly what handed the automatic path an unbounded
   * retry.
   */
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => ({ on: true, ok: true }));
  let started = 0;
  /* A runner that FAILS the way a real one does: the spawn succeeds and the
     child exits non-zero, which is what releases the flag. */
  update.setInstallRunner(() => {
    started += 1;
    return { on: (evt, fn) => { if (evt === 'exit') setTimeout(() => fn(1), 0); }, unref() {} };
  });

  await update.refresh();
  assert.equal(started, 1, 'the premise: the first look does try');
  await new Promise((r) => setTimeout(r, 5));   // let the exit handler run

  /* ⚠️ NOT `resetCache()` BETWEEN LOOKS, which is what the first version of
     this test did -- and `resetCache` clears the backoff stamp, so the test
     wiped the very state it was asserting about and read the result as the
     code failing. `refresh()` called directly is the real second look: it
     bypasses the TTL the same way the background poll eventually does, and
     touches nothing else. */
  await update.refresh();
  assert.equal(started, 1, 'a failed automatic install retried on the very next look');

  update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null);
});

test('a PERSON whose install fails does not suppress the next automatic one', async () => {
  /**
   * 🔑 THE OBSERVABLE HARM OF STAMPING THE BACKOFF ON BOTH PATHS is not that
   * the button stops working -- `beginInstall` never consults the stamp -- it
   * is that ONE failed press by a person would silence the unattended path for
   * an hour on a machine that could have installed perfectly well a minute
   * later. So the test has to be about the AUTO attempt that follows a MANUAL
   * failure, which is where the difference shows.
   */
  update.resetCache();
  let started = 0;
  const failing = () => {
    started += 1;
    return { on: (evt, fn) => { if (evt === 'exit') setTimeout(() => fn(1), 0); }, unref() {} };
  };
  update.setInstallRunner(failing);

  update.beginInstall();                       // as the route calls it: no `auto`
  assert.equal(started, 1, 'the premise: the press tried');
  await new Promise((r) => setTimeout(r, 5));  // its exit releases the flag

  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => ({ on: true, ok: true }));
  await update.refresh();
  assert.equal(started, 2,
    'a person\'s failed press put the UNATTENDED path into a backoff it never earned');

  update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null);
});

/**
 * The one command in this product that ends in `| sh`.
 *
 * 🛑 NOTHING EXERCISED OR CHECKED IT. Every test that reaches `beginInstall`
 * injects `installRunner`, which replaces the spawn entirely, so the real
 * command was never built, never run and never asserted. That is the highest
 * consequence line in the codebase and it had the least coverage of any line
 * near it.
 *
 * 🔑 THE PROPERTY IS SYNTACTIC, so the check reads the source rather than
 * running it. "This value must not be interpolated into a shell string" is a
 * fact about the TEXT, and the only way to observe it at runtime would be to
 * actually execute a hostile URL. The URL travels as a positional parameter
 * (`sh -c '... "$1"' sh <url>`), which is what makes a base containing
 * `; rm -rf ~` an argument rather than a command.
 *
 * ⚠️ AND THE BASE IS OVERRIDABLE. `setBase` and `KOSMOS_RELEASE_BASE` exist for
 * staging, so the URL is not a constant this file controls. That is exactly why
 * the shape matters rather than being belt-and-braces.
 */
const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, 'update.js'), 'utf8');

test('the installer URL is a positional parameter, never interpolated into the shell string', () => {
  const at = SRC.indexOf("spawn('/bin/sh'");
  assert.ok(at > -1, 'the installer spawn is gone or no longer uses /bin/sh directly');
  const call = SRC.slice(at, SRC.indexOf(')', SRC.indexOf('setupUrl()', at)) + 1);

  /* The safe shape, asserted positively first: the command references `$1`,
     `$2` and `$3` only, and the URL, the status file and the stamp ride as
     their own argv elements after the `sh` argv[0] filler (#553 added the
     two trailing positionals so the installer's exit code and start stamp
     land in logs/install.status whatever happens to this server). */
  /* #1277 widened the printf from two fields to four so the DURABLE record
     carries the target version and whether the machine chose the install. The
     two new values ride as $4 and $5, argv elements like the three before them,
     and nothing new enters the -c string. The shape is re-pinned rather than
     loosened: this guard exists because interpolating a release base into a
     shell string turns it into shell. */
  /* `set -o pipefail` was added because the recorded code was the PIPELINE's,
     which is sh's, not curl's: a 404 recorded 0, and seedFromStatusFile returns
     early on 0, so the failure this durable channel exists to record produced
     no record and no attempt count at all. Measured: piped 404 recorded 0,
     unpiped recorded 56, with pipefail 56. It changes the reviewed shape, so
     the shape is re-pinned rather than the guard loosened. */
    /* #1277 again: a SIXTH printf field, the cross-version failure streak, riding
       as $7. The per-version cap is right for a bad tarball and was a hole for a
       machine that cannot install anything, so a counter a version change does
       not reset has to survive the restart the installer causes, which means it
       has to live in this file. Re-pinned rather than loosened, and this guard is
       exactly why the change got read: it went red the moment the field landed. */
  assert.match(call, /'-c',\s*'set -o pipefail; curl -fsSL "\$1" \| sh; code=\$\?; printf "%s %s %s %s %s %s\\n" "\$code" "\$3" "\$4" "\$5" "\$6" "\$7" > "\$2"',\s*'sh',\s*setupUrl\(\)/,
    'the installer command is no longer the reviewed shape: ' + call);
  /* The two trailing positionals, asserted on the wider source since the
     slice above stops at the URL: the status file is $2, the stamp is $3,
     neither interpolated. */
  assert.ok(/setupUrl\(\),\s*statusFile,\s*lastAttempt\.startedAt,\s*lastAttempt\.version \|\| '-',\s*lastAttempt\.auto \? '1' : '0',\s*String\(lastAttempt\.attempts \|\| 0\),\s*String\(lastAttempt\.streak \|\| 0\)\]/.test(SRC),
    'the status file, stamp, version, auto flag, attempt count and cross-version streak no longer all '
      + 'ride as positionals');

  /* And the unsafe shapes, by name. A template literal or a concatenation
     inside the `-c` string is the whole failure: it turns a release base into
     shell. */
  const dashC = call.slice(call.indexOf("'-c'"), call.indexOf("'sh',"));
  assert.ok(!/\$\{/.test(dashC), 'the command string interpolates: ' + dashC);
  assert.ok(!/\+/.test(dashC), 'the command string concatenates: ' + dashC);
  assert.ok(!/setupUrl/.test(dashC), 'the URL is inside the command string rather than beside it');
});

test('a hostile release base cannot become a command', () => {
  /* 🔑 THE CONTROL, and it exercises the real builder rather than restating it.
     `setupUrl()` is what feeds that positional parameter, so a base carrying
     shell metacharacters must come back as a URL string and nothing else. What
     makes it harmless is its POSITION, which the test above pins; this pins
     that nothing sanitises it into looking harmless while the position changes
     underneath. */
  update.setBase('https://example.com/dist"; rm -rf ~; echo "');
  const url = update.setupUrl();
  assert.match(url, /rm -rf ~/, 'the base was silently rewritten, so this test no longer proves anything');
  assert.ok(!url.includes('\n'), 'the URL carries a newline, which no positional parameter should');
  update.setBase(null);
});

test('#553: a failed install is RECORDED for the page, keyed to its own press, and a new press starts clean', async () => {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => ({ on: false, ok: true }));
  await update.refresh();
  assert.equal(update.lastAttempt(), null, 'the premise: nothing has been attempted yet');

  /* A runner that FAILS the way a real one does: spawn succeeds, exit 3. */
  let exitFn = null;
  update.setInstallRunner(() => ({ on: (evt, fn) => { if (evt === 'exit') exitFn = fn; }, unref() {} }));
  update.beginInstall();
  const started = update.lastAttempt();
  assert.ok(started && started.startedAt && started.endedAt === null, 'the press did not open a record');
  exitFn(3);
  const ended = update.lastAttempt();
  assert.equal(ended.code, 3, 'the installer\'s exit code did not reach the record');
  assert.equal(ended.startedAt, started.startedAt, 'the ended record lost the press it belongs to');
  assert.ok(ended.endedAt, 'no end stamp');
  assert.equal(ended.log, '/opt/kosmos/logs/install.log', 'the diary path is not the engine\'s own');
  assert.match(ended.because, /stopped/);

  /* A new press: the old failure is history, not a verdict on this one. */
  update.beginInstall();
  const fresh = update.lastAttempt();
  assert.equal(fresh.endedAt, null);
  assert.equal(fresh.code, null);
  assert.notEqual(fresh.startedAt, undefined);

  update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null);
  update.resetCache();
  assert.equal(update.lastAttempt(), null, 'resetCache left an attempt behind');
});

test('#553: a spawn error records its own sentence, in a run of its own so no earlier exit bleeds in', async () => {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => '/opt/kosmos');
  update.setAutoPref(() => ({ on: false, ok: true }));
  await update.refresh();
  /* Only 'error' is wired here (a real spawn failure emits it); the
     record must carry the could-not-start sentence and no code. */
  update.setInstallRunner(() => ({ on: (evt, fn) => { if (evt === 'error') setTimeout(() => fn(new Error('EAGAIN')), 0); }, unref() {} }));
  update.beginInstall();
  await new Promise((r) => setTimeout(r, 10));
  const got = update.lastAttempt();
  assert.match(got.because, /could not be started/);
  assert.equal(got.code, null);
  update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null);
  update.resetCache();
});

test('#553: a failure the OLD server never lived to see is read back from logs/install.status', () => {
  /* On an update the installer stops the board before it downloads, so
     the exit listener is dead for every real failure; the spawned shell
     writes the code and the start stamp to a file, and whichever server
     answers next seeds its record from it. A code of 0 seeds nothing. */
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-upd-'));
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  update.resetCache();
  update.setInstalledRoot(() => root);
  fs.writeFileSync(path.join(root, 'logs', 'install.status'), '0 2026-08-24T18:00:00.000Z\n');
  assert.equal(update.lastAttempt(), null, 'a successful run seeded a failure');
  fs.writeFileSync(path.join(root, 'logs', 'install.status'), '1 2026-08-24T18:05:00.000Z\n');
  const got = update.lastAttempt();
  assert.ok(got, 'the failed run left no record for the next board');
  assert.equal(got.code, 1);
  assert.equal(got.startedAt, '2026-08-24T18:05:00.000Z', 'the stamp did not come from the file');
  assert.equal(got.log, path.join(root, 'logs', 'install.log'));
  assert.ok(got.endedAt);
  update.setInstalledRoot(null); update.resetCache();
  fs.rmSync(root, { recursive: true, force: true });
});

/* #1277: THE UPDATER'S OWN TIMER.
   Every arm below is BEHAVIOURAL: it drives the real poll and watches what
   happens, rather than reading update.js for the shape of the code. A source
   read would pass against a timer that was created and never fired, which is
   the exact defect this card is about -- machinery that exists and is never
   driven. */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(pred, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (pred()) return true; await sleep(5); }
  return pred();
}

test.afterEach(() => { update.stopAutoPoll(); });

test('#1277: a board NOBODY LOOKS AT still checks, and still installs', async () => {
  const started = autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: '/opt/kosmos' });
  /* The whole point: nothing in this test poked. No status GET, no checkNow,
     no hand-driven refresh -- exactly the headless machine's situation. */
  assert.equal(started(), 0, 'precondition: nothing has installed before the poll runs');
  update.startAutoPoll({ every: 5 });
  await waitFor(() => started() === 1, 3000);
  assert.equal(started(), 1,
    'an unwatched board took no update: poke() still has no caller but the status route');
});

test('#1277: a from-source board does not poll a host it could never install from', async () => {
  autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: null });
  let fetches = 0;
  update.setFetcher(async () => { fetches += 1; return { ok: true, json: async () => ({ version: '99.0.0' }) }; });
  update.startAutoPoll({ every: 5 });
  await sleep(150);
  assert.equal(fetches, 0,
    'a checkout that installs from git made release-host traffic that can lead nowhere');
});

test('#1277: the poll never holds the process open', () => {
  const t = update.startAutoPoll({ every: 60 * 1000 });
  assert.ok(t, 'no timer was created');
  assert.equal(typeof t.hasRef, 'function', 'not a node timer, so unref cannot be checked');
  assert.equal(t.hasRef(), false,
    'the poll is ref\'d, so `kosmos start` would never exit and the suite would hang');
});

test('#1277: starting twice leaves ONE timer, so a single stop really stops', async () => {
  autoSetup({ latest: '99.0.0', pref: { on: true, ok: true }, root: '/opt/kosmos' });
  let fetches = 0;
  update.setFetcher(async () => { fetches += 1; return { ok: true, json: async () => ({ version: '99.0.0' }) }; });
  update.startAutoPoll({ every: 5 });
  update.startAutoPoll({ every: 5 });
  await waitFor(() => fetches > 0, 2000);
  update.stopAutoPoll();
  assert.equal(update.autoPollRunning(), false, 'autoPollRunning still reports a live poll after stop');

  /* 🔑 THE TTL GATE HIDES AN ORPHANED TIMER, so the obvious assertion here is
     worthless. After the first fetch `poke()` returns early for a whole TTL
     window, so a leaked timer keeps firing and fetches NOTHING -- the count
     stops growing whether or not the leak exists. Measured: with the
     single-flight `stopAutoPoll()` removed from `startAutoPoll`, a
     count-based version of this test stayed GREEN.
     Clearing the cache reopens the gate, so a timer that is still alive is
     forced to reveal itself on its next tick. */
  update.resetCache();
  const settled = fetches;
  await sleep(150);
  assert.equal(fetches, settled,
    'a second start orphaned the first timer, so one stop left it running forever');
});

test('#1277: stopping a poll that never started is safe', () => {
  update.stopAutoPoll();
  update.stopAutoPoll();
  assert.equal(update.autoPollRunning(), false);
});

/* ---- iteration 1 findings: cadence, the env floor, the fetch gate, the reset ----
 * Each of these was a real defect found by review, and each has an arm because
 * a fix nobody drives is the same shape as the bug this card is about.
 */
test('#1277: the poll tick stays small against TTL, so a missed boundary costs little', () => {
  const u = require('./update');
  /* The module docblock says firing AT TTL doubles the cadence. 5 minutes is
     "well inside" 15 and still lands EXACTLY on the boundary every third tick,
     which is the same failure by a different route: measured at 5, 25, 45, 65,
     a 20-minute cadence from a 15-minute TTL, and a REACHABLE host polled less
     often than an unreachable one. The property that matters is alignment. */
  /* Read off a STARTED timer rather than an exported constant. Exporting the
     constant purely so this arm could see it created an export that is tested,
     excused by nobody, and reachable from nowhere, which is the #265 signature
     the repo's own engine.reachable guard exists to catch. It caught me in the
     full suite while the single-file run stayed green. */
  u.resetCache();
  /* ⚠️ The ambient env var must be OUT OF THE WAY. This arm reasons about the
     POLL_EVERY constant, but startAutoPoll() reads AGENT_WORKFORCE_UPDATE_POLL_MS
     when it is set, and the source calls that a live production variable. On a
     machine where an operator has set it above TTL/10 this arm went red for a
     configuration choice rather than a code change, which is the false-red the
     runner exists to stop people re-running past. */
  const prevPoll = process.env.AGENT_WORKFORCE_UPDATE_POLL_MS;
  delete process.env.AGENT_WORKFORCE_UPDATE_POLL_MS;
  let interval;
  try {
    const t = u.startAutoPoll();
    interval = t && (t._repeat || t._idleTimeout);
    u.stopAutoPoll();
  } finally {
    if (prevPoll !== undefined) process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = prevPoll;
  }
  assert.ok(interval > 0, 'could not read the default interval off the started timer');
  /* 🛑 THE PROPERTY IS GRANULARITY, NOT DIVISIBILITY, AND I ASSERTED THE WRONG
     ONE FIRST. My first version of this arm required the interval not to divide
     TTL; it went red on 60s, which divides 900s exactly and is nonetheless
     fine. A boundary tick is ALWAYS missed by epsilon, so the real cost is one
     whole tick, and what matters is how big that tick is: 5 minutes stretched
     15 to 20 (+33%), 60 seconds stretches it to 16 (+7%). Bounding the
     overshoot is the honest invariant; the arm taught me that by failing. */
  assert.ok(interval <= u.TTL / 10,
    `a missed boundary costs one whole tick, so ${interval}ms against a ${u.TTL}ms TTL can stretch `
    + `the real cadence by ${Math.round((interval / u.TTL) * 100)}%. Keep the tick small relative `
    + 'to TTL so the gate, not the tick, decides when the host is asked');
});

test('#1277: the poll interval env var has a floor, so =1 cannot spin the machine', () => {
  const u = require('./update');
  u.resetCache();
  const prev = process.env.AGENT_WORKFORCE_UPDATE_POLL_MS;
  process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = '1';
  try {
    const t = u.startAutoPoll();
    const ms = t && (t._repeat || (t._idleTimeout));
    assert.ok(ms >= 1000,
      `an interval of ${ms}ms got through. The variable is live in production with no validation, `
      + 'so =1 would spin installedRoot() a thousand times a second on an unattended machine');
  } finally {
    u.stopAutoPoll();
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_UPDATE_POLL_MS;
    else process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = prev;
  }
});

test('#1277: DRY_RUN stops the FETCH but leaves the timer, so the suite cannot install', async () => {
  /* Sixteen test files boot the real server, so all of them start this poll
     against the real fetch and the real release host. The only thing that kept
     the suite off the network was installedRoot() returning null because a
     checkout is not an installed layout, which is incidental: from an installed
     app directory that guard goes truthy, the default-on preference passes, and
     a test run can spawn a real curl-pipe-sh installer.

     The gate is on the FETCH, not the timer, because the wiring guard in
     server.update-poll-1277.test.js asks whether the poll is running. */
  const u = require('./update');
  u.resetCache();
  let fetches = 0;
  u.setFetcher(async () => { fetches += 1; return { ok: true, json: async () => ({ version: '9.9.9' }) }; });
  u.setInstalledRoot(() => '/tmp/pretend-installed');
  /* 🛑 A RUNNER, OR THIS ARM SPAWNS THE REAL INSTALLER. Opening every gate is
     the POINT of this control, and the last gate is a live `curl | sh` against
     installkosmos.com. Measured before this line: two real installer spawns per
     `node --test engine/update.test.js`, and that endpoint serves a real 201KB
     installer even for a version that does not exist. The product gate added in
     engine/update.js also refuses now; this is the second lock, because a test
     must not depend on a product guard to be safe to run. */
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  /* 🛑 STUB THE PREFERENCE TOO, OR THIS ARM CANNOT BE TRUSTED TO FAIL. The tick
     has three gates and this one only stubbed two.

     ⚠️ CORRECTED. This comment used to say autoupdate.js reads an absent OR
     unreadable file as { on: false }. That is wrong about the absent case and
     wrong in the flattering direction, so it is worth stating plainly rather
     than quietly editing: engine/autoupdate.js:43 returns { ...DEFAULTS,
     ok: true } on ENOENT, so ABSENT READS AS ON. Only PRESENT-BUT-UNREADABLE
     (or corrupt) fails toward off, at :46. On a machine with no autoupdate.json
     the ambient preference is therefore ON, deleting the DRY_RUN gate WOULD
     have produced a fetch, and this arm WOULD have failed. My stated hazard did
     not exist on the machine I was describing.

     The hazard is real for the other two states: a file that is present and off,
     or one that is unreadable. Stubbing autoPref removes the dependence on the
     ambient machine entirely, which is why the fix stands even though the
     reasoning printed under it did not. server.switch-account-1373.test.js:143
     on this same branch already stated it correctly, so the branch contradicted
     itself and the wrong half is the one that was load-bearing here. */
  u.setAutoPref(() => ({ on: true }));
  const prev = process.env.AGENT_WORKFORCE_DRY_RUN;
  process.env.AGENT_WORKFORCE_DRY_RUN = '1';
  try {
    u.startAutoPoll({ every: 1000 });
    assert.equal(u.autoPollRunning(), true,
      'the TIMER must still run under DRY_RUN, or the wiring assertion this card exists for cannot see it');
    await new Promise((r) => setTimeout(r, 2400));
    assert.equal(fetches, 0,
      `the poll fetched ${fetches} time(s) under DRY_RUN with a truthy installedRoot. That is the `
      + 'shape where a test run reaches the real release host and can start a real installer');

    /* NEGATIVE CONTROL: with the variable unset and every other gate open, the
       tick MUST fetch. Without this the assertion above is satisfied by a poll
       that never fetches under any conditions. */
    u.stopAutoPoll();
    delete process.env.AGENT_WORKFORCE_DRY_RUN;
    u.resetCache();
    u.setAutoPref(() => ({ on: true }));
    u.setInstalledRoot(() => '/tmp/pretend-installed');
    fetches = 0;
    u.startAutoPoll({ every: 1000 });
    await new Promise((r) => setTimeout(r, 2400));
    assert.ok(fetches > 0,
      'CONTROL: with DRY_RUN unset the tick must fetch, or the assertion above proves only that '
      + 'this poll never fetches at all');
  } finally {
    u.stopAutoPoll();
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DRY_RUN; else process.env.AGENT_WORKFORCE_DRY_RUN = prev;
    u.setFetcher(null); u.setInstalledRoot(null); u.setAutoPref(null); u.resetCache();
  }
});

test('#1277: resetCache stops the poll, so a reset means what its name says', () => {
  const u = require('./update');
  u.startAutoPoll({ every: 5000 });
  assert.equal(u.autoPollRunning(), true, 'precondition: the poll must be running');
  u.resetCache();
  assert.equal(u.autoPollRunning(), false,
    'resetCache left the poll running. It clears five other pieces of module state, so a future '
    + 'test that starts the poll and calls only resetCache leaks a live interval into the suite');
});

test('#1277: the poll interval env var has a CEILING, so "disable it" cannot spin the machine', async () => {
  /* setInterval collapses any delay above 2147483647 to 1ms. Setting this to a
     year is the natural way to try to turn the poll off, and unclamped it ran
     installedRoot() about 780 times a second forever, on exactly the unattended
     machine this card is about. Measured before the clamp: _repeat=1 and 39
     ticks in 50ms; the 60s control gave 0. The floor guarded one end only. */
  const u = require('./update');
  u.resetCache();
  u.setInstalledRoot(() => null);
  const prev = process.env.AGENT_WORKFORCE_UPDATE_POLL_MS;
  process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = '31536000000';
  try {
    const t = u.startAutoPoll();
    const ms = t && (t._repeat || t._idleTimeout);
    assert.ok(ms > 1000,
      `a one-year interval resolved to ${ms}ms. Above 2147483647 setInterval wraps to 1ms, so the `
      + 'operator who tried to switch the poll off got a thousand-per-second spin instead');
    assert.ok(ms <= 2147483647, `interval ${ms}ms exceeds the setInterval maximum and will wrap`);
  } finally {
    u.stopAutoPoll();
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_UPDATE_POLL_MS;
    else process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = prev;
    u.setInstalledRoot(null); u.resetCache();
  }
});

test('#1277: an automatic install records WHICH version and says so, a manual one stays quiet', async () => {
  /* Until this card an automatic install needed somebody at the board, so
     "what did it install" was answerable by whoever pressed the button. The
     unattended path is now the normal one, and the record carried a start
     stamp, an exit code and no version at all. */
  const u = require('./update');
  u.resetCache();
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '9.9.9' }) }));
  u.setInstalledRoot(() => '/tmp/pretend-installed');
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  try {
    /* 🛑 THE SPY MUST WRAP refresh(), NOT JUST beginInstall(). refresh() ends by
       calling maybeAutoInstall(), which fires the automatic install itself, so a
       spy installed afterwards captures nothing and the explicit call below
       returns early on the single-flight flag. Measured: the first version of
       this captured [] and read as "the code writes nothing".

       It matters more than a naming slip that this is asserted at all: the new
       fields reach NO SCREEN, because the update overlay renders only a record
       belonging to a press the viewer just made. So this line is the only
       artifact an unattended install produces for a human. */
    const written = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => { written.push(String(chunk)); return realWrite(chunk, ...rest); };
    try {
      await u.refresh();
      u.beginInstall({ auto: true });
    } finally { process.stderr.write = realWrite; }

    const a = u.lastAttempt();
    assert.equal(a.version, '9.9.9',
      `the attempt recorded version=${a.version}. After a machine changes version by itself, the `
      + 'first question is what it took, and nothing on the box answered it');
    assert.equal(a.auto, true, 'the record must say the machine chose this, not a person');
    assert.ok(written.some((l) => /automatic install of 9\.9\.9/.test(l)),
      `the automatic path wrote nothing naming the version. Got: ${JSON.stringify(written)}. With no `
      + 'screen showing an unattended attempt, this line is the only thing a human can read');

    /* And the manual path stays quiet, because whoever pressed the button
       already knows. Paired, so neither half is vacuous. */
    /* The manual path, with the automatic one switched OFF so maybeAutoInstall
       cannot fire and claim the single-flight flag first. */
    u.resetCache();
    u.setAutoPref(() => ({ on: false }));
    await u.refresh();
    const written2 = [];
    process.stderr.write = (chunk, ...rest) => { written2.push(String(chunk)); return realWrite(chunk, ...rest); };
    try {
      u.beginInstall();
    } finally { process.stderr.write = realWrite; }
    assert.ok(!written2.some((l) => /automatic install of/.test(l)),
      `a manual install announced itself as automatic. Got: ${JSON.stringify(written2)}`);
  } finally {
    u.setFetcher(null); u.setInstalledRoot(null); u.setInstallRunner(null); u.resetCache();
  }
});

test('#1277: the ENDED record still says which version and that it was automatic', async () => {
  /* The in-flight record was covered; the ended one was not, and the ended one
     is the only kind an operator ever reads. A successful install kills this
     server before anything is recorded, so an attempt that HAS an endedAt is
     always a failure, and /api/status ships that record to the page. */
  const u = require('./update');
  u.resetCache();
  let onExit = null;
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '9.9.9' }) }));
  u.setInstalledRoot(() => '/tmp/pretend-installed');
  u.setInstallRunner(() => ({
    on(ev, fn) { if (ev === 'exit') onExit = fn; },
    unref() {}, stderr: { on() {} },
  }));
  try {
    await u.refresh();
    u.beginInstall({ auto: true });
    assert.ok(onExit, 'precondition: the runner must have bound an exit handler');
    onExit(1, null);
    const a = u.lastAttempt();
    assert.ok(a && a.endedAt, 'precondition: the attempt must have ended');
    assert.equal(a.version, '9.9.9',
      `the ended record says version=${a.version}. It is rebuilt from scratch, so the fields the `
      + 'automatic path adds were dropped at exactly the moment the record starts mattering');
    assert.equal(a.auto, true, 'the ended record must still say the machine chose this');
  } finally {
    u.setFetcher(null); u.setInstalledRoot(null); u.setInstallRunner(null); u.resetCache();
  }
});

test('#1277: the installer URL carries the version buster, which had never once fired', async () => {
  /* cache.latest is a STRING; the old code read `.version` off it, so the
     buster resolved to '' every time. The comment above setupUrl says it exists
     because an edge cache can hand an updating machine the PREVIOUS release's
     installer, which then fetches the previous bytes and reports success. */
  const u = require('./update');
  u.resetCache();
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '9.9.9' }) }));
  try {
    assert.doesNotMatch(u.setupUrl(), /[?]v=/, 'CONTROL: with nothing cached there is no version to bust with');
    await u.refresh();
    assert.match(u.setupUrl(), /[?]v=9\.9\.9$/,
      `setupUrl() is ${u.setupUrl()}. Without the buster an edge cache can serve the previous `
      + 'release installer to a machine that is updating, and it reports success');
  } finally { u.setFetcher(null); u.resetCache(); }
});

test('#1277: the interval ceiling applies to the in-process seam too, not just the env var', () => {
  /* The FLOOR is scoped to the env path on purpose. The ceiling is not: the
     setInterval wrap is a property of the value, not of who supplied it. */
  const u = require('./update');
  u.resetCache();
  const t = u.startAutoPoll({ every: 1e12 });
  const ms = t && (t._repeat || t._idleTimeout);
  u.stopAutoPoll();
  assert.ok(ms > 1000 && ms <= 2147483647,
    `an in-process interval of 1e12 resolved to ${ms}ms. Above 2147483647 setInterval wraps to 1ms, `
    + 'so a caller trying to slow the poll right down speeds it up to a thousand a second');
});

test('#1277: the tick respects the preference, so an opted-out machine stops phoning home', async () => {
  /* My first reason for NOT gating this was false: I argued the Settings card
     needs a fresh answer, but opening the board hits /api/status which already
     pokes. Ungated, this was new unattended traffic from machines whose owner
     switched auto-update off, for no functional gain. */
  const u = require('./update');
  u.resetCache();
  let fetches = 0;
  u.setFetcher(async () => { fetches += 1; return { ok: true, json: async () => ({ version: '9.9.9' }) }; });
  u.setInstalledRoot(() => '/tmp/pretend-installed');
  /* 🛑 A RUNNER, OR THIS ARM SPAWNS THE REAL INSTALLER. Opening every gate is
     the POINT of this control, and the last gate is a live `curl | sh` against
     installkosmos.com. Measured before this line: two real installer spawns per
     `node --test engine/update.test.js`, and that endpoint serves a real 201KB
     installer even for a version that does not exist. The product gate added in
     engine/update.js also refuses now; this is the second lock, because a test
     must not depend on a product guard to be safe to run. */
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  try {
    u.setAutoPref(() => ({ on: false }));
    u.startAutoPoll({ every: 20 });
    await new Promise((r) => setTimeout(r, 200));
    u.stopAutoPoll();
    assert.equal(fetches, 0, `an opted-out machine fetched ${fetches} time(s) on the unattended tick`);

    u.resetCache();
    u.setAutoPref(() => ({ on: true }));
    u.startAutoPoll({ every: 20 });
    await new Promise((r) => setTimeout(r, 200));
    u.stopAutoPoll();
    assert.ok(fetches > 0, 'CONTROL: with the preference ON the tick must still fetch, or this proves nothing');
  } finally {
    u.setFetcher(null); u.setInstalledRoot(null); u.setAutoPref(null); u.resetCache();
  }
});

/* An arm asserting "a null preference does not silently kill the poll" lived
   here and was DELETED, because it could not fail. It checked that the poll
   still runs and does not fetch, and both are true whether the preference
   throws or returns early: the tick's catch is per-tick, so the interval
   survives either way. Measured by perturbation, which is how it was caught.
   The defensive `(autoPref() || {})` form stays for style and to avoid
   throwing once per tick forever, not for a behaviour this suite can observe.
   Recorded rather than silently removed, so nobody re-adds it. */

test('#1277: the DURABLE record carries the version and the auto flag, not just the in-memory one', () => {
  /* The path that matters. On an update the installer runs `kosmos stop` before
     downloading, so THIS server is dead for every real failure and the
     in-memory noteAttemptEnd path only sees preflight refusals and spawn
     errors. The record an operator reads after an unattended machine changed
     version by itself is seeded from logs/install.status, which carried only an
     exit code and a start stamp. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-status-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  u.resetCache();
  u.setInstalledRoot(() => home);
  try {
    fs.writeFileSync(path.join(home, 'logs', 'install.status'), '1 2026-09-01T00:00:00.000Z 9.9.9 1\n');
    const a = u.lastAttempt();
    assert.equal(a.version, '9.9.9', `the durable record says version=${a.version}`);
    assert.equal(a.auto, true, 'the durable record must say the machine chose this');

    /* And a file from a release BEFORE this change still parses, losing two
       fields rather than the whole failure record. */
    u.resetCache();
    fs.writeFileSync(path.join(home, 'logs', 'install.status'), '1 2026-09-01T00:00:00.000Z\n');
    const old = u.lastAttempt();
    assert.ok(old && old.code === 1, 'a two-field status file from an older release must still parse');
    assert.equal(old.version, null, 'an older file has no version, and null is the honest answer');
  } finally {
    u.setInstalledRoot(null); u.resetCache();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: a failed automatic install does NOT retry after a restart, so a board cannot boot-loop itself down', async () => {
  /* The whole reason this matters: install/setup.sh runs `kosmos stop` before
     downloading, so a real failure kills the process and takes autoFailedAt
     with it. The launchd job is RunAtLoad with no KeepAlive, so the board then
     stays down until the next login. Without a durable brake this card turns
     "stale but up" into "down" on exactly the unattended machines it is for:
     boot, poll a minute later, stop to install, fail, stay stopped. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-loop-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  u.resetCache();
  let installs = 0;
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  u.setInstallRunner(() => { installs += 1; return { on() {}, unref() {}, stderr: { on() {} } }; });
  try {
    /* A FRESH process, exactly as launchd would start one: nothing in memory,
       and a durable record saying the last automatic attempt for THIS version
       failed a moment ago. */
    fs.writeFileSync(path.join(home, 'logs', 'install.status'),
      `1 ${new Date().toISOString()} 99.0.0 1\n`);
    await u.refresh();
    assert.equal(installs, 0,
      `the board started an automatic install ${installs} time(s) despite a durable record of the `
      + 'same version failing minutes ago. On a machine with nobody at it that is a boot loop that '
      + 'ends with the board down, because the installer stops it and launchd does not bring it back');

    /* CONTROL: the same shape but the failure was for a DIFFERENT version, so
       the brake must not apply and the install must proceed. Without this the
       arm above would pass for a predicate that never installs. */
    u.resetCache();
    fs.writeFileSync(path.join(home, 'logs', 'install.status'),
      `1 ${new Date().toISOString()} 98.0.0 1\n`);
    await u.refresh();
    assert.ok(installs > 0, 'CONTROL: a failure recorded for a different version must not block this one');
  } finally {
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: after MAX_AUTO_ATTEMPTS recorded failures the board stops offering, however long ago they were', async () => {
  /* A TIME WINDOW CANNOT CLOSE THE BOOT LOOP. launchd is RunAtLoad with no
     KeepAlive, so a board that stopped itself for a failing install returns
     only at the next login, by which point the previous failure is hours old
     and any window has expired. The board would be up about sixty seconds per
     login, forever. A count does not decay, so it survives the restart the
     installer itself causes. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-cap-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  const long_ago = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let installs = 0;
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  u.setInstallRunner(() => { installs += 1; return { on() {}, unref() {}, stderr: { on() {} } }; });
  try {
    /* Three recorded automatic failures for this version, two days old, so the
       window is long expired and only the count can stop it. */
    const f = path.join(home, 'logs', 'install.status');
    fs.writeFileSync(f, `1 ${long_ago} 99.0.0 1 3\n`);
    fs.utimesSync(f, new Date(Date.now() - 48 * 60 * 60 * 1000), new Date(Date.now() - 48 * 60 * 60 * 1000));
    await u.refresh();
    assert.equal(installs, 0,
      `the board tried again after 3 recorded failures two days old. The window had expired, which `
      + 'is the normal case between logins, so only a count can stop this. Left unchecked the board '
      + 'takes itself down about a minute after every login, forever');

    /* CONTROL 1: the same age and version, but BELOW the cap, must still try. */
    u.resetCache();
    fs.writeFileSync(f, `1 ${long_ago} 99.0.0 1 1\n`);
    fs.utimesSync(f, new Date(Date.now() - 48 * 60 * 60 * 1000), new Date(Date.now() - 48 * 60 * 60 * 1000));
    await u.refresh();
    assert.ok(installs > 0, 'CONTROL: one prior failure is under the cap and must not block the retry');

    /* CONTROL 2: at the cap but for a DIFFERENT version, so a new release is
       never blocked by an old version's failures. */
    installs = 0; u.resetCache();
    fs.writeFileSync(f, `1 ${long_ago} 98.0.0 1 9\n`);
    fs.utimesSync(f, new Date(Date.now() - 48 * 60 * 60 * 1000), new Date(Date.now() - 48 * 60 * 60 * 1000));
    await u.refresh();
    assert.ok(installs > 0, 'CONTROL: a different version must reset the count, or one bad release blocks all future ones');
  } finally {
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: the attempt count ACCUMULATES across the surviving-server path, it does not regress', async () => {
  /* noteAttemptEnd rebuilds the record from scratch and had dropped `attempts`,
     which is the third field this rebuild has lost. On the one path where this
     server survives a failed install (a non-zero child exit before kosmos stop),
     the child had written attempts=2 durably, the rebuilt in-memory record said
     undefined, lastAttemptView returned it instead of re-seeding, and the next
     attempt computed 0+1 and wrote 1 back over the durable 2. The escalation
     counter walked backwards. */
  const u = require('./update');
  u.resetCache();
  let onExit = null;
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '9.9.9' }) }));
  u.setInstalledRoot(() => '/tmp/pretend-installed');
  u.setAutoPref(() => ({ on: true }));
  u.setInstallRunner(() => ({ on(ev, fn) { if (ev === 'exit') onExit = fn; }, unref() {}, stderr: { on() {} } }));
  try {
    await u.refresh();
    assert.ok(onExit, 'precondition: the runner must have bound an exit handler');
    onExit(1, null);
    const a = u.lastAttempt();
    assert.ok(a && a.endedAt, 'precondition: the attempt must have ended');
    assert.equal(a.attempts, 1,
      `the ended record says attempts=${a.attempts}. Dropped here, the count restarts at 1 on every `
      + 'surviving failure and the cap is never reached, so the brake never fires');
  } finally {
    u.setFetcher(null); u.setInstalledRoot(null); u.setAutoPref(null); u.setInstallRunner(null); u.resetCache();
  }
});

test('#1277: giving up says so, because it is the terminal state and no screen shows it', async () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-giveup-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  const long_ago = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  const written = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  try {
    const f = path.join(home, 'logs', 'install.status');
    fs.writeFileSync(f, `1 ${long_ago} 99.0.0 1 3\n`);
    fs.utimesSync(f, new Date(Date.now() - 48 * 3600 * 1000), new Date(Date.now() - 48 * 3600 * 1000));
    process.stderr.write = (c, ...r) => { written.push(String(c)); return realWrite(c, ...r); };
    await u.refresh();
  } finally {
    process.stderr.write = realWrite;
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
  assert.ok(written.some((l) => /giving up on automatic install of 99\.0\.0/.test(l)),
    `the brake fired silently. Got: ${JSON.stringify(written)}. Starting an install writes a line; `
    + 'stopping forever wrote nothing, and the update overlay never renders an unattended attempt, '
    + 'so the terminal state of this whole mechanism reached no human anywhere');
});

test('#1277: a manifest version with whitespace still matches the durable record, or the brake never fires', async () => {
  /* parts() trims only to VALIDATE, so a manifest carrying whitespace left it
     in cache.latest, while seedFromStatusFile splits on \s+ and therefore
     returns a trimmed version. The same-version comparison in maybeAutoInstall
     then compared " 99.0.0 " against "99.0.0" and was false forever, silently
     disabling the attempt brake this card depends on. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-trim-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  const long_ago = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let installs = 0;
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '  99.0.0  ' }) }));
  u.setInstallRunner(() => { installs += 1; return { on() {}, unref() {}, stderr: { on() {} } }; });
  try {
    const f = path.join(home, 'logs', 'install.status');
    fs.writeFileSync(f, `1 ${long_ago} 99.0.0 1 3\n`);
    fs.utimesSync(f, new Date(Date.now() - 48 * 3600 * 1000), new Date(Date.now() - 48 * 3600 * 1000));
    await u.refresh();
    assert.equal(installs, 0,
      'a padded manifest version stopped matching the durable record, so the cap never applied and '
      + 'the board would keep taking itself down. Whitespace in a manifest must not disable a brake');
  } finally {
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: the give-up sentence is said ONCE per version, not once per TTL forever', async () => {
  /* refresh() runs once per TTL for as long as the offer stands, so an
     unlatched line wrote the same terminal-state sentence about 96 times a day
     into logs/board.log, which nothing in this repo rotates. The start line is
     one per attempt and bounded; this one was not. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-latch-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  const long_ago = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const written = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  try {
    const f = path.join(home, 'logs', 'install.status');
    fs.writeFileSync(f, `1 ${long_ago} 99.0.0 1 3\n`);
    fs.utimesSync(f, new Date(Date.now() - 48 * 3600 * 1000), new Date(Date.now() - 48 * 3600 * 1000));
    process.stderr.write = (c, ...r) => { written.push(String(c)); return realWrite(c, ...r); };
    await u.checkNow();
    await u.checkNow();
    await u.checkNow();
  } finally {
    process.stderr.write = realWrite;
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
  const said = written.filter((l) => /giving up on automatic install of 99\.0\.0/.test(l)).length;
  assert.equal(said, 1,
    `the board said it was giving up ${said} times across three looks. Unlatched that is about 96 `
    + 'lines a day forever, into a log nothing rotates');
});

test('#1277: pressing Install by hand does not erase the automatic-failure count', async () => {
  /* The brake is gated on durable.auto, and the manual route calls
     beginInstall() with no opts. Zeroing attempts there wrote `0 0` over the
     record, so the next boot skipped the brake and re-armed three more
     unattended shutdowns. The realistic sequence is not exotic: three automatic
     failures reach the cap, a person logs in, sees the board dying, presses
     Install, that fails too, and walking away restarts the whole loop. A manual
     attempt is not evidence the automatic path started working. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-manual-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  try {
    // three automatic failures on 99.0.0 have already happened
    fs.writeFileSync(path.join(home, 'logs', 'install.status'),
      `1 ${new Date().toISOString()} 99.0.0 1 3\n`);
    // a real offer has to stand, because beginInstall reads cache.latest, not opts
    u.setAutoPref(() => ({ on: false }));
    u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
    await u.checkNow();
    // the person presses Install by hand: no opts, which is the manual route
    u.beginInstall();
    const after = u.lastAttempt() || {};
    assert.equal(after.auto, false, 'a manual press is a manual attempt');
    assert.equal(after.attempts, 3,
      `the manual press wrote attempts=${after.attempts}. Zeroing it here rearms three `
      + 'more unattended self-shutdowns, because the brake is gated on durable.auto '
      + 'and skips a manual record entirely');
  } finally {
    u.setInstalledRoot(null); u.setInstallRunner(null); u.setAutoPref(null); u.setFetcher(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: an install still running is not counted as a failure', async () => {
  /* `durable.code !== 0` is TRUE for `code: null`, which is exactly what an
     IN-FLIGHT attempt carries. So the board could announce it was giving up
     "after 3 failed attempts" while the third was still running and might yet
     succeed, and the latch then suppressed the truth when it finished. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-inflight-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  const written = []; const realWrite = process.stderr.write.bind(process.stderr);
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  try {
    /* ⚠️ The in-flight state CANNOT be hand-written into the status file: the
       installer wrapper writes that file only when the child exits, so a record
       with no exit code exists ONLY in memory. A first version of this arm wrote
       `- <ts> ...` into the file and passed with the guard removed, i.e. it was
       decoration. The state has to be reached by actually starting an install. */
    const f = path.join(home, 'logs', 'install.status');
    // two automatic failures already, the last one long enough ago to retry
    const old_ts = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    fs.writeFileSync(f, `1 ${old_ts} 99.0.0 1 2\n`);
    fs.utimesSync(f, new Date(Date.now() - 2 * 3600 * 1000), new Date(Date.now() - 2 * 3600 * 1000));
    process.stderr.write = (c, ...r) => { written.push(String(c)); return realWrite(c, ...r); };
    await u.checkNow();               // starts attempt 3; the runner never exits
    const mid = u.lastAttempt() || {};
    assert.equal(mid.code, null, 'precondition: attempt 3 is in flight with no exit code');
    assert.equal(mid.attempts, 3, `precondition: this is the third attempt, got ${mid.attempts}`);
    written.length = 0;               // only what is said AFTER it is in flight counts
    await u.checkNow();
  } finally {
    process.stderr.write = realWrite;
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
  const gaveUp = written.filter((l) => /giving up/.test(l));
  assert.equal(gaveUp.length, 0,
    `the board said "${(gaveUp[0] || '').trim()}" about an attempt that had not finished. `
    + 'An unfinished install is not a failed one, and it might yet succeed');
});

test('#1277: a failed MANUAL press does not clear the brake for one more unattended attempt', async () => {
  /* Carrying the count forward on a manual press was necessary and not
     sufficient. The brake read `durable.auto`, so a record whose last attempt
     was manual was skipped entirely and the count nothing read did nothing.
     Measured before the fix, with the record at the cap: an auto record gave
     installs 0, a manual record gave installs 1 and attempts climbed to 4. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  async function attemptsUnderRecord(autoFlag) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-brake-'));
    fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
    let installs = 0;
    u.resetCache();
    u.setInstalledRoot(() => home);
    u.setAutoPref(() => ({ on: true }));
    u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
    u.setInstallRunner(() => { installs += 1; return { on() {}, unref() {}, stderr: { on() {} } }; });
    try {
      const old = new Date(Date.now() - 2 * 3600 * 1000);
      const f = path.join(home, 'logs', 'install.status');
      fs.writeFileSync(f, `1 ${old.toISOString()} 99.0.0 ${autoFlag} 3\n`);
      fs.utimesSync(f, old, old);
      await u.checkNow();
    } finally {
      u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
      u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
    }
    return installs;
  }
  assert.equal(await attemptsUnderRecord('1'), 0, 'CONTROL: the brake must hold on an automatic record at the cap');
  assert.equal(await attemptsUnderRecord('0'), 0,
    'a record at the cap whose last attempt was MANUAL let the automatic path install again. '
    + 'That is the sequence where somebody presses Install, it fails, they walk away, and the '
    + 'board takes itself down once more');
});

test('#1277: a SPAWN error consumes no DURABLE chance, because the installer never ran', async () => {
  /* This arm exists to give `durable.code !== null` a guard of its own. A
     reviewer measured that removing either that clause or `durable.endedAt`
     alone left the suite green, because an in-flight record satisfies both, so
     the condition could not fail for the clause its comment named.

     A spawn error is a DIFFERENT state from an in-flight attempt: wireChild's
     'error' handler calls noteAttemptEnd(owner, null, ...), so endedAt IS set
     and the code is null. The installer never ran, which means `kosmos stop`
     never ran either, so nothing took the board down and the attempt should not
     burn one of three chances. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-spawnerr-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  let installs = 0;
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  // a runner whose child fails to spawn, the real EMFILE/EAGAIN shape
  u.setInstallRunner(() => {
    installs += 1;
    return {
      on(ev, cb) { if (ev === 'error') setImmediate(() => cb(new Error('EAGAIN'))); },
      unref() {}, stderr: { on() {} },
    };
  });
  const statusFile = path.join(home, 'logs', 'install.status');
  fs.writeFileSync(statusFile, 'sentinel\n');
  const before = fs.readFileSync(statusFile, 'utf8');
  try {
    await u.checkNow();
    await new Promise((r) => setImmediate(r));
    const rec = u.lastAttempt() || {};
    assert.equal(installs, 1, 'precondition: one attempt was made');
    assert.ok(rec.endedAt, 'precondition: a spawn error ENDS the record, which is what makes it '
      + 'distinct from an in-flight attempt');
    assert.equal(rec.code, null, 'precondition: a spawn error carries no exit code');
    /* 🛑 THE NAME OF THIS TEST USED TO CLAIM MORE THAN IT ASSERTED, AND THE
       ASSERTION WAS THE HONEST HALF. It was called "does not consume one of the
       three automatic chances" while checking `attempts === 1`, which IS a
       consumed chance. A reviewer measured the gap: on top of a durable record at
       2, a spawn error takes the in-memory record to 3, the cap itself.

       What is actually true is a different and narrower sentence, and it is now
       the name: no DURABLE chance is consumed. The installer wrapper writes
       logs/install.status only when the child exits, and a spawn error means no
       child, so the file is untouched. Asserted directly below rather than
       inferred.

       The in-memory count DOES climb, and that is left alone deliberately: a
       spawn error means nothing ran, so the board was never stopped, and the
       worst case is that this process declines to auto-update until it restarts
       while the person's board keeps working normally. The hour window paces it
       either way. What would change my mind is evidence that boards run long
       enough for a transient EMFILE to suppress a wanted update for days; then
       the fix is to roll the count back in wireChild's error handler. */
    assert.equal(rec.attempts, 1,
      `the in-memory attempt count is ${rec.attempts}, not the 1 this arm expects`);
    assert.equal(fs.readFileSync(statusFile, 'utf8'), before,
      'a spawn error changed the DURABLE record. The shell never ran, so nothing should have '
      + 'written to logs/install.status, and a chance was consumed that cost the person nothing');
  } finally {
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: the live-execution gate refuses a real installer spawn, and releases single-flight', async () => {
  /* 🛑 THIS ARM GUARDS THE GUARD. The gate at engine/update.js was added in
     response to the suite spawning the real production installer, was verified
     load-bearing with a four-arm matrix, and then had NO arm of its own, so
     deleting it left the whole repo green. A verified guard with nothing keeping
     it verified is one refactor from gone.

     The runner seam is consulted well before the gate, so this arm deliberately
     injects NO runner: that is the only way to reach the gate at all.

     It also pins the ORDER of the two statements inside the refusal.
     refuseOrWarn THROWS in a test process, so a release written after the call
     is unreachable, the flag stays set, and every later beginInstall in the file
     returns early doing nothing. That turns a loud guard into silent green for
     every arm after the first. */
  const u = require('./update');
  const liveExec = require('./live-execution');
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-gate-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  u.resetCache();
  liveExec.resetForTests();               // gate CLOSED, which is the production-unauthorized state
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  u.setInstallRunner(null);               // no seam: the gate is the only thing left
  try {
    await u.refresh();
    let threw = null;
    try { u.beginInstall({ auto: true }); } catch (e) { threw = e; }
    assert.ok(threw, 'the gate did not refuse. With no runner injected the next statement is a real '
      + '`curl -fsSL <setupUrl> | sh`, so this arm failing means the suite can install Kosmos');
    assert.match(String(threw.message), /inside a test process|not authorized/,
      'something threw, but not the live-execution refusal: ' + String(threw.message));
    assert.equal(u.alreadyInstalling(), false,
      'single-flight was left set after the refusal. Every later beginInstall in this file would '
      + 'then return early doing nothing, so arms after this one would pass without running');
  } finally {
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); liveExec.allowLiveExecution();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#1277: a NEW RELEASE does not hand a machine that cannot install three more shutdowns', async () => {
  /* The per-version cap asks "has THIS version failed three times", which is the
     right question for a bad tarball and the wrong one for a machine that cannot
     install anything: no write permission on the install root, a full disk, a
     proxy blocking the release host. Those persist across releases. Measured
     before the cross-version counter existed: a record carrying 99 failures on
     9.9.9 still installed when 9.9.10 was offered. Since the installer runs
     `kosmos stop` before it downloads a byte, and launchd is RunAtLoad with no
     KeepAlive, each of those is a board that stays down until the next login. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  async function installsWhenOffered(recordVersion, attempts, streak, offered) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-xver-'));
    fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
    let installs = 0;
    u.resetCache();
    u.setInstalledRoot(() => home);
    u.setAutoPref(() => ({ on: true }));
    u.setFetcher(async () => ({ ok: true, json: async () => ({ version: offered }) }));
    u.setInstallRunner(() => { installs += 1; return { on() {}, unref() {}, stderr: { on() {} } }; });
    try {
      const old = new Date(Date.now() - 5 * 3600 * 1000);   // window long expired
      const f = path.join(home, 'logs', 'install.status');
      fs.writeFileSync(f, `1 ${old.toISOString()} ${recordVersion} 1 ${attempts} ${streak}\n`);
      fs.utimesSync(f, old, old);
      await u.checkNow();
    } finally {
      u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
      u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
    }
    return installs;
  }
  assert.equal(await installsWhenOffered('9.9.9', 3, 3, '9.9.10'), 1,
    'CONTROL: three failures on ONE version must NOT brake a different version. A run of bad '
    + 'releases is exactly what the per-version cap is for, and this counter must not steal that');
  assert.equal(await installsWhenOffered('9.9.9', 3, 6, '9.9.10'), 0,
    'a machine with six consecutive failures across versions took a new release as permission to '
    + 'stop the board again. Those failures are not about the tarball');
  assert.equal(await installsWhenOffered('9.9.9', 0, 0, '9.9.10'), 1,
    'CONTROL: a healthy machine must still install a new release');
});

test('#1277: DRY_RUN is read as === "1", so a machine setting it to "0" still updates', async () => {
  /* The exact spelling carried a paragraph of rationale and no arm: a reviewer
     measured that loosening it to a truthiness check left the suite green.

     The failure the rationale describes is real and would have been silent. A
     person or a wrapper script setting AGENT_WORKFORCE_DRY_RUN=0, meaning "no,
     this is not a dry run", would under a truthiness check disable automatic
     updates on that machine FOREVER, with no message anywhere: the board simply
     stops updating and nothing says why. '0' is the natural way to write "off",
     which is exactly what makes it dangerous. */
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const u = require('./update');
  const prev = process.env.AGENT_WORKFORCE_DRY_RUN;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1277-dryspell-'));
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  let fetches = 0;
  u.resetCache();
  u.setInstalledRoot(() => home);
  u.setAutoPref(() => ({ on: true }));
  u.setFetcher(async () => { fetches += 1; return { ok: true, json: async () => ({ version: '99.0.0' }) }; });
  u.setInstallRunner(() => ({ on() {}, unref() {}, stderr: { on() {} } }));
  try {
    /* ⚠️ THE TICK, NOT checkNow(). The DRY_RUN gate lives in the interval
       callback, so checkNow() walks straight past it: my first version of this
       arm used checkNow and its own CONTROL caught that, by fetching with the
       variable set to '1'. */
    process.env.AGENT_WORKFORCE_DRY_RUN = '0';
    u.startAutoPoll({ every: 1000 });
    await new Promise((r) => setTimeout(r, 2400));
    u.stopAutoPoll();
    assert.ok(fetches > 0,
      'with AGENT_WORKFORCE_DRY_RUN="0" the tick did not fetch. Under a truthiness check "0" reads '
      + 'as set, so a machine whose owner wrote 0 meaning "not a dry run" would silently never '
      + 'update again, with no signal anywhere');
    /* CONTROL: the real value must still stop it, or the assertion above is
       satisfied by a gate that never blocks anything. */
    fetches = 0;
    u.resetCache();
    u.setInstalledRoot(() => home);
    u.setAutoPref(() => ({ on: true }));
    u.setFetcher(async () => { fetches += 1; return { ok: true, json: async () => ({ version: '99.0.0' }) }; });
    process.env.AGENT_WORKFORCE_DRY_RUN = '1';
    u.startAutoPoll({ every: 1000 });
    await new Promise((r) => setTimeout(r, 2400));
    u.stopAutoPoll();
    assert.equal(fetches, 0, 'CONTROL: with the variable set to "1" the tick must NOT fetch');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DRY_RUN;
    else process.env.AGENT_WORKFORCE_DRY_RUN = prev;
    u.setInstalledRoot(null); u.setAutoPref(null); u.setFetcher(null); u.setInstallRunner(null);
    u.resetCache(); fs.rmSync(home, { recursive: true, force: true });
  }
});
