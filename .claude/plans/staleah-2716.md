# staleah-2716: the 0.7.21 cut's one red browser check (render-autohello-switch-2716, #4008 provider arm)

Cut red 07:52 (cut-0721.log 2171, 2200): expected "Right now: OpenAI Codex (hello@example.com)", got "Right now: OpenAI
Codex". Cause: #5101 review 5 (122d46e94) rebuilt the bracket from the NEW account; this sibling check still encoded the
old behaviour (the Claude account kept under OpenAI), which that review called a bug. Decision: stale check, fix the
assertion; no revert. Weakest premise: no bracket is honest but not ideal (naming the OpenAI account the engine picked
is a follow-up).
Validation: both checks in a real browser (this one and render-switch-claude-5091), light lane on Agent1s.
