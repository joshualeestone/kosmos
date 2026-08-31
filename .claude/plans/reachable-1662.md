# The installer's reachability check must be able to say no

**Branch:** `reachable-1662`  ·  **Card:** kosmos#1662  ·  Ice Cream Kitty, 2026-08-31

## The defect

`reachable()` in `install/setup.sh` accepted **every** URL, including names that
cannot exist. Its fallback asks the host for the first byte of the target, and a
web server answers a range request for its own 404 page with `206 text/html`,
which curl reports as success.

Measured against installkosmos.com, with both controls:

```
kosmos-arm64.tar.gz      HEAD fail (correct)   RANGE PASS  <- false
zzz-cannot-exist.tar.gz  HEAD fail (correct)   RANGE PASS  <- MUST-FAIL control
latest.json (real file)                        RANGE PASS  <- must-pass control
```

A check with no failing case is not a check.

## Why it mattered, and it is not the wrong answer

**The cost was silence.** `if ! reachable "$url"` could never fire, so the
sentence written for exactly this situation ("could not reach the download at
$url ... it is safe to re-run") was dead code. Somebody whose download was
missing met a bare curl failure with no guidance. That is part of why the
missing binaries on 2026-08-30 went unreported for thirteen hours.

## What changes

`reachable()` now judges the **content type** as well as the status, on both
arms, so an error page cannot impersonate a download.

## The decision that matters: refuse textual, do not demand binary

The first version of this fix used an **allowlist** of binary content types.
That is stricter-looking and wrong, for two reasons, both measured:

1. **It breaks this project's own install gate.** `curl` on a `file://` URL
   succeeds and reports an **empty** content-type, and `tools/test-install.sh`
   drives the entire release path over `file://` on purpose ("curl serves
   file:// for both probes, so no server is needed"). An allowlist refuses a
   genuine tarball there and aborts the download path.
2. **The cost is asymmetric.** A false YES only means the pre-check did not
   help and curl fails a few lines later with its own error, which is the
   behaviour before this guard existed. A **false NO blocks the install
   outright** behind "Check your internet connection".

So the predicate refuses positively-textual types (`text/html`, JSON, XML,
and NOT `text/plain`, for the reason under Weakest premises below) and
accepts anything else, including empty and unknown. Media types are compared
lowercased, per RFC 9110 section 8.3.

Curl's exit status is checked first and separately, so an empty content-type
from a **failed connection** is not read the same as an empty one from a local
file that is genuinely there.

## Verified

Eleven cases against real servers, not fixtures. Every arm that must refuse
still refuses:

```
file:// real gzip                      YES   (the case an allowlist broke)
application/gzip · Application/GZIP    YES   (case-insensitive)
application/x-tar · no header at all   YES   (would have been false NOs)
application/octet-stream               YES
404 page answering 206 text/html       NO    (the original defect)
200 carrying text/html                 NO
host that cannot resolve               NO
production real tarball                YES
production name that cannot exist      NO
```

## The install gate, anchored to the bytes it tested

`yarn test:install` is the only gate that drives `reachable()` end to end. The
node suite structurally cannot: `test:shell` runs `bash -n
tools/test-install.sh` (a syntax check) and `test:install` sits outside `yarn
test`. An earlier claim on this branch that "the full suite is green" was never
evidence about this code path.

🛑 **THE FIRST TWO RECORDED RUNS WERE BOTH STALE, AND THE SECOND WAS STALE
THROUGH THE FIX FOR THE FIRST.** Run one predated the `set -e` fix by seven
minutes. I then moved a `diff -q` assertion inside the job and wrote that the
problem "cannot recur silently" - and it recurred immediately, because **an
assertion inside the job protects a RUN, not a later COMMIT.** I ran the gate,
then committed `application/*+json*`, then kept citing the number. A reviewer
found it both times.

✅ **So the evidence is anchored to the SHA256 OF THE TESTED FILE, not to a
commit and not to my discipline.** Anyone can check it in one command against
any future HEAD:

```
tested-source-sha256   c4fae33e37a974e9b0c69c0f56a875638397a4aed4d893213ff2fd7b7a53d99a
bundle-sha-matches     dist/setup == install/setup.sh, asserted BEFORE the harness
source-sha-at-end      c4fae33e... (identical, so nothing moved mid-run)
assertions             328 (a run that asserted NOTHING is not a pass)
attempts               1

  shasum -a 256 install/setup.sh
```

**If that command does not print the sha above, this evidence does not describe
the current installer.** That is the property the previous two remedies lacked.

📌 **AND IT FIRED, AS INTENDED.** Comment-only edits after the run changed the
file sha to `f587b533758fcce06321758c521724f89a1614768d8c4110783b5d34f24769cf`, so the anchor stopped matching. Under the previous two
remedies that would have been silent and I would have carried a stale claim
into a third PR.

✅ **The gate was NOT re-run, and here is the argument, with a control.** The
executable text is unchanged: stripping comments and blank lines from the
anchored revision and from HEAD gives **1267 identical lines**. The same
comparison against a commit that DID change behaviour differs, so it can
discriminate. Reproduce it with:

```
git diff 85b75857 HEAD -- install/setup.sh    # read it: comments only?
```

🛑 **AN EARLIER VERSION OF THIS RECIPE WAS LOSSY IN THE REASSURING DIRECTION
AND IS RETRACTED.** It used `sed 's/[[:space:]]*#.*$//'` to strip comments,
which also truncates EXECUTABLE lines containing `#` inside a parameter
expansion. `install/setup.sh` has **14** such lines. Measured: changing
`${_stg##*.}` to `${_stg#*.}` -- a genuine behaviour change -- strips to the
same text, so that recipe would have certified it "comment-only" and told a
reader the gate need not be re-run.

⇒ **A control that shares the instrument's blindness certifies the wrong
answer**, and this one was published in a plan for other people to run. Read
the raw diff. If a mechanical filter is wanted, `grep -v '^[[:space:]]*#'`
removes whole-line comments only and distinguishes the case above (verified
both ways).

⚠️ **This argument is only valid while the delta stays comment-only. Any change
to executable text means the gate must be re-run, not re-argued.**

```
327 passed, 1 failed

PASS  download-path install exits 0     PASS  the versioned artifact name was fetched
PASS  download-path board answers       PASS  the refusal names both versions
PASS  tampered download refuses         PASS  no false installed-done over old bytes
PASS  tamper refusal speaks a sentence  PASS  stage residue swept from the home folder
PASS  no stage residue after refusal    PASS  pinned install exits 0
```

⭐ **The remaining failure is invariant across FIVE runs whose code differed**
Byte-identical detail every time, while the code changed under it:

```
run 1   baseline
run 2   + set -e fix, /usr/bin/tr, problem+json
run 3   + *+json*, contract comment, cost correction
run 4   + --max-filesize on the second probe
run 5   + curl exit 63 mapped to a successful fetch
        327 / 1 every time, same file named every time
``` A failure caused by this diff would have moved when the diff
moved. The assertion is `EXPECTED_ADDS` in the LOCAL-SOURCES install, which
`tools/test-install.sh:797` says never runs `reachable()`, `verify_download()`
or tar; the unexpected file is `wouldping/needs-you.jsonl`, a runtime
notification record, and `main` carries the identical expectation. **No control
run on `main` was performed**, so the attribution rests on the invariance, not
on that reasoning.

## The `set -e` shapes, measured

Under `set -euo pipefail`, which `install/setup.sh:102` sets:

```
f(){ local a; a=$(false); echo REACHED; }   -> nothing printed, rc=1
g(){ false && return 0; echo REACHED; }     -> REACHED, rc=0
h(){ local a rc; a=$(false) && rc=0 || rc=$?; echo "REACHED rc=$rc"; }
                                            -> REACHED rc=1, shell alive
```

A bare `_r_ct=$(curl …)` is the first shape: a failing HEAD probe aborts the
shell before the range-GET fallback runs. The pre-#1662 code was the second
shape and safe only by accident. The third is what ships.

## The weakest premises, both directions

**Accepting an unknown content-type** means a host that serves an error page
with no type at all still passes. I judged that the right trade because the
false-NO cost is an unusable installer, but it is a real hole.

**Refusing `text/html` and not `text/*`** is the same trade in the other
direction, and the first version of this plan named only the first one. A
plain-text error page now passes. The reason is that `text/plain` is nginx's
compiled-in `default_type`, so a mirror that has not mapped `.gz` serves a
genuine tarball as `text/plain` and refusing it would block that install
behind "Check your internet connection". `KOSMOS_RELEASE_BASE` is overridable
(`install/setup.sh:456`), so a mirror is a real case rather than a
hypothetical. Production is separately mitigated because `serves_gzip()` in
`tools/kosmos-artifact-check.sh` gates the release on a gzip type, but that
mitigation does not extend to a mirror.

⇒ Both premises resolve the same way on purpose: **a false YES costs nothing
the code did not already cost** (curl fails a few lines later with its own
error), **a false NO is an installer that refuses to run.** A reviewer who
weighs those differently should change the predicate, not the tests.
