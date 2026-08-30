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

**1. A cheap synchronous `accessSync` before the CONNECTED short-circuit.**
Deliberately not the full `haveBinary`, which refines it with an awaited
`--version` probe on a 15 second timeout. Putting that in front of the fast path
would make every already-connected `start()` pay for it. A binary that exists but
is broken still reports connected here and is corrected by the probe further
down; that is pre-existing behaviour and not this card's subject.

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

- full suite **3110 pass, 0 fail**
- cell 4 (auth, no binary): **CONNECTED -> DOWNLOADING**
- journey (install then finish): **downloading -> connected**, binary on disk
- cells 1, 2, 5, 5b unchanged
- three mutations, each RED independently: the binary check, the `!haveBinary`
  guard, the `checkLive` verification

The third needed a test of its own. Perturbing it first left the file green,
because the post-install path is unreachable in any cell that has a binary; the
new arm has no binary AND a stale file over a signed-out account, which is the
only shape that reaches it.

## The test file verified against the UNFIXED tree, which cannot be redone later

Run on `origin/main`, without this branch's fix:

```
engine/connect.nobinary-1580.test.js   5 tests   4 pass   1 FAIL
  FAIL: "#1580: signed in with NO binary is not reported connected,
         it is offered the install"
```

**That red is the file's strongest property and it has a shelf life.** It shows
the cells detect the real defect, on the real tree, in the state that actually
shipped. Once this lands, that demonstration can never be produced again: the
bug is gone and the test passes for the ordinary reason.

The other 4 arms pass on main because they guard behaviour that already works
(#1560, and the two controls). So the file is not merely "tests that pass with my
change" - it is 1 arm that fails without the fix and 4 that hold the surrounding
behaviour still.

## Deliberately not done

No change to the broken-binary path. A binary that exists and does not run still
reports connected at this branch and is corrected by the `--version` probe, which
is what #1562 cell 2 measured as already working.
