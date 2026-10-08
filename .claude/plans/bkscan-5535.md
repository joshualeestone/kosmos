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

## Review round 1 (opus): 3 BLOCKERs, 4 WARNINGs, all fixed
- **BLOCKER, UTF-16 text passed with the key readable.** Its NULs made it "binary", and a Latin-1 scan cannot see `s\0k\0-`. UTF-16 (BOM, or every other byte NUL) is now decoded, scanned as text, and written back in its own encoding (BOM and endianness kept). Binaries are also scanned with NULs stripped. Mutation: removing the UTF-16 path goes red.
- **BLOCKER, compressed bytes were scanned blind** (.docx/.xlsx, git objects and packs, PDF Flate streams, browser stores). `.git/` is denied whole, zip-container extensions and browser profile stores are denied, and **compressed magic** (zip, gzip, zlib, bzip2, xz, zstd, 7z, a git pack, a PDF with FlateDecode) is skipped whatever the name. Mutation: removing the magic check goes red.
- **BLOCKER, the line-by-line fallback lost secretmask's detection of a held value split across lines.** **Decision: no fallback at all; a withheld whole-text scan skips the file.** Rejected: line-by-line (the review measured it miss split values) and overlapping windows (built and measured: about 12 ms per window, so 25 s for one 16,000-line file, and windows holding the near-match rows still could not be mapped back, so they skipped anyway). Withholding needs held secrets plus text dense with near-matches; 20,000 lines of plain prose are checked whole (a test control). **Weakest premise:** that real transcripts rarely withhold. When one does, it is skipped by name and counted, never stored unchecked.
- **WARNING, PGP armored keys** (and PuTTY): `PRIVATE KEY( BLOCK)?` in both key patterns, and a PuTTY header skips the file. Mutation: reverting goes red. (secretmask's own PEM pattern has the same PGP gap; worth a follow-up there.)
- **WARNING, the deny-list:** added .envrc, *.env, Terraform state, client_secret JSON, .git/ (whole), .yarnrc.yml, kubeconfig, .vault-token, .boto, .s3cfg, rclone, .m2, pip.conf, .p8, browser stores, zip containers. Credential-named files now match only config-like extensions, so `src/auth.ts`, `pkg/auth.go`, `src/tokens.ts` and `styles/tokens.css` are kept (controls).
- **WARNING, redaction rewrote more than the secret** (BOM, zero-width joiners, soft hyphens, and secretmask's split-key logic taking the next word and line break). Stated in the header as a KNOWN, TESTED LOSS; a test pins it, so a change shows up. A file where nothing fires keeps every byte (a control).
- **NITs:** `..notes.md` at the root is no longer refused by the real-path check; the redundant binary withheld check is kept and exercised by the NUL-stripped scan.
