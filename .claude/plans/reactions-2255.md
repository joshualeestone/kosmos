# reactions-2255: inline emoji reactions on posts (#2255)

## The ask

Josh, #2255: Discord-style inline emoji reactions on room posts (thumbs up, fire,
etc.); the user - and, as a follow-up, agents - can react. This ships the
operator/user side (Josh's core ask: the user reacting to a post).

## Design

- **Engine (`engine/messages.js`, `engine/reactions-2255.test.js`).** A reaction
  is a `kind:'reaction'` EVENT `{of, emoji, from|operator, op}` appended to the
  same append-only log as posts - nothing mutates a stored post. `reactionsFor`
  replays the events to current state (toggle, mine, order, isolation between
  posts); `react` is a Discord-style click-toggle (add if absent, remove if the
  same author already reacted with that emoji) that refuses a bad emoji or a
  nonexistent post; `normalizeReactionEmoji` accepts only a real, short emoji with
  no HTML-dangerous content.
- **Server (`server.js`, `server.projects.test.js`).** The room GET carries each
  post's reactions (viewer='you'); `POST /api/project/:id/room/:postId/react`
  toggles as the operator and returns the fresh pills; `POST /api/react` is the
  agent surface (sender read from `from_pane` via resolveSender - it can never
  mint operator authority, and a body-forged identity is refused).
- **Web (`web/index.html`).** `pjReactions` renders toggle pills (aria-pressed +
  a gold `.mine` state, title names who reacted), a "+" opener, and a quick
  palette; a delegated `#pj-room` handler toggles via the route and repaints just
  that row. Emoji are `esc()`'d (XSS-safe). `reaction` is added to
  `ROOM_NOT_SPEECH` (#1397). Theme-aware CSS.
- **Browser-check (`docs/browser-checks/render-reactions-2255.js`).** Drives the
  real painted room in both themes: "+" reveals the 8-emoji palette, clicking an
  emoji adds a count-1 `.mine` pill, clicking it again toggles the reaction OFF
  (the control that makes the add meaningful), no page errors. 20/20 both themes.
  Wired into the runner + README + reason-grep (EXPECTED_SITES 48 -> 49).

## Deliberately deferred (decision + reasoning)

The **agent-DELIVERY** half - a `kosmos react <project> <postId> <emoji>` CLI verb
plus surfacing post ids in `kosmos room` so an agent can reference which post to
react to, plus one instruction line telling agents they can react. Deferred
because it changes the SHARED agent room view (every agent's `kosmos room` output)
for the OPTIONAL half of the card (Josh's core ask - the user reacting - is done
here), and a shared-surface change should not be rushed. The mechanism (the
`/api/react` route + the engine) is already built and tested, so the follow-up is
delivery-only. #2255 stays open for it after this merges.

## A test the harness blocks (deferred, covered elsewhere)

A route-level "a RESOLVABLE agent + a body operator/from lie lands as the agent,
not the operator" test is not present, and it is harness-blocked rather than
missed: the test fake-tmux resolves EVERY pane to one fixed session name, and
`resolveSender` will not match that synthetic name to a project member, so a
resolvable `/api/react` cannot be driven in this harness. The property is still
covered three ways: it is structural (the route builds the `react()` call with
only `from: sender.card.sessionName` and never forwards `operator`/`from` from the
body), the engine test asserts an agent react stores `from:<name>` and never
`operator:true`, and the `%9999` route test proves a body operator flag cannot
mint via an unresolvable sender. Three review passes re-raised this; it is a
conscious deferral, not an oversight.

## Verification

- Full node --test suite green (4700/4700) after rebasing onto current origin/main.
- The reactions browser-check passes 20/20 both themes on the rebased web.
- Rebase conflicts were only the two browser-check wiring files (runner list +
  reason-grep count); resolved as a union (origin/main's checks + render-reactions
  -2255) and the count re-verified by running the reason-grep test.
