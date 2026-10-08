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

## Review round 2 (sonnet): 3 BLOCKERs, 3 WARNINGs, fixed by closing the CLASS
- **The three BLOCKERs were one class: the scan read a different view of the bytes than the one stored.** A UTF-32LE BOM read as UTF-16, a false BOM in front of ASCII, and NUL-interleaved text after the first 8 KiB each stored a key readable. **Fix: a FINAL raw check on the bytes about to be stored, whatever path produced them** (as Latin-1, and with NULs removed). Anything key-shaped left, or a withheld scan, skips the file. Tested with all three shapes and a no-key control.
- **Magic false positives** (`x^2`, `BZhello`, `PACKAGE`, `PK `) are gone: zip needs its full signatures, bzip2 its block magic, a git pack its version, and zlib and lzma (weak magic) count only on a file that is binary anyway. **Added** lz4, rar, compress (.Z), the zip central directory, lzma, and a zip appended after a stub. Each is tested, with ordinary-text controls.
- **Deny-list:** tfvars, .terraformrc, .dockercfg, .my.cnf, service-account JSON, *.secret, *.token, authorized_keys, 1Password and doctl config, Firefox logins/key4/cookies, shell histories. **Templates** (`.example`, `.sample`, `.template`, `.dist`) are kept, and their content is still scanned (tested with a real key in a template).
- **Test vacuity:** the NUL-split fixture now NUL-separates every character, so removing the NUL-stripped scan goes red. xz, zstd and 7z each have a case.

## Review round 3 (opus): no BLOCKER, 2 WARNINGs, 1 CONVENTION, fixed
- **The placeholder mapping opened a hole.** secretmask trusts a value starting with its placeholder, so content like `password=••••Hunter2…` hid a password (measured in a binary). Now a text that already holds `••••` is skipped before masking, the mapping applies only to our own masked text output, and binaries are never mapped. Tested: the binary and text forms, with a bullet-list control and a URL control (our own placeholder still passes).
- **Real images and libraries were over-skipped** (11 of 151 real HEIC, ICNS and Mach-O files fired on structured data). Binaries are now scanned on their printable runs (8+ printable bytes, as strings(1)) from the raw and NUL-stripped views. A private-key opening anywhere in the raw views still skips. The test runs this Mac's own wallpapers, icons and dyld (each must be kept) and a PNG with a token in a text chunk (must skip).
- **CONVENTION, a test title claimed a withheld case it lacked:** a withheld binary scan, and a lone private-key opening inside UTF-32, are now tested.
- **NIT, Latin-1 text** (invalid UTF-8, no NULs) is decoded as Latin-1 and redacted in place (Latin-1 round-trips every byte), rather than skipped whole.
- **While fixing the over-skip, two more measured causes on this Mac's own Sonoma.heic:** the XMP packet id `W5M0MpCehiHzreSzNTczkc9d` (a fixed public constant in nearly every image or PDF with metadata), now removed before scanning; and a base64 binary plist in Apple's desktop metadata. **Decision: inside a binary, the generic high-entropy kind (`long_token`) is ignored**, while every specific detector still counts (provider keys, JWTs, URL credentials, assigned secrets, private keys, the board's held values). Rejected: allowlisting metadata fields one by one (endless), and private-key plus held-value checks only (that would drop provider-key detection in binaries). Weakest premise: a shapeless secret inside a binary that the board does not hold now passes, the same limit the text path has.
- **The Latin-1 path needs real text** (no NUL, under 0.1% control bytes). Without that check a NUL-free binary was redacted in place, which corrupts it; now such a file stays binary and a key in it skips it.
- Mutations, each red then restored: the binary placeholder rule, `long_token` counted in binaries, the loosened Latin-1 check.

## Review round 4 (sonnet): no BLOCKER, 3 WARNINGs and untested guards, fixed
- **Generic kinds ignored only for media and fonts** (PNG, JPEG, GIF, WebP, TIFF, ISO-BMFF/HEIC, ICNS, PDF, Mach-O, sfnt/WOFF, by magic): long_token (base64 metadata) and url_credential (glyph-name noise, measured in this Mac's fonts). Any other binary counts them, since Azure and SendGrid keys fire only as long_token. Tested with an Azure-style key in a SQLite file.
- **A key split by one control byte** in a non-media binary: a third view deletes every non-printable byte (not for media, where it would stitch noise together). Tested with `sk-ant-` then \x01 then the rest. **Weakest premise:** a key split that way inside a media file still passes, the residual of not reading noise as text.
- **Latin-1 redaction** wrote `"` for the U+2022 marker; it now writes `*`.
- **Guards with no test:** each now has one (XMP-only metadata kept, a UTF-16 key inside a binary skipped, a lone key opening skipped, a NUL keeping text on the binary path). The binary withheld check is labelled defence in depth (a withheld search also fires a counted kind).
- **Corrected in flight: the XMP packet id was never the cause.** Round 3's diagnosis printed the first run that changed under masking, and that run held both the XMP id and, further along, the base64 binary plist. The plist fired; the id alone fires nothing (measured). The `PUBLIC_CONSTANTS` removal guarded nothing, so it is gone. Round 4's mutation of it caught nothing, and that is how this was found.

## Review round 5 (opus): no BLOCKER, 2 WARNINGs, 1 CONVENTION, fixed
- **Over-skipping is fine** on a broad sample: 11 of 6,515 worktree files, each for a stated reason. System binary plists are skipped as accepted.
- **Exemptions are per format** (images and Mach-O ignore only long_token; fonts also url_credential), so a database URL compiled into a Mach-O is caught (url_credential fires on 3 of 1,377 Mach-O files). **Magics checked strictly** (PNG needs IHDR, a font a sane table count, ISO media a known image brand), so a store prefixed with a bare magic is not media. **Residual, stated:** a long_token-only key compiled into a Mach-O, or a store crafted with full media headers, passes. The threat model is accidental secrets, not a user hiding them.
- **Media-only guards tested** (a PNG hiding a password behind the placeholder; a PNG with a UTF-16 key), with a clean-PNG control.
- **Compressed fixtures** for lzma, zip 0708 and a zip end record after a stub, each with a deflated key behind it; `BZh9hello` is the block-magic control.
- **The fail-closed catch is tested** with a Buffer whose toString throws. The KEY_OPEN binary checks are labelled defence in depth.

## Review round 6 (sonnet): no BLOCKER, 1 WARNING (lost work), untested guards, fixed
- **Audio was over-skipped** (10 of 17 real system sounds: AIFF, WAV, CAF; sample data fires long_token). An `audio` kind with strict magics (FORM+AIFF/AIFC, RIFF+WAVE, caff, ID3, ftyp with M4A/M4V/mp41/mp42/isom/qt) ignores only long_token. Tested on this Mac's real /System/Library/Sounds, with a provider key inside a WAV still caught.
- **Untested guards now tested:** an ftyp with a non-media brand is not media (with heic and M4A controls); each font magic (wOF2, ttcf, true, OTTO) keeps long_token- and url_credential-shaped glyph data; the same url_credential in a non-font binary counts (the font-only exemption's control).
- **Residuals stated in the code:** a url_credential inside a font, and a Java .class (which shares the Mach-O fat magic cafebabe) carrying a long_token-only key, pass. A negative control "a real URL password in a font must skip" cannot exist alongside the exemption, so it is a stated residual instead.
