# kosmos#1707: gate the served content-type on the artifacts an install actually fetches

**Branch:** `ctype-1707` · **Card:** kosmos#1707, filed by Ice Cream Kitty, unclaimed when I took it.

## The gap, verified against the subject before claiming

```
serves_gzip in tools/kosmos-artifact-check.sh   3 occurrences
  :70  definition · :102 the bogus-version CONTROL · :104 the versioned tarball
content-type in tools/verify-served.sh          0
CONTROL, sha in tools/verify-served.sh         18    <- the search works
```

⇒ Two call sites, one of which is the control, so **one artifact was actually judged**.

## Why it matters, in the card's own framing

`#1662` made the served content-type decide whether an install proceeds: `reachable()` now refuses
anything positively textual. **A false NO at those call sites is an ABORT guard, not an existence
probe** - the person gets a blocked install and a sentence telling them to wait for a release that
is already published.

## 🛑 THREE URLS, NOT THE FIVE THE CARD SUGGESTS, AND THE MEASUREMENT IS WHY

The card proposes covering both arches. Measured against the live origin first:

```
kosmos-0.6.20-arm64.tar.gz   200 application/gzip
kosmos-arm64.tar.gz          200 application/gzip     <- unversioned, REAL
tmux-arm64.tar.gz            200 application/gzip     <- REAL
kosmos-x86_64.tar.gz         404 text/html            <- NOT PUBLISHED
tmux-x86_64.tar.gz           404 text/html            <- NOT PUBLISHED
kosmos-9.9.99-arm64.tar.gz   404 text/html            <- negative control
```

⇒ **Asserting the x86_64 pair would redden every correct release**, which is the same
blocked-on-a-good-build failure this check exists to prevent, arriving through the fix for it.
**A guard that fails on correct releases gets disabled, and then you have nothing.**

⚠️ **And the probe cannot distinguish the two 404 kinds:** an unpublished artifact and a
nonexistent one return identical signatures. Which URLs belong here comes from what the release
publishes, never from probing. That is stated in the code comment so the next person does not
"complete" the list from a probe.

## Verified the check is actually RUN before building anything

```
tools/release.sh:916   if ! bash "$REPO/tools/kosmos-artifact-check.sh" --repo "$MAIN_REPO"; then
CONTROL, verify-served in release.sh: 8 · NEG CONTROL: 0
```

⇒ **It is gated by the cut, not merely present.** Had this gone the other way the whole card was
cosmetic. ⭐ And the wiring itself is guarded by `tools/test-artifact-check-wired.sh` in
`test:shell`, which still passes with this change.

## Perturbation, both arms

```
PERTURBED  one new assertion pointed at a text/html 404  ->  EXIT 1, FAIL names the URL
RESTORED                                                  ->  EXIT 0, 18 passed, 0 failed
```

## Verification

    tools/kosmos-artifact-check.sh   exit 0, 18 passed, 0 failed, 0 unproven, against the LIVE origin
    tools/test-artifact-check-wired.sh  exit 0
    runner tools/run-tests.sh        see the PR comment
