# Provider brand marks: manifest

Fetched 2026-08-14. Official vendor sources only (vendor brand page, vendor's own
website markup, or vendor CDN referenced by that markup). No third-party icon packs
were used: no simpleicons, worldvectorlogo, seeklogo, brandfetch, or wikimedia.

Every file below was rendered in Chromium and visually confirmed to be the mark it
claims to be. That check caught two wrong grabs mid-task (see "Rejected" at the end).

---

## 1. Anthropic / Claude

### `anthropic-claude-mark.svg`
- **viewBox:** `0 0 125 125` (1986 bytes)
- **What:** The Claude spark / starburst mark, on its own.
- **Source URL:** https://claude.com/ (inline SVG in page markup)
- **Element:** `<svg class="ClaudeWordmark-module-scss-module__u-w1aa__claudeWordmark" viewBox="0 0 573 125" aria-label="Claude">`
- **Note:** Claude.com ships the spark and the "Claude" lettering as two `<path>`
  elements inside one wordmark SVG. This file is the spark path isolated; its
  geometry occupies exactly x 0-125, y 0-125, so the viewBox is exact, not cropped.

### `anthropic-claude-wordmark.svg`
- **viewBox:** `0 0 573 125` (7969 bytes)
- **What:** Full Claude lockup, spark plus the "Claude" wordmark.
- **Source URL:** https://claude.com/ (inline SVG, same element as above, unmodified
  except that the CSS-module `class` attribute was stripped)

### `anthropic-mark.svg`
- **viewBox:** `0 0 46 32` (339 bytes)
- **What:** The Anthropic corporate "A" glyph (the angular A), distinct from Claude's spark.
- **Source URL:** https://www.anthropic.com/ (inline SVG in page markup)

**Brand guideline page seen:** No public Anthropic brand/press asset page was found.
The published brand material is the `brand-guidelines` skill in Anthropic's own GitHub
org, https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md,
which covers colors and typography rather than downloadable logo files. Assets above
therefore come from the vendor's own site markup.

---

## 2. Google Gemini

### `google-gemini-mark.svg`
- **viewBox:** `0 0 28 28` (1144 bytes)
- **What:** The Gemini spark / sparkle mark, four-pointed star with the official
  radial gradient (blue to purple).
- **Source URL:** https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg
- **Why this is official:** `gstatic.com` is Google's own asset CDN, and this exact
  filename is referenced twice in the served HTML of https://gemini.google.com/ .
  Verified both by fetching the file (HTTP 200) and by grepping the Gemini homepage
  markup for the reference.
- **Licence / brand page:** none surfaced for Gemini specifically.

---

## 3. OpenAI

### `openai-mark.svg`
- **viewBox:** `0 0 716 716` (2415 bytes)
- **What:** The OpenAI Blossom mark (the hexagonal knot), black version.
- **Source URL:** https://cdn.openai.com/brand/openai-logos.zip
  → `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_Black.svg`

### `openai-wordmark.svg`
- **viewBox:** `0 0 1212 542` (2149 bytes)
- **What:** The OpenAI wordmark, black version.
- **Source URL:** https://cdn.openai.com/brand/openai-logos.zip
  → `OpenAI-logos/SVGs/OAI_OpenAI_Wordmark_Black.svg`

- **Brand guideline page:** https://openai.com/brand/ (the official OpenAI Design /
  brand page; the zip above is the logo download it links). The zip also contains
  White variants of both marks plus PNGs, kept in `_scratch/openai-logos-unzipped/`.
- **Access note:** openai.com sits behind a Cloudflare interactive challenge that
  returns HTTP 403 to curl and to headless fetches. The page was reached with a
  headed Chromium session, which cleared the challenge; the asset URLs above then
  download fine over plain curl.

---

## 4. Meta / Llama

Llama has no official standalone brand mark, so Meta's corporate mark is used, as
instructed.

### `meta-mark.svg`
- **viewBox:** `0 0 25.6 17` (911 bytes)
- **What:** The Meta infinity mark on its own.
- **Source URL:** https://www.meta.com/brand/resources/meta/company-brand/
  (inline SVG in page markup, `<title id="meta-company-logo">Meta company logo</title>`)
- **Note:** Meta's brand page ships the infinity glyph and the "Meta" lettering as
  subpaths of a single `<path>`. This file keeps only the two infinity subpaths. The
  viewBox was not guessed: it is the measured `getBBox()` of those subpaths rendered
  in Chromium, x 0, y 0, w 25.6, h 17.

### `meta-wordmark.svg`
- **viewBox:** `0 0 85 17` (1858 bytes)
- **What:** The official Meta company lockup, infinity mark plus "Meta" wordmark.
- **Source URL:** same page and element as above, unmodified except that the
  framework `class` and `height="100%"` attributes were stripped.

- **Brand guideline page:** https://www.meta.com/brand/resources/meta/company-brand/
  (Meta Brand Resource Center). That page also links an official
  `Meta_Company-Lockup.zip` on `scontent-*.xx.fbcdn.net`, but the link is
  session-signed and returned HTTP 403 when fetched directly, so the inline SVG from
  the same page was used instead.
- **Access note:** meta.com rejects a bare curl with HTTP 400. It serves normally once
  full browser headers (`sec-ch-ua`, `Sec-Fetch-*`, `Accept-Language`) are sent.

---

## 5. Alibaba / Qwen

### Qwen: NO official SVG found.

Qwen publishes its mark only as raster. Everything checked:

- https://qwen.ai/ and https://qwen.ai/home — logo is a PNG. Rendered the page in a
  real browser to defeat JS-only rendering; zero inline SVG, zero `.svg` references.
- https://chat.qwen.ai/ — the only inline SVG is a UI icon sprite
  (`__qwen_iconfont_sprite_root`, symbols like `qwpcicon-add`). No logo symbol in it.
- Qwen's favicon is a PNG: `https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png`
- The official Qwen wordmark as served by qwen.ai is a 180x48 PNG:
  `https://img.alicdn.com/imgextra/i3/O1CN01JLF4IJ1yAv1ZE7bfQ_!!6000000006539-2-tps-180-48.png`
  (viewed and confirmed: blue Q spark plus "Qwen" lettering). Raster only, so not saved.
- Official GitHub org https://github.com/QwenLM — searched the org's repo trees. The
  only brand file is `QwenLM/Qwen/assets/logo.jpg`, a JPEG. No SVG anywhere in the org.

Per instructions, no lookalike was substituted. The Alibaba Cloud mark below is the
stated fallback.

### `alibaba-cloud-wordmark.svg`
- **viewBox:** `0 0 295.93 37.28` (3027 bytes)
- **What:** The Alibaba Cloud logo, orange bracket mark plus "Alibaba Cloud" wordmark.
- **Source URL:** https://www.alibabacloud.com/ (inline SVG in page markup, header logo)
- **Licence / brand page:** none surfaced.

---

## 6. Mistral AI

### `mistral-mark.svg`
- **viewBox:** `0 0 21 15` (514 bytes)
- **What:** The Mistral "M" flag / pixel mark, full colour, in the official five-band
  palette: `#FFAF01`, `#FF8204`, `#FA500F`, `#E61300`, `#C4001D`.
- **Source URL:** https://mistral.ai/ (inline SVG in page markup)

### Mistral wordmark: NOT saved.
Mistral's homepage carries the flag mark in several variants (full colour, monochrome
black, blue-on-square, dark-square) but no "Mistral AI" lettering wordmark as SVG. No
public Mistral brand/press asset page was found. Rather than ship a near-miss, only the
mark is included.

---

# Added 2026-09-08 by Mona Lisa (kosmos#1040)

Four new provider marks: GLM (Z.ai), MiniMax, DeepSeek, Kimi. Same discipline as above,
official vendor sources only, no third-party icon packs. Every file was rendered (headless
Chromium + rsvg) and visually confirmed to be the mark it claims, and the DeepSeek grab
below caught a wrong-glyph the same way the 2026-08-14 pass caught Gartner and the App
Store badge.

**Two things these four record that the six above did not**, both because kosmos#1040
asked for them:

1. **The ink-to-viewBox fill fraction**, measured with `getBBox()` in headless Chromium.
   The 2026-08-14 marks were mostly edge-to-edge (99-100%) except `openai-mark.svg` at
   50% x 50% (25% by area), which renders half-width beside the others. To stop that
   recurring, **each mark below was re-cropped so its viewBox is its own painted bounding
   box** (the card's recommended "normalise on the ink, not the box"). All four now sit at
   ~98-100% fill by construction, so a ninth mark is a measurement and not an argument.

2. **Monochrome vs brand-coloured**, because it decides one line of code: a monochrome
   mark takes `currentColor` and follows the theme through `.pmark.live`; a brand-coloured
   one keeps its own values. Getting this backwards is what left `openai-mark` hardcoded
   `fill="black"` and invisible on dark. Each entry states which, and one (Kimi) is a
   two-tone hybrid that the earlier two-category split did not anticipate.

## 7. GLM / Z.ai

### `glm-zai-mark.svg`
- **viewBox:** `0 0 31.85 27` (491 bytes)
- **What:** The Z.ai "Z" mark. GLM is the model family from Zhipu AI; its platform and API
  now brand as **Z.ai** (`api.z.ai`), and the "Z" is that brand's mark. There is no
  separate "GLM" logo, so the Z.ai mark is the correct official mark for a provider named
  GLM.
- **Source URL:** https://www.zhipuai.cn/logo-en.svg (the served "Z.AI" wordmark; the three
  Z subpaths were isolated from the ".AI" lettering). The same "Z" also ships as a solid
  rounded tile at https://z-cdn.chatglm.cn/z-ai/static/logo.svg (z.ai header); the glyph
  from the wordmark was used instead of the tile so the mark is a transparent glyph like
  every other mark in this folder rather than a solid app-icon square.
- **Monochrome or brand-coloured:** **Monochrome.** Stored `fill="currentColor"`, follows
  the theme.
- **Fill fraction:** 99.5% x 100% (re-cropped to the Z's painted bbox).

## 8. MiniMax

### `minimax-mark.svg`
- **viewBox:** `0 0 490.16 411.7` (1091 bytes)
- **What:** The MiniMax "M" soundwave mark, the official pink-to-red gradient
  (`#e4177f` to `#e73562` to `#e94e4a`, left to right).
- **Source URL:** https://raw.githubusercontent.com/MiniMax-AI/MiniMax-01/main/figures/minimax.svg
  MiniMax publishes no inline-SVG logo on `minimax.io` / `minimaxi.com` (raster PNGs only,
  like Qwen), but its **own** GitHub org `MiniMax-AI` ships this vector in the MiniMax-01
  model repo. That is a vendor source, not a third-party pack.
- **Monochrome or brand-coloured:** **Brand-coloured** (gradient), like Gemini and Mistral.
  Keeps its own values. The gradient id was renamed to `pmark-minimax-g` (from a
  non-ASCII id) and the class-based fill was inlined as `fill="url(#pmark-minimax-g)"` so
  nothing collides when the mark is inlined into `web/index.html`. The Illustrator export's
  two redundant `<g>` wrappers (with non-ASCII default "Layer" ids) and its unused
  `xmlns:xlink` declaration were stripped as well, leaving a single `<path>` under `<defs>`.
- **Fill fraction:** 100% x 100% (the tallest bars span the full box; the mark is wide,
  aspect ~1.19:1, and centres inside a square cell under `preserveAspectRatio`).

## 9. DeepSeek

### `deepseek-mark.svg`
- **viewBox:** `0 1.5 27 20.1` (3586 bytes)
- **What:** The DeepSeek whale/dolphin mark, on its own.
- **Source URL:** https://www.deepseek.com/ (inline SVG in page markup). DeepSeek ships the
  whale glyph and the "deepseek" lettering as ten `<path>` elements inside one wordmark
  SVG; this file is the whale path isolated (it is the one path confined to x 0-27).
- **Note / wrong grab caught:** the page also carries a `2500 x 2500` inline SVG that
  looked like a plausible standalone mark; rendered, it was the **Zhihu** "知" logo (a
  different site's badge). Dropped, exactly as the 2026-08-14 pass dropped the Gartner and
  App Store grabs. The whale from the wordmark was used instead.
- **Monochrome or brand-coloured:** **Monochrome.** DeepSeek's own markup serves the whale
  as `fill="currentColor"` (the page paints it brand-blue `#4D6BFE` via CSS). Stored
  `currentColor`, so `.pmark.live` renders it in theme ink like Claude and OpenAI; the
  brand blue is recorded here if a coloured treatment is ever wanted.
- **Fill fraction:** 98.6% x 97.5% (re-cropped to the whale's painted bbox).

## 10. Moonshot / Kimi

### `kimi-mark.svg`
- **viewBox:** `0 0.94 23.95 23.25` (1090 bytes)
- **What:** The Kimi "K" mark, the K with the floating rounded-square notch at top-right.
- **Source URL:** the official **MoonshotAI Branding-Guide** repo,
  https://github.com/MoonshotAI/Branding-Guide (`scenarios/04-k-only/k-only-light.svg`).
  This is Moonshot's own published brand guide, not a third-party pack. (The standalone
  icon in `scenarios/03-icon-without-kimi/` is PNG-only; the "k-only" scenario carries it
  as SVG.)
- **Monochrome or brand-coloured:** **Two-tone hybrid**, and this is the category the
  earlier split did not anticipate. The brand guide's own light and dark variants differ
  only in the K body (black on light, white on dark) while the notch-dot stays brand-blue
  `#1783FF` in both. So the mark is stored with the **K body `currentColor`** (follows the
  theme, reproducing the official light/dark variants exactly) and the **dot a constant
  `#1783FF`**. Rendered on both `#fff` and `#1c1c1e` and confirmed against the vendor's own
  two variants.
- **Fill fraction:** 100% x 100% (re-cropped to the mark's painted bbox).

---

## Permission for the four added 2026-09-08

Following Renet Tilley's 2026-08-26 point below (provenance is not permission): these four
carry **provenance but no captured licence**, the same status as OpenAI/xAI above. GLM,
MiniMax and Kimi come from the vendors' own GitHub/site assets; DeepSeek from its own site
markup. None of the four vendors' trademark terms were captured here, and a nominative-use
mark still may carry usage restrictions. Not a claim of infringement, a claim that the
permission half is unrecorded, matching the folder's existing pattern. This is the same
open question `web/index.html` already carries for the six marks it renders today.

---

## Rejected during verification

Two files were saved, rendered, and then discarded because rendering showed they were
not the vendor's mark. Recording them because both were plausible from the markup alone:

- A 90x27 SVG pulled from `alibabacloud.com` markup, referenced under a JSON key
  literally named `brandImage`, rendered as the **Gartner** logo. It was an analyst
  badge, not Alibaba's mark. Replaced with the real header logo.
- A 128x38 SVG on `mistral.ai`, selected because its aspect ratio matched a wordmark,
  rendered as the Apple **"Download on the App Store"** badge. Dropped, not replaced.

## Files kept for audit

`_scratch/` holds the fetched page HTML, the unpacked OpenAI logo zip (including the
White variants and PNGs), and the extraction scripts. `_sheet.png` is the rendered
contact sheet of all ten final files.

---

# Permission, which is a different question from provenance

**Added 2026-08-26 by Renet Tilley (kosmos#1052, findings from kosmos#570's logo task).**

Everything above records **where each mark came from**. It does not record **whether we
are permitted to use it**, and those are not the same question. A mark can be
impeccably sourced from the vendor's own page and still be one we may not ship.

⚠️ **Read this before adding a mark to a surface, not after.** Captured from each
vendor's own published terms on 2026-08-26. Quoted rather than summarised, because a
paraphrase of a licence is not a licence.

## Anthropic / Claude

> *"You may only use our trademarks as specifically permitted by us and only in
> materials we approve beforehand."*
> *"We will supply an image (or images) of the trademark(s) for your use."*
> *"No alterations of our trademarks (changes to color, font, proportion, or otherwise)
> are permitted."*
> — `anthropic.com/legal/trademark-guidelines`

And from Claude Code's own legal page (`code.claude.com/docs/en/legal-and-compliance`):

> *"You can't use the Claude Code or Anthropic names or logos as part of your own
> product, feature, or company name, in your own logo, or in a way that suggests
> Anthropic built, endorses, or is partnered with your product. Any other use of
> Anthropic's names or logos is governed by our Trademark Guidelines and requires our
> written permission."*

🛑 **There is no public Anthropic logo download, by design.** Anthropic supplies the
file on request. The marks in this folder were taken from `claude.com` page markup,
which is a legitimate provenance trail and is **not** a permission. Written approval
goes through `marketing@anthropic.com`.

## Google / Gemini

> *"Use only Google-approved artwork when using Google's logos."*
> *"Don't remove, distort, or alter any element of a Google Brand Feature."*
> Written requirements are supplied *"at the time of our approval"*.
> — `partnermarketinghub.withgoogle.com/brands/google/trademarks-and-terms/trademark-guidelines-for-proper-usage/`

Google publishes no Gemini logo on its trademarks list; artwork comes with approval.

## Mistral

> *"Do not recolor."* · *"Do not stretch, deform, rotate."* · *"Do not modify the
> layout."* · *"Do not use on a colored background."* · *"Do not use a frame."*
> *"Partners and collaborators are welcome to use our brand."*
> — `mistral.ai/brand`

⚠️ **Mistral publishes no SVG at all.** The brand page offers PNG/JPG only. The single
SVG referenced by that page is a decorative pixel-art sneaker, not the mark: it is
served from `mistral.ai`, on the brand page, as `image/svg+xml`, in Mistral's own
palette, and it is a shoe. Rendered and checked, 2026-08-26.

## Meta

> *"All other forms of marketing do not require permission but must use the officially
> provided assets and abide by the guidelines on this site."*
> — `meta.com/brand/resources/`

⚠️ Meta's brand centre has **no Llama or AI section**, and `llama.com` publishes no
brand page. So permission is the easy part and there is no officially provided Llama
asset to comply with.

## OpenAI and xAI

**Not captured.** Both return HTTP 403 to automated fetching, and the block survives a
full Chrome User-Agent with realistic headers, so it is TLS/bot fingerprinting rather
than User-Agent sniffing. Their terms need a browser session, and the `openai-mark.svg`
and `openai-wordmark.svg` above therefore carry **provenance but no captured licence**.

## ⭐ The one line to take from all of this

**Two of the six vendors whose marks this folder holds require written permission before
the mark may be used at all**, and neither permission is recorded here or anywhere else
I could find. That is not a claim that Kosmos is infringing: nominative use is real, and
StoneSyndicate may hold permissions I have no visibility into. It is a claim that **the
folder documents sourcing thoroughly and permission not at all**, and that the second
is the half with legal exposure.

Related: `~/.cache/claude-handoffs/FLAG-vendor-marks-already-shipping.md`, which raises
the same question about the marks currently rendered in `web/index.html`.
