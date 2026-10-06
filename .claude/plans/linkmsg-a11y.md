# linkmsg-a11y: the empty lost-link follow-up line stays readable to a screen reader

**Card:** kosmos#5388 (Renet's accepted NIT on #5387, the 0.7.25 fix-forward; Splinter 06:01: follow-up for 0.7.26).

**Finished looks like:** while empty, #d-linklost-msg (an aria-live status) is in the accessibility tree and takes no space in its flex column on any screen, including a sideways phone DM; written into, it is an ordinary line.

**Change:** `#d-linklost-msg:empty` uses the visually-hidden pattern out of flow (position:absolute; 1px; margin -1px; clip-path inset(50%); overflow hidden) instead of display:none. render-dm-sideways-3969 names d-linklost-msg as a surface (so a change to it selects the check), measures it, asserts it is not display:none and is absolute on every sideways and wide run, and expects 83 checks per engine.

**Rejected:** display:block at zero height (review 1: still a flex item, so its parent's 4px gap came back on the sideways DM); moving the element out of .dtext (more churn for the same result).

**Weakest premise:** that keeping an empty live region in the tree makes the first announcement reliable across screen readers; it is the documented pattern, not tested with VoiceOver here.
