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
- The bubble's tail wing stays (#3267 / the iMessage read, #3134). Measured: at the column's right edge it is whole, not clipped.
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
