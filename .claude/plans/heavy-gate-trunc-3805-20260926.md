# heavy-gate-trunc-3805: cut long command lines in heavy-gate's verdict lines

Addresses #3805. Liu Kang's review of #4099 (m1191, 2026-09-26): one "ignore ... mentions the
name" line printed a mention-only shell's whole command line, several thousand characters, which
floods logs. His ask: about 160 characters with an ellipsis. Non-blocking, so #4099 merged as
approved and this follows it.

## Finished means
Every verdict line (ignore and COUNTS) shows at most 160 characters of the command, then `...`.
The verdict itself is unchanged: classification still reads the whole command.

## Decisions
- All four verdict lines are cut, not only "mentions": a counted or fixture line can carry the
  same long command.
- `...` (ASCII), not a Unicode ellipsis: the output goes to logs and terminals of any locale.
- Only the printed copy (`show`) is cut. Cutting `cmd` would push a script path past the cut and
  turn a real run into a mention, a wrong CLEAR.

## Check
Two tests in `tools.heavy-gate-3805.test.js`, with controls. Mutation-checked: with the limit
raised to 100000 both fail; with classification reading the cut copy, the past-160 real-run test
fails.

## Weakest part
The cut is by character count under the shell's locale; a multibyte command in a C locale is cut
by bytes and may end mid-character. It only affects the printed line.
