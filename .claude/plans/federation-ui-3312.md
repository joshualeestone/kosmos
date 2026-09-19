# Federation UI, Add Project: New vs Join-External, invite-code, join+verify (#3312)

Branch: `federation-ui-3312` · Repo: joshualeestone/kosmos · Owner: Mona Lisa · web/index.html

## Source of truth
Josh, #chaoskosmos-design 2026-09-19 (wireframes ROUGH: IA + copy only; match the existing Kosmos design). Card #3312, umbrella #3311. Wireframes: ~/.cache/claude-handoffs/kosmos-federation-wireframes-2026-09-19/. Coordinator contract: ICK #3313 (~/work/kosmos-relay-fed-invite-3313/.claude/plans/fed-invite-3313.md).

## Done-condition
- The Projects "+ New project" button reads "+ Add Project".
- The Add-Project screen carries a TOP toggle: "Create New Project" (default) | "Join External Project".
- CREATE mode: the existing create form, plus "Add an external person" and "Add an external agent" buttons in the agents section. Clicking either reveals the invite panel: the verbatim message, the single-use code in a read-only field, a copy button, and a "copied" indicator.
- JOIN mode: "Enter your code to access an external project:" + a code input + a Verify button (spinner while verifying). On success: read-only Name + Description + a "+ Add an agent" section (no external-add) + the submit button reading "Join Project". Distinct error states for invalid / used / expired / revoked / self-join / double-join.
- The submit button reads "Create project" in create mode and "Join Project" in join mode.
- Messaging-only guardrail is never contradicted by any copy (a connected member views/messages, never drives your computer).

## Approach (web/index.html, markup + CSS + JS)
- Rename the create button text to "Add Project" (keep its id/handler).
- Add a `.pj-mode-toggle` (two pills + "or") at the top of the create screen; a JS setter toggles a mode class/state and swaps the create form vs the join form, and the submit label.
- CREATE: add the two external-add buttons beside "+ Add an agent". On click → POST /api/federation/invite {project_ref, project_name, project_desc?, invited_kind} → render the invite panel. Copy button uses the clipboard helper + a transient "copied" state.
- JOIN: code input + Verify → POST /api/federation/verify {code} → on ok render read-only name/desc + agents + flip submit to "Join Project"; on error render the specific message. Spinner reuses the app's existing spinner.
- Frontend calls a LOCAL /api/federation/* proxy (no credential in the frontend, per Angel's #3149 3b), mirroring the coordinator shapes.

## Decisions (reversible)
- Toggle style: two pills matching the wireframe (active = dark, inactive = outline), reusing the app's button tokens rather than a brand-new control language.
- project_ref in the create-with-invite flow: the app supplies a stable local project id at invite time and reuses it on create (coordination point, see Weakest premise).
- Invite panel is inline in the create form (per wireframe), not a modal.
- Copy string is VERBATIM Josh copy; never reworded.

## Weakest premise
The LOCAL /api/federation/* proxy routes do NOT exist yet (backend dependency: ICK coordinator + Baron transport + the local proxy in server.js). The UI is built against the contract and is testable with a mocked fetch; it must degrade honestly when the routes are absent (a clear "could not reach" state, never a fake success). The project_ref assignment in the create-with-invite flow (client-generated id vs create-then-invite) needs confirmation with ICK/Angel, the UI is structured so either resolution is a small change.

## Verification (as SHIPPED)
- node --test covers the new UI logic via the page's real functions: web.add-project.test.js (the markup: native-radio toggle, live external doors, invite panel, join mode) and web.federation-3312.test.js (mode toggle, error-reason mapping, mint/verify/join success + non-ok + unreachable degrade, the empty-name guard, reset, copy).
- The #1720 gate is satisfied by a `Browser-check:` trailer plus per-check `Browser-check-surface:` trailers (ferr, openAddProject). No docs/browser-checks assertion was added: the invite/verify/join flow needs the live /api/federation/* routes to render meaningfully, and those do not exist yet.
- FOLLOW-UP (near-term, does not need the backend): a docs/browser-checks assertion for the PURE-UI parts that are synchronous client state, the mode toggle switching create<->join and an external door revealing the invite panel + verbatim message. Deferred here only to keep this PR to the UI; tracked as a fast-follow once the browser-check is wired (README + runner + gate, per the three-part wiring rule).

## Deferred / follow-ups
- Abandon-with-invite: minting an invite then leaving create via "All projects" without creating the project hands out a code for a project that may never exist under that client ref. The defensive measure (disable doors until named/saved, or confirm-on-back) depends on how the project_ref reconciliation is settled with ICK, so it is a follow-up card, not resolved in this UI-only PR. Flagged to Splinter/ICK.
