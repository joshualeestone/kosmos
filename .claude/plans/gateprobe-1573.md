# gateprobe-1573: the gate could not see the one thing #1556 shipped

## The defect, and it is smaller and stranger than I filed it

Every other `node ./server.js` boot site in `tools/browser-checks.sh` sets
`AGENT_WORKFORCE_DRY_RUN=1` (`boot_thread_server` boots a different script and is not
one of them). A dry-run
probe returns `{ok:true, dryRun:true}` **without executing**, and #1556 correctly scores
that as "we did not check", so `willInstall` is unconditionally true on a dry-run board.

⇒ The confirm-skip path #1556 delivered was **unreachable by the gate, by construction**.
No amount of care writing a check would have found it.

## 🛑 The finding: the stub was already there and could not be reached

Board `sb4` already boots with a `fake-claude` whose `--version` arm echoes a version and
exits 0. It was written deliberately, with a comment explaining that two callers reach it
and that a sandbox must not fall through to the operator's real Claude.

**The same env block sets `AGENT_WORKFORCE_DRY_RUN=1`.**

⇒ **Two correct mechanisms, one env block, cancelling.** Nobody was careless.

📌 Precisely: only the `--version` ARM was dead. The stub's `auth status` arm IS reached,
through `subscription.checkLive()`'s own seam, which is not dry-run gated. An earlier
draft here said the stub answered a question nothing asks; the runner already carries
that correction and now so does this.

### The rule that generalises

**Dry-run neutralises a subprocess by FAKING SUCCESS, which is exactly what makes a probe
unobservable. A stub neutralises it by being HARMLESS, costs the same, and leaves the
probe visible.**

Anything gated on "did this external thing actually work" is invisible on a dry-run
board, however good the check is.

## What this adds

- `docs/browser-checks/render-connect-skip.js`, **two arms**. A skip-only assertion would
  pass on a build where the confirm can never open at all, which is the pre-#1556 defect
  inverted, so the broken-launcher arm is not optional.
- Two boards that omit `AGENT_WORKFORCE_DRY_RUN` and use stub launchers instead.
  `pick_ports` raised from 13 to 15.

🛑 **THOSE BOARDS ARE READ-ONLY, AND THAT MEANS NO MUTATION, NOT "NOTHING REAL RUNS".**
An earlier draft here listed launchd and the network among the things these boards do
not touch, and the script's matching sentence
was removed as a hazard. Both halves were wrong:

- **Real launchd READS happen with nothing clicked.** `/api/status` calls
  `create.disabledJobs()` and `runningJobs()`, which run `launchctl print-disabled` and
  `launchctl list` against the operator's real session, and `wait_up` curls that route
  before any check starts. Non-mutating and fail-soft, which is why the pair is fine.
- **A check that PRESSES A BUTTON would mutate it**: `create.js`'s `run()` no longer
  short-circuits, so `launchctl bootstrap` and `enable` hit the real login session. The
  plist path is sandboxed; the registration is not, which is #1539.

⇒ That restriction is no longer prose. `tools.browser-checks-wired.test.js` asserts
exactly ONE `run_one` targets `$P14`/`$P15` and that it is `render-connect-skip`.
Perturbed: a second check pointed at those boards goes red.
  `pick_ports` raised from 13 to 15.

Measured, run exactly as the gate runs it: **7/7, exit 0.**

```
working launcher   FR.connect {"willInstall":false}   predicate says SKIP
broken launcher    FR.connect {"willInstall":true}    predicate says ASK, flat sentence
```

⚠️ **THE CHECK READS THE PREDICATE, NOT THE PIXELS, AND AN EARLIER VERSION OF THIS PLAN
SAID OTHERWISE.** It evaluates `frClaudeInstallNeeded()` against the real `FR` the real
server produced. It does NOT click Connect and watch a dialog, because clicking on a
non-dry-run board is what the runner's own safety comment forbids. The predicate-to-dialog
wiring is pinned separately by a source-text assertion in `web.connect-confirm.test.js`.

⇒ So the honest claim is **a real browser reading the real predicate against a real
subprocess answer**, which is the last link before the pixels and not the pixels
themselves. I told the fleet #1556 was "behaviour measured" on this basis; that is the
third qualification of that claim tonight and this one is exact.

## My own guard caught this, which is the argument for having written it

`tools.browser-checks-wired.test.js` (from #1575, merged hours ago) asserts every
`node ./server.js` boot site sets dry-run. **These two boards deliberately do not, so it
went red.** That is the guard working: without it, this change would have silently made
the #1575 comment false, which is precisely the rot it exists to prevent.

Resolved with a **NAMED exemption**, not a loosened assertion, and the narrowness is
perturbation-verified:

```
a third rogue boot with no dry-run, not the exempt pair   -> RED
strip dry-run from boot_board                              -> RED
restore                                                    -> 7 pass
```

Widening it to "most boots" would have thrown away the property it exists to hold. The
#1575 comment is updated in the same commit, so the sentence and the guard agree.

## Scope correction against myself

#1573 said the fix "wants a deliberate decision rather than a patch from someone passing
through". **Wrong**, though not as wrong as it sounds: two new sandboxes and one new boot site,
reusing stub discipline the gate already had. Not a sandboxing-model change.

## What this does NOT do

It does not change how the existing six boards boot. A release gate is the wrong place to
rewrite a sandboxing model, and those boards are load-bearing for every other check.

## Someone else settled the cut-safety question on this card, and I verified it

A comment on #1573 from another agent, timestamped before I claimed the card, establishes
that **editing `tools/browser-checks.sh` cannot disturb a running cut**. I had not asked
that question, and it covers edits I had already made to that file during live cuts.

Verified independently rather than accepted:

```
tools/release.sh REPO assignments, in order:
  130  REPO="$(cd "$(dirname "$0")/.." && pwd)"   the working checkout
  326  REPO="$BUILD"                              rebound to the frozen tree
  nothing after 326.

  370  ( cd "$REPO" && bash tools/browser-checks.sh ... )   <- $REPO is $BUILD here

control: `cd "$BUILD"` appears 0 times, against 18 mentions of BUILD, which is
consistent with their account that the code rebinds the variable rather than cd-ing.
```

⭐ **Their reusable lesson is better than the answer: A VARIABLE NAME IS NOT A VALUE.**
Line 370 reads `$REPO` and looks unambiguously like the working checkout; the rebinding is
44 lines earlier and nothing at the call site suggests the name no longer means what it
meant when defined. Grep every assignment and check the order before concluding what a
shell script operates on.

📌 The blocker they named is now cleared: they wrote that #1556 had not landed and that a
gate built to observe that behaviour could not be verified until it existed. #1556 shipped
in 0.6.12 and is verified in the served artifact, which is exactly why this card became
workable.

📌 And a process note against myself: **that comment sat on my own card and I nearly
missed it**, because I was reading my own comments rather than the card. Someone had done
safety analysis for me hours before I asked the question.
