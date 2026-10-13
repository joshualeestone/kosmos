# kosmos#6084: kosmos --version prints Unknown

## Change
install/kosmos routes `--version` and `-v` (free) to cmd_version, in an arm of their own: the Windows parity test and
cli.help-lines-4785 read the dispatch with patterns that need a verb name right after two spaces, so a combined
`version|--version|-v)` arm would hide `version` from both. The command list's version row names the flags.

## Decided
- Mac and Linux only. Windows has no `version` verb on purpose (PERSON_ONLY_VERBS in
  tools.windows-kosmos-cli-verbs-parity.test.js: the zip carries the version in manifest.json). The card's five seats
  ran on one Mac (one was Meta Muse, which runs only on a Mac), so no Windows seat met this.

## Evidence
- cli.version-flag-6084: --version and -v print exactly what kosmos version prints (stdout and stderr); control:
  --versio is Unknown, exit 2. Mutant (arm removed) reds the alias test only.
- With cli.version-4892, the parity test and cli.help-lines-4785: 23/23. Shell tests reading install/kosmos
  (help-exit0-3036, installer-runnable-guard, msg-newlines-1927): 0 failures.

## Review
1. opus: no blockers or warnings; the help-line nit taken; the Windows concern answered (above).
