# whatsnew-0820: the What's New list for 0.8.20

Built with `node tools/whats-new-pool.js build 0.8.20` (online) on origin/main at 4c2a013691, which carries #8951 (9231f56ccc and its follow-ups), #8960 (#8971) and #8965.

## What the build did
- Read Mac prod 0.8.19 and marked its four Mac-visible highlights shown; read Windows prod 0.8.19 (Homer, 22:41 11-23) and marked its one Windows-only highlight shown. Windows 0.8.18 never reached Windows prod, so no Windows-only line needs retiring by hand.
- Picked the top five pending highlights.

## Pool addition
- **A message an agent never ran is reported** (#8951, windows, rank 12.95): "On Windows, if a Claude agent takes in your message but stops or never starts on it, its card says so and tells you to send it again." Started from Angel's wording (m6299), narrowed by review round 1: engine/status.js:1895 reports only for a Windows pane whose runner is Claude (Codex, Grok and Antigravity agents get nothing), and the needs-you notice is not guaranteed (it needs a phone, is rate-limited, and does not say "send it again"; the card sentence does). My first line's "instead of looking idle or busy" was also wrong: the card keeps its state and gains a sentence. #8951 merged at 9231f56ccc and its follow-ups, after the v0819 bump 1b52b66d0e, so since 0.8.20.

## Not added
- #8960 and #8965: release tooling and a test, nothing a person sees.
- #8955, #8962, #8959: the iPhone app, which is not in this window.

## The list (5)
- windows: A message an agent never ran is reported (since 0.8.20)
- all: Shared tasks say who has finished (since 0.7.96)
- all: Agents that answer you elsewhere say so (since 0.7.96)
- all: An old Grok sign-in says since when (since 0.7.96)
- mac: An old Meta Muse sign-in says since when (since 0.7.96)

Per platform: Windows 4, Mac 4, Linux 3. The four older lines are the next pending ones by rank; none was in a window prod users saw.

## Checks
- `prod-check`: rc 0 (Mac and Windows prod 0.8.19, both recorded).
- An offline build of the committed pool is byte-identical to `web/whats-new.json`.

## Weakest premise
That the line holds on a Windows run: it rests on reading engine/status.js and the card sentence in web/index.html, and on Angel's read, not on a Windows box I ran.
