# #3296 (slice 2 of the Gemini runner): the status board's context ring for a Gemini agent

## Problem
Slice 1 gave `geminisession.read()` (merged, #3392), but nothing consumed it. A launched
Gemini agent's board row would read "Not yet read" forever -- the #2257 symptom Codex had
before `readCodexContext`. This slice wires the reader into `status.js` so the board's
context ring reads a Gemini agent's real usage, the exact sibling of the Codex arm.

## Scope (deliberately the context ring only; non-fenced, non-UI, non-accounts)
- **Engine only.** No `web/` change -- so it does NOT touch the launch/#3383 UI surface
  Splinter fenced off for the launch window, and does NOT add gemini to `MODELS` (which
  feeds the create-screen picker). No user-facing surface offers an unlaunchable agent.
- **Default-account only.** `readGeminiSession` uses `job.configDir || defaultAgentGeminiHome()`;
  a default-account gemini agent has `configDir=null`. Per-account gemini homes (the
  GEMINI_CLI_HOME-vs-.gemini semantics + `accountEnvVar('gemini')`) are the launcher slice's
  concern and are deliberately NOT touched here.
- **Classify + account-badge DEFERRED to the launcher.** The busy/idle pane classify arm needs
  a LIVE gemini pane to validate; the account-badge overlay needs a GOOGLE provider in
  observed.js. Both are separable from the context ring and land with the launcher.

## Changes
1. **create.js `defaultAgentGeminiHome()`** -- the sibling of `defaultAgentCodexHome`, the
   default-account gemini `.gemini` home. Exported.
2. **create.js `plistFor`** -- generalize the codex-only runner/model lines to ANY non-claude
   runner, so a `runner: 'gemini'` plist writes `<string>gemini</string>` and round-trips
   through `readJobVerdict` (`s.runner || 'claude'`, no whitelist). A claude agent's plist
   stays byte-for-byte identical (the guarded #2519 golden card + the full suite confirm no
   drift). REQUIRED for `readGeminiSession`'s `job.runner === 'gemini'` gate to fire -- and a
   prerequisite the launcher needs too. Unreachable in production until the launcher writes
   such a plist (createAgent still refuses provider 'google'), so dead-but-ready.
3. **status.js `readGeminiSession` / `readGeminiContext`** -- exact mirrors of the Codex arm
   (the completion-time helper geminiCompletionAt/geminiLastCompletionAt moved to the launcher
   slice, where the GOOGLE-provider observation arm that consumes it lives -- an
   exported-but-unwired helper is the #265 dead-code signature). Gate on runner, read the
   agent's own account home, map the session to the ring. `contextWindow` is structurally
   null for Gemini (the Claude "assumed ceiling" case) so it renders measured-usage /
   no-ceiling, but with the model NAMED (Gemini carries it, unlike Codex). Same #2803-analog
   guard (found + no-usage -> notYet) and unreadable/not-transcript ladder.
4. **status.js snapshot** -- an `isGeminiPane` discriminator (TAG-ONLY: gemini fronts as
   `node`, so key on `pane.runner === 'gemini'`, never a command classifier), `geminiSess`
   read once, the context-ring ternary extended, and the runner field (both the raw-tag
   normalize at ~947 and the snapshot field at ~6596) passing 'gemini' through. The Anthropic
   observation-arm gate is `!isCodexPane && !isGeminiPane` (challenge iter 1): without the
   `!isGeminiPane`, a live gemini pane scraping WORKING would record a false
   observed.saw(PROVIDER.ANTHROPIC) -- the cross-provider false-green the #1889/#2413 split
   exists to prevent. Gemini takes NEITHER observation arm in this slice, only the context ring.
5. **The #2519 golden-card count** -- `readGeminiContext` adds two `{ ...NONE_BASE, ... }`
   branches (mirroring the Codex per-provider duplication), so the NONE_BASE-family count
   grows 11 -> 13. Updated the guard's assertion and the derived doc
   (docs/browser-checks/render-talk.js) in the same commit, which is the guard's intended
   workflow. The frozen plan proof that also states "eleven" is historical and left as-is.

## Tests
`engine/status.gemini-ring-3296.test.js` (6): the ring mapping (measured usage / no ceiling /
model named) via the pre-read `sess` seam, the #2803-analog notYet, the unreadable admission,
an end-to-end read via a real-shaped session + gemini plist + profile, the no-session case, and
the runner gate (a codex agent must not read a gemini session on disk). Full whole-tree JS suite
green (8022, 0 fail); frozen-roots clean.

## Weakest premise
The end-to-end + mapping tests use a real-SHAPED fixture (header + a gemini turn with tokens),
not a full real capture -- but the deep transcript parsing is already covered against the REAL
0.61 capture by geminisession.runner-3296.test.js (slice 1). This slice tests the WIRING, so a
real-shaped fixture is the right level. The one genuinely-unverified-until-live piece is a live
gemini pane exercising the snapshot end-to-end, which needs the launcher; the reader + mapping
are verified.

## Not in this slice (the launcher, its own PR)
create.js provider validation + MODELS + provider->runner resolution + binPaths geminiBin + the
per-account GEMINI_CLI_HOME (accountEnvVar) + auth pre-seed; agent-supervisor.sh spawn arm; the
classify arm; observed.js GOOGLE provider; runners.js manifest; the connect-UI un-gate.
