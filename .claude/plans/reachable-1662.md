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

## The install gate: run once, and that run is SUPERSEDED

`yarn test:install` is the only gate that drives `reachable()` end to end. The
node suite structurally cannot: `test:shell` runs `bash -n
tools/test-install.sh` (a syntax check) and `test:install` sits outside `yarn
test`. An earlier claim in this branch that "the full suite is green" was never
evidence about this code path.

**A first run passed 327 / failed 1** with the whole download-path section
green, including the versioned-name probe. ⚠️ **That evidence is stale and is
recorded here as stale rather than quietly kept.** `dist/setup` was built at
11:48:31; commit `167d42b9` at 11:55:44 then introduced the `set -e` fix, the
`/usr/bin/tr` change and `application/problem+json`. So that run exercised
bytes **without the set -e fix**, which is the most consequential part of this
diff. A reviewer found that, not me.

**The second run, against bundles rebuilt from the final code, is what this
branch rests on.** The job asserts `diff -q dist/setup install/setup.sh` BEFORE
starting the harness, so the staleness above cannot recur silently: if the
bundle does not match the source the job fails instead of producing a number.

```
bundle-matches-source        (asserted before the harness ran)
dist/setup                   byte-identical to install/setup.sh
set -e fix in tested bytes   present

327 passed, 1 failed

PASS  download-path install exits 0     PASS  the versioned artifact name was fetched
PASS  download-path board answers       PASS  the refusal names both versions
PASS  tampered download refuses         PASS  no false installed-done over old bytes
PASS  tamper refusal speaks a sentence  PASS  stage residue swept from the home folder
PASS  no stage residue after refusal    PASS  pinned install exits 0
```

⭐ **The remaining failure is now shown invariant rather than argued away.** It
reproduced with byte-identical detail across two runs **whose code differed**
(the second carries the `set -e` fix, `/usr/bin/tr` and
`application/problem+json`). A failure caused by this diff would have moved
when the diff moved. That is a measurement; the reasoning below is what it
replaced.

The one failure in the first run was `EXPECTED_ADDS` in the LOCAL-SOURCES
install, which `tools/test-install.sh:797` says never runs `reachable()`,
`verify_download()` or tar. The unexpected addition was
`./AgentWorkforce/wouldping/needs-you.jsonl`, a runtime notification record,
and `main` carries the identical expectation. **No control run on `main` was
performed**, so that attribution is reasoned, not measured.

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
