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

## The install gate HAS now been run

`yarn test:install` is the only gate that drives `reachable()` end to end, and
the node suite structurally cannot: `test:shell` runs `bash -n
tools/test-install.sh` (a syntax check) and `test:install` sits outside `yarn
test`. An earlier claim that "the full suite is green" was never evidence about
this code path.

Run against freshly built bundles (`dist/setup` is byte-for-byte this branch's
`install/setup.sh`), after the 0.6.19 cut completed, and **not** with
`KOSMOS_HARNESS_IGNORE_CUT=1`:

```
327 passed, 1 failed

the download path (file:// origin, no local-copy shortcut)
  PASS  download-path install exits 0        PASS  tampered download refuses
  PASS  download-path board answers          PASS  tamper refusal speaks a sentence
                                             PASS  no stage residue after refusal
the pointer pins the bytes (the 0.5.13 wedge)
  PASS  the versioned artifact name was fetched
  PASS  the refusal names both versions
  PASS  no false installed-done over old bytes
```

Those are exactly the assertions an allowlist-shaped predicate was predicted to
break, and they pass.

**The one failure is not attributable to this diff**, and the reasoning is
stated so a reviewer can reject it: the assertion is `EXPECTED_ADDS` in the
LOCAL-SOURCES install, which `tools/test-install.sh:797` says outright "never
runs `reachable()`, `verify_download()` or tar". The unexpected addition is
`./AgentWorkforce/wouldping/needs-you.jsonl`, a runtime notification record,
and `main` carries the identical `EXPECTED_ADDS` list. **A control run on
`main` was NOT performed**, so this is a reasoned attribution rather than a
measured one.

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
