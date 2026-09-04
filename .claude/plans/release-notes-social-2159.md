# Plan: auto-post release notes to X + LinkedIn on a prod release (#2159)

## Why
Splinter (2026-09-04): build the MECHANISM now — a release-pipeline hook that on prod-release
generates the release notes and posts them to X (@installkosmos) + LinkedIn (the Kosmos company
page), with a public-post safety default (prod-only + a preview/first-run confirm so a bad note
can't auto-publish). Live posting is gated on Josh's X/LinkedIn API creds (not provided yet) — so
build + dry-run against a stub and wire creds when they land.

## What
- `tools/post-release-notes.sh <version> [--publish]` — the mechanism:
  - Pulls the release-notes prose for `<version>` from the versions page entry.
  - Composes an X post (<=280 chars, truncated + link) and a LinkedIn post (full note + link).
  - SAFETY: a live publish needs ALL of: prod release (KOSMOS_RELEASE_IS_PROD=1), `--publish`,
    `KOSMOS_SOCIAL_AUTOPOST=1`, live creds (secrets map: x-installkosmos + linkedin-installkosmos),
    and a one-time approval marker (`~/.config/secrets/kosmos-social-autopost.approved`). Missing
    any -> DRY-RUN preview, exit 0 (a prod cut must not fail because posting is off).
  - Idempotent: an announced-versions record; never announce a version twice.
  - The HTTP POST is behind the `KOSMOS_SOCIAL_POST_CMD` seam (testable against a stub).
- Wiring: the prod CUT (release.sh) calls it `--publish` after deploy (served); a PROMOTE
  (promote-channel.sh) PREVIEWS only (the promote flips the pointer, but the served go-live is its
  deploy — posting there would announce a not-yet-served version).
- `tools/test-post-release-notes.sh` — hermetic red-capable test (all gates, both-platforms
  publish, 280-char limit, note extraction, idempotency); wired into test:shell.

## Decisions / rejected
- Live posters NOT implemented until creds land + the API shapes are pinned; without the seam a
  publish is a hard refusal, never a silent no-op that reads as success.
- Promote path previews (not live-posts) to avoid announcing before the deploy serves it — the
  promote's live post is a documented follow-up (a deploy-time hook or manual), not v1.
- Idempotency via a record file rather than deploy-diff state — simplest thing that prevents a
  double-post across cut/promote/deploy paths.

## Weakest premise
No live end-to-end post is exercised (no creds, by design) — the publish path is proven only
against the stub seam. When Josh provides creds, the real X/LinkedIn poster impls + the approval
marker are the activation step; the safety gates guarantee nothing publishes before then.
