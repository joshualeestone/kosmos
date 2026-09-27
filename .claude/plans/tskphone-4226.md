# #4226: the Tasks view on a phone (fields 16px, tap targets 44px)

## Finished looks like
On a touchscreen ((hover: none)), every field in the Tasks view is at least 16px, so iOS does not zoom, and every tap
target is at least 44px, without two targets' areas overlapping. The desktop, with a mouse, is unchanged.
render-tasks-view-3559 pins it on a 390x844 touch phone (fields, targets, titles on their number's line, collapsed
search width, pill overlays, and edge taps that land on the right control) and on a desktop control.

## Decided
- One touch-only block scoped to #panel-tasks (it follows the view into the iPad one-screen layout and never reaches
  Settings, Kano's trap on the project page).
- Checkbox: wrapped in label.tsk-hit whose padding makes the 44px tap area (11 above, 17 below, 14 either side), a
  label so the tap toggles the box natively with one change event.
- Title: stays an inline button so a long one wraps like text on its number's line; its tap area is padding
  (11 above, 15 below) with equal negative margins. Short one-line buttons use min-height 44.
- Drawn pills (subtask chip, agent) keep their look; a 44px ::after overlay is the tap area.
- Real room where areas would overlap: the meta line starts 16px below the title; stacked agent pills sit 22px
  apart; rows keep 13px below for the last pill.
- Weakest premise: rows are taller on a phone than on the desktop; that is the cost of 44px targets that do not
  overlap.
