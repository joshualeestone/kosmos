---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: found-gate-1493
diff_hash: 910f63257cc15830560783f585ae8bfef4208fee76c27c248c887f9423f08e4a
subdir_audit: passed
timestamp: 2026-08-29T19:11:18Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24, push as ready). Bracketed markers because
the template's own heading is refused by this gate, my #1458. **This card has a
clock: Josh's sister is in town and Splinter has told him not to put a build on
her machine until this lands.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] NOBODY HAS OPENED THIS IN A BROWSER.** Every assertion runs the
  real lifted functions against a stub DOM. **That is stronger than a source
  match and it is not a browser**, and this is a first-run screen, which is the
  one screen a person cannot get back to easily if it is wrong.
- **[WARNING] I HAVE NOT PROVEN THIS IS HER CASE.** I have proven that two of the
  three paths never read the disk. **Which path she was on is not recoverable
  from here**, and it needs her machine or her folder. If she was on `create`
  with a genuinely empty `found()`, this changes nothing for her and the loss is
  somewhere I have not looked.
- **[WARNING] THE `adopt` SCREEN NOW HAS TWO ENDINGS** where it had one. Somebody
  with a complete fleet still gets "You already have N agents here"; somebody with
  an agent on disk gets the found list instead. **That is a real change to a
  screen Josh has ruled on twice** (no name chips, the count is the claim), and
  he may want the adopt heading kept above the list rather than replaced.
  ⇒ **Reversible in a commit and I made the call rather than parking the card.**
  What would change my mind: his word.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword. #1493 also carries the silent-drop half
  (the name fallback lead), which this does not touch.

### NITs

- **[NIT]** `frFoundOffer()` is called up to three times in one paint. Each is an
  `Array.filter` over a list that is almost always tiny; caching it would be a
  fourth place for the same fact to live.

### Attacked and CLEARED

- **PERTURBED FIVE ARMS**, each failing its own test. Restores sha-verified.
- **CONTROLS THAT CAN RETURN THE DANGEROUS ANSWER:** every honest empty answer is
  asserted unchanged (adopt-with-nothing, adopt-with-all-held, unknown-with-
  nothing, search-could-not-run). **Without those, "always show the found list"
  would pass every other assertion in the file.**
- **THE UNKNOWN-FLAG DIRECTION IS ITS OWN TEST.** `already !== true` rather than
  `!already`, because `found()` leaves it undefined when the roster could not be
  read, **which is precisely the `unknown` path this card is about.** Treating
  undefined as "already in" would hide every agent in the case that motivated the
  change, and it perturbs red.
- **THE DOUBLE FETCH WAS FOUND BY THE TEST, NOT BY READING.** Moving the search to
  the top left the create arm's own call in place, so it fired twice. The
  generation guard hid it. **Pinned at exactly one.**
- **TWO EXISTING HARNESSES BROKE AND THE FIX WAS ALREADY WRITTEN DOWN.**
  `ReferenceError: frFoundOffer is not defined` in `web.found-undo.test.js` and
  `server.test.js`, **which reads as a product defect and is not one**.
  `test-support/page.js` says why `FOUND_PAINTER_FNS` exists: this happened three
  times in one day when each harness kept its own list. One entry, both fixed.
- **Suite 2965 pass, 0 fail.**

### The measurement that located it

Running the real `frPaintFleet` across every path value:

```
  path=adopt,   agent on disk  ->  "You already have 2 agents here."   NO SEARCH
  path=unknown, agent on disk  ->  "We could not see what is..."       NO SEARCH
```

**Nothing that reads source would have found it**, which the create arm's own
comment already says about the last defect in this same function.
