# onekosmos-4815: one Kosmos per computer (multiple Kosmoses off, the structure kept)

Card: kosmos#4815 (Josh, #admin 2026-09-30 19:50; Splinter's decisions 19:55).

Finished looks like: on a board with several Kosmoses, nothing on any screen shows the Kosmoses list, New Kosmos,
its dialog, a Kosmos's settings (rename, add agents from another Kosmos, hide) or the word "Kosmoses"; the top-left
names THIS computer and opens only when the account has another computer, onto Your computers (#4648) alone.
Flipping one switch brings it all back. /api/worlds unchanged; nothing moved or deleted.

Decisions:
- One switch: MULTI_KOSMOS, default off, with a hidden per-browser override (localStorage kosmos.multiKosmos = 1).
  Rejected a bare constant: the nine browser checks that pin the kept structure (#1704, #2238, #2563, #2935, #2628,
  #2350, #3055, #4648) would all go red or have to be deleted, and Josh asked to keep the structure.
- The computer's name comes from Your computers (the row marked this); with no Kosmos+ account, "This computer".
- With no other computer the button is plain text: no chevron, no border, nothing to open (Splinter's card).
- The dialogs are not touched: every way in is through the hidden list (New Kosmos, each Kosmos's cog).
- Lifted functions (worldswRender, worldswSetStale, computersRender, worldswToggle) reach the new code through
  typeof, so the unit tests that lift them alone keep testing today's behaviour.
Weakest premise: the name of this computer exists only on a Kosmos+ account. Without one it says "This computer".

Validation: render-onekosmos-4815.js 28/28 (Chromium + WebKit, light + dark); control: defaulting the switch on
fails all 24 off-arms. The nine kept checks pass with their override. web.* 2216/0. Gates 0.
