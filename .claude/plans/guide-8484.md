# guide-8484: the setup guide is adopted when it is already there, and a held name says how to free it (kosmos#8484)

Found while building #8466. Kosmos seeds one setup guide ("Josh", falling back to "Josh AI"), and the seeded flag
was the only thing saying one exists. The card lists five states that duplicate the guide or stop it for good.

## What finished looks like
On macOS and Linux (the logic is platform-free; the job look is create.hasJob):
- a guide Kosmos already made, under either name, is found before any create and never made a second time;
- a guide whose marker was never written is recognised only by its own newest birth line with the profile's id;
- no seeded flag is written for a guide with no startup job;
- a guide name held by a leftover (folder only, job only, removed list) gets a sentence saying how to free it, not
  "Try again in a moment".

## Change
- engine/setup-assistant.js
  - `existingGuide(shown, deps)`, a read: the folder must exist; then the marker, or the NEWEST created/partial birth
    line for the machine name that is create.isAutoGuideBirth and whose id equals the profile id. Returns
    { name, job: 'yes' | 'no' (proven) | 'unknown', byBirth }.
  - `adoptExisting(deps)`, both names: on the removed list, no adoption and no second guide (a sentence to put it
    back); job 'yes', adopted (and the marker written when it was known by its birth line); job 'no', no flag, no
    second guide, a sentence to clear it; job 'unknown', state 'unclear', nothing made and nothing advised.
  - `finishAdoptedGuide`: refreshGuideGuards (also run at every board start) and the picture only when there is none.
  - `seedSetupAssistant` asks adoptExisting before any create.
  - `heldSentence`: for create's leftover refusals (folder only; job only with no folder, both platform forms;
    removed list), a sentence without "Pick another name". The removed-list form names only deleting, since putting
    the agent back keeps the name taken. create's "removing it did not work. Pick another name for now." is left as it
    was (null): nothing here can free that name.
  - `ensureGuide` asks adoptExisting BEFORE the paid live model check; an adopted guide's flag names it with
    `adopted: true` and no provider. A held name, a removed guide, or an unchecked job stops at the first model.
    `because` is carried on the refusal.
  - Test seams `deps.jobPresence` and `deps.birthLog` (tests only).
- engine/create.js: exports `isAutoGuideBirth`.
- server.js: the Settings ON reply passes `guide.because` when the refusal carries one; web/index.html already shows
  `made.because` for a `refused` state, and its own sentence for `unclear`, so the page needs no change.

## Decided, and what was rejected
- State 3 (half-made) is worded, not adopted: every partial create rolls back and writes no profile, so a half-made
  guide comes only from a board that stopped mid-create, with no marker and no birth line, and nothing proves it is
  the guide's.
- State 4 (both names held), live since #8466 (merged 19:32 11-12, PR #8486, this branch rebased on it): on Windows a
  leftover Scheduled Task with no folder now holds a name and the seed moves past it, so a leftover task under Josh
  and a real Josh AI read as names-taken ("Two of your agents", false); and on Windows a real Josh with a folder
  stops the loop at the first name, which the old sentence match also read as names-taken. Now names-taken is set
  by the seed itself (seed.namesTaken) only when BOTH names were refused as real agents; a leftover holding either name
  gets its how-to-free sentence instead (the last name's, else the first leftover moved past). The Windows task forms
  of create.win32HeldTaskWords are rewritten too; its "an agent called Josh is running" form is a real agent and keeps
  its old wording. No new guide state: the collector's list is fixed (chaoskosmos-site), and names-taken keeps its
  meaning, now true.
- Rejected: moving on to "Josh AI" past a leftover folder or job on macOS and Linux (a behaviour change not asked
  for; #8466 keeps "a folder present stops" on Windows).

## Weakest premise
The page sentence depends on create's refusal wording. The tests call the real create under dry run, so a change to
that wording turns them red.

## Tests
- engine/setup-assistant.adopt-8484.test.js (24): adopt by marker; flag record; adopt before any live check, guards
  re-applied; by birth line; newest line only; id mismatch, no id, partial; job proven gone; job unknown or unreadable
  (unclear, no advice); removed guide; fallback name; no folder; held folder, held job and removed list with the real
  create; the Linux command form; other refusals unchanged, including "Pick another name for now".
- server.asbrow-4405.test.js: Settings ON with a leftover josh folder replies refused with the sentence, no flag, no
  josh-ai.
- Controls: adoption off turns 7 of 8 red; the sentence off turns the held tests red; the server pass-through off
  turns the end-to-end red; the removed check off turns the removed-guide test red.

#### Iteration 1 (sonnet)
- WARNING: a job look that FAILED (jobPresence 'unknown') read as "no job", so a working guide got "delete what was
  left of it". Fixed: the job is 'yes' / 'no' (proven) / 'unknown'; unknown makes nothing, advises nothing, and is
  looked at again next time. Test: unknown and a throwing look.
- WARNING: an adopted guide may never have had its post-create steps (the board can stop after the create).
  Fixed: finishAdoptedGuide runs refreshGuideGuards (what the board also runs at every start) and copies the picture
  only when the guide has none. Test: the guards file appears on adoption.
- WARNING: adoption waited behind the paid live model check. Fixed: ensureGuide asks adoptExisting first; a guide
  on disk is adopted, or stops the seed, with no live check. Tests assert zero checks.
- NITs fixed: the seed's docblock sits above the seed again; the two stop comments merged; the removed-list arm is
  now tested with the real create and a real removal. Its sentence also read as a comma splice and every arm
  repeated "which frees the name" after "To free it"; both fixed, and the Linux command form reads "To free it, run:".

#### Iteration 2 (opus)
- WARNING: a removed guide (its plist stays on disk) with no flag was adopted and reported set up, then not found.
  Fixed: adoptExisting checks the removed list first; no adoption, no second guide, a sentence to put it back.
- WARNING: the job pattern also matched create's "removing it did not work. Pick another name for now.", which no
  rewrite fixes. Fixed: the pattern is the no-folder form only; that refusal keeps its old wording. Test added.
- WARNING: the removed-list sentence offered putting the agent back, which keeps the name taken. Fixed: its own
  sentence, deleting only.
- NITs fixed: an unchecked job answers 'unclear' (the page's could-not-tell sentence); the marker is written by
  adoptExisting only when it adopts; a test title. NIT left: existingGuide reads the whole birth log when a folder
  under a guide name has no marker, once a minute on the sweep; it is one file read and was judged cheap.
- CONVENTION fixed: this plan's Change and Tests now match the code.
- Found while fixing: a cleanup called remove.forget, which does not exist (the try swallowed it), so a removal
  leaked into later tests. The tests now clear the removed list in clean(). The same call sits in an older #7825 test
  (engine/delete-leftover.test.js); left alone, outside this branch.

#### Final validation 1 (after iteration 3 converged): 28925 tests, 2 failed, both guards on this branch
- [BLOCKER] final-validation: engine.reachable.test.js, heldSentenceForTests exported and reachable from nowhere.
  Fixed: excused as a test seam with its reason, as its neighbours are.
- [BLOCKER] final-validation: engine/windows-tests-1777.test.js, the new test file branched on a win32 host and
  nothing runs it on Windows. Fixed: the one Windows branch is now skipOnWin32 with the kosmos#8378 exception reason
  (what it checks exists on Windows), and the file is in HOST_BRANCH_EXCLUDED, so it does not run on Windows.
  (The reason first named #8466 as owing the arm; after the rebase it names this card, see below.)

#### Iteration 3 (sonnet)
- WARNING, DEFERRED: a removed guide with no flag is refused every sweep with no back-off, and "Put it back" might
  need the flag. Read: the refusal is a few file reads; "Show removed agents" lists it without the flag (the board
  hides the guide row only by the flag's name, guideMarkName), and once put back the next sweep adopts it.
- NIT: a literal em dash in a negative test assertion. NIT: the birth-log read (as iteration 2).

#### Iteration 4 (opus)
- WARNING: a removed-list check that failed counted as "removed", so a possibly healthy guide got "put it back"
  advice. Fixed: the removed state is yes / no / unknown from remove.removedNames (isRemoved reads an unreadable list
  as empty, which would have said "not removed"); unknown answers 'unclear' with no advice. Test with an unreadable
  list, and a control that it is unreadable.
- WARNING: the loop answered for the first name with any guide, so a broken Josh hid a working Josh AI. Fixed: both
  names are looked at, a healthy one is adopted first, and only then is the first name's answer given. Test, with a
  control.
- NITs fixed: ensureGuide's docblock names 'unclear' (worded by the page, not recorded by guidestate) and the new test
  seams; its adoption path returns finishAdoptedGuide's avatarCopied; the test spells the em dash as an escape; the sentences say
  "To free the name" (no "it" meaning two things).

#### Iteration 5 (sonnet)
- No BLOCKERs, WARNINGs or CONVENTIONs. NIT fixed: this plan had a literal em dash (written by a shell that expanded
  an escape). NITs left: the birth-log read and the dependence on create's wording, both named above.
- Converged.

#### Rebase on #8466 (PR #8486), then state 4
- The branch was applied onto main as one change (the iteration commits all touched the seed's signature, which
  #8466 also changed); the one conflict, the signature, keeps both `platform` (#8466) and `deps` (this card).
- State 4 built as above. Tests: a Windows leftover task under Josh plus a real Josh AI (real create.win32HeldTaskWords
  words, the platform seam, any host); two real agents still names-taken (control) and one real Windows Josh is not;
  the "free this one" form; the running-agent form left alone. Controls: both rules reverted turn both tests red.
- The Windows skip reason no longer says "until #8466 lands": the Windows sentences are pinned here through the
  platform seam; running the real-create job arm against a real Scheduled Task is owed on this card.
- Final validation 2 (before the rebase) had 1 failure in 28927, a #6668 watchdog test unrelated to this branch; the
  whole suite run twice more passed 28438 with 0 failures.

#### Iteration 6 (opus, after the rebase and state 4)
- No BLOCKERs, WARNINGs or CONVENTIONs. Converged.
- NITs fixed: the existingGuide comment says partial lines count and can only block; this plan's older #8466 lines.
- NITs left, carried to the card as follow-ups: three more create refusals that never clear by waiting (a startup
  file Kosmos did not make, systemd still running it, a job with nothing else left) still show "Try again in a
  moment"; the profile read when no line matched, and the second adoptExisting inside the seed; the page's unclear
  sentence names only Josh when the guide in doubt is Josh AI.

#### PR #8487 CI, first run: one red, the #6668 watchdog test (tools.run-tests-file-timeout-6668.test.js)
- Green alone 4 of 4 and green on main's runs at the same base; not this branch. Pushed fresh (empty commit), per
  the re-run rule. Second run: Windows red on #8466's test "a healthy guide under the first name with no seeded flag
  gets no second guide beside it": it pinned one refused create of Josh, and the guide is now ADOPTED with no create
  tried. Its assertion now pins adoption (no create, seeded and adopted under the first name, still no second folder).

#### Iteration 7 (sonnet)
- WARNING: on Windows one real agent called Josh stops the seed at the first name (#8466); with names-taken now only
  for two real agents, that case fell to "Try again in a moment" and a paid live check on the back-off, hourly at
  most, for as long as the board runs. Fixed: the seed answers heldByAgent with a true sentence ("one of your agents is
  already called Josh. Rename it, restart Kosmos, then choose Set it up now."), and ensureGuide holds it for the
  process as it holds names-taken. A tests-only deps.platform reaches the seed's #8466 seam from ensureGuide. Tests:
  the sentence, no second create or live check (explicit too), a Mac control.
- WARNING: the first leftover's sentence was given whatever the last name's refusal was. Fixed: only when the last
  name was refused as a real agent. Test.
- NITs left: the link-that-leads-nowhere Windows form has no test of its own (it degrades to the old wording); a
  birth-line adoption writes the marker the page route trusts, on createdBy/role/purpose plus the newest-line and
  profile-id checks; a guide with no job found only inside the seed counts as a failure for the back-off.

#### Iteration 8 (opus, the whole branch, the last round the 8-round cap allows)
- WARNING: a guide known only by its birth line was adopted even when its marker would not write; the board then
  does not treat the folder as the guide (no guards at start, the page route refuses it), and the flag stops any
  further seed, for good. Fixed: an unwritten marker answers 'unclear', no flag. Test (a read-only folder), control.
- NITs fixed: the seed's docblock lists what it now returns; a pointless shownOf; ensureGuide keeps 'unclear' when
  the seed itself finds an unchecked guide (a race).
- NITs left: heldByAgent is answered before the off switch, as namesTaken is; a Windows "an agent called X is
  running" pair has no sentence of its own; a person's own setup-role Josh with no flag is adopted, as the board
  already treats a marked folder.
- The cap is reached, so this loop stops here unconverged: round 8 found a WARNING, fixed and tested, and no round
  has looked at that fix.
