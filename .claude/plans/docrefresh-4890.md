# docrefresh-4890: a change to the working rules reaches agents that already exist

Card: joshualeestone/kosmos#4890 (Josh's five-family diagnostic, items H9 and N7). Agents described CLI and display
behaviour that had changed (#4627 links, #4582 `reply --stdin`) because their instructions held the old words.

## Cause (measured on main)
- `create.js` wrote the working rules at birth with `defaults.appendTo`: plain text, no managed-span markers.
  `discover.js` did the same for an imported agent.
- `doctrine.planFor` keeps a section current only inside a managed span. Without one it offers only the headings a
  file lacks (`defaults.missingFrom`), by design.
- So a change under an existing heading reached new agents only. Measured on this Mac: 3 of 3 instruction files
  holding the rules were plain; none had a span.

## Change
1. Birth and import write the rules inside the managed span (`doctrine.atBirth`), with a birth version of the dated
   first line. A newborn agent is `current`, and every later version is offered through the existing consented
   refresh. Text that already has the rules is unchanged; text that already holds a doctrine marker gets the plain
   block (no span spliced among markers it did not write).
2. An older agent whose plain copy byte-matches an EARLIER block (fingerprints in `engine/doctrine-past.js`,
   generated from git history by `tools/doctrine-past.js`) is offered the current rules in the same consented
   dialog. The click replaces that copy where it stands, inside the span. The dialog says so (`replacing`).
   A copy the person edited fails the byte match and keeps today's rule (missing headings only).
3. "Send readable messages" said a `[label](address)` link drops the address; since #4627 it shows "label
   (address)". Fixed, doctrine v23 (main took v21 for #4624 and v22 for #4873 while this was in review).

## Decided, not missed
- Nothing is rewritten without the person's click: the ownership rule stands. Birth needs no click because nothing
  of theirs is replaced.
- DECIDED TRADE-OFF (review 4): being born inside the span means an edit a person makes INSIDE the marked block is
  Kosmos's to bring current, as it already was for any span a person clicked into being. The consent dialog now
  says so ("Anything changed inside the marked block is set to the current rules"), and the block's own first line
  has always said "Kosmos may update this block". Their words above and below it are never touched. Rejected:
  never offering an update to an edited span (it would leave every born agent unreachable again after one edit).
- Rejected: matching whole-section text to update edited copies (would rewrite a person's edits); generating the CLI
  section from `--help` (card's other suggestion; a larger change, and this fix makes any future wording change reach
  agents anyway).
- The fingerprint table includes today's block, and a test reds if it does not, so the next version bump must
  regenerate it.

## Weakest premise
That most existing agents carry an unedited copy, of a block that was COMMITTED: the table is built from
engine/defaults.js's git history, so a block that was only ever shipped from an uncommitted tree cannot be matched
(and unreleased intermediate commits add harmless extra rows). Also a copy saved with Windows line endings (CRLF)
never matches the \n-only fingerprints, and neither does a copy followed directly by a `###` heading of the person's
own (indistinguishable from a later block's appended section): nothing is overwritten, each keeps today's
missing-headings rule. 3 of 3 here did (v15 twice, v18 once), a small sample. A person
who edited theirs is offered only missing headings, as before; birth in the span is the lasting fix.

## Tests
engine/doctrine-4890.test.js (31): birth span and current-at-birth; the card's case (a same-heading change reaches an
agent born before it); replace in place with a control; an edited, a one-character-edited and today's copy are not
replaced; marker fallback; the shipped table's pairing guard; server flag and dialog copy. Mutations: dropping the
past-block match, the today's-copy skip, or the line-start check each red a test. create.test.js: the verbatim test
reads the span; #1672 stubs `doctrine.atBirth` (throwing it reds 8 of 214).

## Review rounds
- Round 1 (sonnet): FIXED W: the fleet list sends `replacing` too. FIXED W: the committed-history premise is named
  above. FIXED C: the generator names its test. FIXED NIT: the generator skips a version it cannot load.
- Round 2 (opus): FIXED W: a heading the person also carries outside the old copy is not written twice. FIXED W: the
  match must end at a line end, so words typed onto the copy's last line are an edit. FIXED W: an agent with a span
  AND a plain old copy has the copy folded into the span (the card's failure in one more shape). FIXED W: the
  "edited copy" test now edits the middle, past the anchor. FIXED C: doctrine.js's constraints 6 and 8 and planFor's
  docstring name the #4890 exception. FIXED NIT: the undo note says "replaced" for a replace. Each new guard was
  mutated and reds one test.
- Round 3 (sonnet): FIXED W: earlier rules inside a span no longer hide a plain old copy after it (pastBlockIn skips
  the span). FIXED W: where only the plain block fits under the size cap, birth and import write it plain rather than
  none (the frame costs a few hundred bytes). FIXED W: CRLF copies named in the weakest premise. FIXED NIT: the dialog
  title says "Update" when it replaces. Left NITs: an empty section list in the span-current-plus-copy case; one blank
  line left where a copy is cut; no fleet dialog reads `replacing` yet.
- Round 4 (opus): DECIDED W (above): edits inside a born span; the dialog now says it. FIXED W: the dialog no longer
  says "in the same place" (a copy beside a span folds into it), and a click that only deletes a copy lists the
  sections the file keeps. FIXED W: two copies (two earlier ones, or an earlier one and today's) settle in one click.
  FIXED NIT: the birth line says "set up", true for an imported agent too. Left NITs: one long docstring line; the
  test's temp dir is not removed (as its siblings).
- Round 5 (sonnet): FIXED W (two, both my own dialog sentences, so cut rather than reworded): the replace sentence no
  longer says "inside a marked block" (an earlier copy beside today's plain copy is only cut); the inside-the-block
  sentence shows only when the click rewrites an existing span (`updating`). DEFERRED W: the fleet click can now cut
  a plain copy with no wording for it; no fleet screen exists, the list route sends `replacing`, and the fleet click
  is name-level consent by Mona Lisa's ruling. Whoever builds that screen should read `replacing`.
- Round 6 (opus): FIXED W: an earlier block can be a prefix of a later one (v11 to v14 only appended sections), so a
  match is refused where today's block starts, or where the copy goes on into another `###` section; each rule has
  its own fixture and its own mutation red (the first fixture let one rule mask the other; caught by the mutation
  run). FIXED W: the `own` and `setup` role templates carry today's block inline, so atBirth frames that copy in place
  rather than leaving it plain. FIXED W: an update to an existing span has its own title ("Update") and sentence, and
  the restart line says "This restarts" when nothing is added. FIXED (mine, deleted): a dialog comment saying the
  copy is replaced "where it stands". Left NITs: near the cap, the frame's bytes are spent before the connections
  and files blocks (each still says so when it does not fit); long docstring line.
- Round 7 (sonnet): FIXED W: after an update or replace, the done lines and the undo note say "Updated" rather than
  "Added" (the add flow is unchanged; render-autohello-2686 drives it). FIXED W: a person's own `###` heading right
  after an unedited copy keeps it unmatched; named in the weakest premise and pinned as an accepted miss. DEFERRED W:
  sectionContentOf ignores any line starting with the dated opener's words inside a span; that predates this branch
  and the click rewrites the whole span, which the dialog says. Left NITs: the import birth line says "set up"; the
  kept-sections list in the copy-only case; doctrine-past.js would skip a defaults.js that gains a relative require.
- Round 8 (opus): FIXED W: the dialog's confirm button says "Update & Restart" when the title says Update. The
  banner button keeps "Add Instructions & Restart": Josh's one label for every case (the comment above
  #d-doctrine-note), so it is not changed here. FIXED NITs: doctrine.js constraint 6 no longer says the copy's place
  is taken by the span (only true on one path); the fleet list sends `updating` too; the no-dead-end guard catches the
  composed verb (proved by a mutation). Left NIT: the copy-only case says "replaced" for a cut.
- Round 9 (sonnet): FIXED W: an imported file is the person's own, so import does not frame an inline copy of
  today's rules (creation still frames a template's). FIXED W (round 5's deferral, re-raised; the route is live):
  cutting an older copy needs the per-agent dialog's hash, so the fleet click (names only, no hash) leaves that agent
  for its own page with a reason. Each guard mutated, each reds one test. Left NITs: "replaced" also covers a
  partial or cut-only replace, in the dialog and the undo note.
- Round 10 (opus): FIXED W (my round-9 gap): the fleet list marks a replacing agent `could_not` with the fleet
  click's own reason (one constant), so the list says what the click does. FIXED NITs: planFor's return line lists
  `updating?`; atBirth's inline comment says what the code checks (today's block byte for byte), not who wrote it.
  Left NITs: the empty fold in the cut-only case; hashing before the cheap checks; the test's temp dir.
- Round 11 (sonnet): FIXED W: the generator checks every prefix pair; an earlier block that a later one extends
  inside its last section is left out of the table with a warning (its agents keep the missing-headings rule, never
  a wrong cut). Proved both ways: with the working copy's last section extended the v21 row was left out, and on
  the real tree the table regenerates byte-identical. It also fails, rather than warns, on a version it cannot load.
  FIXED W: the defaults.js v21 log names Windows line endings beside edited copies. Left NITs: the empty fold in
  the cut-only case; a row's version label is the first commit that produced its block.
- Round 12 (opus): FIXED W: a span the person edited, at the version the agent already carries (recorded at birth
  and at every click), raises no "updated working rules" banner; the next version offers the update. Control: an
  earlier carried version still gets it. FIXED W: a span saved with CRLF compares equal (sectionContentOf
  normalises line endings). FIXED NIT: the link sentence says "parentheses", what the renderer draws (v21 re-pinned,
  table regenerated: 27 rows, the extra one this branch's unreleased first v21). FIXED NIT: atBirth's docblock names
  the inline framing. PINNED (decided): a paragraph of the person's right after an unedited copy is kept, outside the
  new span. Each new guard mutated, each reds one test.
- Round 13 (sonnet): FIXED W: the fleet click (no dialog hash) applies status()'s carried-version rule through one
  helper, so it leaves a span the person edited rather than overwrite what the list called current; control: an
  earlier carried version is still brought current. FIXED W: the update sentence says "Your words outside the
  marked block stay exactly as they are". NOTE: the table's second v21 row is this branch's unreleased first v21;
  after the merge, rerunning tools/doctrine-past.js on main drops it (harmless either way).
- Round 14 (opus): FIXED W: an import that writes the rules records `doctrineVersion`, as creation does, so the
  carried-version rule protects an imported agent's edits too (connect-agent.test.js, with a control: a file that
  already had the rules gets no version claimed; mutation reds it). Left NITs: the cut-only case's empty fold and
  extra blank line; the carried-version rule also holds back a section the person deleted OUTSIDE the span until
  the next version; plainCurrentAt assumes no earlier block has today's as a prefix (true for all 27 rows).
- Round 15 (sonnet): FIXED W: the fleet click updates a span only when its rules are exactly an earlier block (a
  fingerprint match, so never edited); an edited span, or one from an older click holding only some sections, is
  left for the agent's own page, where the dialog says edits are set current. One helper (fleetLeaves) answers for
  the fleet list and the click. Round 13's control, which expected the fleet click to overwrite an edited span at an
  older version, is superseded and now expects it left. Both arms mutated: dropping the leave reds two tests,
  treating every span as edited reds the unedited update. DEFERRED W: create.js records doctrineVersion at every
  birth, even where the rules landed plain; that predates this branch, and the carried-version rule reads it only for
  a span (`updating`).
- Round 16 (opus): FIXED W: the fleet list checks a Not now first, then what the click leaves, then the plan, in the
  fleet click's order, so the two give the same verdict. FIXED NIT: the carried-version rule needs `edited`, so an
  unedited earlier block (a restored .previous) still gets the banner. FIXED NITs: refresh's docblock sits above
  refresh again; the carried-version comment no longer says every agent is born in a span. Both behaviour changes
  mutated, each reds a test.
- Round 17 (sonnet): FIXED W: the dialog body is now tested by RUNNING its expression for all four plan shapes
  (replacing x updating), which found the combined shape still opened "Your words stay exactly as they are" while
  saying edits inside the block are reset; it now says "outside the marked block" there too (mutation reds it).
  DEFERRED W: an older block missing from the table reads as edited, which errs safe (no banner at the carried
  version, the fleet click leaves it, the next version offers it); guarded by the per-version row test and the
  generator failing on an unloadable version. FIXED NITs: atBirth's docblock lists its four cases; the table's
  header says it holds every block from git history, released or not.
- Round 18 (opus): FIXED W (a regression I made in round 15): a span from an older click holding only the headings an
  agent lacked is Kosmos's own text, but it was called `edited`, so the fleet click skipped it and the list said
  "changed by hand". The table now also holds every section's fingerprint (44), and a span is Kosmos's when it is a
  whole earlier block or every section in it is an earlier section, byte for byte (knownContent). The fleet reason
  no longer accuses anyone ("not a copy Kosmos recognises as its own"). Test with a control (one word changed in
  the partial span is the person's); mutation reds it; a guard that the table holds every section of today's block.
  FIXED NIT: the generator drops an earlier row only when the later block continues on a NEW line (a same-line
  extension is already refused at runtime). Left NITs: the overlap guard in planFor is defensive and cannot fire
  today; the cut-only case's empty fold and blank line.
- Round 19 (sonnet): DEFERRED W: an agent with no recorded version cannot get the carried-version rule, but its
  edited span is still left by fleetLeaves (`edited` does not depend on the version); the reviewer could not build an
  overwrite. NITs only otherwise. CONVERGED.
- NEXT: #4873 also takes doctrine v21. Whichever merges second renumbers to v22, re-pins defaults.test.js,
  regenerates engine/doctrine-past.js and gets one more blind round before its final validation.
- 05:40 10-02 (after #4873 merged as v22): merged origin/main. The version log keeps main's 21 (#4624) and 22 (#4873),
  this card's entry is now 23, DOCTRINE_VERSION 23, pinned 91ad3a6c31f4b409. tools/doctrine-past.js re-run AFTER the
  merge was committed (run before it, HEAD's history lacked main's v22 and the table had no v22 row): 30 blocks, v20
  to v23 present; the extra rows are this branch's unreleased earlier blocks (no agent holds them, so they match
  nothing). defaults, doctrine, doctrine-4890 and doctrine-consent tests green. One review round on the merged tree next.
- Round 20 (opus, after the merge with main): FIXED W: a released version could drop out of doctrine-past.js silently
  (v21 has main's row and two unreleased rows from this branch, and the guard only asked that SOME row carry 21);
  engine/defaults.test.js now asserts every pinned fingerprint has its own row (with main's v21 row deleted it goes
  red naming v21 2211bf1f791a9399). NITs taken: git log --full-history in the generator (table byte-identical after
  regenerating; my first edit put the comment mid-expression and crashed the generator, caught because the table
  could not have been "unchanged" from a run that printed a stack); the generator's header says what the test catches
  and that interim branch rows carry their then-current number.
- Round 21 (sonnet): NITs only. CONVERGED (after the merge: rounds 20 and 21 on the merged tree). It checked "born on
  22 is offered 23" directly (planFor: refresh, updating, not edited; a plain v22 copy: refresh, replacing). LEFT NITs:
  versions 1 and 2 have no numbered rows (the oldest block is labelled null; an agent on v1 or v2 keeps the
  missing-headings rule); an import into a file already holding a doctrine marker records doctrineVersion for a plain
  copy (planFor still treats it correctly).

