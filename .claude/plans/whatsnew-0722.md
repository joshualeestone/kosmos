# whatsnew-0722: What's New for 0.7.22 (cut target Sunday afternoon 2026-10-04)

At most 5 highlights, ranked for a newcomer. Only MERGED, user-visible changes get a line; each line is re-read against
its MERGED diff before the cut (0.7.21 needed 6 review rounds because drafted lines overclaimed).

## In the file now (merged)
0. #5140 (ee9dc58f0, PR #5170, Angel) phone "New agent stays in reach": "On a phone, before you have any agents, a notice at
   the top no longer covers the New agent button." From the PR: at 720px and below, on an empty board (grid holds only its
   empty-state box), #boardbar clears a floating notice (the update or the taller offline notice). Ranks FIRST (day-one).
0b. #5165 (a6b7e4d8, PR #5179, Pete) phone "Files come to your device": "Over Kosmos+, clicking a file now downloads it
   to the device you are using, instead of opening it on the computer running Kosmos." From the PR: the project rail,
   Documents, a file cited in the thread, an agent's Files list; decided by kplusRemote(). "downloads", not "opens"
   (Splinter's draft said open; the merged change downloads). Ranks 2nd (day-one, Kosmos+).
0c. #5152 slice 0 (a40fa31db, PR #5172, Mona) tasks "Work you can check off": "Agents are now told to put bigger work on
   a task first, with Done when checks you can answer yes or no, and to say how each went." From the PR: doctrine v24,
   instruction-only ("are told to"); existing agents are OFFERED the new section; measured on Claude only. Ranks 3rd.
1. #5146 (d8d49b776) chat "Community posts stay readable": "On a Mac set to another language, agents are now told to
   write on the Kosmos+ community in English, so everyone there can read them." From the PR: one sentence appended to
   #5118's language block; measured on Claude Sonnet in Spanish only (6/6 intro posts, 3/3 replies in English). "are
   told to", not a guarantee. ENTRY note (not the line): on a non-English Mac the first board start rewrites each agent's
   instructions once; the one-step undo backup is replaced and each agent shows as on older instructions until restart.

## Merged, no line (not user-visible in the app)
- #5135 cut-log CONTROL lines; #5149 codesign retry (build); #5156 App Store listing price (store metadata, not the app).

## Candidates if they merge before the pin (draft from their MERGED diff, not from these notes)
- #5154 A: bounded retries (Kosmos stops a repeating failure and asks the person).

## Weakest premise
#5146's line generalises from Sonnet + Spanish; if a reviewer thinks it too broad, narrow to "agents are asked to".

0d. #5164 (1e23b5085, PR #5185) chat "An honest sign-in warning": from the PR, an ended login whose access token is still live
   shows "N agents stop working at about <time>" instead of saying they stopped. Ranks 3rd (day-one). 5 lines = the cap.

0e. #5154 slice A (580fb2556, PR #5203, Renet) shield "Agents that keep stopping": "When an agent keeps crashing, its card
   now says Keeps stopping, and with Kosmos+ your phone is told once." From the merge: the card label is 'Keeps stopping'
   with the needs-you look (web/index.html stateCopyOf); a needs_you push once per loop episode (engine/crashloop.js).
   Ranks 3rd. #5146 (community English) DROPS at the cap of 5: it reaches the fewest newcomers.
   Final order: #5140, #5165, #5154 A, #5164, #5152 slice 0.

## Blind review (20:35) and what changed
- Line "Agents that keep stopping" OVERCLAIMED: a phone notice needs phone notifications turned ON in Kosmos+ (off by
  default; the phone app is in testing), not Kosmos+ alone; and it detects stopping, not crashing. Rewritten.
- "Work you can check off" OVERCLAIMED: only NEW agents are told; existing agents are offered the heading. Rewritten,
  keeping "are told to" (instruction-only), with "Done when" quoted.
- "An honest sign-in warning": made concrete (a Claude sign-in; its agents can work a few more hours).
- Ranking changed to breadth (reviewer): #5154 (every card, every device), #5164 (any Claude user), #5152 (every new
  agent), #5165 (Kosmos+ only), #5140 (phone, empty board, notice showing). The phone lines reach the fewest.
- Shas: #5165 landed as dfe2b88b1 and #5152 as 4091df1e9 (the shas above are their proof commits); reviewed those.
