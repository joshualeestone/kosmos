# Light-mode agent messages in Josh's warmer cream (Josh 2026-09-25 09:14, DM with Mona Lisa)

Josh, verbatim, after comparing two mocks: "I like it. Let's use this for light mode on all agent messages, projects,
DMs, assistant chat box. And use the blue for users messages." Then: "No stroke outlines though". Then, separately:
"Actually the stroke would be cool for an unread message and then as you read it it fades away" (a later card, not this one).

## Finished looks like
In light mode every agent message bubble (project conversation, agent DM, and the setup assistant once #3738 lands) is
#fbf4e4 with no outline. The person's bubbles stay --usermsg-tint #e8ebf5. Dark and Kosmos+ navy are unchanged.

## Decided
- One token: --agent-msg (light) #f4f1ea to #fbf4e4. Every agent bubble already reads it, so nothing can drift.
- The Tasks tiles' hover and selected fill read the same token and follow. Rejected: a separate tile token, which adds
  three theme definitions to keep a hover shade he did not mention. The selected tile already has a gold edge.
- No outline (his second message). The unread-edge fade is its own item.

## Weakest premise
That "light mode" excludes Kosmos+ navy, which is a dark look. His words say light mode, so navy keeps its value.

## Verification
render-agent-msg-gray-2805: a new arm pins light to rgb(251, 244, 228). Control: with #f4f1ea it fails. The warm-tone
bound follows the pick (spread 23, was capped at 20). render-room-msgbox-2806, render-agentdm-3414 and
render-tasks-view-3559 pass.
