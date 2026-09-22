# Plan — #3383c: write default-account folder-trust to ~/.claude/.claude.json (0.6.88 launch blocker)

## The failure
On a real laptop (Josh's, and any GUI-launched Kosmos.app), creating a NEW agent leaves it parked on
Claude Code's "Is this a project you created or one you trust?" prompt, every time, and the app's
"Trust & Restart" button does nothing. Josh: "worked for ~50 builds, then broke." Agents can't be
created and talked to = the whole launch bar fails.

## Root cause (measured, not assumed)
Claude Code's **native installer (v2.1.278)** moved a DEFAULT-account agent's config from
`~/.claude.json` to **`~/.claude/.claude.json`** (a file INSIDE the `.claude` directory). Measured on
this box (same v2.1.278 Josh runs):
- Answered a real trust prompt myself -> `hasTrustDialogAccepted` was written to `~/.claude/.claude.json`
  (verified present there, ABSENT in `~/.claude.json`). Re-launching in that folder -> no prompt (so it
  READS there).
- Kosmos's `trustFolder` writes the OLD `~/.claude.json` via `defaultAgentConfig() = homeDir()/.claude.json`.
  So the agent never sees the trust -> prompt on every default-account agent.
- Independently confirmed (ICK, measured): the fleet's real trust config is `~/.claude/.claude.json`
  (570 trusted projects); `~/.claude.json` is stale (67). `launchctl getenv CLAUDE_CONFIG_DIR` is empty,
  so a GUI-launched app inherits none and its agents use the new default `~/.claude/.claude.json`.

Ruled out (a wrong first theory, disproven by e2e): claude does NOT read folder-trust from `$HOME`.
`os.homedir()` follows `$HOME`, but the CLI uses getpwuid-home / its default config dir `~/.claude`. A
pane with the correct `$HOME` and the trust in that HOME's config STILL prompted. So this is NOT a HOME
re-injection problem.

## The fix
`engine/trust.js` `defaultAgentConfig()` -> `homeDir()/.claude/.claude.json` (was `homeDir()/.claude.json`).
- TRUST-ONLY and safe: `defaultAgentConfig` has NO callers outside trust.js. It feeds `configTarget`,
  which drives the trust + onboarding writes and the `folderTrusted` read-check. AUTH is a SEPARATE
  path: `accounts.js configFile()` reads `oauthAccount` from `~/.claude.json` and is UNCHANGED. Both
  files carry oauth now (~160KB each), which is why auth kept working while trust broke.
- Named-account agents unaffected: with CLAUDE_CONFIG_DIR set, claude reads `$CLAUDE_CONFIG_DIR/.claude.json`
  where Kosmos already writes (`CONFIG(configDir)`). So the code as a whole already implements the robust
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.claude.json` shape (named -> CONFIG; default -> defaultAgentConfig).
- The `AGENT_WORKFORCE_CLAUDE_CONFIG` test seam still wins verbatim (unchanged first branch).

## What finished looks like
- The fixed `trustFolder(fresh folder, default account)` writes the trust to `~/.claude/.claude.json`,
  and launching claude in that folder shows ZERO trust prompt; an untrusted folder still prompts
  (control). PROVEN end-to-end.
- Full JS suite green. The 5 default-account trust-path tests updated to the new location, plus a test
  pinning `defaultAgentConfig()`'s path as a literal so a refactor can't silently revert it.

## Also fixed by the same change
- The theme-picker onboarding seed for default accounts (`preacceptOnboarding` uses `defaultAgentConfig`).
- The dead "Trust & Restart" route (writes via the engine trust path -> now lands where the agent reads;
  `server.trust-restart-fallback-2129.test.js` pins it).

## Scope / disclosed gaps
- macOS is proven end-to-end here. The change is cross-platform (`homeDir()/.claude/.claude.json`) and the
  win32 test is updated, but I cannot e2e-verify on Windows — claude's native installer very likely uses
  the same `.claude/.claude.json` there, but flag Homer to confirm on a real Windows box.
- The "can't open terminal / can't reach agent" symptom Josh reported is Splinter's downstream theory of
  the same root; not independently proven by me. If it persists after the trust fix, it's a separate item.
- 0.6.88 = this fix + the already-merged/verified design work only (Splinter is keeping it minimal). Money
  / promote HELD until Josh's experiential retest on 0.6.88 (his laptop) shows a fresh agent comes up with
  zero trust prompt.
