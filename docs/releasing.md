# Cutting a release

```
yarn release 0.2.12
```

Everything below is what that script does and why. It is written down because
the script itself lived in a scratchpad for three releases, and every
improvement it gained would have died with the session that wrote it.

## The order matters, and the reason is one defect each

1. **Clean main, and read the log.** The release ships what is merged, not what
   you remember merging. **The versions entry is also checked HERE, not only at
   step 7 (#1463)** -- presence and stamp both, so a missing or stale entry stops
   the cut in about three seconds instead of after the suite, the browser gate,
   the install gate and the build.

   🛑 **THIS MAKES THE ENTRY A HARD PRE-LAUNCH PRECONDITION, AND THAT IS A REAL
   CHANGE TO HOW A CUT IS RUN.** It used to be possible to launch and write the
   entry while the suite ran, because nothing read it until step 7. It is not any
   more: the cut refuses in the first three seconds. **The copy is ruled by
   somebody else, so if you do not have it yet, you cannot start.** That is
   deliberate -- waiting three seconds for ruled copy is better than spending
   fifteen minutes to be told the same thing -- but it is a loss of a working
   habit and you will meet it on every cut, not only on a slow one.
2. **Bump `package.json`.** One place. `engine/update.js` compares this against
   the served `latest.json`, numerically rather than lexically.
3. **The whole suite**, on the tree that ships.
4. **Build**, then copy the bundle, `.sha256` and `latest.json` to the site.
   ⚠️ The tarball and `latest.json` must land in the **same deploy**: shipping
   one without the other tells every installed copy to update to a version the
   download does not contain.
5. **Copy `/setup`.** 🛑 It is served from the site **root**, not from `dist/`,
   so copying the bundle does not carry it — and **both** paths run it: a new
   install (`curl … /setup | sh`) and an existing one updating itself
   (`engine/update.js` re-runs `setupUrl()`). It was stale on the site by a
   whole change before this step existed, **while three correct checks of the
   bundle passed.**
6. **Confirm the bundle says the version** before publishing it.
7. **The versions page needs its entry, re-checked at the moment of deploy.**
   Step 1 already asked; this asks again because the site checkout can change
   under a cut that runs fifteen minutes, and a stamp that agreed with the clock
   at step 1 can be stale by now. Copy is ruled by Mona Lisa; the timestamp is
   the only field written at release time, and the page's own rule is never to
   edit an existing entry.
8. **Deploy.**
9. **Verify what is SERVED** — `tools/verify-served.sh`, retried, because a
   deploy is live before every edge has it and one read cannot tell "not
   published" from "not yet".
10. **Restart the board on THIS Mac, if it runs from this repo.**
   `tools/restart-local-board.sh`. Installs update themselves from what step
   9 verified; the developer's own board runs the repo under a hand-written
   launchd job and never did, so every release (and every merge that touched
   `engine/` or `server.js`) left it serving the previous code until somebody
   noticed: three stale-board incidents in one day (#360). It restarts only
   when `com.kosmos.board` exists AND its working directory is this repo, and
   says which case it found; from a worktree it declines, because the job
   runs main's code, not the worktree's. Between releases, `bash
   tools/restart-local-board.sh` from the main checkout is the one command.


## Why the verification is a separate script

`tools/verify-served.sh` **derives the artifact list from the code that fetches
each one**, and cites the line beside it:

| artifact | who fetches it |
|---|---|
| `/setup` | new installs, and `engine/update.js:189` on every update |
| `/dist/latest.json` | `engine/update.js:82`, every 15 minutes |
| `/dist/kosmos-arm64.tar.gz` + `.sha256` | `install/setup.sh` |
| `/dist/tmux-arm64.tar.gz` + `.sha256` | `install/setup.sh:373` |

🔑 **A hand-maintained list of "things we ship" drifts from the things actually
fetched, and the drift is invisible.** Deriving it means a new fetch in the
product becomes a new line in the check rather than something somebody has to
remember.

⚠️ **It leads with a 404 control.** An empty body and a missing file look
identical, and a wrong URL reads as an outage — that happened to a reviewer
within a minute of 0.2.11 going out. The control's own first version was buggy
(`curl -fsS … || echo 404` printed `404404`, because `-f` makes curl exit
non-zero and the fallback appends), which is the best argument for it.

## Proving a check can fail

```
bash tools/prove-it-fails.sh <test-file> <label> <node-expression>
```

Breaks the code on purpose, runs the named test, and restores.

🛑 **It refuses on a dirty tree, and that refusal is the point.** The loop ends
in `git checkout`, which discards uncommitted work silently. On 2026-08-21 that
ate a real fix **seven times in one day** — twice unnoticed until a test written
minutes later failed, and once a reverted state was committed on top of the loss.

⚠️ **"Commit before you perturb" was written down after the first one and failed
six more times.** A habit that has to hold seven times a day is not a habit, it
is a load-bearing assumption. The tool holds it instead.

## What is deliberately not automated

- **The versions-page copy.** It is ruled, not generated.
- **The merge.** Josh's standing rule is that a ready PR gets merged without
  waiting for him, but *what* goes in a release is a judgement about what has
  been through review.

## After a failed cut, before the next one

Seven attempts were needed to serve 0.5.24 on 2026-08-24. Five stopped on true
reds, and the gates were right every time. Two stopped on what the previous
attempt had left behind, and those are the ones this section exists to end. A
failed cut is not clean: it may have written into the site checkout before it
died, and the next attempt trips on the leftovers with a message that describes
a different problem.

1. **The versions entry's stamp.** **Set `rel-d` to about FIFTEEN minutes AHEAD
   of launch**, in the site's `versions.html`. That is the whole instruction; the
   detail below is why.

   **Two gates read it, and they do not use the same window (#1463).**

   | gate | accepts in the PAST | accepts in the FUTURE |
   |---|---|---|
   | step 1, before anything is built | **5 minutes** | 20 minutes |
   | step 7, at the moment of deploy   | 20 minutes     | 20 minutes |

   The entry is written once, by hand, so every failed attempt ages it; attempt
   four died on a 40-minute gap after three earlier attempts had burned the
   window. **Step 1 is stricter on the past side on purpose:** an entry already
   fifteen minutes old would pass a 20-minute window at step 1 and then read
   `+15 + D` at step 7 and die after the suite, the browser gate, the install
   gate and the build. Step 1 can see that it is doomed, so it says so in three
   seconds. The future side is 20 at both and is deliberately not widened, since
   a forward stamp is what the guard was built to catch.

   ⚠️ **Stamp for when you expect to PUBLISH, never for now.** A now-stamp passes
   step 1 and then arrives at step 7 having aged by the length of the cut, which
   is what a re-cut most often dies on. This is also why the two refusals give
   different advice: step 1 says "stamp for publication", step 7 says "paste the
   clock line", because at step 7 there is no cut left to age it.

   🛑 **AND THERE IS A CEILING THIS CHANGE INTRODUCES.** With `A` the minutes you
   stamp ahead and `D` the cut's duration, step 1 needs `A <= 20` (nothing may be
   stamped further ahead than the future bound) and step 7 needs `A >= D - 20`
   (it must not have gone stale by the time we deploy).

   | you stamp | the cut can take up to |
   |---|---|
   | `A = 15`, the recommendation above | **`D = 35`** |
   | `A = 20`, the most step 1 allows   | `D = 40`, the absolute ceiling |

   ⚠️ **So the wall an operator actually meets is 35 minutes, not 40.** Forty is
   reachable only by stamping the full twenty ahead, which is not what the
   headline tells you to do. If a cut is running long, stamping further ahead
   buys time up to `A = 20` and no further; past `D = 40` nothing passes both.

   ⚠️ **This is a real loss and it is worth knowing before you meet it.** Before
   #1463 only step 7 read the stamp, so `A` could simply track `D` and an
   arbitrarily slow cut still worked. **So if a cut is crawling and you are
   re-stamping repeatedly to chase it, stop: re-stamping cannot succeed.** The
   fix is to shorten the cut, or to widen `KOSMOS_LATE_PAST_BOUND` deliberately,
   never to keep guessing at the stamp. Nothing in the code pins `D <= 40`; it
   is a property of the machine on the night.

   ⚠️ **AND IF STEP 1 SAYS "IN THE PAST" ON AN ENTRY YOU JUST WROTE, ASK WHICH
   CLOCK YOU READ.** The gate compares the stamp against **this machine's** clock,
   so a machine that is uniformly wrong cancels out entirely: an entry stamped
   from that Mac's own `date` reads `off = 0` however far off the machine is. The
   refusal only appears when the stamp came from a **different** clock, a phone, a
   wall, another machine. So the fix is usually to re-stamp from `date` on the
   cutting machine, not to correct the machine.

   ⚠️ It bites harder than it used to because the past side is now 5 minutes
   rather than 20, so a four-minute difference between two clocks that never
   mattered before can refuse you. Related and separately carded as **#1464**: the
   gate parses the stamp in the machine's local timezone while the page hard-codes
   `CDT`, so a non-Central machine, or any machine after the November switch, is
   measuring something different again.

   ⚠️ **The tighter bound also refuses some entries step 7 would have accepted.**
   The 5 is derived from a cut taking about fifteen minutes; on a fast cut
   (`D = 8`) an entry ten minutes old would have reached step 7 reading 18 and
   passed, and step 1 refuses it at 10. That is deliberate and it costs one
   re-stamp and three seconds, but it is a real false refusal and you should
   recognise it rather than hunt for a cause.

   ⚠️ **All THREE bounds are overridable if you genuinely need to**, not just the
   late one: `KOSMOS_STEP1_PAST_BOUND`, `KOSMOS_LATE_PAST_BOUND` and
   `KOSMOS_FUTURE_BOUND`. The step 1 bound is the one that will have stopped you.
   The future bound was undocumented here while being equally overridable, which
   is the worst combination: reachable and unmentioned.

   📌 **How binding is the ceiling in practice? NO RECORDED CUT HAS EVER TAKEN
   MORE THAN TWENTY MINUTES to reach step 7.** So the `D <= 35` wall is real and
   has never been hit. It is documented because it is a property this change
   introduced, not because it is a live problem.

   ⚠️ **A COUNT USED TO SIT HERE AND IT IS DELIBERATELY GONE.** It read "87 cuts
   ... 12.5 to 19.2 minutes". Three separate passes over
   `~/.claude/logs/cut-suite-runs.log` produced **87, 82 and 73** for the same
   question, because the log has to be paired started-to-completed, some
   completions carry early step labels, and a few rows are sub-minute aborts.
   **I published the 87 and it did not reproduce even for me.**

   ⇒ The maximum is robust and every pass agreed on it; the population was
   decoration and I kept getting it wrong BECAUSE it was decoration. Re-derive a
   count yourself if you need one, and state your pairing rule when you do.

   📌 **Where fifteen comes from.** Measured on the 0.6.06 attempt of 2026-08-28:
   launch 21:56:18, step 7 at 22:12:04, so **15m 46s**, and a slow browser gate
   stretches it. An earlier version of this runbook said ten to twelve minutes;
   that figure is superseded, not merely supplemented, and it has been removed
   rather than left standing above its own correction.

2. **A versioned tarball from the dead attempt.** If the attempt got past 4b it
   copied `dist/kosmos-<V>-arm64.tar.gz` into the site checkout. The next build
   produces different bytes (builds are not byte-reproducible: codesign
   timestamps, tar mtimes), and step 5 then refuses "different bytes for a
   cache-immutable name". That guard is right when the file was SERVED. Check
   the wire first: `curl -sI https://installkosmos.com/dist/kosmos-<V>-arm64.tar.gz`.
   A 404 means it never left this Mac; remove the local pair
   (`.tar.gz` and `.sha256`, both gitignored) and re-cut. A 200 means it was
   served: bump the version instead, exactly as the guard says.
3. **The site checkout's uncommitted state.** A dead attempt can leave
   `dist/latest.json` and `setup.sha256` modified. The next successful cut makes
   them consistent and commits them; until then, nobody should deploy the site
   by hand (`vercel deploy` from the checkout publishes the working tree, #649).
4. **The tree must hold still.** Every attempt freezes to the sha at its start
   and takes ~25 minutes; a merge that lands mid-cut cannot be in it, and a page
   check that reads the live checkout can go red on it. Attempt six died on a
   Settings change that merged at minute three. When a cut has to land, call a
   merge freeze for its duration, and lift it the moment `latest.json` flips.

A red at any step is read, not retried. Of the seven, four found real defects
(a caution that had vanished from the product, a bundle expectation frozen at
the broken state, a phone layout stacking on itself, a bundle that could not
install); a "retry the flake" would have shipped every one of them.
