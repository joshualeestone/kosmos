# Gemini and Grok first-class on the first-run list; the Claude line at the top of every view (kosmos#3708)

From PigeonPete's 0.6.94 staging QA. Josh asked (09-24) for Gemini and Grok to show "exactly like GPT".

## Call
1. **Grok's real mark.** Settings had no real xAI logo either (the card assumed it did):
   `providerMarkNode` clones the first-run marks, and Grok fell back to an "X" letter chip everywhere.
   The mark is taken from grok.com's own header logo (x.ai answers 403 to fetching), the two mark
   paths unmodified and the wordmark dropped, viewBox measured in Chromium. It is inlined on the
   first-run row as `.pmark live` like the others, and `PROVIDER_MARK_KEY.xai` now points at it, so
   every provider picker shows it too. Recorded in docs/provider-marks/manifest.md (section 11).
2. **Truthful subtitles.** Grok: "xAI · subscription or API key today". Gemini: "Google · API key
   today" (its subscription path, #3568, is not live). Neither says "works today" the way Claude and
   GPT do, because Kosmos installs Claude's and GPT's tools and not these two yet (review pass 1).
3. **The Claude-unreachable line (#conn) moved above every panel**, beside #askcard, so it is at the
   top of every view. It used to sit after the panels, which put it at the top of Agents only. On an
   agent's Talk page (#3497, whose header loses its bottom gap) it takes that gap back.

## Rejected
- Saying "works today" for Gemini: its subscription half is not live, the card's own rule says the
  subtitle should say what is true.
- A newly drawn or third-party Grok icon: the manifest's rule is official vendor sources only.

## Weakest premises
- **Permission.** xAI's trademark terms were not captured (x.ai blocks fetching), the same state
  OpenAI's are in. Josh asked for Grok to show like GPT and supplied the Gemini mark himself after
  the manifest's permission question was raised; that is the basis. Reversible in one commit.
- Neither subtitle mentions that Kosmos does not install the Gemini or Grok command line tools yet;
  Connect says so when one is missing, and Claude's and GPT's subtitles do not mention install either.

## Tests
- web.firstrun-model.test.js: new arm (Grok's inlined mark, no chip, both subtitles); the slice
  tripwire raised 40000 -> 44000 with measured headroom.
- render-firstrun-grok-3386.js: the chip arms replaced by real-mark arms (mark, size, subtitle, the
  pickers' providerMarkNode('xai')). Restoring the chip reds 4, xai: null reds 2.
- render-provider-combobox-1040.js: Grok's option wears the mark (xai: null reds 6).
- NEW render-conn-top-3708.js: the line is below the header, above the content and in the same place
  on Agents, Settings, Projects, an agent's Talk page and New agent; the Talk page still fits.
  Moving #conn back reds 8; dropping the Talk-page gap reds 1.
- render-talk-fill-2622.js A1j: rewritten for the line above the panel (dropping the gap reds it).
- web.consolidated-980.test.js: stays green. The inlined paths are self-closing because its body-child
  counter treats `path` as void and a `</path>` closer drove its depth to -2 (114 "children").
- browser-checks-reason-grep: 138 -> 139 and 98 -> 99, measured, both from the new check.

## Suite round 1 (d2377c3c): 3 fails, all web.unique-ids
grok.com's two mark paths each carry `id="mark"` (a hook for its own CSS), a duplicate id in the page
and again in every providerMarkNode clone. Stripped from the inline copy; the path data is unchanged.
web.unique-ids.test.js was the guard that caught it.

## Review pass 1 (opus)
- BLOCKER, the duplicate `id="mark"` (the same defect the suite found): already fixed at 3449dc0d;
  also removed from docs/provider-marks/xai-grok-mark.svg.
- WARNING fixed: "xAI · works today" was untrue on a fresh computer. Grok's Connect first checks for
  its tool and, with none, says it is not installed and opens neither the sign-in nor the key box.
  The subtitle now names how it connects, the same shape as Gemini's.
- WARNING fixed: five stale descriptions of the chip or the old banner position (two comments, the
  placeAppSettings sibling comment, the combobox check's success line, its README row).
- NIT fixed: the subtitles use `&middot;` like Claude's and GPT's.
- NIT left: the "#541 ship-day" comment has had no element under it since before this branch;
  moving it means guessing where that line lives now.
- Measured clean by the reviewer: the #conn move on every view and agent-page section at three sizes,
  and the consolidated layout pixel-identical to main.
- My own slip, caught by an exit code: rewording the combobox check's success line put an apostrophe
  inside a single-quoted string, a syntax error that printed no FAIL line. Reworded; `node --check`
  run on every edited check.
