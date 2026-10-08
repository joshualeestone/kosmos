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
