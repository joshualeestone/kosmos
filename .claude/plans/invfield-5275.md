# invfield-5275: the whole invitation, selected, when Copy the invitation cannot copy (and honest selection on every copy screen)

**Card:** kosmos#5275 slice 2 ("Second, smaller"; Pete's design call). Slice 1 merged as b68c09d81 (#5377).

**Finished looks like:** when Copy the invitation fails both ways, the whole invitation shows in a field below the line, selected, so the copy keys copy all of it; and on all four copy paths a refusal selects the text without pulling focus from a field the person moved on to, with a line that is true either way.

**Change:** #fedinv-whole (read-only textarea, 5 rows, max 40vh) below #fedinv-status; filled, shown and selected on the invitation's refusal; hidden and emptied by fedInviteCopyReset (focus back to Copy the invitation if it had it) and fedInviteOpen. selectForCopy(el, btn) focuses+selects when copyFocusStillOn(btn) or focus is in el, else setSelectionRange; used by all four paths (select() always moves focus: review 1, measured in three engines). Lines branch on it: copy keys alone, or click + select-all (selectAllKeysWord) + copy (copyRefusedLine on the three code paths). The create screen's refusal line no longer reverts after 2 s.

**Rejected:** placing the field above the line (the line points at it, so it reads below); both-edges anything; a select-all key in the static copy-keys test (C5 checks it per platform instead).

**Weakest premise:** that a person with focus elsewhere reads the line; the field and the line are the only signal, as on every other copy screen.

**Surface gate:** render-unread-edge-3743 and render-agentdm-3414 match only the bare token 'msg' (pjsOwnCopy's local); trailers on the commit.
