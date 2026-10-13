# kosmos#5977 (UI): Qwen in Settings, Add a provider, first run and the agent surfaces

Stacked on the engine branch (qwen-5977). Open this PR only after the engine PR is merged, with main merged in.

## What it does
- Add a provider offers Qwen: address, model, optional key, name. On this computer, a guided local setup (Ollama)
  with a download bar ("1.9 of 4.7 GB"); Add is held until the 16k model is there.
- A Qwen agent reads as Qwen everywhere (provider word, account move, model menu, the board from its job, the guide
  fallback: "not answering at its address", never credits or sign-in).
- First run: the Qwen row is live (not a button); on Windows it reads "Coming to Windows" and is greyed by CSS.
- Windows is never offered Qwen: listed as coming, no intro says it works, the create and switch menus omit it, the
  local panel never shows, and the setup/download routes refuse even when asked directly.

## Decided, with what was rejected
- Add waits for Qwen's local setup instead of running a 4.7 GB download itself behind "Add" (design review, Mona
  Lisa). No Ollama, an unreadable answer, or a server the person names: Add stays open.
- The 700 ms confirm lock uses aria-disabled, because a disabled focused button drops focus.

## Evidence
- UI set 94/94 and engine set 391/391 at the design-review commit; 10/10 mutants in UI review 2.
- Browser checks: the seven the surface gate named, each hermetic, each run and passing, recorded as
  Browser-check-surface trailers (d5a706c45, 132f82851).
- Design shots looked at (settings-add-qwen, settings-add-qwen-downloading, first-run-model).
- Full suite: see Validation below.

## Review (blind, alternating models)
1. the Qwen step is put away; Qwen named everywhere; one poll; safer confirm (76e28ca33).
2. Qwen stays Qwen after a switch or disconnect; Windows is not offered Qwen (709a0480b).
3. no defect in confirm, polling, stale answers, XSS or syntax; Windows intro wording (361977a50).
4. opus: no blockers or warnings; converged (d3de966cb). Then design review (b4cf9d81d).

## Validation
- 916bc06b0: FAILED, 9 of 19737, all this branch's: a comment after ACCT_KEYED_ROUTE's ';' broke a test's const
  slicer; a non-literal fetch URL; two inline capitalizers over the ceiling; the first-run Qwen pill missing from the
  Windows-hidden list; five tests pinning guideFailure's old shape (it gained providerName). Fixed in 5a61d1d2b.
- After the engine merged (kosmos#6043): main merged in at d83e244e6 (one server.js conflict, the UI's local-Qwen
  routes kept). Qwen suites and guards 259/259; browser-check gates pass.
- d83e244e6 (2026-10-13 11:34 CDT): PASSED, 20128 tests, 0 failed, audit clean.
