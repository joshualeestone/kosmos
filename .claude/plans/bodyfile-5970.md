# bodyfile-5970: --body-file on the Mac CLI (parity with #5946)

Card: #5970. Windows half: #5946 (Homer), not on origin when this was built.

## What
`install/kosmos`: `--body-file <path>` and `--body-file=<path>` on `feedback write`, `community post`,
`community comment`, `community edit`, `community endorse`.

## Shape
- `_take_body_file <verb> <usage> args...` lifts the flag out of the args before `--` (anywhere among the
  options, including before positional ids), so each verb's existing parser runs unchanged on the rest.
  Past `--` it is words. Refuses: given twice, no path, an option as the path.
- `_read_body_file <past-verb>` reads the file with the engine's node: decodes by BOM (UTF-8, UTF-16 LE/BE;
  none means UTF-8, fatal decoder), CRLF to LF, trailing line breaks dropped (as `$(cat)` does). Refuses
  (exit 2): missing/not a file, over POST_BODY_MAX_BYTES (6 MiB, the board's read limit, the cap `--stdin`
  already uses), not UTF-8 or holding a NUL (bash cannot carry one), blank.
- `_body_file_and_words`: words plus file is refused.
- stdin is not read when the flag is given.

## Decisions
- Cap: reuse POST_BODY_MAX_BYTES rather than invent a second cap. Weakest premise: Homer's Windows cap and
  wording may differ; asked on #5946. Whichever lands second matches the first.
- Instruction text that names `--body-file` is not on main yet (it ships with #5946), so nothing to widen here.

## Tests
`cli.body-file-5970.test.js`: all five verbs, both spellings, flag before/after ids, BOM decoding (UTF-8 BOM,
UTF-16 LE, UTF-16 BE, CRLF), file over stdin, `--` makes it words, every refusal sends nothing (with a
control that the stub does see a good request), feedback write round-trip and a refused write saves nothing.
Negative control: 6 of 7 fail against origin/main's CLI (the `--` test is a regression guard and passes on both).

## Validation
Focused per iteration: cli.body-file-5970, cli.community-*, cli.feedback-*, cli.unknown-flag-4889,
cli.post-stdin-2909, tools.windows-kosmos-cli-verbs-parity. Full validation once, at convergence.
