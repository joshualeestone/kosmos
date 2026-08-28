# #1344: say why accessibility is needed, and give a button that opens the pane

**Josh, 2026-08-28, from the fresh-machine install:**

> *"I'd love to see how we want a message to say: 'Turning accessibility on so that Kosmos
> agents can work on this computer' and have a button to open that setting so that they
> can okay it as well."*

## What was already true

The **copy** half landed in #1214 this morning: the tmux permission box now names both
permissions instead of folder access alone.

The **button** did not exist, and the card's measurement holds:

```
x-apple.systempreferences in web/index.html   0
CONTROL, http(s) URLs in the same file       18
```

## What I found before writing anything

**1. A link or an anchor would not have worked.** `native-app/main.swift` is a WKWebView
host implementing `runOpenPanelWith`, `didFinish`, `didFail` and
`didFailProvisionalNavigation`. It does **not** implement `decidePolicyFor
navigationAction` or `createWebViewWith`, so a custom scheme is cancelled and
`target="_blank"` opens nothing in the window Josh actually uses.

⚠️ Which also means the 11 existing `target="_blank"` links may already be inert in the
native app. **Separate finding, deliberately not folded into this card.**

**2. The right mechanism already exists twice.** `/api/open-sleep-settings` and
`/api/reveal-app` are server-side `open` calls. This is the third of that family, not a
new idea.

**3. There is no accessibility state anywhere in the product.** The engine emits five
machine checks: `app-location`, `installed`, `labels`, `restart`, `sleep`. None concerns
accessibility or any permission, and nothing in `engine/machine.js` mentions TCC.

## The change

```
engine/machine.js   a11yPaneUrl()  probes for the Privacy pane, mirroring sleepPaneUrl
                    openAccessibilitySettings()  derives the URL, opens, refuses honestly
                    resetA11yPaneCache()  test hook, same reason as its sibling's
server.js           POST /api/open-accessibility-settings, four lines, no parameter
web/index.html      the sentence and the button, in "Keeping agents running"
                    the click handler, attached ONCE outside paintSettings
```

## Decisions, with reasons

**Probed, not hardcoded.** The pane's bundle identifier moved between macOS versions. A
stale one opens System Settings to nowhere, and a button that appears to work is the exact
failure this product is written against.

**It claims no state.** Nothing here can read whether the permission is granted, so there
is no tick, no "you have already done this", and the button does not hide once granted.
The button offers a door; it never says what is behind it.

**Not a check row.** Its sleep sibling hangs off a row that can go red. There is no
accessibility check and cannot be one from node, so this sits in the box as its own
sentence.

**Attached once, outside the painter.** The sleep buttons live inside re-rendered
`innerHTML`; this is static markup, and attaching it in `paintSettings` would add a
listener per repaint.

**The wording does not soften the app-control half**, per Josh's ruling relayed 2026-08-28
and honoured by #1214: agents acting in your other applications is the feature.

## What I could not verify, said plainly

**Whether the derived URL opens the right pane on this macOS version is a real-world fact,
and checking it means opening System Settings on somebody's machine.** I did not do that.
The probe plus the honest refusal is what makes that acceptable: if the pane is missing the
person gets a sentence rather than a dead button.

## Out of scope

- Reading whether accessibility is granted (a native-app change, `AXIsProcessTrusted`)
- The 11 possibly-inert `target="_blank"` links
