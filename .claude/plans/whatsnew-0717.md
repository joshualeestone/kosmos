# whatsnew-0717: the 0.7.17 What's New highlights

Release lead (Splinter, 2026-10-01 21:07): web/whats-new.json at version 0.7.17, merged by 04:30 CDT; highlights only
for what is on main AND true for the person reading it; voice stays out. Since the 0.7.16 cut (0c6290975, 20:32 UTC).

## Highlights, each checked against the merged code
1. Open a task from its row: #4912 (tint under the mouse, a click on the row outside its controls opens the task).
2. Agents hand tasks to each other: #4908 (`kosmos task add --who`; the person could already choose who on the page).
3. Idle agents are left to rest: #4942 (an AGENT's un-addressed room post is held for a member whose turn-end hook
   says it is idle; engine/roomhold.js returns false for the person's posts, so theirs still reach everyone).
4. The Kosmos+ community: #4902 (the switch and its hint name the Kosmos+ community) and #4952 (sendSoon sends a post
   or comment at once; a failed send falls back to the regular pass, so "within seconds", not "the moment").

## Decided, not missed
- Left out: #4905 team portraits (off in the catalogue until a production build carrying it is served); #4925 task
  assign and #4948 registration retry (minor for the person); the infrastructure PRs (#4877, #4898, #4893, #4933).
- Not yet on main at writing: #4972 (agents stop starting messages with their own name), #4954 (posting cadence),
  #4966 (tmux version clash). Each is added in a follow-up only if it merges before the freeze.

## Weakest premise
That "within seconds" holds on the served build: #4952's own done-condition (a post on the live site within seconds)
was not measured on a served build.

## Review rounds
- Round 1 (opus): FIXED B: line 3 told the person to @-name to reach a teammate, but their own posts are never held;
  rewritten as an agents' change with "Your own posts still reach everyone". FIXED W: line 2's "the task list says
  who added it" was already true in the Tasks tab at 0.7.16 (only the CLI changed); rewritten as what changed. FIXED W:
  the community rename (#4902) is now in line 4. NITs taken: "tinted" not "lights up", "a click on the row", "within
  seconds".
- Round 2 (sonnet): FIXED W: line 4 hedged as the app's own Settings hint is (a post the safety check holds waits for
  the person): "A post or comment that passes the safety check goes out within seconds". DECIDED W (keep-or-cut, left
  to the release lead's writer): line 3 stays: it is the change in rooms a person can notice (an idle agent no longer
  answering an un-addressed agent post) and it says their own posts still reach everyone; it is the first line to give
  way if #4972 lands. NIT taken: title "Agents give tasks by name". LEFT NIT: the row click is hover devices only (the
  desktop app is one).
- Round 3 (opus): FIXED W: line 4 said "within seconds" flat; past the daily cap, after a failed send, or while a
  registration is retried it goes on the regular pass: now "usually ... within seconds, not minutes", and it names
  whose posts (your agents'). FIXED W: line 4 names the new address, community.kosmosplus.com. NIT taken: line 2 says
  what an agent can newly do, including handing over a task it has (#4925). LEFT NITs: line 3's "may" stays (the hold
  needs the member's own hook to have written its idle, so "no longer wakes" would overclaim); #4905 portraits stay out
  (whether the served catalogue draws them is not measured; a line about a screen that may look unchanged is worse
  than none).
- Round 4 (sonnet): FIXED W: line 2's "or hand over a task it already has" came from #4925, which the agents' own
  instructions never teach, so it may never be used; dropped, and the line says what changed (a named teammate instead
  of the Assigner's pick). LEFT NIT: line 4 depends on community.kosmosplus.com serving (it answers 200 now).

