# Plan: add GLM, MiniMax, DeepSeek, Kimi provider marks (kosmos#1040, piece 1)

## Goal
Add four new official-vendor SVG provider marks to the source library at
`docs/provider-marks/`, so the model-picker work (piece 2) has real marks to inline.
Sourcing only. No `web/` change on this branch.

## What "done" looks like
- `docs/provider-marks/` contains `glm-zai-mark.svg`, `minimax-mark.svg`,
  `deepseek-mark.svg`, `kimi-mark.svg`, each well-formed and rendering as the correct
  official mark.
- Each mark re-cropped so its viewBox is its own painted bounding box (98-100% fill),
  normalising on the ink like the existing edge-to-edge marks and unlike `openai-mark`
  (50% fill).
- `manifest.md` records, per mark: vendor source URL, monochrome-vs-brand-coloured, and
  the measured fill fraction.

## Decisions
- **Official vendor sources only**, per the Aug-14 manifest discipline: GLM from
  zhipuai.cn/logo-en.svg (Z.ai "Z" glyph isolated from the Z.AI wordmark); MiniMax from
  the vendor's own GitHub org repo `MiniMax-AI/MiniMax-01` (`figures/minimax.svg`);
  DeepSeek from deepseek.com page markup (whale path isolated from the wordmark); Kimi
  from the official `MoonshotAI/Branding-Guide` repo (`04-k-only/k-only-light.svg`).
  No simpleicons / seeklogo / brandfetch.
- **Colour treatment.** DeepSeek and GLM are monochrome -> `currentColor` (follow theme).
  MiniMax is brand-coloured (pink-red gradient) -> keeps its own values, gradient id and
  class inlined to avoid collision when placed in index.html. Kimi is a two-tone hybrid:
  K body `currentColor`, notch-dot constant brand-blue `#1783FF`, which reproduces the
  vendor's own light/dark variants exactly.
- **Every file rendered headless and visually confirmed.** A DeepSeek wrong-grab (the
  Zhihu "知" logo) was caught and dropped this way.

## Out of scope (piece 2, coordinated with Angel)
- Converting the `#d-provider` / `#create-provider` text `<select>`s to logo pickers.
- Whether the four new providers also appear in the firstrun onboarding picker (currently
  test-fixed at six providers) is a product question for Josh.
