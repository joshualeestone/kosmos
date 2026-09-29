# orgchart-file-4559: an org chart FILE into the New Agent team (#4559)

## Card
Josh, 2026-09-29 09:10: "upload an actual org chart file or something and have it capture people roles and reporting
structures." Extends #1280/#4217 (the paste-a-list upload). Done means: a sample chart image, a PDF and a CSV each produce
the right people, roles and reporting lines in the preview; creating builds the team with reports-to set; fixtures per
format. Liu Kang (m3311): plan on the card first; synthetic names only; heavy runs only on his go.

## Plan (posted on #4559, approved with conditions, Liu Kang m3317 / m3320)
- Local, exact, no model: CSV/TSV and XLSX (first sheet), columns found by header (name / first+last, title, manager by
  name or by id/email). No new package.
- Model: a picture (PNG/JPG/WebP/GIF) or a PDF, read by the person's own Claude Code headless with every tool off and
  the file inline, answering a JSON schema. Slides: export as PDF in v1.
- Preview: editable Reports to on every row; a line the reader was unsure of says "Check this: <why>" and Create waits
  for Looks right (or a new manager); a reporting loop is named and blocks Create.
- Create: /api/team members managers-first with reportsTo; a manager that is not created leaves the people under it
  reporting to the person (PUT profile reportsTo '').

## Liu Kang's five conditions (m3317)
1. Say before sending that the file is read by the person's own AI provider, and which one; allow cancel.
2. Any connected provider that can do it safely; if none, say so and offer CSV. Routing decided and measured: Claude Code
   only in v1 (Gemini CLI 0.58 cannot switch every tool off); key-based OpenAI/Gemini/Grok over HTTP is #4560.
3. The document is untrusted: no tools, JSON only, strict validation (plain one-line text, capped lengths, reportsTo must
   name someone in the list), nothing executed or used as a path.
4. XLSX without a package only if safe: per-part uncompressed cap (zip bomb), first sheet only.
5. Synthetic names in every fixture.

## Measured (2026-09-29, synthetic chart)
PNG: 7/7 people and managers right, one ambiguous connector marked unsure with a reason, 9s, about $0.04.
PDF: 7/7 right, two lines marked unsure, 12s, about $0.04.

## Weakest part
How well the model reads a crowded or low-contrast chart. The guard is the preview (Check this, confirm before create),
not the model's accuracy.
