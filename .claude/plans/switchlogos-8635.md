# switchlogos-8635: provider logos in the phone's Switch to menu (kosmos#8635)

## Goal
The phone's "Switch to" menu (AI Settings, from #8626) shows each provider's logo beside its name, for the App Store
frame Josh asked for on 11-17.

## Decided (reversible)
- The logos are the phone's own assets that the Runs on row already draws for an agent on that provider
  (SwitchProvider.mark, tested equal to runnerMark for an agent on each, and each asset tested present). Weakest
  premise: the card asks for "the same logo set as the computer's Add a provider dialog"; the phone's SVGs are not
  byte-identical to the board's docs/provider-marks files. They are the logos the phone already shows for each
  provider, so a provider looks the same in the menu and on its agent after the switch.
- A Label in the existing system menu (iOS 16+ draws its image), not a custom list.
- A system menu ignores SwiftUI size modifiers and draws a vector logo at its own size, and the files frame their
  drawings differently (OpenAI's fills about half its viewBox). Measured: OpenAI at half the others' size. So each logo
  is trimmed to its ink (scanned in a bitmap of known RGBA layout), fitted into one 22-point box with aspect kept, and
  kept a template image (the menu's colour in light and dark).
- Only what the phone can switch to is listed, unchanged from #8626.

## Measured
- ios/LogicTests/run-agentinfo.sh 190/190.
- The menu open in the simulator, light and dark, via a temporary UI test (not committed): logos even in size and
  tinted in both. Screens kept as 8635-switch-menu-light.png and -dark.png in PigeonPete's Files.
