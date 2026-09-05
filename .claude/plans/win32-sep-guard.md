# A source pin for the Windows-hostile path-separator class (#1732)

#1732: a Windows-hostile hardcoded `:` path separator in `engine/github.js` shipped
to iteration 45 of #1606 because it is INVISIBLE to every behavioural test on this
macOS fleet (`path.delimiter` IS `:` on POSIX). The card asks for two things: a
sweep for the class (point 1), and a convention that SOURCE pins, not behavioural
arms, guard platform-specific failures (point 2) - "a guard blind on the same axis
as the code is not a guard." (Point 3, "decide whether Windows is in scope," is
answered by reality: it is - the #570/#253 paneless-board initiative shipped win32
roster #2171, create record-write #2174, and live-state capture #2179.)

## The sweep (point 1), classified

Swept `engine/` for the axes the card names. Result: the class is CONTAINED.

- **`:`/`;` as a split/join separator - 9 hits, ALL non-path (verified):** MIME
  content-type parameter strips (`attachments.js`, `unfurl.js`), an HTTP
  cookie/header split (`boardauth.js`), a hex/colour split (`unfurl.js`), and a
  filename sanitiser replacing filename-illegal chars incl. `:` with `-`
  (`projects.js`). The only PATH/env-var splits - `github.js` ghCandidateList
  (AGENT_WORKFORCE_GH_CANDIDATES) and `discover.js` scan-roots
  (AGENT_WORKFORCE_SCAN_ROOTS) - already use `path.delimiter` (both fixed under
  #1732/#1938). So there is NO remaining separator sibling; the github.js instance
  was a one-off.
- **`.exe` literals - all win32-AWARE, not hostile:** `status.isClaudeCommand`
  accepts `claude.exe`/`codex.exe`; `win32roster.WIN32_COMMAND`. These are the
  cross-platform handling, not a POSIX assumption.
- **home-directory resolution - 1 marginal:** `machine.js` uses
  `process.env.HOME` inside the macOS `~/Library/LaunchAgents` path, which is
  Mac-only launchd code (win32 does not run it). Not a live win32 defect.
- **`\n` line-ending splits - 39 hits, no win32-reachable defect today:** they
  split either our own format (JSONL selfreport, our emitted text) or macOS
  tool output (tmux `capture-pane`, launchctl) on Mac-only code paths. The
  win32-reachable readers (`win32roster`/`win32capture`) parse `claude agents
  --json` with `JSON.parse`, not `.split('\n')`, so CRLF cannot bite them. When
  the win32 launch/report flow is wired (windows-orchestrator's Gap-B arm), any
  external-tool-output split it adds should use `/\r?\n/`; noted for that lane.

## The guard (point 2)

`engine/win32-separator-guard.test.js` - a SOURCE pin (reads source, so it is not
blind on the platform axis the way a behavioural arm on macOS is). It scans
`engine/` for a hardcoded `:`/`;` as a `.split`/`.join` separator and requires every
occurrence to be either the `path.delimiter` fix (never a literal, so silent here)
or a reviewed non-path entry on an explicit ALLOW list with a reason. A NEW literal
separator - or a REGRESSION of github.js/discover.js back to `:` - fails on the Mac,
which a behavioural arm cannot catch. Perturbation-verified: reverting github.js to
`split(':')` reds the guard.

This is the honest resolution of the card's own insight ("a by-shape scan is bounded
by its file list; a by-name sweep is bounded by the searcher's imagination"): the
scan cannot tell a path split from a MIME split statically, so it forces the human to
DECLARE which it is, once, in a reviewed place - and a path split has a mechanical
correct answer (`path.delimiter`) that keeps it out of the list entirely.

Two secondary guards keep the pin honest: the allow list is asserted to have no dead
entries (a stale entry protects nothing and invites copy-paste), and the two known
env-var path splits are positively pinned to `path.delimiter`.

## Scope decision (recorded)

The enforcement guard is scoped to the SEPARATOR axis - where the defect actually
shipped, and where legit uses are few and tractable (9). The `\n` axis has 39 mostly
legitimate uses; a guard there would be almost all allow-list, so it is documented
(above) rather than enforced. `.exe`/case/homedir are documented as either
win32-aware already or Mac-only, with no live defect.
