---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: wouldping-1494
diff_hash: 4f9348b32e8e0362f7461895b3b67b71738f62249ff188dec0144b21e90aa170
subdir_audit: passed
timestamp: 2026-08-29T20:58:45Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. **The shape
is Splinter's suggestion: log-first, ping nobody, because it needs no receiver.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] IT WRITES TO DISK ON A HOT PATH.** `snapshot()` runs from 44 sites
  in `server.js` on every poll. It writes **only on a transition**, so the steady
  state is a `Map` lookup, **but the write is synchronous `appendFileSync` and it
  happens inside a board read.** On a machine with many agents flapping into
  `needs_you`, that is disk I/O the board did not previously do.
- **[WARNING] THE LOG GROWS AND NOTHING ROTATES IT.** One line per transition is
  small, and nothing prunes it. **It is a measurement, so somebody should read it
  and then decide whether to keep it**, and this branch does not force that.
- **[WARNING] THE PANELESS ARM IS NOT WIRED**, deliberately: only the pane arm
  calls it. A paneless agent's `needs_you` is always REPORTED (there is no screen
  to scrape), so it is already covered by the seam. **If that ever stops being
  true, this measurement will silently miss it.**
- **[WARNING] "SINCE THIS BOARD STARTED" IS A REAL LIMIT ON THE NUMBER.** A
  restart re-arms every agent. The first read after one can log a continuation as
  a transition, so **early lines after a restart over-count.** The `sinceBoot`
  field is how a reader excludes them and nothing enforces that they do.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword: this produces the number, it does not make
  the decision.

### NITs

- **[NIT]** `wouldping` is a made-up word. It says exactly what the file does,
  which is worth more here than a conventional name.

### Attacked and CLEARED

- **PERTURBED FIVE ARMS**, each failing its own test. Restores sha-verified.
- **⭐ A FLAKY TEST WAS THE DEFECT, NOT NOISE.** `sinceBoot` was a bare timestamp,
  and **two boots inside the same millisecond produced the same value**, which
  defeats the entire purpose of a field whose job is to tell boots apart. Now
  timestamp plus 4 random bytes. **Five consecutive runs, 0 failures.**
- **⭐⭐ AND THE REACHABILITY TEST COULD NOT SEE A DEAD CALL.** Perturbing the call
  site to `if (false) wouldping.saw(...)` left it **GREEN**, because the text was
  still there. **A guard that cannot tell a live call from a dead one is not a
  reachability check**, which is the exact class the test exists for.
  ⇒ Strengthened, **and its limit is written into it**: still a text check, so the
  honest claim is "not trivially disabled", not "reached".
- **IT CANNOT PING, ASSERTED.** The test reads the module's own source and refuses
  a `notify` require, a `fetch`, a URL, or a `happened(` call. **A future edit
  that helpfully wires this to the seam turns a measurement into a 3am phone call
  nobody decided on.**
- **Suite 3008 pass, 0 fail.**

### 📌 What I did wrong while building it

**My first smoke test ran unsandboxed and wrote a real line into the operator's
Application Support directory.** That is the #1443 defect, **committed by me an
hour after fixing it.** I removed the directory, and the test now sandboxes
BEFORE requiring the module with a control asserting the log path is inside the
sandbox. **That control is the arm that would have caught me.**
