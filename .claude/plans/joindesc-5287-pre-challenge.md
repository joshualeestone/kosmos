---
pre_challenge: true
method: challenge-loop
branch: joindesc-5287
diff_hash: a0af942dbe7cf7c7a06af56b8f28aaf6c27aaca0368c58caa3d0064f883e29f1
validation: passed (D3: server.joindesc-5287.test.js 5/5; related server.fed*/federation/project + every web.* + guards 2782/2782; browser-check coarse+surface gates pass; rendered on a sandboxed board with a joined project in 4 layouts); full suite + full browser checks before merge
subdir_audit: passed
timestamp: 2026-10-05T13:28:37Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, fresh blind reviewer)
**Converged:** Yes (no BLOCKER; 2 layout WARNINGs fixed and measured; NITs noted)
**Fixed:** 2 WARNINGs | **Deferred:** 0 | **Asked (awaiting user):** 0

#5287: a project joined from another account shows who shared it and THEIR description, as theirs; its own
description (the brief its agents get) stays empty, as the join route has always deliberately kept it.

## Round 1 (sonnet): 0 BLOCKERs, 2 WARNINGs, 2 NITs
- [WARNING] a description up to DESC_MAX (1000, newlines kept) in the header was unbounded and a long unbroken word
  could overflow on a phone: FIXED (overflow-wrap:anywhere, max-height 10.5em with scroll). Measured on a sandboxed
  board with a 903-char description incl. a 300-char unbroken URL: in viewport at 390 px, no horizontal scroll,
  capped at 137 px and scrolling.
- [WARNING] the made line has per-layout header rules and the new block had none: FIXED (its own full-width row in the
  header, incl. the new-look non-consolidated rule). Measured in default and consolidated at 390 and 1280 px.
- [NIT] withShared re-spreads each project per GET: kept (cheap; linkFor is mtime-cached, one stat).
- [NIT] wording plain; curly quotes as escapes; no em dashes.
- Checked clean: no leak (GET /api/projects is not an agent-token or remote route; the CLIs read /overview); text
  cleaned at verify and painted with textContent only; only member links get shared; tests have controls.

## Weakest premise
That 10.5em with scroll is the right cap for the owner's description in a header; Mona Lisa can change it.
