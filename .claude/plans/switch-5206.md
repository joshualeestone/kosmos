# switch-5206: the phone tap audit measures where a finger lands

Card: #5206, corrected after measuring. The Settings switches were already 44x44 targets via
`#panel-settings .toggle::after { inset: -10px -1px }`; the shot tool's audit read only their 42x24 box and false-red
them. That nudges a designer to grow a fine control's layout.

## Done looks like
- docs/browser-checks/mobile-shots.js `fitOf`: a control whose box is under 44 is probed before it is flagged.
  - It is scrolled into view, and each edge of a 44x44 square centred on it must hit the control
    (document.elementFromPoint; a hit on a descendant or on its ::after counts).
  - A probe that hits something else, or lands off screen, keeps the flag.
  - The window AND every scrollable ancestor scrollIntoView moved are put back (review round 1), so a screen's verify
    and after-step see the page as it was. The audit runs after the shot, so shots are unchanged.
- A settings-advanced screen (Settings > Advanced: three switches).

## Measured
- settings-advanced: old audit flags #eng-toggle and #look-toggle 42x24; new audit 0, on 16 phone shots.
- tasks: old flags 3 "Ada" .tsk-who 44x22; new 0. Correct: .tsk-who has a 44px ::after on touch (web/index.html ~4130).
- CONTROL, a real small control must still flag: the new audit on the task page WITHOUT #5200's rule (receipt-5153's
  page) flags all 10 controls at the audit's old sizes (Change who 25x17, Done 35x24, ...).
- Probed by hand on main: taps 9px above and below and 0.5px past each side of the Settings switches land on them
  at 390 with touch; at 1280 with a mouse they miss, as intended.
- Tests touching mobile-shots (desktop, leak, control-arms, pr-select, reason-grep, org-sectors, catalogue): 124/124.

- Synthetic page (lifted fitOf): an inner box and a strip scrolled to 10 and 5 stay at 10 and 5 after the audit;
  the previous version left them at 350 and 435. A ::after clipped by its scroller still flags (a finger cannot reach
  clipped space).

## Weakest premise
- elementFromPoint on an emulated touch page stands in for a finger. A finger is a disc, not a point, but Apple's 44
  is itself a box, so testing the box's edges is the same rule the audit always meant.
