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
  assert.match(call, /'-c',\s*'curl -fsSL "\$1" \| sh; code=\$\?; printf "%s %s %s %s\\n" "\$code" "\$3" "\$4" "\$5" > "\$2"',\s*'sh',\s*setupUrl\(\)/,
    'the installer command is no longer the reviewed shape: ' + call);
  /* The two trailing positionals, asserted on the wider source since the
     slice above stops at the URL: the status file is $2, the stamp is $3,
     neither interpolated. */
  assert.ok(/setupUrl\(\),\s*statusFile,\s*lastAttempt\.startedAt,\s*lastAttempt\.version \|\| '-',\s*lastAttempt\.auto \? '1' : '0'\]/.test(SRC),
    'the status file, stamp, version and auto flag no longer all ride as positionals');

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
  const t = u.startAutoPoll();
  const interval = t && (t._repeat || t._idleTimeout);
  u.stopAutoPoll();
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
  } finally {
    u.stopAutoPoll();
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DRY_RUN; else process.env.AGENT_WORKFORCE_DRY_RUN = prev;
    u.setFetcher(null); u.setInstalledRoot(null); u.resetCache();
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
    await u.refresh();
    u.beginInstall({ auto: true });
    const a = u.lastAttempt();
    assert.equal(a.version, '9.9.9',
      `the attempt recorded version=${a.version}. After a machine changes version by itself, the `
      + 'first question is what it took, and nothing on the box answered it');
    assert.equal(a.auto, true, 'the record must say the machine chose this, not a person');
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
