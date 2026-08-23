---
pre_challenge: true
method: challenge-loop
branch: unfurl
diff_hash: c0b826d66c9ff8e595cb6c462817afb1a63c082fe5b00994bbac6aa045460320
subdir_audit: passed
timestamp: 2026-08-23T17:34:47Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No (bounded at one round before it started; the reviewer was briefed to attack the gate and did)
**Total findings:** 12 (1 BLOCKER, 6 WARNINGs, 2 CONVENTIONs, 3 NITs)
**Fixed:** 10 | **Deferred:** 2

### Iteration 1
- [BLOCKER] server.js image route — SVG proxied on the board's origin; "open image in new tab" would run its script where the write routes live --> FIXED (engine refuses SVG; route adds `content-security-policy: default-src 'none'; sandbox`; both pinned)
- [WARNING] readCapped discarded the head of a page past 512 KB, so most real pages got no preview --> FIXED (pages keep their first 512 KB; images past the cap are refused; test re-pinned on the right outcome)
- [WARNING] the attribute regex stopped at either quote, truncating "Josh's page" at the apostrophe --> FIXED (per-quote alternatives; test)
- [WARNING] bodies unread on 3xx, non-2xx, not-a-page, not-an-image held sockets --> FIXED (discard())
- [WARNING] image cache could hold 1 GB --> FIXED (byte budget, 32 MB, oldest evicted)
- [WARNING] NAT64, 6to4, IPv4-compatible, site-local v6 forms passed --> FIXED (embeddedV4; tests for each, public forms stay allowed)
- [WARNING] transient failures cached ten minutes --> FIXED (refusals one minute; test)
- [CONVENTION] trailing dot in a hostname bypassed the name rule (caught by address) --> FIXED (stripped before the suffix tests)
- [CONVENTION] direct route omitted fetchedAt --> FIXED
- [NIT] ::ffff:8.8.8.8 over-refused after parser normalisation --> FIXED by embeddedV4 (::ffff:808:808 now reads as 8.8.8.8; test)
- [NIT] meta inside comments or scripts honoured --> FIXED (stripped before scanning; test)
- [NIT] second-poll assertion rests on a 50 ms sleep --> DEFERRED: the fake fetcher resolves on the next tick; noted in the test
- [NIT] (implicit) DNS rebinding --> DEFERRED: named in the module header as the residual, bounded by the caps

### Strengths (reviewer's measurements)
- Number-form attacks (2130706433, 127.1, 0x7f.1, 0177.0.0.1, [::ffff:7f00:1], [0:0:0:0:0:ffff:127.0.0.1]) all refused because the URL parser normalises before net.isIP; redirect to file:/data: refused on the next hop; relative Location resolved against the gated URL; empty and mixed resolver answers refused; the refusal tests carry a fetcher-call control.
- crossSiteRead holds for the drive-by (img loads and navigations send Sec-Fetch-Site; same-site from a subdomain refused).
- withPreviews mutates only freshly parsed rows; the page drops an empty image and any non-/api/ path.
