# autopost-promote-2159 — auto-post release notes on a staging→prod promote

Follow-up to the #2159 feature plan (`release-notes-social-2159.md`), implementing its documented
promote-side hook.

## Problem
`post-release-notes.sh` (the #2159 release-notes social poster) is wired into a prod **cut**
(`release.sh --publish`) and the promote **preview** (`promote-channel.sh`, dry-run at pointer-flip
time), but NOT the promote **go-live** deploy. So a staging→prod promote — the launch flow, and how
0.6.37 reached prod — ships a release to users and never announces it, while a direct prod cut does.

## Change
Add a gated hook at the end of `deploy-site.sh`'s `--promote` success path (after served-verify), so
a promote go-live announces the release, mirroring `release.sh`'s existing #2159 hook.

- Fires **only** on a version-moving forward PROMOTE: the just-served version (`$sj`) must be strictly
  NEWER than the pre-deploy live version (`$LJ`), via `sort -V`. A rollback, a same-version re-point,
  and an unreadable prior version all SKIP — a rollback must never announce an older version as "is
  out", so every ambiguous case fails toward "do not post".
- Best-effort (`|| echo`): the release has already shipped and been verified, so a hook non-zero can
  never fail the promote.
- Safe by construction: `post-release-notes.sh` is DRY-RUN unless `--publish` AND
  `KOSMOS_SOCIAL_AUTOPOST=1` AND live `@installkosmos` creds are in the secrets map.

## Tests
Two cases in the (already `test:shell`-wired) `test-deploy-site-promote.sh`: a forward promote
announces, a rollback promote skips. Red-capable (inverting the version compare fails both).

## Out of scope (remaining for #2159, correctly needs-operator / needs-decision)
- Filing `@installkosmos` X/LinkedIn creds via `/add-secret` (Josh owns the account).
- Josh flipping `KOSMOS_SOCIAL_AUTOPOST=1` with his chosen mode (full-auto vs draft-for-approval).
