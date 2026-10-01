# roomidle-4624: an idle member is not woken by a colleague's un-addressed room post either (#4624 follow-up)

Card: joshualeestone/kosmos#4624, comment of 2026-10-01 14:41 (0.7.15 diagnostic by five model families, H7):
"Claude, Grok and Gemini still see every room post wake every member on 0.7.15 ... Suggested again: do not redeliver
a post an agent has answered, batch background posts, and wake only when mentioned, assigned or asked."

## Measured first
- The first fix (#4715, bf91a912) IS in 0.7.15 (ancestor of b6effce46). It held an agent's un-addressed post only for a
  member whose latest report is a fresh `working`. An IDLE member was still typed every such post: one turn each,
  ending in "not addressed to me". That is the diagnostic's report, so the gap is the rule's scope, not a regression.

## What changes (engine/roomhold.js)
- shouldHold also holds for a member whose latest report is `idle`, at any age (its turn ended; nothing decays it).
- The told line reads "Since you last heard from this room, N room posts not addressed to you ..." (it said "While
  you were working", now wrong for an idle member).
- Unchanged: the person's posts, posts that @-name the member, replies to the member's own post, members whose report
  is needs_you, blocked, stopped, never reported or a stale working; the brake AGENT_WORKFORCE_ROOM_HOLD_OFF=1.

## How an idle member hears about held posts
On its next typed arrival in that room (the person, a post naming it, a reply to its post: the line rides on it), or
at the end of its next turn (the existing idle flush). So it is woken only when something is asked of it, which is the
diagnostic's ask. It can always read the room (`kosmos room <id>`).

## Decided, and rejected
- Rejected: a periodic digest typed to idle members (every N minutes). It is still a wake per window for posts that
  ask nothing, which is what the report complains about.
- Rejected: holding for never-reported members. A runner the board cannot read is typed as before (no change in risk).

## Weakest premise
That an idle agent needs nothing from a colleague's un-addressed post until something wakes it. A colleague who needs
an answer must @-name it (the room's existing rule, and what the Prompter and the Assigner already use to wake an
agent). What would change my mind: rooms where work stalls because an idle agent never saw an un-addressed question.

## Tests
engine/messages.roomhold-4624.test.js: a new arm (idle held, needs_you typed as control, an old idle report still
holds, the person's post carries the held line once); the controls that used an idle member as "typed" now use a
never-reported one; ride-on carriers are @-addressed posts. engine/roomhold-agyhold-4588.test.js: the line's wording.

## Review 1 (Sonnet, blind, source-only): 0 blockers, 3 warnings, 3 nits
- W1 an idle report never decays, so a runner that does not report every turn's end could strand held posts: FIXED,
  only an idle written by the member's own turn-end hook (by 'auto') holds; it proves the next turn's end flushes.
  An agent-written idle is typed as before. Arm added.
- W2 the #4588 minute retry (flushReleased) would wake an idle agy member about posts asking nothing: FIXED, it skips
  such a member unless a held post names it. Arm added (and the control that a naming post is told).
- W3 a quota-paused member's un-addressed post lost its heldUntil: with W1's fix an agent-written idle (the #4588
  test's) goes through the quota gate as before and keeps it; a hook idle is held by this rule and told at the next
  wake, so no "held until" time applies.
- N4 an un-addressed question to the room now wakes no idle member: the `kosmos post` usage says so on both CLIs
  (held equal by cli.post-stdin-2909).
- N5 KEEP=200 with no decay: kept (the line counts "and N earlier"; the room has everything).
- N6 test notes: the never-reported controls are controls by design; the new arms fail on origin/main.

## Review 2 (Opus, blind, source-only): 0 blockers, 4 warnings, 5 nits
- Runner table (reasoned): Claude, Codex, Gemini, Grok, agy and Muse all write an auto idle at a normal turn end;
  errors and interrupts may not (Claude StopFailure writes blocked; Esc writes nothing). Held posts then wait for the
  next wake, never lost.
- W1 a hook idle never decays, so a member whose reporting breaks AFTER its last idle keeps holding while it works:
  ACCEPTED and stated in the module header. Fixing it soundly needs the idle tied to the current launch across every
  runner; nothing is lost (the room keeps every post; the next typed arrival carries the line). What would change my
  mind: a broken-reporting member seen missing room work.
- W2 a poster is not told an un-addressed question woke nobody: FIXED in the defaults every agent reads (a room post
  that names nobody does not wake an idle colleague; @-name or answer their post), beside the usage line.
- W3 the #4588 tests' idle is agent-written, not the bridge's: ADDED the production-shape arm (bridge idle: plain post
  held with no heldUntil, addressed post quota-held with heldUntil, only it retried after the reset).
- W4 flushReleased no longer tells un-addressed posts held while working when the quota refused the turn-end line:
  DOCUMENTED in its comment (consistent with the idle rule).
- N5 stale comments (messages.js "mid-turn", roomhold.js "proves every turn"): FIXED. N7 `report idle --auto` by an
  agent: DOCUMENTED. N6, N8, N9: kept.

## Review 3 (Sonnet, blind, source-only): 1 blocker, 1 warning, 2 nits
- B1 the defaults block changed with no DOCTRINE_VERSION bump or pinned fingerprint (defaults.test.js would go red,
  and existing agents are never offered the change): FIXED, version 21 with a log entry, fingerprint 2211bf1f791a9399
  pinned (computed from the block on this branch). And moved under a NEW heading, `### Who a room post wakes`, so the
  agents already posting in rooms are re-offered it (the version 5/6/7/8 delivery reason), not only new agents.
- W2 "does not wake" was broader than the rule (never-reported or self-idle members are still typed): FIXED, "may
  not wake", in the doctrine and both usage lines.
- N5 the production-shape arm's last assertion was weaker than its title: FIXED, the line must use the asked form for
  the addressed id and not list the plain id as asked.
- N6 usage suffix after the parenthesis: kept (both CLIs equal).
