# Plan: relabel the S2 Access screen file-access prompts "Terminal" -> "tmux" (#2685)

## What finished looks like

On the first-run Access screen (S2), the six grouped dialog previews name the app macOS
actually names in each prompt. The file-access group is labelled **tmux** (was "Terminal") and
its three mock prompts read `"tmux" would like to access files in your <folder> folder.`, with a
one-line supporting micro-line under the group. The Kosmos group is unchanged. The S3
accessibility gate stays **Kosmos** (the asymmetry is the point, see below). The browser check
`render-firstrun-access-onebox.js` asserts the new label, the micro-line, and per-app coverage,
green in chromium + webkit; all four registration gates stay green.

## Why tmux, not Terminal (the correction this card makes)

Kosmos ships and launches its own bundled relocatable tmux (macOS has none). That bundled tmux
is the process macOS holds **responsible for agent FILE access** (`engine/fileaccessstatus.js`),
so the real folder prompts come up as "tmux" -- which is exactly what Josh's screenshots show.
The old copy said "Terminal", which is wrong on this machine: nothing here is Apple Terminal.

## Scope: this branch is FILE access only (S2)

FILE access is attributed to the responsible process = the bundled tmux, so the S2 file-access
prompts (and this relabel) name **tmux**. This branch does NOT touch S3 and does NOT assert the
accessibility mechanism. A live macOS prompt (Josh, 2026-09-13, Mortals box) showed the
ACCESSIBILITY prompt ALSO names tmux, refuting the earlier "accessibility is Kosmos, never tmux"
premise. The accessibility attribution and its screen copy are a separate, reopened piece
(#2911, now "two asks" per Josh: a tmux a11y ask plus a Kosmos a11y ask), led by Mona Lisa and
pending ICK's deny-test. Verified: S3 gate untouched here. The #1214 "one place the word tmux may
reach a person" invariant is reframed to the principle (tmux appears only where macOS shows it
first) because S2 is now a second such place; Mona Lisa's wording, applied to the box comment and
web.tmux-box-1214.test.js.

## Division of work (Mona Lisa's ruling)

- I (Angel) own the **render change** in `web/index.html` and the **browser check**.
- Mona Lisa owns the **copy** (label, mock strings, micro-line wording) -- built to her exact text.

## What I rejected

- **Relabelling S3 too**: rejected -- it would erase the true asymmetry and mislabel the
  accessibility grant, which really is Kosmos, not tmux.
- **A boxed callout for the micro-line**: rejected -- Mona Lisa's copy is a quiet muted line, not
  a warning box; `.s2-grpnote` is small, muted, no border.

## Weakest premise

This is the browser-verifiable half. It asserts the SCREEN renders "tmux". It does NOT prove the
real macOS prompt fires as "tmux" on a fresh Mac, nor that the native app requests file access in
a way that produces exactly these prompts -- that is a real-macOS-testing gap (the fleet
capability gap flagged separately). If the real prompt named something other than "tmux", this
screen would then be wrong and this check would not catch it; but Josh's screenshots already show
"tmux", so the screen now matches observed reality.

## Verification

- `render-firstrun-access-onebox.js` standalone: 18/18, chromium + webkit (all arms incl. tmux
  label, micro-line, per-app coverage).
- Registration: browser-checks-reason-grep, browser-checks-indexed, tools.browser-checks-wired,
  bc-surface-map (shell) -- all green. No count bump: this modifies an existing check, does not
  add one.

## Delivery

PR bases into `origin/main` (the #2910 Access screen is on main). Tag Mona Lisa for copy/layout
review of the micro-line placement.
