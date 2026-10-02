# cliversion-4892: `kosmos version` says when the command being run is not the installed one

Card: joshualeestone/kosmos#4892 (0.7.15 five-family diagnostic, section 5). A Meta agent ran its own patched copy of
the CLI from /tmp; `kosmos version` printed the current version (it reads the installed app's package.json) while
that copy lacked `project list` and `reply --stdin`.

## Change
install/kosmos cmd_version: after printing the version, if the running script ($SELF, symlinks resolved) differs by
content from the installed `$KOSMOS_HOME/bin/kosmos`, say so on stderr and name the installed command to run.
stdout stays exactly the version.

## Decided, not missed
- Identity by CONTENT (cmp against the installed copy), not a build hash written at build time (the card's
  suggestion): nothing to stamp or keep in step, and it answers the real question (will this copy behave as the
  installed one?). An identical copy elsewhere is not flagged, because it behaves the same.
- stderr, not stdout: nothing in the repo parses `kosmos version`, but a script might; the number stays clean.
- Mac only. kosmos.ps1 (Windows) has its own `version`; Windows CLI behaviour goes to Homer as a spec (Josh,
  09-16), noted on the card.
- Rejected: refusing to run a non-installed copy (it breaks the source checkout and every legitimate dev use).

## Weakest premise
That an agent running a copy has KOSMOS_HOME pointing at the real install (it needs it anyway to find node, or
the command says "Kosmos looks incomplete here"). A copy with no installed command beside its home says nothing.

## Tests
cli.version-4892.test.js (4) runs the real script against a throwaway Kosmos home: the installed command prints only
the version; an identical copy elsewhere is not flagged; a patched copy warns on stderr naming the installed command
while stdout stays the version. Mutation (comparison disabled) reds it.

## Review rounds
- Round 1 (opus): W (no test through a symlink, how every install runs it): ADDED a test through a two-link chain
  (absolute, then relative). Its feared failure cannot happen through this check, measured: with the script's link
  resolution disabled the test stays green, because cmp reads through links and compares the same bytes. So the test
  pins the real-world behaviour (no warning via ~/.local/bin), not the resolution. FIXED NITs: the warning says the
  copy's commands "may not match this version" (a dev checkout can be newer); the identical-copy test checks the
  exit code; the new comment wraps at the file's width. Left NIT: a missing cmp would warn falsely (macOS always has
  /usr/bin/cmp; this file is Mac only).
- Round 2 (sonnet): its W restates the weakest premise above and calls the behaviour correct (DUPLICATE). NITs only
  otherwise (the link test pins behaviour, not resolution, as noted; a missing cmp; say's indent). CONVERGED.

