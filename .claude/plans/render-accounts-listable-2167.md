# render-accounts-openai: assert the listable-OpenAI ENABLED picker (stale check from #2140/#2167)

## The problem

`docs/browser-checks/render-accounts-openai.js:243` asserted
`say('model menu still parks for OpenAI', create-model.disabled === true)` — the
pre-#2140 "park every OpenAI model menu" behavior. #2140/#2162 (merged) made a
**listable** OpenAI account show an **enabled** picker of its own `/v1/models`. The
harness (`tools/browser-checks.sh:862-896`) stubs the WALK account's `/v1/models`
to `{data:[{id:"gpt-4o"}]}`, so WALK **is** listable → `create-model` is now
ENABLED → the stale assertion fails. This aborted the 0.6.30 (#2129) staging cut at
step 3b. Browser checks are not in the unit suite, so #2140/#2162/#2167's
challenge-loops could not see it; Baron's cut is the first run of this check since.

## The call: stale check, product correct

The product is right per Josh's #2167 intent (OpenAI never shows Claude models; a
listable API-key account offers its own OpenAI models) and Astra's OpenAI spec
(Direct-OpenAI key discovers + picks). Only a **not-listable / ChatGPT** account
parks on "OpenAI picks its own model for now." So the fix is to update the CHECK,
not the product. (Splinter concurred; the parked-vs-enabled-for-all-OpenAI question
is Josh's to rule on seeing 0.6.30 live — this matches current shipped behavior.)

## The change

`docs/browser-checks/render-accounts-openai.js`:
- Header comment updated: the model menu offers the listable account's own OpenAI
  models (only a not-listable account parks).
- The assertion now: selects the WALK account explicitly, WAITS for the async
  `/v1/models` fetch to settle past the synchronous "Loading…" disabled frame (the
  old read was racy — a slow fetch caught the loading-disabled state and passed),
  then asserts `create-model` ENABLED, offers `gpt-4o`, and shows NO Claude model.

## Not in scope

- Any product/web change (the behavior is already correct and shipped).
- Whether all OpenAI should park "for now" (Josh's live call on 0.6.30).

## Verification

The substantive proof is running `render-accounts-openai` green (needs a
browser-quiet window; the harness refuses concurrent page layers). The unit suite
is unaffected by a browser-check-file change.
