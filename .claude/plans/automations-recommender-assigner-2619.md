# automations-recommender-assigner-2619

Card: kosmos#2619 (Settings > Automations). Routed to me by Splinter, night shift
2026-09-24, to build the unbuilt half I found in the josh-review sweep. Part of #2619
(the "Agent Communication" retitle) was already served; this branch does the rest.

## Scope decision (mine, per Splinter "decide the details yourself")

#2619(B) asks to ADD two automations - Recommender and Assigner - to Settings >
Automations. Each is described with a large BEHAVIOUR:
- Recommender: blocked agents reach consensus on a recommendation, document it, and
  implement it, bounded by three guards.
- Assigner: map top goals to prioritized tasks and give idle agents work.

Those behaviours are major agent-orchestration features, coupled to the v2 flywheel
initiative, and entirely unbuilt (no existing hook: grep of engine/ + server.js is
empty). Building them is not a settings-card build.

**So this branch delivers the SETTINGS + PERSISTENCE layer** - which is exactly what
the card literally asks ("add them to Settings > Automations") and is a stable
contract the behaviour will read when it is built:
- `engine/recommender-setting.js` + `engine/assigner-setting.js`: persist the choice
  the same way `engine/heartbeat-setting.js` does (atomic tmp+rename, safe defaults,
  a write failure returns a reason, never throws). Node-tested (17 tests).
- `GET/PUT /api/recommender-setting` + `/api/assigner-setting`: the STATUS-control
  contract (a read error is 500, never a false position), matching heartbeat-setting.
- Two Settings UI blocks in #s-sec-automation, following the exact Auto-save/Prompter
  `.toggle` + paint/save/epoch-guard/could-not-read-hides-the-knob pattern. The
  Recommender carries its three guard checkboxes.

## Decisions written here

- **The two automations default OFF.** Unlike Auto-save/Prompter (on by default),
  an automation whose behaviour is not yet wired must not read as ON - a person
  flipping an on-by-default Recommender would expect agents to act and see nothing.
  Off is honest until the behaviour lands. **Flip the default to on WITH the
  behaviour, not before.**
- **The three Recommender guards default ON (checked)**, per the card. They are the
  irreversible-consequence carve-outs (money moving, something public under the
  person's name, deleting the only copy). A guard being on RESTRICTS the Recommender,
  so on-by-default is the safe direction; a never-configured install is maximally
  guarded. Guards are independent of the on/off toggle (a person can pre-set them).
- **Corrupt/partial config fails SAFE:** a missing/non-boolean guard falls to ON
  (never silently drops a guard to off), and a corrupt file reads off with ok:false.
  Controls in the tests pin this dangerous direction.
- **The Recommender PUT changes ONE field per request** (on, or one guard via
  setGuard) so a single guard flip never resets the other two (write({guards})
  would refill missing guards to on).

## Explicitly NOT in this branch (the behaviour, a follow-up)

The consensus-recommend-implement behaviour and the goal-to-task/idle-assign
behaviour are large and flywheel-coupled. They should be scoped as their own build(s)
and land WITH the default flip. This branch makes the preference persist + readable so
that build has a contract, and shows the guards in Settings so the person can set them.

## Verification

- Node: `engine/recommender-setting.test.js` (guards default-on, off default,
  setGuard merges one, unknown-guard rejected, corrupt->safe) + `assigner-setting.test.js`
  = 17 tests, 0 fail. server.js `node --check` clean.
- Browser: the UI blocks follow the exact existing toggle pattern; the backend is
  node-tested. A hermetic browser-check (render-*, file:// + stubbed fetch, driving
  paintRecommender/paintAssigner) + a live visual pass are recommended follow-ups for
  a browser-capable session - I am a no-Playwright session, so this PR carries a
  `Browser-check:` trailer per the gate rather than a check I cannot run and validate.

## Weakest premise

That shipping OFF-default settings whose behaviour is not yet wired is the right
increment (vs. holding the whole card until the behaviour exists). The case for
shipping: the card literally asks to add them to Settings, Josh wants to pre-set the
guards, and the persistence is the contract the behaviour needs. The risk: a person
turns one on and nothing happens. Mitigated by OFF-default (they are not on unless
deliberately turned on) and honest copy; the real fix is landing the behaviour, which
is the documented follow-up.
