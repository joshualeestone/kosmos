# bkscan-5535: E0.6 (#5535) slice 3, first pure part: what may leave the Mac in a backup

## Why
Design v2 / v2.1 on #5535: a backup never carries credentials, enforced twice (path and content), and **redacts in place rather than dropping**, so a transcript with one pasted token keeps everything but the token. **Fail closed:** a file that cannot be checked is skipped and recorded, never stored unchecked. No I/O and no dependency on E0.1 / E0.2. The slice-3 walker will call it.

## Change: `engine/backupscan.js`
- **By path:** a case-insensitive deny-list on the forward-slash relative path:
  - env files; keys and keystores; ssh keys; credential folders (.ssh, .gnupg, .aws, .kube, .docker); .netrc, .npmrc, .pypirc, .git-credentials, .pgpass;
  - `.git/config` (remote URLs carry tokens); gh, gcloud and hub config; provider sign-ins (Claude, Codex, Gemini, Grok);
  - credential-named files; any `secrets/` folder;
  - **compressed archives** (their contents cannot be scanned).
  - Absolute paths, `..`, NUL and empty paths are refused.
- **By content** (`scanFile`), reusing **engine/secretmask.js**, the hardened detector the setup guide relies on, never a second pattern set:
  - Text: PEM private-key blocks are cut whole first (they span lines; an opening with no END skips the file). Then the whole text is masked. When secretmask withholds it (its known-secret search budget is sized for chat), the text is masked line by line, and a line still withheld skips the file.
  - Binary (a NUL in the first 8 KiB, or not valid UTF-8): stored only if a Latin-1 scan finds nothing; any hit, a PEM opening, or a withheld scan skips it.
  - The result records kinds and counts of what was removed, never values and never positions.
- **By real path** (`insideWorkKosmos`): the walker's check that a resolved path stays inside the work Kosmos. Named so it collides with nothing: `forget.js` already exports an `insideRoot`, and that collision hid the export from the reachability guard (see below).

## Changed from design v2.1, deliberately
v2.1 said redacted spans are "listed by position". This records **kinds and counts only**: a position plus the file is a hint at the value, and restore needs nothing more. The masked text marks each removal in place (`••••`, and a fixed line for a PEM block).

## Tests: `engine/backupscan.test.js` (8, each with a control)
- deny-list (16 skipped, 6 ordinary kept as controls, separators normalized, escapes refused);
- the real-path check (inside, root, a link to ~/.ssh, a same-prefix sibling, unresolved `..`, relative);
- redaction in place, with a clean byte-for-byte control;
- PEM cut whole, and an unterminated one skipped;
- the line-by-line fallback, with **a precondition that the whole text really is withheld** (held secrets plus half-matching rows, the shape secretmask's own budget test uses), and a single withheld line skipped;
- binaries (clean stored; a token in sqlite, a PEM in a blob, non-UTF-8 all skipped);
- the design's case set, each decided:
  - base64 of an unknown key is kept (secretmask masks KNOWN values in any encoding once the walker feeds them);
  - a key split across lines is kept (a known limit of shape matching);
  - a git remote URL token: the config is denied, and in a note the token is masked;
  - archives are skipped;
- junk input never throws and is skipped.

## Caught while building
1. **The first fallback test was vacuous.** Plain filler never makes secretmask withhold, even at 2 MB (measured), so the test passed without reaching the fallback. It now asserts its own precondition. Mutation: removing the fallback reds it.
2. **The reachability guard was fooled twice more**, the #5548 class:
   - the header comment named the exports (use versus mention);
   - and `insideRoot` collides with forget.js's own export, which reads as a caller.
   Both fixed. The guard now flags exactly `insideWorkKosmos` and `scanFile`, which are excused by name. `pathDecision` has a real caller (`scanFile`).

## Checks
backupscan 8/8, backupformat, hpke, **secretmask's own suite**, engine.reachable, and every engine/ and tracked-file walker green.

## Not in scope
Feeding the board's known secrets (the walker calls `setKnownSecrets` from `knownsecrets.collect`); the walk itself and its I/O; a streaming chunker (next part).

## Weakest premise
That secretmask's shape patterns plus known values catch the credentials a work Kosmos holds. A secret with no recognizable shape that is also not one the board holds (a customer's own database password typed into a note) passes, and redaction cannot know it is secret. The deny-list covers files, not words in a note. The consent text should say exactly this.
