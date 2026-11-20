# answering-8735: #8735 slice 3, item 1 (the three answering sections)

## Call (after review round 3)
"Answering the person who messaged you" (engine/defaults.js) drops two paragraphs that repeated the earlier section
"Answering where you were asked": a reply in your own session reaches nobody, and the message's bracketed note names the
command. What only they said stays, shorter: the operator paragraph now says an answer left in your own session does
not arrive either (round 3: the earlier section words that rule for rooms), and "reading is not running" moves into the
earlier section (round 2: custom agents have no colleagues block to carry it). The removed "at the front" sentence was
accurate (the note opens the message); it goes because it repeats, not because it was wrong (round 3 corrected my
first reason).

## Rejected
- The card's design table: one home for every answering rule, in the working rules. And my first build: one home in
  the colleagues block, with the working rules pointing to it. Round 1 measured why neither works: the colleagues block
  is added only to agents made from a role template (engine/create.js, "ROLE TEMPLATES ONLY"), so an agent made from a
  person's own words has the working rules and no colleagues block; and the working rules can be edited or removed by
  a person, so the colleagues block cannot rely on them either. Each must state how to answer on its own.
- Moving the claim protocol to a `kosmos claim --how` guide: its own slice (new guide, both CLIs, moved-lines handling).

## Measured
- pm brief about 47,070 on main -> 46,912 (darwin). Ratchet 47,600 -> 47,000. The saving is about 160, not the 3,300
  the design table estimated, because the table's premise (one home reaches everyone) was false.
- 53 test files that read defaults, doctrine, messages or instructionreread: 1,625 pass, 0 fail.
- engine/answering-once-8735.test.js: both homes state how to answer; an agent from a person's own words (doctrine.atBirth)
  carries the rules without a colleagues block; the wrong "at the front" sentence stays out. Perturbed red.

## Re-read notice
A running agent whose unedited working rules are rewritten to v54 gets a changes file marking the removed lines with -,
and its header says a - line no longer applies. For "Answering in your own session sends nothing" that is the wrong
lesson. engine/instructionreread.js adds one moved entry with an EMPTY line set (nothing hidden) under "Answering the
person who messaged you", so a note says the rule may be in the section "Answering where you were asked", earlier in
this file, reworded ("Who a room post wakes" sits between them, so not "just above").
Only when the agent's last-read copy holds the first v53 repeat line, the new file does not, and both headings are in
the new file. The header's exception now reads "unless a note in this file says where it went" (it said "a Left out
note", which an empty-set note never is; this also covers slice 2's reworded-line sentence). Tested with a control (a
different removed line gets no note); the control perturbed red with the version condition removed.

## Weakest premise
That an agent reading only "Answering the person who messaged you" also reads the earlier section.
