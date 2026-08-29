---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: 2fa-copy-1415
diff_hash: ceddd7d0bec3676371463fa7db03017ac011ace6511b405c1f3af7c461adbaba
subdir_audit: passed
timestamp: 2026-08-29T19:19:55Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24, push as ready). Bracketed markers because
the template's own heading is refused by this gate, my #1458. **Copy only. No
mechanism touched, which was the stated scope.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] I AM NOT THE OWNER OF THIS LANE OR THIS VOICE.** The original words
  are Ice Cream Kitty's and the file says Mona Lisa may replace them. **I fixed a
  false claim, not the phrasing**, and the guard pins the CLAIM so a rewrite does
  not have to touch it. If either of them wants different sentences, nothing here
  is in the way.
- **[WARNING] THE RULING NAMES AN AUTHENTICATOR APP THAT DOES NOT EXIST.** Zero
  hits for `authenticator` and `TOTP` across the page, the server and the engine.
  **That is a real gap between what Josh described and what ships**, and it is a
  mechanism question, not a copy one. Not carded by me because I do not know
  whether it is planned; **somebody should ask him rather than infer.**
- **[WARNING] NOBODY HAS LOOKED AT THE SCREEN.** These are source assertions on
  rendered copy. The sentences are in the file a user is served; whether they
  render where I think they do is not proven here.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0 on the diff, planted control 1.
- **[CONVENTION]** No closing keyword.

### NITs

- **[NIT]** The device-list line now says "another device", which is broader than
  the old "a phone" and slightly vaguer. It is true, which the old one was not.

### Attacked and CLEARED

- **PERTURBED FOUR ARMS**, each failing its own test. Restores sha-verified.
- **GREPPED THE TEST TREE BEFORE ASSUMING NOTHING ASSERTED THE OLD COPY**, with a
  control: 0 tests match the old phrase, 3 name `plus-second`, so the tree was
  read. **Nothing was pinning the false sentence**, which is the one way a copy
  fix turns a suite red for the author of the next change.
- **⭐ THE DETECTOR MATCHED ITS OWN DESCRIPTION, AND THE TEST CAUGHT IT.** My
  comment explaining why the copy does NOT promise an authenticator app contains
  `authenticator` and `TOTP`, so the check found its own explanation and failed.
  Comments are stripped before every assertion now.
- **⭐⭐ AND A SILENT ONE THE CONTROL CAUGHT: SLICING FORWARD FROM AN `id` STARTS
  INSIDE THE TAG.** `plus-devempty` is a `<p>` whose opening tag is BEHIND the
  id, so my paragraph scan found no `<p` and picked up the NEXT element, which is
  an empty message paragraph. **Every assertion would have run against `""` and
  passed.** ⇒ **Three of my four assertions are absence assertions, and an empty
  string satisfies all of them.** Without the control this file would have been a
  guard that could never fail.
- **THE ABSENCE ASSERTION HAS AN EXPIRY WRITTEN INTO IT.** The authenticator test
  goes red when somebody builds one, and its message says to delete it rather
  than work around it, so it cannot become a check defending a stale state.
- **Suite 2969 pass, 0 fail.**
