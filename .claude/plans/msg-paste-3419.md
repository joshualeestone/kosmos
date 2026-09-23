# #3419a — busy-agent message-send truncation (paste transport)

Branch: `msg-paste-3419` · Repo: joshualeestone/kosmos · Card: kosmos#3419 (part a,
the engine half). Top 0.6.89 cut-blocker, routed to Ice Cream Kitty by Splinter
2026-09-22 19:38.

## The bug

`engine/chat.js` `deliver()` put the person's message into the agent's pane with
`send-keys -l -- <text>` — a keystroke stream. A pane that is BUSY (an agent
mid-turn) drops all but a tail fragment of that stream, silently, with no error on
either side. The person typed a full message; the agent received "…og area." and
neither side was told. That is silent corruption of the product's core action.

The signature (a surviving fragment that has lost an INTERIOR space) is a keystroke
race against the TUI, not a clean byte cut — see the fleet bulletin
`truncation-is-recipient-busyness-not-byte-count`. It is recipient-busyness, not
sender byte count. A paste avoids it because the content is delivered to the
composer atomically rather than as a per-keystroke stream.

## The fix

Vendor the core of the fleet's proven `~/.claude/scripts/claude-msg` transport into
`engine/chat.js`:

1. Split the wire into UTF-8-safe chunks ≤256B (`chunkUtf8`). A single paste-buffer
   above ~800B drops its LEADING bytes at the PTY layer (measured on the fleet TUI
   2026-09-01: clean ≤782B, head-truncation by ~931B), so the body is pasted in
   sub-threshold chunks with no Enter between them; the composer accumulates them.
2. Per chunk: `tmux set-buffer -b <uniq> -- <chunk>` then
   `tmux paste-buffer -b <uniq> -d -t <target>`. `--` makes the chunk literal data
   of any bytes (a leading `-`, a `;`, `$(…)`, unicode) — never a shell arg, never a
   tmux flag, never a keystroke.
3. Size-adaptive paste→Enter delay so the bracketed-paste close (ESC[201~) flushes
   before the Enter, or the Enter is absorbed as a newline inside the paste. At least
   the codex 500ms floor on a codex pane (#571).
4. One separate `send-keys Enter` submits the whole message as a single turn.

Preserved unchanged: `verifyAtSend` (the fresh pre-send capture that stops a paste
being executed as a command in a pane that fell to a shell), the trust-dialog floor,
the PLACED/UNCONFIRMED/COULD_NOT verdicts, and the codex Enter gap.

## Decision: JS-through-the-seam, not a vendored shell script

The card's resolved design (agreed with Angel) was to vendor a `.sh` and shell out
via `execFileSync`. On examining the code I changed that call, and the reasons are
recorded here rather than in a comment because they are the "why", not the "what":

- The whole module and its ~150 tests are built on one `tmux()` seam (`setRunner`).
  A shelled-out script bypasses the seam and destroys testability of a
  security-sensitive path.
- An Electron app packages `engine/` inside the asar archive; a file there cannot be
  `execFileSync`'d without `asarUnpack`. A vendored executable is a real packaging
  complication a JS port does not have.
- The JS port stays faithful to claude-msg's proven constants (256B chunk, the
  size-adaptive delay formula) with cross-references, and ships nothing new.

`set-buffer` (content in argv after `--`) is used instead of `load-buffer` (stdin) so
every tmux call still goes through the seam and is assertable, with no shell and no
injection surface.

## Deliberately NOT ported

- claude-msg's per-target mkdir lock. It guards concurrent sender PROCESSES sharing
  the default tmux buffer. This server is synchronous (execFileSync + the pause both
  block), so one `deliver()` completes before the next — no interleaving. Unique
  buffer names are kept as hygiene against a future async caller.
- The self-address envelope guard (fleet-messaging-specific; no envelope here).
- claude-msg's full post-send classify/corrective-Enter loop. The Kosmos wire is
  single-line (`cleanMessage` flattens), so the multi-line "collapsed paste" failure
  that loop targets is not reachable here; the size-adaptive delay is the needed
  submission guarantee, and the existing UNCONFIRMED verdict already covers a
  failed Enter.

## Tests

`chunkUtf8` UTF-8-boundary + multi-chunk anti-truncation coverage added; every
send-shape assertion across the chat/messages/projects/server suites updated to the
paste transport (they now read `set-buffer` chunks / a reassembled message rather
than a `send-keys -l` arg). The paste→Enter real sleep is skipped when tmux is
stubbed so the suite does not pay it. Full node suite green (8094 tests, 0 fail).

## Follow-up

- Splinter/Angel review the PR. Ping Splinter when it is up.
- Weakest premise: that a chunked `paste-buffer` into a busy pane lands intact where
  `send-keys` does not. Rests on claude-msg's 489-send fleet measurement, not a
  Kosmos-side measurement — the definitive confirmation is an operator watching a
  real busy-pane send land whole on the running app.
