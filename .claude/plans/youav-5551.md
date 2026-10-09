# youav-5551: your own messages carry no avatar under the new look (kosmos#5551, slice 3)

Independent of slices 1 (#5579) and 2 (v2look2-5551); branched from main.

## Finished means
With the new look on (outside the consolidated layout), your own messages in the project room and in an agent's
Direct Message show no avatar (no ink dot, no photo), while an agent's message keeps its avatar. With the look off,
nothing changes: your avatar sits at the bubble's foot as today. render-newlook-4470.js asserts both at 1280 light and
dark and at 390.

## Context
Josh's v9 drawing (Files: kosmos-project-two-col-v9.png) draws your messages as grey bubbles on the right with no avatar.
The look had already made them grey and right-aligned, but kept `.msg-av.mine`, the solid ink dot from the room's first
design (#75), or your photo when you have one. #4470's phone slice kept "yours at the foot" only as a scope choice while
it moved agents' avatars to the top; it records no reason to keep the dot.

## Decided
- CSS only, new look only, room and DM only (the two threads the look restyles): `.msg.you > .msg-av { display: none }`.
- The time stays INSIDE the bubble. The drawing puts it outside, to the left, but timestamp-inside is an existing ruling
  that checks enforce (render checks: "the user timestamp is INSIDE the bubble"). Rejected: moving it.
- The bubble's tail wing stays (#3267 / the iMessage read, #3134). With the avatar gone the bubble keeps 14px clear on its
  right (the wing reaches 8px past it, its ground mask 14px), so neither is clipped by the thread and the thread does not
  scroll sideways. (Corrected in review 1: the first version claimed the tail was whole from a desktop zoom; in the DM
  it was cut at 4px and the mask overflowed.)
- Rejected: hiding your photo only when there is none. The drawing has no avatar either way, and the side plus the grey
  already say whose it is.
- Weakest premise: that a person with a photo set will not miss seeing it on each message. It still shows in the top bar
  and anywhere outside these two threads. Reversible in one rule.

## Checks
- render-newlook-4470.js PHONE_LOOK reads whether your avatar and an agent's are shown. On: yours hidden, the agent's
  shown (room and DM). Off: yours shown at the foot (the control). 301/301 local.
- Mutation: rule removed -> 3 FAILs (light 1280, dark 1280, light 390); restored -> pass.
- render-shell-noscroll-4872 (uses the look) 72/72; render-agentdm-3414 (reads your avatar) all passed.
- Surface gate: 16 named checks; 15 never turn the look on (trailers say so), the 16th was run. Both gates rc 0.
- Screens: agent chat in both looks, desktop and android, light and dark, 0 overflow.

## Review 1 (opus, blind): 1 BLOCKER + 2 WARNING + 3 NIT, all fixed
- [BLOCKER] in the DM your bubble's tail tip was cut: the bubble ended at the thread's content edge with only 4px of
  padding --> FIXED: `.msg.you > .msg-b { margin-right: 14px }` under the look (room and DM).
- [WARNING] the wing's ground mask made #d-dmthread (every width) and #pj-room (phone) scroll sideways, invisible to the
  page-level overflow checks --> FIXED by the same margin; PHONE_LOOK now measures, per thread, the room right of your
  bubble (tailRoom >= 14) and the thread's own sideways overflow (<= 0). Measured DM: tailRoom 18, sideways 0.
  Mutation (margin removed) -> 3 FAILs.
- [WARNING] the plan stated the tail as measured and whole --> corrected above.
- [NIT] #4470's comment said yours keep the foot avatar --> corrected. [NIT] the check's docblocks still said "the
  foot" --> corrected. [NIT] the Off arm checked the room's foot only --> the DM's too.
Re-run after the fixes: render-newlook-4470 301/301; screens re-shot (tails whole at 412 and 1280).

## Review 2 (sonnet, blind): CONVERGED
Checked the margin against every other `.msg-b` margin rule (none for `.you`), the three row builders that share the
markup (DM, pending DM, room), the reactions bar (positioned on `.msg-b`, moves with it), long words, the mask's colour
under the look (`--k-bg` for room, DM and dark; no sliver in the dark phone shot), and the check's geometry (padding box,
cannot pass with a hidden thread).
- [NIT] tailRoom reads the bubble's box, not the mask's --> recorded: a grown mask still trips the sideways measurement.
- [NIT] an over-long docblock line --> FIXED.
