---
pre_challenge: true
method: challenge-loop
branch: rnquote
diff_hash: e35f4bf109956c6e33b50c1d832b6118abf806944c4db00c8ac6ab255015b66f
validation: Scoped, stated plainly. The diff touches only tools/post-release-notes.sh and its test, so I ran tools/test-post-release-notes.sh (all arms pass, including the two new entity arms) and bash -n on both files. I did NOT run the full node or shell suite locally; nothing else reads this script. Control: both new arms go red against origin/main's script with the exact 0.7.37 garble. Field check: the fixed decoder over all 359 real versions-page entries leaves no HTML entity behind. The merge is gated on all-green GitHub CI.
subdir_audit: passed
timestamp: 2026-10-10T17:06:09Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one blind review; then fixes and a re-check)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
**Fixed:** both WARNINGs and one NIT. One NIT left, with a reason. | **Asked (awaiting user):** 0

The change (#5775, the 0.7.37 social-preview garble):
- post-release-notes.sh decodes the release note inside a single-quoted `node -e '...'` string. The literal apostrophes in its &#39; and &#8216;/&#8217; replacements ended the shell quote, so node got a broken program and "agent&#39;s" came out as "agent).replace(/&#821[67];/g,s". They are now written as \u0027, and a comment says never to type an apostrophe in that block.
- Also decoded now: &#x27;, &apos;, &rsquo;, &lsquo;, &#x2018;/&#x2019;, &ldquo;/&rdquo;, &#x201C;/&#x201D;.

### Per-Iteration Breakdown

#### Iteration 1 (blind review)
- [WARNING] &ldquo;/&rdquo; still undecoded; the real page uses them (v0.5.90, v0.5.95 came out raw) --> FIXED, plus the hex forms.
- [WARNING] the added entity forms had no test, so dropping &rsquo; later would stay green --> FIXED: a second fixture arm covers every named and hex form; red against main.
- [NIT] &#x2018;/&#x2019; hex apostrophes not decoded (unused today) --> FIXED anyway, same line.
- [NIT] &larr; is not decoded --> LEFT: it sits only in the page's nav bar, never inside a release note's first <p>.
- Reviewer confirmed: no apostrophe remains inside the quoted program other than its delimiters; &amp; is still decoded last, so nothing double-decodes; no em dashes added.

#### Iteration 2 (re-check)
- Test file: all arms pass. Both entity arms red against origin/main's script (control).
- All 359 real versions-page entries decode with no &...; left.
- No new findings.
