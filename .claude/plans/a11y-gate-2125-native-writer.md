# #2125 slice 3 -- the native writer (the remaining piece)

## What is DONE (committed + pushed on branch a11y-gate-2125)
The CONSUMING half of the Accessibility Continue-gate, fully tested and SAFE:
- `engine/a11ystatus.js` + `/api/a11y-status`: reads a native-written reading. Three-answers
  discipline (checkable:false vs checkable:true+trusted:false). 7 unit tests. Fails safe.
- `web/index.html` fr-pane-5: Continue gated via `frPollA11y` on `/api/a11y-status`,
  FAIL-SAFE + POSITIVE-ONLY (disabled ONLY on a positive checkable:true+trusted:false; trusted,
  uncheckable, stale, and fetch-failure all leave Continue ENABLED). New what-to-toggle guidance
  (names the Accessibility list AND the Automation grant). The offer-not-require skip-out removed.
- `docs/browser-checks/render-a11y-gate-2125.js`: drives the live route through 3 readings; the
  DISABLED arm is the feature, the trusted/no-reading/stale ENABLED arms are the controls. Wired
  into browser-checks.sh + README. render-a11y-copy-1940 reconciled to the gated copy.

Because the native writer does not exist yet, `/api/a11y-status` is always checkable:false, so the
gate is INERT and Continue is never blocked -- i.e. today's behaviour exactly, no regression. This
is the safe intermediate state.

## What REMAINS: the native writer (native-app/main.swift + maybe build wiring)

### The confirmed design
The accessibility grant is TMUX's (macOS attributes the "control this computer" prompt to tmux; the
copy + #1940 guidance already say "Turn on Tmux in Accessibility"). The engine cannot read TCC
(#1344). Only a native `AXIsProcessTrusted` call can, and it must reflect TMUX's trust, not the
kosmos-app's (checking the app's own trust is a FALSE-PASS).

### The approach (low build-risk -- reuse the existing binary + hatch pattern)
main.swift already has `--kosmos-app-*-selftest` hatches that run before app.run() and exit. Add:
1. `import ApplicationServices`.
2. `a11yStatusURL()`: resolve `<app-support>/AgentWorkforce/a11y-status.json` exactly like
   `boardTokenValue()` resolves its dir (AGENT_WORKFORCE_DATA / AGENT_WORKFORCE_HOME / default).
   This MUST match engine/store.js's ROOT (join(AGENT_WORKFORCE_DATA, "AgentWorkforce")) so
   a11ystatus.js reads what the app writes.
3. Hatch `--kosmos-app-axcheck`: `let t = AXIsProcessTrusted(); write {"trusted":t,"at":<ISO8601>}
   to a11yStatusURL(); exit(0)`.
4. Hatch `--kosmos-app-axprompt`: `AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt
   .takeUnretainedValue() as String: true] as CFDictionary); exit(0)` -- shows the system prompt +
   ADDS the responsible process to the Accessibility list.
5. In applicationDidFinishLaunching: spawn the hatches UNDER the bundled tmux (`<home>/bin/tmux`,
   the same home `startBoard` resolves) so macOS attributes the AX call to tmux (the responsible-
   process model, the SAME one that makes tmux the folder-TCC owner):
     tmux -L kosmos-axcheck new-session -d '<Bundle.main.executableURL.path> --kosmos-app-axcheck'
   Run it on launch + on a repeating Timer (~60s, safely inside a11ystatus.STALE_AFTER_MS=180s) so
   the reading stays fresh while the first-run screen polls it. On launch when the last reading is
   not-trusted/absent, fire `--kosmos-app-axprompt` ONCE (so tmux appears in the list -> the
   Open-Accessibility button then "gives something to enable", Josh's bug #2).
6. Build verification: add a `--kosmos-app-axcheck`/`--kosmos-app-axprompt` smoke to
   build-kosmos-bundle.sh's selftest block (they must exit cleanly under hardened runtime), matching
   the existing `perl -e 'alarm 15; exec @ARGV' ... --kosmos-app-*-selftest` checks.

### 🛑 THE LOAD-BEARING UNKNOWN -- MUST be verified on a fresh install BEFORE this gates for real
Does a kosmos-app process re-exec'd UNDER tmux report TMUX's accessibility trust, or its OWN
(kosmos-app's)? This is the responsible-process attribution question. It is the SAME attribution
that already makes tmux the folder-TCC owner in this codebase (well-grounded), but AX-specific
behaviour is UNVERIFIED: on a dev box with a11y already granted broadly, AXIsProcessTrusted returns
true both directly and under tmux, so it cannot be discriminated locally (measured 2026-09-04).

⚠️ WHY THIS MATTERS AND WHY IT MUST NOT SHIP BLIND: the gate is fail-safe on the FRONTEND, but if
the native attribution is WRONG the native writer produces a WRONG reading:
- reads kosmos-app's trust, app not granted, tmux granted -> checkable:true+trusted:false ->
  the gate FALSE-BLOCKS: the user grants Tmux (as the pane says), the reading still says not-trusted
  (it was reading the app), and Continue stays stuck. Stranding a user on onboarding is the worst
  outcome -- worse than the haunt this family of cards fixes.
So: build the native writer, but VERIFY on a fresh macOS install (batches with Josh's #2129 re-test,
per Splinter) that granting **Tmux** in Accessibility flips the reading to trusted and UNBLOCKS
Continue. Only after that does the hard gate ship. If the attribution reads the app instead, the fix
is known: the check must run as/under a tmux-responsible context that reflects the tmux binary, or
the reading location moves -- but that is a fresh-install measurement, not a guess.

### Mitigation option if the attribution proves wrong / to de-risk the first ship
Have `--kosmos-app-axcheck` write `trusted:true` UNLESS it can POSITIVELY establish not-trusted for
tmux specifically -- i.e. bias the native writer toward the fail-safe (never emit a gating
not-trusted unless confident). That trades "gate may not engage" (safe, matches today) for "never
false-block". Decide with the fresh-install measurement in hand.
