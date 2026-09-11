# adddir-2682: add an agent from an arbitrary folder

Card: kosmos#2682. An agent set up outside discovery's bounded roots (an orchestrator run from a shared dir, an agent in a non-standard location) is invisible to Kosmos with no way to bring it in. The only manual bring-in today is the loose-agent-FILE import (#1652), for a single downloaded `.md` file, not an existing agent FOLDER already on disk.

## The ask (Josh, via #admin)

"When a user sets up an agent in a way discovery does not reach, they should still be able to add it, for example an 'add an agent from a folder' action that points Kosmos at the agent's directory."

## Design decision (mine, per the decide-and-build ruling)

Build the FOLDER analog of the existing loose-file import (#1652), reusing its entire downstream flow:

- New endpoint `POST /api/agent-import-folder`, body `{ dir }`. It reads ONLY `<dir>/CLAUDE.md` and returns its raw TEXT as `{ ok, dir, text }`, the server-side sibling of the client-side "Choose a file" FileReader (a browser FileReader cannot read a server-side path). It does NOT parse or create: parse, validation and create all stay downstream in the import textarea's "Bring it in" (`importLoad`), unchanged. The only content check here is a non-empty read (an empty CLAUDE.md is refused rather than loading a blank box).
- New "Load folder" UI action next to the existing file-import controls: a directory-path input + button whose `loadImportFolder` handler POSTs `{ dir }` and, on `ok`, loads the returned text into the SAME `#import-text` textarea the paste/choose path uses. The operator then presses "Bring it in" to review, parse, validate and create, exactly as for pasted or chosen text.

### Why not touch discovery scope

Discovery's bounded auto-scan is deliberately bounded for safety (it never walks the whole disk). Widening it is a separate, riskier design (the card itself flags the open question and #1938). This card's ask is a MANUAL point-at-a-folder action, so the fix is a manual bring-in path, leaving `engine/discover.js` auto-scan untouched. That also keeps this out of the engine-discovery lane.

### The safety model, and where it departs from the file import

`/api/agent-import-file` gates on scan-membership (`scan.importable.some(c => c.file === file)`) specifically to avoid reading an arbitrary server-side path. This card by definition reads a folder OUTSIDE any scan, so that gate cannot apply. The replacement guard:

- The board is loopback-only and board-token authed, so the caller is the operator on their own machine reading their own file.
- Require an ABSOLUTE, existing directory path.
- Read ONLY a file literally named `CLAUDE.md` inside that dir (not an arbitrary filename), so the read surface is agent-instruction files, not arbitrary files.
- Mirror the file import's full hardening verbatim: a platform-independent `lstat` symlink/non-file refusal, then `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (each `|| 0` for win32), `fstat` isFile + size cap on the fd, read by fd. This closes the lstat->open TOCTOU window exactly as the exemplar does.

Agent-ness is NOT decided here. Whether the CLAUDE.md actually introduces an agent (vs a plain project instruction file) is decided downstream by `importLoad` when the operator brings it in, the same as for pasted or chosen text. So a non-agent CLAUDE.md returns `ok:true` with its text and is refused later at "Bring it in", not by this route.

Weakest premise: this reads a path the scan never vetted, a deliberate departure from the membership gate. It is bounded by loopback + auth (operator's own machine), a CLAUDE.md-only read, and the full symlink/TOCTOU hardening. If a future threat model needs more (e.g. a root allowlist), it is an additive tightening, not a redesign.

## Tests

- `server.agent-import-folder-2682.test.js` (end to end over HTTP): the happy path (a temp dir with a CLAUDE.md returns its text verbatim); a non-agent CLAUDE.md still returns its text (`ok:true`, because agent-ness is decided downstream); a dir with no CLAUDE.md refuses naming CLAUDE.md; an empty CLAUDE.md refuses; a symlinked CLAUDE.md is refused and the symlink target is never read out (the security arm); a relative path, a missing dir, an empty body, and a file-not-a-dir path each refuse.
- `web.import-folder-2682.test.js`: a source slice pinning the UI wiring (the input + button exist, the button is bound to `loadImportFolder`, and the handler POSTs the folder and loads the returned text into `#import-text`). The browser-check gate is satisfied by a `Browser-check:` trailer.

## Ship

Repo `joshualeestone/kosmos`, reviewer `joshualeestone` only, squash merge-on-green. PR links the card with non-closing `Addresses #2682`.
