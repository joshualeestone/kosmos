# allowance-capture-3946: record each Claude account's weekly usage (#3946 phase B, part 1)

## Why

Josh asked (#3946 items 9 and 10) for a swarm's daily limit as a "% of weekly
allowance". The decision on the card: the only honest "weekly allowance" is
the provider's own weekly figure, calibrated against tokens Kosmos measures.
This PR is the capture half. It shows no reading on screen yet; part 2 (the
calibration and the slider in %) reads what this records.

## Measured before building (Claude Code 2.1.283, this Mac, 2026-09-26)

- The statusline input carries `rate_limits.seven_day = {used_percentage, resets_at}`
  on one compact line.
- Hook events (UserPromptSubmit, Stop) carry no `rate_limits`, so the report
  hook cannot capture it. The statusline is the only source.
- A detached tmux pane (created with `new-session -d`, never attached) still
  ran the statusline. Both probe panes were detached.

## What changes

- `engine/kosmos-statusline.js` (new): the statusline. Writes
  `{usedPct, resetsAt, at, history}` to `<account dir>/kosmos-weekly.json`
  only when the reading moves forward, prints nothing, never errors. Measured:
  printing nothing still leaves one empty row under the prompt and hides the
  "? for shortcuts" hint, against a control with no status line at all
  (`--setting-sources project,local`, so the account's own was excluded).
- `engine/allowance.js` (new): `ensureStatusLine` (merge-only wiring),
  `readWeekly` (null for nothing, malformed, or a week already reset).
- `engine/reporthook.js`: the settings read, the atomic write and the #1582
  ephemeral-path check are extracted as exported helpers, so the report
  hooks and the statusline share one copy of each. Behaviour unchanged
  (engine/reporthook.test.js, 29 tests, passes).
- `engine/accounts.js`: `prepare` wires the statusline and returns `weeklyWired`.
- `install/setup.sh`: the hook block also wires the statusline on the same
  targets, outside the hooks' refused count.

## Decided

- An account that already has its own statusline is left alone: it is one
  slot, and replacing it is clobbering. That account keeps the token slider.
- Windows is not wired here: a statusline is a shell string there and the
  exec form does not apply. Needs the Windows box to verify.
- The script is `engine/*.js` so it ships with no bundle or release-freeze
  plumbing (build-kosmos-bundle.sh copies engine/*.js).
- The figure only moves forward within a week. Each session carries the
  figure from its own last API response, so agents sharing an account repaint
  with readings that lag each other; a lower one is stale, and would put
  backwards steps into the history the calibration reads. Reset stamps within
  a day are the same week.
- The command bakes a node path that survives an upgrade: the bundle's own
  runtime, else a stable symlink to the same binary, never a versioned
  Homebrew Cellar path.
- The DEFAULT account is wired too, not only Kosmos-made ones: most people
  have only the default account, and their agents run on it. Setup says so
  in one line. The cost is a node process per repaint of any Claude session
  on that account, which is small, and the figure it records is the same
  account's either way.

## Rejected

- A wrapper statusline that runs the person's own one and records ours on the
  side: transparent in theory, but it rewrites their setting and becomes ours
  to keep working. Not for a first cut.
- Capturing from the report hook: the hook payload has no weekly figure.

## Weakest premise

The field is present on the measured Claude Code build only; another build
could rename it. Then nothing is written, and the account falls back to the
token slider, which is the safe direction.

A second, smaller one: forward-only assumes the weekly figure never drops
mid-week. If the provider ever reset usage mid-week, the recorded figure would
stay high until the week ends. That errs toward pausing a swarm early, which
is the safe direction again.

A third: the command names files by absolute path. Installed Kosmos names its
own bundle, which updates keep in place. A board run from a source worktree
names that worktree, and once the worktree is removed the status line records
nothing until an installed setup or prepare repoints it. The report hooks
have the same exposure. Uninstall names the status line it leaves behind,
since by then nothing can edit the JSON.

## Tests

`engine/allowance.test.js` (19). The script runs the way Claude Code runs it,
fed the measured payload shape, and setup.sh's hook block runs for real
against a sandbox home (extracted from setup.sh). Mutations shown red:
- always rewriting the reading;
- clobbering a foreign statusline;
- trusting a week that already reset;
- letting a lagging reading step back;
- treating a reset stamp seconds apart as a new week;
- setup not wiring the statusline;
- setup's guard removed;
- uninstall not naming our status line, or naming somebody else's;
- uninstall splitting a path that has a space in it;
- setup telling the person about a status line it did not add;
- accounts.prepare requiring allowance without its guard (an account must still be born);
- accounts.js requiring allowance at load again (the fixture copies files, because a
  symlinked one resolved the real module and could not fail).
