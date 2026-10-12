---
pre_challenge: true
method: challenge-loop
branch: linuxcopy2-5865
diff_hash: afd659b80c4758743b0863541b6c82dce9289dd009a694eb72640ad1de5e4c8d
validation: failed on Mortals for this exact hash ONLY on the #2518 browser-check surface gate (commit trailers, 19293 tests 0 fail, shell suites 0 failures); fixed by per-check Browser-check-surface trailers in two empty commits (diff unchanged), both gates then rc 0 run directly. Not re-run in full.
subdir_audit: passed
timestamp: 2026-10-12T03:31:23Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (blind, alternating opus and sonnet)
**Converged:** Yes (iteration 10: its one WARNING duplicates the plan's named weakest premise)
**Total findings:** 1 BLOCKER, 24 WARNINGs, 1 CONVENTION, many NITs
**Fixed:** 21 | **Deferred:** 4 | **Asked:** 0
**Reverted:** 1 (iteration 5's Linux aria-label rename of the Terminal section, removed in iteration 7)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION
**Self-generated:** 0
- [BLOCKER] web/index.html Settings Opening Kosmos: the engine's app-location row would warn "We could not find the Kosmos icon" on Linux --> FIXED 1ca8e5c1 (hidden on Linux with its reveal button and message)
- [WARNING] Accessibility line/button and tmux box still visible on Linux --> FIXED 1ca8e5c1
- [WARNING] no rendered check of the Linux hiding --> FIXED 1ca8e5c1 (Linux arm in render-win32-board-copy.js, computed style, chromium + webkit, Mac control)
- [CONVENTION] stamp comments said Windows only --> FIXED 1ca8e5c1

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- [WARNING] signed-out sentences said "Your Mac" on a Windows board seen remotely --> FIXED 177fd0da (hostMachine Windows arm "your PC")
- [WARNING] remaining data-win-hide elements not audited for Linux --> FIXED 177fd0da (Open Terminal hidden; auto-update kept: Linux install has runtime/bin/node)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs
- [WARNING] Finder buttons and "macOS permission prompt" hint on Linux --> FIXED b7054084
- [WARNING] Linux not-answering step covered only one of its two causes --> FIXED b7054084
- [WARNING] platformHides did not know data-linux-hide --> FIXED b7054084

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs
- [WARNING] Windows asleep sentence --> FIXED 01dd1b2f (hostMachine in the Mac arm; all four sentences tested on Windows)
- [WARNING] Files overflow line pointed at the hidden Finder button --> FIXED 01dd1b2f
- [WARNING] file preview offered a Finder reveal on Linux --> FIXED 01dd1b2f (Download)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs
- [WARNING] Terminal section aria-label on Linux --> FIXED 554c7277, then REVERTED in iteration 7 (self-generated: the section still holds the live window box)
- [WARNING] three more revealFolder buttons (project folder, conversations, task conversations) --> FIXED 554c7277

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- [WARNING] load-time constants need PLATFORM_COPY_FNS in harnesses --> FIXED 3101b649 (comment)
- [WARNING] Settings > Computer machine rows on Linux (engine/machine.js has no Linux arm) --> DEFERRED to #5877 (engine change; first run reads the same sleepGate)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 3 WARNINGs (+1 SELF NIT acted on)
**Self-generated:** 1 (the iteration 5 aria-label rename)
- [WARNING] focus lost after a folder move on Linux --> FIXED 9fe8f6b1 (pjsMoveDoneFocus, tested both arms)
- [WARNING] Windows world-switch step reused the stale "Kosmos folder" remedy --> FIXED 9fe8f6b1 (restartHow's Start-menu step)
- [WARNING] overflow line test only regex-matched source --> FIXED 9fe8f6b1 (runs paintAgentFilesAll on Linux)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- [WARNING] pvOpen test only regex-matched source --> FIXED 7d38a8f2 (pvOffersDownload, run on 3 platforms + remote)
- [WARNING] PDF preview not excluded on Linux --> DEFERRED: the fallback (open on the computer) also runs /usr/bin/open and is worse; filed with the rest as #5881

#### Iteration 9
**Reviewer model:** opus
**New findings:** 3 WARNINGs
- [WARNING] worldswStuckStep comment stale --> FIXED 8522fef8
- [WARNING] worldswStuck could drift from restartHow --> FIXED 8522fef8 (test pins them)
- [WARNING] Files overflow line said Finder on Windows --> FIXED 8522fef8 (platformCopy docsOpenFolder)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 (1 WARNING duplicates the plan's weakest premise: kosmos restart on a non-installed board)
**Converged.**

#### Final validation (6j)
Rebased on origin/main (2 commits, no conflict). Mortals run for hash afd659b8: 19293 tests, 0 fail; red only on the #2518 surface gate (render-login-expiry-3532, render-docs-seg-4937, render-task-taps-5200, render-subview-cleanup-3502, render-agent-files-3614). Four of those run green on this branch headless; login-expiry needs the runner's board and runs in PR CI. Per-check trailers added (the first set without ".js" did not match; the second does). Coarse and surface gates rc 0.

### Deferred
- engine/machine.js rows on Linux, first run on Linux --> #5877
- PDF preview on Linux, opening a file "on the computer", the engine's /usr/bin/open calls --> #5881
- kosmos restart named to a non-installed Linux board: #5862's precedent, the plan's weakest premise

### Strengths (across all iterations)
- Every new arm runs the page's own source with the served platform set, with a Mac (and where it matters Windows) control
- data-linux-hide counted against a named list in markup, and checked by computed style in two engines with a Mac control
- The load-time sentences keep their names, so identity comparisons still hold
