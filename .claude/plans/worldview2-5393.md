# worldview2-5393: one view across worlds, slice 2, the page (kosmos#5393)

Slice 1 (#5472, merged 2026-10-07) built `engine/worldview.js` and the read-only, token-gated
`GET /api/worlds/overview`. Its plan: `.claude/plans/worldview-5393.md`. Ice Cream Kitty handed slice 2 to
PigeonPete 2026-10-07 18:40.

## Decided (PigeonPete, reversible)
- **Where:** an "At a glance" button in the worlds switcher menu (`#worldsw-menu`), beside New Kosmos. It opens a
  sheet listing every world. The switcher is where a person already thinks about "my Kosmoses", and the route
  lists exactly the worlds the switcher lists. Rejected: a new top-level page (more chrome for a read-only view),
  and the Agents page (it is one world's).
- **When it reads:** once each time the sheet opens, plus a Refresh button. No background poll: the route builds a
  fresh `safeRoster()` per call (slice 1 review notes), and nothing here needs live updates.
- **Words per provider row (running world):**
  - `not_paused` -> "Not paused" (never "Working": an idle or unknown agent also reads not paused).
  - `paused` -> "Paused until <h:mm>" when `until` is set, else "Paused".
  - `some_paused` -> "<n> of <m> agents paused".
  - `stopped` -> "Stopped".
  - `signInFailed > 0` adds "<n> could not sign in".
  - Provider names from the page's own words: Claude, OpenAI Codex, Gemini, Grok, Gemini (Google subscription);
    an unknown runner shows its own name.
  - `agentsWithoutProvider > 0`: "<n> agents on another computer or runner" (paneless cards carry no provider).
- **Other worlds:** `providersBecause` is shown as written ("known only while this Kosmos is open"), never a blank.
- **Unassigned tasks:** "<w> tasks waiting for someone", "+ <h> on hold" when held; `unassignedBecause` shown
  instead of a number when the projects file is unreadable. Never shown as 0 when unreadable.
- **No quota figure, anywhere.** No provider gives Kosmos one.
- **Failure:** a fetch failure or a non-200 says so in the sheet with Refresh; nothing stale is left up as current.

## Weakest premise
That "At a glance" in the switcher menu is discoverable enough. A one-world install still shows the switcher, so
the entry is reachable there too.

## Validation plan
- Pure render function, node-tested (state words, unknown provider, unreadable counts, other worlds, failure).
- A browser check for the sheet (file:// with a stubbed fetch, no board) mapped to the surface gate.
- Static set + surface gate before queueing; full validation through the queue; challenge loop.
