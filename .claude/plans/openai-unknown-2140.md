# #2140 slice: offer unknown OpenAI model IDs marked "compatibility not verified"

## The gap (Astra's spec)

`engine/openaiaccounts.js` filters `/v1/models` down to a chat-model picker. The
old filter had two outcomes: recognised chat family (offer) or `openaiFamilyOf`
returns null (drop). That null folded together two very different cases:

- **denylisted non-chat** (audio / realtime / transcribe / tts / search / image /
  embedding / moderation / whisper / dall-e / instruct): definitely cannot drive
  a chat agent. This is #1026's whole point and must keep being dropped.
- **unknown** (neither a known chat family nor denylisted, e.g. a future
  `gpt-6` / `o5` / a real `gpt-3.5-turbo` outside the allowlist): might be a new
  chat family we do not recognise yet. Dropping it silently hides a drivable
  model.

Astra's rule for the unknown case: **mark, do not erase** — offer it with a
"compatibility not verified" note, ranked last, never the default.

## The change (engine only)

1. New pure `openaiModelClass(id)` → `{kind:'chat',fam}` | `{kind:'nonchat'}` |
   `{kind:'unknown'}`. Denylist checked first, so a non-chat variant of a known
   family (`gpt-4o-audio-*`) is nonchat, never unknown. Both former callers of
   `openaiFamilyOf` (`chatModelsFromList`, `chatRunnableIds`) now use
   `openaiModelClass` directly, and `openaiFamilyOf` (never exported, no external
   callers) is removed as dead code rather than left reading as live.
2. `chatModelsFromList` now emits a row for an unknown id: rank `OPENAI_UNKNOWN_RANK`
   (last), label suffixed `" (compatibility not verified)"` (the marker shows in
   the dropdown itself; the why-note only elaborates the selected row),
   `unverified: true`, and an honest `why`. Nonchat is still dropped.
3. The default is chosen only among **verified** (recognised) rows, so an unknown
   model is never pre-selected. An account that lists ONLY unknown models gets no
   default row — both pickers prepend their own selected "Let OpenAI choose", so a
   no-default menu is never a menu with nothing selected.
4. `chatRunnableIds` now admits chat AND unknown ids (offerable ⇒ runnable), so a
   chosen/stored unknown id validates rather than being refused; only denylisted
   non-chat ids stay out.

No `web/` change: both the create and detail pickers already render `m.label` per
option and `m.why` on selection, so the marker and note flow through unchanged.

## Reconciliation with prior slices

- **#1026** (drop non-chat so an agent does not fail to start): preserved — the
  denylist still drops, proven by a control that a nonchat id beside an unknown
  one is still dropped, and by the untouched #1026 tests.
- **#2191** (collapse dated snapshots for display): unchanged — collapse still
  applies to unknown ids by base, and the runnable set stays un-collapsed.

## Weakest premise

Offering an unknown model can reintroduce the #1026 "agent fails to start" for
that specific model. The "compatibility not verified" marker is the mitigation:
the user chooses knowingly, which is Astra's stated intent. Anything we
positively recognise as non-chat is still dropped, so the risk is confined to
genuinely unrecognised ids, and the label makes the uncertainty explicit at the
point of choice.

## Not in scope

The per-agent connectionId + exact modelId persistence hardening (the other open
#2140 slice) is a separate follow-up needing end-to-end (booted-board)
verification.
