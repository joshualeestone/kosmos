# wrfiles-8735: #8735, the working rules' "Where the files you make go" says only what the Files block does not

## Call
Ranked #1 of what is left on #8735 (comment 2026-11-20 ~03:00 CST): biggest safe cut. The section (1,138 characters)
repeated the Files block ("Where to save files you make for the person"), which every agent carries: measured tonight,
an agent made from a person's own words has it too, and the boot sweep re-writes it (dmfiles.tellAgent). The section
now says only what that block does not: a file for the person goes where that block says, never in your own folder
(#4420's Gemini misread) and never left only in this chat (#1943); working notes go in your own folder; a project's
files go in the obvious spot inside its folder, not a deeper path (#1943's invented folders). Doctrine 55.

## Rejected
- Removing the section entirely: the heading is how missingFrom offers the rules to a legacy agent (#1943 delivery),
  and two of its rules (the obvious spot inside a project, never only in the chat) are said nowhere else.
- Keeping "if you cannot tell which folder, ask one short question": the Files block already says save to Files and ask
  which project, and the two read as competing instructions (an earlier slice cut the sentence reconciling them).

## Measured
- pm brief 46,912 -> 46,191 (darwin), 721 characters. Ratchet 47,000 -> 46,200.
- 55 test files that read defaults, doctrine, messages, dmfiles or instructionreread: 1,730 tests, 0 failed.
- Re-read note: a running agent rewritten from v54 is told the removed lines may be in the Files block, reworded. The
  fixture is v54's section word for word (checked equal to origin/main's, 1,138 characters). Both conditions perturbed
  red: dropping the Files-block check fails the control, disabling the note fails the positive test.

## Weakest premise
That the Files block is in the file. It is non-gating at creation (a failure is reported to the person) and the boot
sweep adds it again; an agent whose Files block failed both times has lost the exact path whatever this section says.
