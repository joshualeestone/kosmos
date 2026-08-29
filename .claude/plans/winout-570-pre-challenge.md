---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: winout-570
diff_hash: 28e9a46ec7d23b6a43053cb4847880f5cf80132428725dfec0873219f08b609e
subdir_audit: passed
timestamp: 2026-08-29T20:15:12Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458. Renet ran
the board on **Windows Server 2022** an hour ago and it served: `GET /` 200,
1,958,636 bytes, title Kosmos; `/api/projects` 200; `/api/status` 500, no tmux,
correct. **That answers "does it come online" and it is not my measurement.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THE `!` PREFIX IS A GUESS ABOUT EXPLORER, NOT A MEASUREMENT.** I
  verified it sorts first with a shell sort, which is ASCII. **Windows Explorer
  does not sort with `strcmp`** and its default is a natural sort with its own
  rules for punctuation. It very probably still comes first; **I cannot prove it
  from here and nobody should read the test as proof of Explorer's behaviour.**
- **[WARNING] THE MARK-OF-THE-WEB PARAGRAPH IS PRECAUTIONARY.** Nobody has seen
  that dialog on this package. It costs four lines to cover and its absence
  costs somebody a dead end, **but I am not claiming it happens.**
- **[WARNING] A FILENAME WITH A LEADING `!` AND SPACES** is now asserted by the
  build. Any future script globbing the package root has to quote it.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0 on the diff, planted control 1.
- **[CONVENTION]** No closing keyword.

### NITs

- **[NIT]** The README is now 20 lines where it was 16. On a screen a person
  scans in three seconds, more text is a real cost. **The first five lines carry
  the whole message**, which is the reason it is ordered the way it is.

### Attacked and CLEARED

- **THE OUTDIR BUG WAS FOUND BY USING THE BUILDER, NOT BY REVIEW**, and its
  symptom was a false **CORRUPTED RUNTIME** report. **A wrong location surfaced
  as a wrong checksum**, which is about as far from the cause as a symptom gets.
  **Both arms controlled:** absolute lands where asked, relative stays
  repo-relative and `dist` is unchanged.
- **⭐ MY OWN COMMENT CONTRADICTED MY OWN OUTPUT.** I wrote that
  `READ ME FIRST...` "sorts above Kosmos.cmd" and it does not, because `K` < `R`.
  **I found it by printing the sorted listing rather than re-reading my sentence.**
- **TWO FREE CHECKS DONE RATHER THAN DEFERRED TO THE BOX:** `node.exe` is
  byte-identical to nodejs.org's after the round trip (control: a truncated copy
  differs), and every line of every shipped text file is CRLF (control: an LF
  file reads 0). **Renet reached the CRLF result independently on the same
  artifact with his own control.**
- **PERTURBED FIVE ARMS**, each failing its own test.
- **Suite 2995 pass, 0 fail.**

### The reason the filename change is not cosmetic

**The dialog's only visible button is "Don't run", and the way past is behind
"More info", which does not look like a button.** If she stops there, **the
installer never runs and we learn nothing about it.** The information existed in
a README she had no reason to open, at a moment she could not read it.
