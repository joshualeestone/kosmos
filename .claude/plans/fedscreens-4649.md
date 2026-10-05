# fedscreens-4649: slice A of the federation screens (#4649)

Card: joshualeestone/kosmos#4649. Spec and design: ~/work/workers/pigeonpete/Files/federation-screens-4649-spec.md
(Mona Lisa's shots 01 to 10; her Q-M answers on the card, comment 5982711008). Three slices, merged in order:
A (this: the Members "+" menu, the invite sheet and its code step), B (fedscreens-b-4649: the owner's "From
outside" section), C (fedscreens-c-4649: Copy the invitation, platform keys). The card stays open until all three
are served.

## Decisions
- The menu is placed under the "+" inside the Members card (Mona's review), with one phone placement at the app's
  own 40rem width.
- Make has a 60 s limit (FEDINV_MAKE_LIMIT_MS), above the board's worst case; given up, it says a code may still
  have been made. While a Make is answered the sheet does not close (Cancel disabled, Escape refused out loud).
- The gate: "show" draws everything; a passing "signup" reading keeps an open sheet (a label being typed is not
  lost) but makes no code; "hidden" closes everything, even mid-Make.
- An asking sheet belongs to the project it was opened on: a project switch closes it, and Make refuses a changed
  project.

## Depends on
Kitty's #5266 (fedmembers-4649) for the board side. Slice A merges after #5266.

## Weakest premise
That the board's invite route keeps the shape on origin/fedmembers-4649 (`{project, invited_kind, label}` in;
`{code, expires_at}` out) when #5266 merges.

## Ledger
The 13 review rounds are recorded in the commit messages and summarised in fedscreens-4649-pre-challenge.md.
Validation: run 3 clean at c6899692e9 (14831/0). This plan file and the proof were committed after it; neither
changes code.
