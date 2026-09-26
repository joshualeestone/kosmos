# allowance-capture-3946: record each Claude account's weekly usage (#3946 phase B, part 1)

## Why

Josh asked (#3946 items 9 and 10) for a swarm's daily limit as a "% of weekly
allowance". The decision on the card: the only honest "weekly allowance" is
the provider's own weekly figure, calibrated against tokens Kosmos measures.
This PR is the capture half. It shows nothing on screen yet; part 2 (the
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
  only when the reading changes, prints nothing, never errors.
- `engine/allowance.js` (new): `ensureStatusLine` (merge-only wiring),
  `readWeekly` (null for nothing, malformed, or a week already reset).
- `engine/reporthook.js`: the settings read, the atomic write and the #1582
  ephemeral-path check are extracted as exported helpers, so the report
  hooks and the statusline share one copy of each. Behaviour unchanged
  (its 29 tests pass).
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

## Rejected

- A wrapper statusline that runs the person's own one and records ours on the
  side: transparent in theory, but it rewrites their setting and becomes ours
  to keep working. Not for a first cut.
- Capturing from the report hook: the hook payload has no weekly figure.

## Weakest premise

The field is present on the measured Claude Code build only; another build
could rename it. Then nothing is written, and the account falls back to the
token slider, which is the safe direction.

## Tests

`engine/allowance.test.js` (12). The script runs the way Claude Code runs it,
fed the measured payload shape. Mutations shown red: always rewriting the
reading, clobbering a foreign statusline, and trusting a week that already reset.
