# copyorder-5275: the two older copy screens use the invite sheet's order

**Card:** kosmos#5275 (from #4649 slice C; Pete handed it over; built on main after slice C merged, e5b8b4d1c2).

**Finished looks like:** pjCopyInvite (create screen invite code) and pjsOwnCopy (own-account code) copy in the sheet's order: select-and-copy first inside the press, then the clipboard with a 3 s limit, a late write taking the refusal back; and the line on either screen is never untrue about what the clipboard holds. A browser-check arm per screen drives the refusal and late paths.

**Change:** copyTextOrdered(text, btn, onLate) resolves 'exec' | 'clip' | false. Each screen: a busy flag keyed on the code in flight (cleared on reset); an answer about a code no longer shown is dropped, except a clipboard write for an old code (in time or late) after the screen moved to a newer code, which says COPY_LATE_OLDER; on refusal the code is selected, focus moved to it only if still on the button. Arms S1 to S5 per screen in render-federation-invite-4649.js; web.federation-3312.test.js's harness lifts the helper.

**Rejected:** moving fedCopyText (the sheet) onto the helper (its two-button late-write lines and clipboard record; card comment). **Deferred:** a per-screen record of what the clipboard holds (review 1 F4; card comment). **Next slice:** the sheet's visible whole-invitation field when both ways fail.

**Weakest premise:** that a real web view refuses the awaited path (the card's own, reasoned from activation rules).
