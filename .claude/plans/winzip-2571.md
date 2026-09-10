# winzip-2571: deploy-site.sh derives the Windows zip name from latest-win.json

## Problem (kosmos#2571)

`tools/deploy-site.sh` hardcoded the Windows zip name:

```
WINZIP="${KOSMOS_WIN_ZIP:-kosmos-0.6.24-win-x64.zip}"
```

That default went 13 versions stale (0.6.24 while the app was on 0.6.50). A site
deploy that fell through to the hardcode would advertise a Windows download name
that no longer matches the committed bytes, so the Windows pointer and the zip a
person actually downloads could disagree.

Since #2036/#2195 the site already commits `dist/latest-win.json`, written by
`tools/publish-kosmos-windows.sh`, carrying the current `versioned` zip name and
its `sha256`. The name should be derived from that pointer, not frozen in the
script.

## The call

Derive `WINZIP` from the committed `dist/latest-win.json`, but treat the
derivation as an INSTRUMENT rather than a blind lookup: trust the derived name
ONLY when the pointer's `sha256` equals the sha256 of the ACTUAL committed
versioned zip bytes. On any drift, missing field, or uncommitted zip, REFUSE
(non-zero exit) instead of deploying a name whose bytes we did not verify.

Order and behaviour:

- An explicit `KOSMOS_WIN_ZIP` env override skips derivation entirely (operator
  escape hatch), so the change is opt-out and cannot surprise a caller who
  already pins the name.
- When `dist/latest-win.json` is absent (an older checkout), warn and fall back
  to the existing hardcoded default. Absence is not drift; an older site simply
  predates the pointer, and refusing there would break a legitimate deploy.
- Read the committed bytes with `git show "$H:dist/<zip>" | shasum -a 256`, where
  `$H` is the same committed ref the mac-artifact helpers already resolve, so the
  hash is of what is committed, not the working tree or a sidecar the pointer
  could have been hand-edited to match.
- Precheck existence with `git cat-file -e "$H:dist/<zip>"` before hashing, so a
  pointer naming an uncommitted zip refuses with a clear message rather than a
  hashing error.

## Scope, stated honestly

This closes the INTERNAL pointer-vs-bytes drift: the derived name is guaranteed
to match committed bytes or the deploy refuses. It deliberately does NOT add a
committed-vs-live freshness check for Windows. The mac side has `--promote` to
distinguish a promotion from a normal deploy; Windows has no such flag, so a
committed-vs-live win guard would false-refuse a legitimate win-publish deploy
(the very deploy that ships a newer win pointer than what is live). Freshness of
the win pointer is out of scope for this card and is left to the publish step
that writes it.

## Files

- `tools/deploy-site.sh` - the derivation block (after the ptr helpers, gated on
  `KOSMOS_WIN_ZIP` being unset), plus a `ptr_versioned()` helper and a corrected
  comment on the fallback default.
- `tools/test-deploy-site-winderive.sh` - new. Stubs `curl` (serves `latest.json`
  from a fake LIVE dir, fails every other path so the dry run stops just past the
  win-derive block) and `vercel` (no-op, since `deploy-site.sh` runs
  `command -v vercel` before the derive block). Ten assertions across modes:
  agree (green derive of the current name, sha-verified), drift (refuse before
  trusting the name), absent (warn + fall back), override (skip derivation),
  nofields and nosha (refuse a malformed manifest, exercising each half of the
  guard), nozip (refuse a pointer naming an uncommitted zip). Every assertion has
  a control that can return the dangerous answer.
- `package.json` - wires `test-deploy-site-winderive.sh` into `test:shell` right
  after `test-deploy-site-promote.sh`.

## Weakest premise

The guard trusts `git show "$H:dist/latest-win.json"` and the committed zip as
the source of truth. If `publish-kosmos-windows.sh` ever wrote a pointer whose
`sha256` was computed over different bytes than the committed zip, the agree case
would refuse a legitimate deploy (a false refusal, not a false trust). That is
the safe direction to fail, and it is what the drift test asserts. What would
change my mind: evidence that a normal publish can commit a pointer and zip whose
hashes legitimately differ, in which case the agreement check would need to hash
the same bytes the publisher hashed rather than the committed zip.

## Coordination

Overlaps only `tools/deploy-site.sh` region with April's alias work; coordinated
with April (april-discord:0.0) - her call was to build on origin/main now and
rebase onto merged #1667 later, keeping her alias checks. No file conflict at
commit time.
