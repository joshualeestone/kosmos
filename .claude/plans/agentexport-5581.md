# agentexport-5581: an agent can be taken out of Kosmos as one file (kosmos#5581)

Found by #5548: engine/agentfile.exportAgent (the export half of #1652) was built and tested but unreachable. The
import half is live (the create form's "import my existing agent"). Decided on the card: wire it, not delete it.

## Finished looks like
On an agent's Instructions panel, a person with a saved, non-empty instructions file sees "Download this agent", and
the link downloads that agent as one .agent.md file another Kosmos can import. Nothing shows when there is nothing to
share. Agents (token-only callers) cannot fetch it.

## Built
- server.js: GET/HEAD /api/agent/<name>/export. decodeSegment and knownAgent exactly as the instructions GET; the
  engine's refusal is a 409 with its sentence; a 200 is the file as a download (text/markdown, attachment with an
  ASCII fallback name and the exact UTF-8 one, no-store, nosniff). Not on the agent-token allowlists, so it needs
  the person's board credential.
- web/index.html: #d-instr-export under the instructions box, reset at the start of every load, shown with the
  link set only when the load found a saved, non-empty file.
- Tests: server.test.js '#5581' (404 unknown and malformed, 200 headers and body, round trip through
  /api/agent-import, HEAD has no body, empty is 409). Browser check render-agent-export-5581 (real server), wired in
  gated.txt, the reason-grep table and the README.

## Decided
- Placement: the Instructions panel, because the file IS the saved instructions plus the name.
- The export carries the SAVED file, not unsaved edits in the box (the row says "saved instructions").
- Weakest premise: instructions can hold something a person pasted in (a key). The download goes only to the
  person, but anything that later shares the file should mask it first.

## Review log
### Review 1 (opus): 1 BLOCKER, 3 WARNINGs
- BLOCKER fixed: an untied card clears the panel from a fixed list, which left the export row and the last agent's link (it would download that agent under the stranger's card). The row and link are in the untied reset now; browser-check arm.
- WARNING fixed: no test pinned "an agent token alone is refused"; server.agent-token-gate-4491.test.js now does (no credential, agent token, board token).
- WARNING fixed: refusals did not follow the board's download convention; they go through refuseDownload (navigation 204, the page's ?check=1 look gets the sentence, said on the panel), headers match sendFileDownload (CSP, RFC 5987).
- WARNING fixed: a first Save did not show the row; Save paints it.
- NITs fixed: a read failure is a 500 with a plain sentence (the engine's message can carry a path); focus leaves the row before it hides; refusal bodies prove the route answered; temp dirs removed.
### Review 2 (sonnet): 1 BLOCKER, 1 WARNING
- BLOCKER fixed: the click's ?check=1 fetch was a computed URL, which web.api-routes-3957 counts against a ceiling (CI red); the address is written out.
- WARNING fixed: the browser check never clicked; it now clicks (a real download of ezra.agent.md), refuses (the panel says why), and switches agents directly.
- NITs fixed: comment order, a ticket so an older answer never lands, asSentence, focus on the untied path.
### Review 3 (opus): 2 WARNINGs (tests)
- Fixed: the direct-switch arm could not fail (the next load repainted anyway); it now switches to an agent whose read fails, so only the load's own reset can clear the link. The Save paint has an arm. The click remembers its load (a refusal answered after a reload of the same agent is not said).
- NITs left: the HEAD ternary is equivalent (Node sends no HEAD body); the 500 branch is untested.
### Review 4 (sonnet): nothing above NIT. CONVERGED.
- NITs left (follow-up on the card): a Download click clears an unrelated Save message on the line; the check URL is built from CURRENT, not the link (equivalent today); navigation-204 asserted on the 404 branch only.
- web.* 2527/2527, web.api-routes 29/29, reason-grep 7/7, wired 11/11, server '5581' and gate '5581' green (07:27 CDT 2026-10-08). Browser check: queued.

## Validation (07:59 CDT 2026-10-08)
- Browser check render-agent-export-5581: 13/13 against the real server (real click download, refusal said on the panel, failed-load and untied resets, Save paint), screenshot taken. Its first queued runs failed to start: the worktree has no Playwright; the runner's NODE_PATH (~/work/pw-runtime/node_modules) fixes it.
- Rebased onto origin/main (with #5564). server.test 356/356, gate 28/28, agent-import 18/18, agentfile 9/9; guards fixture-discipline, cli.sandbox-data-4796, engine.reachable, no-brand-refs, no-name-refs, win32-separator, windows-coupling-1732, windows-tests-1777, reason-grep, api-routes-3957, browser-checks-wired: all green.
