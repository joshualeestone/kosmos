# Plan: finalize the PWA manifest theme-color and app-title placeholders (#2527)

Branch: `pwa-manifest-2527`
Repo: `joshualeestone/kosmos` (worktree `agent-workforce-pwa-manifest-2527`)
Author: Mona Lisa (design/content), 2026-09-10
Card: #2527 (claimed:monalisa). The card carries my own prior design call; this branch builds it.

## Problem

The PWA / Add-to-Home-Screen manifest carried placeholder brand values flagged for design:

- `web/index.html`: `<meta name="theme-color" content="#f6f5f2">` and a comment saying the
  theme colour and title are "placeholders for Mona Lisa (#815)". #815 is closed (it was the
  copy-screens flag list, discharged by #529 + #2499); the live parent is #718 (Kosmos on a
  phone). So the flag was orphaned and the values were still placeholders.
- `web/manifest.webmanifest`: `background_color` and `theme_color` both `#f6f5f2`, the same
  placeholder shade (used exactly once in the codebase, not a brand token).

## Decision

- **theme-color:** use the brand ground token `--k-bg`, which is `#faf9f7` in light and
  `#0c0d0f` in dark. In `web/index.html` split the meta per colour scheme so the mobile browser
  chrome matches the app in both:
  - `<meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)">`
  - `<meta name="theme-color" content="#0c0d0f" media="(prefers-color-scheme: dark)">`
- **manifest colours:** a manifest has no per-scheme variant, so `web/manifest.webmanifest`
  carries the light value: `background_color` and `theme_color` both become `#faf9f7`.
  `background_color` (the PWA splash background) was the same orphaned placeholder, so it is
  finalized to the same brand ground in the same change.
- **app-title:** keep `Kosmos` (the manifest `name`/`short_name` and the Apple
  `apple-mobile-web-app-title`). It is the correct short home-screen label; the full name
  "KOSMOS Agent Manager" is too long for an icon caption.
- **discharge the flag:** replace the "placeholders for Mona Lisa (#815)" comment with a
  finalized note that cites #718 and records #815 as closed.
- **test:** `server.manifest.test.js` asserted a single `content="#xxxxxx">` theme-color meta
  and compared it to the manifest `theme_color`. Update it to assert both the light and dark
  media variants are present, and to extract the light meta (the manifest's default scheme) for
  the manifest-agreement assertion. This keeps the test's intent (the manifest and the default
  meta must agree so the status bar does not change colour on install) and strengthens it.

## What was rejected and why

- **A single theme-color meta with no dark variant:** rejected. Per-scheme theme-color is
  standard and both Safari and Chrome honour the `media` attribute; a dark-mode PWA whose
  chrome stays light-ground looks unfinished. The card decided the dark variant.
- **A brand gold theme-color:** rejected. The theme-color paints the browser chrome / status
  bar, which should read as a neutral extension of the app ground, not an accent. The ground
  token is the right choice.

## Weakest premise

That the dark chrome value should be the app dark ground `#0c0d0f` rather than a slightly
lighter elevated surface. The dark ground is the honest match for the app background; if the
status bar reads too heavy against the content, a one-token change to an elevated dark surface
is the follow-up. Reversible.

## Scope / verification

Copy/meta/branding only. No served user-facing prose, no DOM behaviour change. This is a `web/`
change, so it carries a `Browser-check:` trailer for the #1720 gate. The visual result (mobile
browser chrome and PWA splash) needs a real mobile/PWA install to see, which a bot session
cannot drive; the values are brand ground tokens already used across the app, so they are
known-good colours. Live mobile-chrome confirmation is a follow-up for a browser/mobile session.
Full node suite must stay green (`server.manifest.test.js` updated in the same change).
