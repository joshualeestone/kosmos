# win32-update-arm — S4 pre-challenge proof

Branch `win32-update-arm`, off `origin/main` @ `1bfd8ad2`. Plan:
`.claude/plans/win32-update-arm-20260913T230101Z.md`. Slice S4 of the Windows in-app updater
(`kosmos-scripts/win32-updater-design.md` §7): arm it.

## Convergence across 3 review rounds

- **Round 1 — 1 MUST-FIX (CI red), fixed.** `server.js` added `updatePhase` to `/api/status`, but
  `server.test.js`'s "no field the board sends is unknown to the page" walks every status key and
  requires each be read by `web/index.html` or listed in `UNREAD_ON_PURPOSE`. On macOS CI (full
  board boot) `updatePhase: null` would land in `unread` and red the `deepEqual([])`. Fixed by adding
  `updatePhase` to `UNREAD_ON_PURPOSE` with an honest reason (published for diagnostics + the S5 Roll
  back UI #3017; the overlay derives its transition from board reachability, not this field). The
  on-box run had masked it (server.test.js dies early here on a 2-field win32 payload), so it was
  verified by STATIC inventory replication: every S4-emitted key (`update`, `updateManual`,
  `updateChannel`, `updatePhase`, `updateLook`, `updateAttempt`, `version`, `download`) is referenced
  in index.html or excused; a diff scan confirmed `updatePhase` is the ONLY new status key.
- **Round 2 — 1 optional hardening, taken.** `beginWindowsInstall` held single-flight on `{ok:true}`
  with no witness on the detached helper (unlike the Mac `wireChild` #2503/#988). If the helper
  spawned then died before stopping the board, the flag stranded and no further update could start.
  Added `armWindowsHelperWitness`: a bounded, `unref`'d timer (window =
  `win32apply.STAGED_HELPER_STARTUP_GRACE_MS`, 2 min — far above win32apply's 30 s + 1 s board-stop
  budget) that releases single-flight only if the journal never left `staged`. The board going down
  for the swap is the normal path (setPhase('stopping') then end-board kills this process, so the
  timer never fires); a phase past `staged` leaves the flag.
- **Round 3 — witness race PROVEN SAFE, converged; one defense-in-depth item taken.** The reviewer
  proved the on-disk WORK lock is the true single-flight authority: a spurious in-memory release can
  only start a resumer, which serializes on that lock, so two concurrent swaps are impossible. Taken
  anyway to make the in-memory flag independently correct: the witness now reads `windowsJournalRead()`
  (distinguishing `readJournal`'s `none` = absent from `unreadable` = a file present but torn) rather
  than `updatePhase()` (which collapsed both to null). It releases only on a definitively absent or
  still-`staged` read and HOLDS on a present-but-unreadable journal (a writer replacing it mid-swap, a
  scanner holding it). Every safety guard re-confirmed. Converged.

## Safety guards verified

- **Source-checkout guard:** on this box the board runs from `src\kosmos\engine`, so
  `win32board.bundleRoot()` → null → `installedRoot()` → null; the route, `maybeAutoInstall`, and
  `beginWindowsInstall` all refuse on null root. This box can never self-install (test).
- **Auto-install cannot fire in dev/CI/tests:** `maybeAutoInstall` gates on `installedRoot()` (null
  from source) and `autoPref().on`; the real `win32update.begin` checks `liveExecutionAllowed()`
  (false under `node --test`) and B0 before anything moves.
- **Location refusal authoritative at B0:** the OneDrive/Program Files rule is one named rule
  (`win32update.unusualLocationRefusal`, `UNUSUAL_LOCATION_POLICY='refuse'`), surfaced to the status/
  route via `update.windowsLocationRefusal()` (env var AND path-inside).
- **Never downgrade:** `readOffer`/`newer` refuse a not-newer build; the armed offer and auto path
  both ride `available()`.
- **Offer/manual exclusivity:** `installOffer()` and `manualOffer()` are mutually exclusive by
  construction (installOffer null exactly where manualOffer is set).
- **Channel selection:** win32 reads only `KOSMOS_UPDATE_CHANNEL` (never `AGENT_WORKFORCE_*`),
  `KOSMOS_RELEASE_BASE` honoured, channel in status + boot log, unreachable staging never falls back
  to prod.
- **Mac byte-identical:** all Windows wording via the board-copy layer; `web.win32-board-copy` (26/0)
  pins every Mac string against main's snapshot, and `web.update-settle-win32` asserts each Mac branch
  exactly.
- **Witness + WORK-lock backstop:** no double swap possible (round 3).

## Tests and revert controls

S4 suites (inline, runtime node v24.19, schtasks guard preload, scratch APPDATA/LOCALAPPDATA; block
log 0 every run): `update.win32-arm` 16/0, `update.win32-570` 6/0, `update.win32-check` 14/0,
`web.win32-update-offer` 11/0, `web.update-settle-win32` 5/0, `web.win32-board-copy` 26/0,
`engine.reachable` 1/0, `platform-gate-wiring` 3/0; regression-parity `update.test` 24/0,
`updating-988` 54/0, `update.livegate-seam-1726` 1/0, `win32update` 98/0, `win32apply` 101/0.

Full-suite comparison vs a `git archive` of `origin/main`, by NAME and by first error line: no
regressions. `server.test.js` 40 fails on both, identical failing-name set (Compare-Object empty) and
identical first error — pre-existing (needs the Mac substrate). `update.marker-1728` 2 pre-existing
`/bin/sh` ENOENT fails on both (a win32 box).

Revert controls (hand-edit break → run → confirm red → restore; no `git checkout`): SELF_INSTALL win32;
`installedRoot` win32 arm; `beginInstall` win32 branch; `windowsLocationRefusal`; `updateSettleText`
win32 branch; `updateOverlayLead`; the helper witness; and the round-3 unreadable-journal hardening.
All red on break, all restored; no leftovers.

## Not exercisable on this box (covered elsewhere)

- The full `/api/status` field-inventory test needs the tmux stub (can't run on win32; dies early on
  a 2-field payload) — covered by macOS CI + the round-1 static inventory replication.
- A real end-to-end swap is barred by HARD SAFETY — covered by macOS CI (platform-agnostic arms), the
  win32-arm seams, and the coordinator's V1–V4 live checks on a staging build with Josh's go.

## diff_hash

- merge-base: `1bfd8ad265a51dc5de64102e7a037ec2b7d2b723` (`git merge-base origin/main HEAD`)
- command: `git diff 1bfd8ad2..HEAD -- . ':(exclude).claude/plans/win32-update-arm-proof-*.md' | sha256sum`
- diff_hash: `96f17d74a7707423c6574c0e3eabd10c42f8557d0d0ca1c1ff3b05b5e3370174`

## Follow-ups filed

#3015 (Authenticode signature check), #3016 (launcher double-click downgrade guard), #3017 (S5 Roll
back button). The round-3 witness hardening was applied (no follow-up needed).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anwz2k5SbPCSy3yNnPQEok
