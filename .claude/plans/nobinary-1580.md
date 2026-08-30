# nobinary-1580: signed in is not the same as ready

## The problem

`start()` returned CONNECTED five lines before it computed `haveBinary`, so a
machine with valid auth and no Claude Code binary was told it was connected and
never offered the install.

Plausible after a machine migration or a partial uninstall. It fails in the
reassuring direction: nothing to click, no error, and the failure surfaces later
as an agent that will not start.

Found by RUNNING cell 4 of the #1562 QA matrix, not by reading the code.

## The fix, in two parts

**1. A synchronous `resolveBin('claude').present` before the CONNECTED
short-circuit.** Deliberately not the full `haveBinary`, which refines it with an
awaited `--version` probe on a 15 second timeout; putting that in front of the
fast path would make every already-connected `start()` pay for it.

🛑 **A binary that exists and does not run still reports connected here, and
NOTHING corrects it.** This verdict is terminal: `start()` returns at `:990` and
the `--version` probe is at `:1006`, unreachable from this arm. Earlier versions
of this plan and of the code comment claimed the probe corrected it. That was
false, and it is deleted rather than annotated, because a wrong sentence left
standing is read before its retraction.

`accessSync` alone was also wrong: **it succeeds on a directory**, so a folder at
the binary path reported connected. `resolveBin().present` adds
`statSync().isFile()`, which is what makes the check mean "something this process
can execute" rather than "something is there".

**2. A post-install connected check.** Falling through alone was worse than it
looked: measured, the journey ran `downloading -> signin-launching` and stayed
there, walking an already-signed-in person through a sign-in they did not need.
The flow's own connected-detection cannot cover it, because that fires only once
a pane classifies as `browser-open` or `awaiting-code`, and somebody who never
needed a sign-in never produces either.

## The decision that cost the most

**I reintroduced #1560 while fixing this, and the suite stayed green.**

The first version of part 2 read the FILE and ran for EVERY flow, so a signed-out
person with a stale paid-plan file was declared connected at the end of
`runFlow`: the exact lockout #1560 exists to prevent, re-entering through the
back door of its own fix. 3105 tests passed while that was in the tree.

The #1562 matrix cells caught it. That is why those cells are now a committed
test file rather than a scratch script.

Both guards on part 2 are therefore load-bearing:

| guard | why |
|---|---|
| `!haveBinary` | only the flow where installing WAS the missing step may re-decide |
| `checkLive` | the file over-claims by design, so start()'s standard must apply here |

## Verification

- full suite **3113 pass, 0 fail**
- cell 4 (auth, no binary): **CONNECTED -> DOWNLOADING**
- journey (install then finish): **downloading -> connected**, binary on disk
- cells 1, 2, 5, 5b unchanged
- **five** mutations, each RED independently, every one re-measured after a
  review found this list overstated: part 2 deleted wholesale, the part-1 binary
  check, `=== CONNECTED` reverted to `!== NONE`, the `checkLive` verification,
  and the `!haveBinary` guard.

  ⚠️ **The `!haveBinary` claim was FALSE when first written.** Replacing it with
  `if (true)` left every connect test green, because no cell reached the tail of
  `runFlow` with a binary present AND a live-CONNECTED account. The arm that
  reaches it needs a live answer that CHANGES MID-FLOW (signed out at `start()`,
  signed in by the tail). Added; the mutation is red now.

The third needed a test of its own. Perturbing it first left the file green,
because the post-install path is unreachable in any cell that has a binary; the
new arm has no binary AND a stale file over a signed-out account, which is the
only shape that reaches it.

## The test file verified against the UNFIXED tree

Run on `origin/main`, without this branch's fix:

```
engine/connect.nobinary-1580.test.js   8 tests   5 pass   3 FAIL
```

The failures are the arms that describe the defect and the behaviour the fix
adds; the passes are the surrounding behaviour the fix must not disturb (#1560
and the controls). So the file is not merely "tests that pass with my change".

**🛑 I FIRST WROTE THAT THIS DEMONSTRATION "CAN NEVER BE PRODUCED AGAIN" AFTER
THE FIX LANDS. THAT IS FALSE AND A REVIEWER DISPROVED IT IN THIRTY SECONDS** by
dropping `main`'s `engine/connect.js` into this tree and running the file. The
old code is in git forever, so the demonstration is reproducible by anyone at any
time.

⇒ What is actually true is smaller: it is *easy to forget to run*, and nobody
does it by default once the bug is gone. That is an argument for writing the
number down, not for calling it unrepeatable. The original figure in this section
(4 pass, 1 fail) was also stale, from before the review added three arms.

## Deliberately not done

**No change to the binary-that-runs-and-misbehaves case.** `resolveBin().present`
answers what is checkable synchronously: a regular file this process can execute.
A file that executes and then fails is out of reach at this branch, and its
verdict here is terminal rather than corrected later.

⚠️ An earlier version of this section said that case "is corrected by the
`--version` probe". It is not, for the same reason as above. #1562 cell 2
measured the probe working on the path where it IS reached (no short-circuit),
which is a different arm.

**Also not fixed here:** `connect.js:2010`'s `canRunClaude` is a bare
`accessSync`, so a directory passes it, and it decides whether the STUCK screen
tells somebody to type `claude` in Terminal. Weak and final, like this one was.
Named rather than changed, to keep this diff to one behaviour.
