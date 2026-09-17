# fileaccess-realhome-3188 -- fix the #3188 folder false-positive (resolve the REAL user home)

## Problem
On a genuinely fresh macOS user (test20), `fileAccessReading()` (the app-exe folder check,
native-app/main.swift) returns `granted:true` with NO macOS prompt and an EMPTY TCC log = a false
positive. The user is never asked, so the app-exe never obtains the real folder grant, and agent file
access (which the app-exe scan mediates) is silently broken. (The #3188 diagnostic, merged in #3223,
established the false-positive; this is the fix.)

## Root (app-identity model)
Folders are the APP-EXE's TCC identity by design: the find-agents import scan runs as the app-exe
under tmux and holds the folder grant (main.swift:569-586, 3424-3434); agents do not hold it
directly. So the bug is the app-exe's OWN check false-greening. Leading cause, consistent with the
empty TCC log:
- (a) `FileManager.homeDirectoryForCurrentUser` resolves to a REDIRECTED / sandbox-container home
  under the launchd/app-exe hatch, so the probe enumerates container Documents/Downloads/Desktop
  (which exist and need no TCC) and never touches the real protected trio -> no prompt, granted:true.
- (b) (less likely) `contentsOfDirectory` (enumerate) is not the TCC-gated op even against the real
  folders. Enumerate of ~/Documents normally DOES gate, so this is secondary.

## Fix
- New `realUserHome()`: resolve the home from the password DB (`getpwuid(getuid())->pw_dir`), which is
  the actual login home regardless of any container remap, falling back to
  `homeDirectoryForCurrentUser` if the lookup fails (never worse than before).
- `fileAccessReading()` probes `realUserHome()` instead of `homeDirectoryForCurrentUser`, so the
  enumerate hits the REAL protected folders -> triggers TCC -> the verdict reflects real access. This
  addresses (a), the leading cause.
- Diag (kept from #3223, extended): logs BOTH `osHome` (the old resolution) and `realHome` (the fix)
  plus the per-folder enumerate outcome, so the fresh-box verify is DEFINITIVE about the cause:
  `osHome != realHome` confirms (a) was the bug and the fix addresses it; `osHome == realHome` means
  the fix is a no-op there and an enumerate that still does not gate against the real home is a
  distinct macOS finding to ESCALATE (not a silent gap). Removed in a follow-up once verified.
- Return contract unchanged (`allGranted`); probe all three (single grant surfaces all prompts).

## Open question (b), honestly flagged
On an EMPTY fresh-box protected folder there is no file to content-read, so a content-read cannot be
the gate there; the enumerate is the only op available. So a (b) mitigation is limited on empty
folders. This fix therefore addresses the leading cause (a); the retained diag's `osHome`/`realHome`
on the fresh-box verify tells us if (a) alone fixed it. If not, that is the distinct finding above.

## Verify (fresh box, after #3234 install fix -- MERGED, so a quick fresh install is one cut away)
On a fresh-ungranted box with this fix:
1. `fileAccessReading()` returns `granted:FALSE` (honest -- not yet granted).
2. The onboarding shows not-granted, and the file-access prompt FIRES (the app-exe asks for real
   folder access).
3. Granting flips the verdict to `granted:true` AND a TCC event appears in the log.
4. `file-access-diag-3188.txt` shows `osHome != realHome` (confirming (a)).
This behavior-verify is the measurement that matters. MERGE IS HELD until it passes (folder access
has real blast radius; do not ship unverified TCC behavior that sits). Fix-forward on the cut is an
acceptable alternative (merge-on-green + verify-on-the-serve) at the operator's call.

## Scope
- Native-only (native-app/main.swift). No web/ change (no browser-check gates), no engine/JS change.
- The native fix is independent of the onboarding SCREEN: Mona's Approve-Access button triggers the
  existing /api/file-access-prompt (fires the app-exe hatch) unchanged; this only makes the app-exe's
  check honest + prompt-firing.
- Locally compile-checked at the floor target (swiftc -target arm64-apple-macos13.5 -O, exit 0). The
  fresh-ungranted (denied) behavior cannot be verified on this already-granted machine; the fresh box
  is required.

Addresses #3188
