# cutnote-8188: kosmos#8188, a cut sheet says so on every path of the spreadsheet viewer

pvSheetInto returned early on "not a table of values" and "empty" before the cut note. Now: not a grid and cut says part
of the file could not be read (fires once #8168's reader change lands: on main the reader sends cut:false there);
empty and cut says nothing of the sheet can be shown; a cut grid says one sentence true for any cause (the reader does
not say why a sheet is cut). Check: render-file-preview-4930.js, per-path arms with uncut controls. Shots: two new
mobile-shots screens (sheet-cut-8188, sheet-cut-empty-8188).
