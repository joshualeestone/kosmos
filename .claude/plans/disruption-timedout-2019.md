# disruption-timedout-2019: the render half of #2019 (timed-out restart)

Card: joshualeestone/kosmos#2019. Design/content lane (Mona Lisa). Engine half:
Renet Tilley (PR #2169, merged). Copy signed off by Renet AND Angel (2026-09-04).

## What finished looks like

When a restart WE started overruns its window, the board tells the truth instead
of spinning forever or reading as "this agent doesn't exist": the animated Kosmos
K stops (holds still), the label keeps the WHY and adds that it has not come back,
and the sub-line drops the "a few seconds" promise. It stays a restarting card,
calm (attn false), and self-heals the instant the agent returns live.

## Engine contract (already on main, read from engine/status.js:4284-4299)

`state: RESTARTING`, `disruption: { cause, startedAt, timedOut }`. `timedOut:false`
= restart in progress (today's behavior, unchanged). `timedOut:true` = the restart
has not come back within its window; the engine `because` is "we restarted this
agent and it has not come back yet". The engine stays in the RESTARTING family on
timeout by design (never a bare STOPPED). The board owns the on-screen copy.

## The change (web/index.html)

1. `restartingLabel(a)`: on `disruption.timedOut === true`, keep the cause-named
   base ("Switching to <model>", "Restarting agent", etc.) and append ", not back
   yet". Approved as written by both reviewers.
2. `stateReason(a)`: the restarting sub-line was always "This takes a few seconds.
   Nothing was lost." On timedOut it drops the timing claim (a card that says "not
   back yet" AND "a few seconds" reads as broken) and becomes "This is taking
   longer than usual. Nothing was lost." Caught during rendering; both reviewers
   flagged the same contradiction.
3. `glyphOf(a)` (NEW): one shared glyph derivation for the card, the row and the
   detail page (matching cardStOf/stateCopyOf). For a timed-out restart it returns
   a STILL K (`kGlyph(true)` -> `.kspin-still`, animation none), never a bare
   "gone". The three render sites (card 11796, row 11962, detail 19006) now call
   glyphOf(a) instead of GLYPH[m.st]. Angel will wire #2146 activeWhileWaiting
   through this same seam (they are mutually exclusive states).
4. `kGlyph(still)` (NEW) + `.kspin-still` CSS: the K builder, animated or held
   still. GLYPH.restarting = kGlyph(false), byte-identical to before.
5. attn stays false: staying calm in the restarting family is the point of #2019;
   a timed-out restart is slow, not "somebody is waiting on you" (red).

## Verification

Committed browser-check `render-restart-timedout-2019.js` (read-only, wired +
indexed): drives the real card() with two engine-contract-shaped agents and
asserts, for the timed-out one, the K animation is `none` (the whole point, only
visible rendered), the K carries `.kspin-still`, the label keeps the cause and
adds "not back yet", the sub-line drops "a few seconds", the card is still
`st-restarting`, and it never says "doesn't exist" -- with the in-progress card as
the control (K animated `kbreathe`, plain cause label, "a few seconds"). Proven red
on origin/main (which leaves the K animated and the copy timing-blind), green with
the fix. `server.test.js` detail-badge prelude gains `glyphOf`. Rendered and
eyeballed. `/challenge-loop` + full suite green.

## Coordination

Copy signed off by Renet (engine side) and Angel (render seam owner). Angel's
#2146/#2157 render work rebases onto this; glyphOf is the shared K seam he asked
for. No file collision: Angel's current work (#2129) is engine-only.
