---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: winpkg-570
diff_hash: 62c9ed50f4656032253a2b8af1c2d41bd71434cfd76f4319dd05cb41e95640d8
subdir_audit: passed
timestamp: 2026-08-29T19:51:14Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. **This is
the deliverable Josh asked for by name this afternoon.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] NOBODY HAS RUN IT ON WINDOWS, AND THAT IS THE ENTIRE POINT OF THE
  ARTIFACT.** I built the zip and read its bytes. **A zip that stages correctly
  and does not launch is indistinguishable from this one, from here.** The two
  likeliest first-contact failures, named so somebody checks them first: the
  launcher's quoting, and whether `APPDATA` is populated in the environment a
  double-click inherits.
- **[WARNING] NO UPDATE PATH.** The Mac ships `install/setup.sh`; there is no
  Windows equivalent, so a person updates by downloading the zip again. **Fine
  for an unsigned preview somebody tries once. Not fine behind a Download for
  Windows button**, and it will not announce itself as a gap.
- **[WARNING] `timeout /t 3` IS A GUESS.** Three seconds is the browser delay and
  I have no measurement of how long the board takes to bind on a cold Windows
  start. **If it is slower, the first page load fails** and the person is left
  with the printed URL, which is why the URL is printed.
- **[WARNING] 35 MB, MOSTLY `node.exe`.** Acceptable, and worth knowing before
  somebody puts it behind a link.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0 on the diff, planted control 1.
- **[CONVENTION]** No closing keyword. #570 is the whole Windows card.
- **[CONVENTION]** `dist/` is gitignored, so the artifact is not committed.

### NITs

- **[NIT]** The builder duplicates the Mac's version-baking block rather than
  sharing it. Extracting it would mean editing the Mac release path, which I am
  not doing on a Saturday during a live release cadence. **The drift test covers
  the file list, not this block.**

### Attacked and CLEARED

- **I RAN IT, WHICH IS MOST OF THE VERIFICATION AVAILABLE FROM HERE**, and that
  is what found the three real defects. **None of them would have survived a
  Windows run; all three would have cost somebody their first impression.**
- **THE PORT WAS WRONG AND I TYPED IT.** 4319 against a real default of 16180.
  Now read from `server.js` with a build failure if unreadable.
- **THE BROWSER OPENED BEFORE THE SERVER.**
- **MY OWN ASSERTION REPORTED A GOOD BUILD AS BROKEN** (pipefail + `grep -q` +
  SIGPIPE), and **it only bit on early matches**, so four of six entries passed
  and it looked reliable.
- **PERTURBED SIX ARMS**, each failing its own test, including "stop staging the
  codex bridge", which is #731 exactly.
- **THE DRIFT SCAN WAS WRONG TWICE, IN OPPOSITE DIRECTIONS**, and the second was
  the dangerous kind: hiding `package.json` in BOTH builders is symmetric, so the
  comparison still passed while not covering a file it names.
- **THE STALE-REASON CHECK DELETED TWO OF MY OWN ENTRIES.** They described
  differences that do not exist, because those files stage to `$STAGE/bin`.
- **THE PACKAGE IS HONEST ABOUT ITSELF**, asserted: README warns about the
  unsigned prompt AND that agents do not work; manifest records `signed:false`
  and `agents_supported:false`.
- **Suite 2987 pass, 0 fail.**
