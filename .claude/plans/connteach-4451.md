# connteach-4451: agents know the Connections tab, can mark what they connect, and read it cheaply

Card: #4451 (Josh 19:57, claimed pigeonpete by Splinter).

## Built
1. **Agents know the tab.** The #1034 connections block (engine/connections.js) gains a Connections tab section. It covers:
   - what the tab is;
   - `kosmos connections` as the ONLY read;
   - the explicit ban on reading `GET /api/connections` or polling it (it bills);
   - `kosmos connect <service>` with the token on stdin;
   - GitHub and Vercel being the person's to sign in to, in the tab;
   - what to say for a service with no door;
   - how to answer "what connections do we need".
   It is the same block, so it syncs where #1034's already does (boot and PUT /api/you). No new markers.
2. **A cheap read.** `GET /api/connections/held` (server.js `connectionsHeld`) reads the disk only.
   - A token door answers held true/false from its token file (`tokendoor.held()`), Cloudflare from its token file, and GitHub true when its device token is stored.
   - Otherwise GitHub and Vercel (sign-in services whose sign-in lives in their own tool) answer null: not known without a live check.
   - It sits behind the same cross-site refusal as the sweep.
3. **Marking a connection.** `kosmos connect <service>` reads the token from stdin (refused on a terminal), writes it into a mode-600 temp file as JSON, POSTs it to the service's existing door (`/api/svc/<slug>/token`, or `/api/cloudflare/token`), and removes the file. The door checks it with the service and keeps it only if it works, so the row shows it.
   - `tokendoor.connect` now answers from the check it just made instead of calling `state()` again. That was a second metered call on every connect. The server.js comment that described the old ending is corrected.
   - `kosmos connections` prints each service in words.
4. **The callout** at the top of Connections: a `P.ask-agent` with the card's words, the same values as #4450's `.gs-ask` (not merged yet). Whichever lands second can share one class.

## Decided
- **A service with no Kosmos door** is not shown in the tab. The block tells the agent to say so plainly ("connected for you, and it will not appear in the Connections tab") rather than invent a row. A new stored "marked" state would be a claim nobody checks.
- **GitHub and Vercel** cannot be marked by an agent. They are browser sign-ins the person does in the tab. The block points the person there and never asks for a password.
- **The same block, not a sibling one:** it is the "connecting" knowledge. A sibling block would add marker plumbing for no gain.

## Rejected
- A cache of the last verify result (#1618 killed a TTL, because a window turns "could not check" into a confident "not connected"). The disk read answers a different, honest question: is a token stored?

## Weakest premise
That "a token is stored" is a good enough answer for an agent. It can be stale (a revoked token still reads held). The tab checks it live when the person opens it, and the CLI line says exactly that.

## Tests
- server.connheld-4451.test.js:
  - Connecting through the door makes exactly ONE metered call.
  - The held read makes ZERO; CONTROL: the full sweep does move the same counters.
  - The Connections row then shows connected.
  - The held read is refused cross-site, with a same-origin control.
  - A refused token is not kept.
- cli.connections-4451.test.js:
  - `kosmos connections` asks the cheap route, never `/api/connections`, and prints each state.
  - `kosmos connect` sends exactly the stdin token, never on argv, and leaves no temp file.
  - A refusal is said in the service's words; an empty token or a bad name sends nothing.
- engine/connections.test.js: the block names the tab, the cheap read, the ban, stdin, and the no-door rule.
- docs/browser-checks/render-conn-ask-4451.js (gated): the callout in light and dark, desktop and phone (36 arms). Contrast measured at 7.54:1 light and 5.61:1 dark.
- Mutants, each red: the cheap read verifies, connect verifies twice, the CLI reads the sweep.
