# Plan: Automation-to-Terminal grant (Josh 0.6.84 blocker #1)

Branch: `automation-grant-terminal` · The 0.6.85 launch gate (blocker #1 of the agent-talk feedback)

## Problem
Josh (0.6.84) hit "Not authorized to send Apple events to Terminal (-1743)" opening an agent's
terminal, unclearable. Root cause: the Terminal-Automation TCC grant is never requested. Onboarding
(`spawnTmuxAutomationPrompt`) primes only `System Events` (→ Accessibility), but the runtime
(`engine/terminal.js`) drives `Terminal.app`, and macOS keys Automation on the (source, TARGET) pair.
So Terminal is ungranted, the runtime is the first to touch it, and it fails -1743 mid-work. The
"Trust & Restart" button grants the agent-FOLDER trust — a different TCC bucket — so it never clears.

## Approach (both my lane: #3113/#3188/#3274)
1. **native-app/main.swift** — `spawnTmuxAutomationPrompt` fires BOTH probes under tmux: System
   Events (Accessibility, unchanged) AND `tell application "Terminal" to get version`
   (Automation→Terminal, read-only, no window). Secures the grant in onboarding, not mid-work.
2. **engine/terminal.js** — detect the -1743 / "Not authorized to send Apple events" denial and
   return an actionable message (grant Terminal under Kosmos in System Settings > Privacy & Security
   > Automation) + a `needsAutomationGrant` flag for the UI, instead of the raw AppleScript code.
3. **test** — a -1743 arm in server.launch-terminal-2129.test.js: actionable message, the flag,
   503-not-400, and no raw-code leak.

## Not in scope
Blocker #2 (the agent's Claude Code at the "Select login method" screen = config-dir auth) is ICK's
#3136 — a separate build. Verified #3326's force-login is already in Josh's build (b0ffb37a), so #2
is NOT a re-cut fix.

## Verify
- Engine message + flag: fully unit-tested (8/8). terminal.js syntax-checked; Swift `-parse` clean.
- Native Terminal probe is VERIFY-PINNED (#2911/#3113): a fresh-Mac verify confirms it raises the
  Automation→Terminal prompt (and whether it briefly launches Terminal) — the 0.6.85 real-Mac gate.
