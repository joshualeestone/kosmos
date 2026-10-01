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

- Only an ANSWER changes the name or whether the menu opens: ok: true, or the engine's marked not-signed-in
  (signedIn: false, added in engine/account-computers.js). /api/remote/computers always answers 200 and ok: false
  ALSO means Kosmos+ did not answer, so anything else keeps the last good state, says so in the menu and re-reads,
  backing off from 15 s doubling to 5 min (rounds 1-4). While there is nowhere else to go it re-reads every 5 min.
  Both wait for a visible tab and never repaint an open menu. With the switch ON the helper returns at once, so the
  kept menu behaves exactly as on main (round 5).
- Out of scope, noted on the card: engine/win32uninstall.js names "your Kosmoses" in its uninstall reasons; the
  uninstall really does have to find every Kosmos, so the words describe what it does.

Validation: render-onekosmos-4815.js 56/56 (Chromium + WebKit, light + dark; 52 arms with the switch off, 4 on).
Controls, each failing exactly its own arms: defaulting the switch on (every off-arm); no boot read (both boot arms);
a retry that never fires (recovery); the old "any object is an answer" rule (the Kosmos+-down arms); no visibility
re-read (the hidden-tab arm); a flat retry (the back-off arm). Engine: the not-signed-in mark asserted present and
absent (removing it fails). Re-run after round 5, all green: the nine kept checks (render-computers-4648 88, the
world/worldsw checks), render-frame-phone-718, both tophead checks. web.* 2216/0. Gates 0.
