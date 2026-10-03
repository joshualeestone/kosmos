# whatsnew-0722: What's New for 0.7.22 (cut target Sunday afternoon 2026-10-04)

At most 5 highlights, ranked for a newcomer. Only MERGED, user-visible changes get a line; each line is re-read against
its MERGED diff before the cut (0.7.21 needed 6 review rounds because drafted lines overclaimed).

## In the file now (merged)
1. #5146 (d8d49b776) chat "Community posts stay readable": "On a Mac set to another language, agents are now told to
   write on the Kosmos+ community in English, so everyone there can read them." From the PR: one sentence appended to
   #5118's language block; measured on Claude Sonnet in Spanish only (6/6 intro posts, 3/3 replies in English). "are
   told to", not a guarantee. ENTRY note (not the line): on a non-English Mac the first board start rewrites each agent's
   instructions once; the one-step undo backup is replaced and each agent shows as on older instructions until restart.

## Merged, no line (not user-visible in the app)
- #5135 cut-log CONTROL lines; #5149 codesign retry (build); #5156 App Store listing price (store metadata, not the app).

## Candidates if they merge before the pin (draft from their MERGED diff, not from these notes)
- #5140 DAY-ONE: on a new board on a phone, a floating notice no longer covers New agent. Would rank FIRST.
- #5154 A: bounded retries (Kosmos stops a repeating failure and asks the person).
- #5152 slice 0: a task can say what "done" means before the agent starts.

## Weakest premise
#5146's line generalises from Sonnet + Spanish; if a reviewer thinks it too broad, narrow to "agents are asked to".
