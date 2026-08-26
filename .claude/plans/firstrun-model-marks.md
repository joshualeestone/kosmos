# Plan: firstrun-model-marks

Issue #876 (mine, filed 2026-08-25 17:02) plus Josh's fresh-Mac install
report the same evening (screenshots at 21:25 CDT): the "Choose a model"
first-run step was collapsing five of six providers behind a closed
"More models" disclosure (#262, shipped 2026-08-22), and Josh wanted the
richer, all-visible design back. Traced the collapse's origin to git
history (pre-#262 commit) and confirmed the richer look he referenced is
this session's own design-pack artifact ("Kosmos App Style"), which
already carries real inlined vendor SVGs for all six providers.

Josh settled the direction directly, 2026-08-25 21:08 CDT: "I want to
show all of the models. That's more important to me than having the
button above the fold... we could make the button show and the modal
stuff could scroll behind it even." Splinter's framing, which this plan
follows: "#262's problem, solved by pinning instead of hiding" — not a
revert, since #262's own overflow measurement (Continue 300px below the
fold at 950/800/700px if the card just grows) still holds.

## Changes

1. **All six providers shown, always, no disclosure.** Removed
   `<details class="smore">…</details>` from `#fr-pane-3`; each provider
   (Claude, Gemini, GPT, Llama, Qwen, Mistral) is now its own `.llm` row
   at the same visual weight, matching the pre-#262/pack shape.
2. **Real vendor marks, inlined SVG.** Replaced Claude's plain gradient
   `.llm-disc` marker (and the empty aria-hidden spans the other five
   never had) with `.pmark` — real inlined vendor SVGs for all six,
   sourced from the "Kosmos App Style" design-pack artifact. Claude
   renders in colour (`.pmark.live`); the other five are monochrome by
   CSS `grayscale()` filter (`.pmark.dim`), not by forcing fills, so
   Qwen's white-counter construction survives instead of filling solid.
   Retired the now-unused `.llm-disc`/`.llm.off .llm-disc` CSS.
3. **Sticky footer, whole wizard.** `#firstrun .fr-box` is now a bounded
   flex column (`max-height: calc(100vh - 2 * var(--space-8))`);
   `#firstrun .fr-body` scrolls internally (`overflow-y: auto; flex: 1 1
   auto; min-height: 0`); `#firstrun .fr-acts` (Continue/Check again/Back)
   stays pinned at the bottom (`flex: 0 0 auto`, opaque `background:
   #fff` so scrolled content doesn't show through). Applied to all six
   first-run steps, not step 3 alone — #262 itself measured step 4
   growing tall on some machines, and a step that already fits scrolls
   nowhere, so this is free everywhere but the one step that needed it.
4. **`.smore-t` kept, reused** for the "Runs on this computer" tier
   label — same class, same visual treatment, no new CSS needed there.

## Verification

- [x] `node --test web.firstrun-model.test.js`: rewrote the file for the
      new shape (all-visible rows, real marks, sticky footer CSS) — 7/7
      pass, including a rewritten "no disclosure survives" test and a new
      "every provider carries a real, inlined vendor mark" test.
- [x] `npm test` (full suite): 0 failures, including the create form's
      own `render-create-form.js`-driven check that a `.smore` disclosure
      does NOT exist there (unaffected — the create form uses a `<select>`
      menu, never had `.smore` in this branch's history).
- [x] Live Playwright verification at #262's own three measured heights
      (950/800/700px): at every height, all six `.llm` rows render, all
      six real SVG marks render, provider order/names match, and
      `#fr-next` (Continue) sits fully inside the viewport with no overlay
      scroll needed. Screenshots confirm the visual match to the design
      pack (real marks, monochrome dim state, "RUNS ON THIS COMPUTER"
      section, content visibly scrolling under a pinned footer).
