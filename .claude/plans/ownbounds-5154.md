# Plan: #5154 Slice B, route Kosmos's silent per-agent bounds through the needs-you record

## Context
Card #5154 ("bounded retries: what remains after C"). Slice A (crash loop, `engine/crashloop.js`)
and Slice C (recurring terminal error, `engine/stuckterminal.js`) are already shipped and in prod.
This is the buildable remainder: Kosmos's OWN per-agent helpers already cap their retries, then
give up with a LOG LINE ONLY, so nothing on the board says they stopped. Slice B raises each give-up
as the same needs-you surface slices A/C established.

## Scope: three per-agent bounds
- **quota**: the Gemini quota resume gave up after MAX_TRIES (`engine/agyquota.js`).
- **nudge**: the idle-agent nudge gave up after MAX_TRIES (`engine/agentnudge.js`).
- **firstreply**: the first-reply reminder gave up after MAX_TRIES (`engine/firstreply-nudge.js`).

`connlost-heal.js` is NOT included: its give-up is already surfaced on the board today (Renet).

### Deliberately carved out (own cards, named on #5154)
- **The Assigner give-up** (#6072). `MAX_ASK_FAILS` is keyed on a PROJECT (a task nobody took), not an
  agent: the session it asked last is not "the agent that needs you". Routing it per-agent would
  pin a needs-you on an innocent idle agent, the exact false alarm slices A/C guard against. It
  needs a project-level surface, so it is its own card.
- **Slice D** (#6071): the same tool refusal repeating INSIDE a turn (per-runner hooks, ~3 to 5d), its own card.

## Design (mirror of slice C)
- NEW `engine/ownbounds.js`: a per-agent episode tracker keyed `(agent, class)`. `note(key,cls,
  evidence)` on a helper's give-up (keeps first `sinceAt`, stamps `lastAt`); `recovered(key,cls)`
  on the helper's next success; `assess`/`peek` for `/api/status`; `tellBounds`/`sweepRoster` for
  the 60s sweep; `forget`/`clearAll`/`keys`.
  - **GRACE_MS** (60s): debounce, a give-up must stand this long before it is raised.
  - **STALE_MS** (2h, above the 60-min MAX nudge sweep from heartbeat INTERVAL_CHOICES, not the 15-min
    default): backstop, an episode not re-noted goes stale and clears, for an agent that left the helper's
    view without a recovered().
  - **IDLE_ONLY** {nudge, firstreply}: a mootness clear, an idle-only give-up on a non-idle agent
    is resolved and clears crisply (the chief false-alarm case: a now-working agent).
  - **Precedence**: an agent in its OWN `needs_you` is suppressed (not told over) without clearing
    the episode, so it surfaces the moment the agent's own question clears.
- Each helper exposes its give-up via a dedicated `bound(session, because)` callback, SEPARATE
  from the once-only stdout `log` (so no per-sweep stdout spam), fired every sweep the give-up
  holds (keeps the staleness clock fresh). agyquota also re-reports each sweep an already-given-up
  agent stays paused (its one-shot gave-up record only fires on the crossover tick).
- `server.js`: require; `ownBound` on `/api/status` (all three row shapes, including the offline row);
  `clearAll` at boot; the 60s sweep raising one `phonenotify.happened({kind:'needs_you', ...})` per
  episode; `bound`/`recovered` wiring.
- `engine/status.js` `needsPerson` plus `web/index.html` (sentence, `agentNeedsAttention`, `pjAlsoWhy`,
  `PJ_NEEDS_WHY`) plus `engine/projects.js` (member projection + `needsYouReason`): an ownBound give-up
  lights the Issue filter and the project pill. Copy is placeholder for Mona Lisa (as A/C were).
- Lifecycle `forget` in `create.js`/`remove.js`/`delete-leftover.js` (beside `stuckterminal.forget`).
- Browser check `docs/browser-checks/render-own-bounds-5154.js`, registered in
  `tools/browser-checks.sh` plus `docs/browser-checks/b8-board.txt`.

## Done-looks-like
1. Each of the three helpers, on its bound, produces a structured give-up (not a string match) that
   server.js routes into ownbounds; unit-tested.
2. ownbounds raises exactly ONE push per episode plus a `/api/status` field that becomes a board card;
   self-clears (recovered / mootness / staleness); excludes own-needs_you; forget on lifecycle; clearAll
   at boot; the null-roster safety invariant holds. Unit-tested.
3. Heavy suite green by content on the exact head; the registered browser check renders a give-up
   card plus the no-escalation controls; challenge-loop converged; gated PR, reviewer Sonya or Liu Kang
   (NOT joshualeestone, the shared push identity, per Liu Kang).
