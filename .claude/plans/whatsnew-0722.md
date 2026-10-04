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

0e. [SUPERSEDED: the line and order below were rewritten; the CURRENT file is web/whats-new.json, and the review
   sections at the end of this plan record each change.] #5154 slice A (580fb2556, PR #5203, Renet) shield "Agents that keep stopping": "When an agent keeps crashing, its card
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

## Angel's cross-agent review (21:53), all taken
- "Agents that keep stopping" OVERCLAIMED FOR WINDOWS: crashloop reads <data>/runs/<key>.log, written only by the Mac
  supervisor (bin/agent-supervisor.sh, the #5154 block near line 185); engine/win32supervisor.js never writes it
  (verified: its "runs" hits are the English word). 0.7.22 ships to Windows staging too. Now begins "On a Mac".
  "right after each start" was looser than the rule (3 runs ending on their own within 2 min, inside 30 min).
- "An honest sign-in warning": worksUntil is set for ANY live margin, minutes included; "a few more hours" was only
  the measured case. Now "can still work for a while", and names "the sign-in warning".
- "Work you can check off": "Existing agents are offered the change."
- Ranking: Angel agrees the five beat #5146.

## Challenge loop iteration 1 (22:07)
- WARNING taken: the sign-in warning is Mac-only too. engine/loginexpiry.js readCredDefault reads the macOS keychain
  (`security find-generic-password`) with no file fallback, and status.js resolves each agent's sign-in via tmux/ps,
  so Windows never produces the warning. The line now begins "On a Mac".
- "soon after it starts" replaces "minutes after" (crashloop counts runs ending within 2 min; the usual case is seconds).
- Superseded sections marked. The "Weakest premise" above is about #5146, which was dropped at the cap; the live one:
  both Mac-only claims rest on reading the Windows code paths, not on a Windows run.
