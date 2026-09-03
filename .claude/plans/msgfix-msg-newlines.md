# kosmos#1985: 0.6.24 empties single-line messages (BSD-sed N-on-last-line)

## The bug (root-caused by Splinter/Splinter2, confirmed here)
On a clean Mac (BSD sed), the CLI's esc_text pipeline
`sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'` DISCARDS single-line input. BSD sed's `N`
on the LAST line has no next line and exits WITHOUT printing the pattern space; single-line
input is all last line, so the escaped text becomes the empty string. Measured on this box:
"hello" -> [] len 0; "a plain sentence" -> [] len 0; multi-line survives. Almost every message
is one line, so it reads as "any content, identical failure". Shipped in 0.6.24 (app.commit
36154ccd), so every Mac that auto-updated overnight is affected.

## Blast radius (wider than first reported, all measured/traced)
The identical pipeline is in all four commands (msg/reply/post/report), but their DOWNSTREAM
visibility differs:
- post, reply, msg REQUIRE non-empty text (chat.messageProblem), so all THREE FAIL loudly on
  single-line input ("write something to send").
- report only requires a <state>; its text is OPTIONAL. So report ACCEPTS the empty text,
  reports "Recorded.", and SILENTLY DISCARDS what was written (Splinter2: stored `because: None`).
  Same defect, opposite visibility. `needs_you` takes its reason through the same field, so on
  0.6.24 a one-line help reason is stripped while the agent believes it explained itself.

## The fix
`sed -e ':a' -e '$!{N;ba' -e '}' -e 's/\n/\\n/g'` at all four esc_text sites. The slurp runs
only WHILE a next line exists (`$!`) and prints the last line normally; single-line survives,
multi-line unchanged, quote/backslash/tab handling identical, JSON round-trips. Verified on
single/multi/quote/backslash/tab. This resolves the acute case for all four (report's one-line
`because` and needs_you reasons now survive too, because the text is no longer emptied).

## The guard (the composing half)
`tools/test-msg-newlines-1927.sh` extracts the REAL pipeline (cannot drift) but only ever fed
MULTILINE input - the arm that works - so it certified the exact blind spot. Added:
- a SINGLE-LINE arm on the real extracted pipeline (reds on a revert to the unguarded N),
- a control that the pre-fix pipeline empties single-line input (so the arm is meaningful),
- extended the regression guard to red on BOTH broken forms (the one-line GNU-ism AND the
  unguarded `-e 'N' -e '$!ba'` that actually shipped),
- retargeted the all-4-sites check to the fixed `$!{N;ba` shape.
Red-cap measured: reverting install/kosmos to origin/main reds the single-line arm (esc=[]) and
both site checks (3 failures); the fixed tree is 0 failures.

## What this fix does NOT do (separate follow-ups, flagged, not in this PR)
1. The report/needs_you SILENT-DISCARD as a CLASS: report accepts a genuinely-empty `because`
   and says "Recorded.". The sed fix removes the acute cause (text is no longer emptied), but a
   test that asserts the STORED RECORD (not the exit code or the success message) is the durable
   guard Splinter asked for, and it belongs at the server/store layer, not in the CLI-escaping
   test. Fast-follow.
2. K-13 SERVER-SIDE FLATTEN: the server still stores a newline as a space (Splinter2's multi-line
   control came back "bravo second line present"). So the CLI now escapes paragraph breaks
   correctly and the SERVER still flattens them. Fixing the sed does not deliver the paragraph
   breaks #1927 originally asked for. Separate, server-side.
3. `msg` single-line is TRACED unambiguous (both halves measured) but not empirically run
   (needs two agents). Worth one live arm.

## Delivery
This reaches the fleet ONLY via a new cut (0.6.25) being served; a fix on main helps no one until
then. Rolling latest.json back is INERT - auto-update never downgrades (Splinter measured
newer("0.6.23","0.6.24")=false), so a rolled-back pointer rescues zero already-broken machines.
The pointer/cut call is Josh's; Splinter has it. I cut 0.6.25 after this merges.
