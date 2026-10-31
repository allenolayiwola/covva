# Adaptive layout verification

## Status

Automated coverage: breakpoint/grid helpers, explicit-fold pane geometry, iOS
orientation config, Android policy and idempotent Kotlin source transform,
phone sign-in render/scroll sizing, and preview selection across width changes.
The Kotlin fixture is copied from Expo 58.0.21's installed template. Its manifest
already includes screenSize, smallestScreenSize, screenLayout, and orientation;
the plugin preserves all flags and ensures these four plus resizeableActivity.

No emulator/device visual or native build verification was performed in this
workspace. The matrix below is a **manual acceptance checklist**, not a claim
that these devices were run. No native dependency or SDK version changed.

## Screen matrix

For every row, check **Welcome/sign-in** (email, sign-up, phone, keyboard and
validation), **Consent**, **Explore**, **My Cover**, **Requests**, **Account**,
and **loading/account-error**. Exercise portrait and landscape, including
attempted phone rotation. Check text scaling, scrolling, safe areas and focus.

| Width (pt/dp) | Expected layout | Portrait | Landscape |
| --- | --- | --- | --- |
| 375 | Original compact spacing and bottom tabs | Pending | Phone must remain portrait |
| 466 | Compact; Duo outer 466×678, about 84pt right safe inset | Pending | Phone must remain portrait |
| 669 | Wide, reading cap, preview list-detail when available content fits | Pending | Pending on tablet/eligible Android |
| 768 | Wide, reading cap, preview list-detail | Pending | Pending on tablet/eligible Android |
| 951 | Wide, side navigation rail, preview list-detail | Pending | Pending on tablet/eligible Android |
| 1024 | Wide, side navigation rail, preview list-detail | Pending | Pending on tablet/eligible Android |

Use current **window** width for layout, not physical device width. Rail begins
at 840. Split requires 552pt of actual content width after safe areas, rail and
padding. Reading pages (including Account) cap at 720; preview pages cap at
1100. There are no live data lists, grids, sheets or modals in this scaffold.
Preview entries are explicitly informational, not fabricated customer records.
The existing launch screen has no custom full-width content; in-app welcome and
loading use the capped reading wrapper. For future sheets: centre/cap within a
safe pane and round all four corners; verify keyboard and dismissal controls.

## Rotation and state

- [ ] iPhone portrait only, including attempted landscape while typing.
- [ ] iPad supports all four orientations; entered form values and consent
      selection survive rotation, as do selected tab and preview detail.
- [ ] Android smallestScreenWidthDp < 600 requests PORTRAIT; >= 600 requests
      FULL_USER in onCreate and onConfigurationChanged. Manifest orientation
      remains Expo's configured default. Test both directions across 600 during
      fold/unfold and verify the Activity is not recreated for covered changes.
- [ ] Verify native OS/user rotation behavior on supported Android versions;
      orientation requests remain subject to the platform's windowing policy.
- [ ] Change wide preview selection to Preview Availability, fold to compact,
      unfold, and confirm selection remains. No dimension-based component keys.
- [ ] At 839↔840 confirm the same tab remains selected as the rail moves.
- [ ] Scroll the sign-in form with keyboard open on compact and wide; the
      ScrollView content uses flexGrow: 1. Render test checks visible fields and
      noncollapsed ancestors; native keyboard/geometry checks remain manual.

## Duo, folds, and iPad windowing

- [ ] Duo outer: 466×678pt, compact, roughly 84pt right safe inset. Check all
      controls remain within safe bounds without subtracting the inset twice.
- [ ] Duo inner: 951×669 / 669×951pt, regular × regular. Verify both layouts.
      iOS phone portrait policy remains configured; actual dual-pane posture
      recognition is unavailable in the installed native stack.
- [ ] iPad Split View and Stage Manager at 669/951 and arbitrary intermediate
      widths: **no inferred crease or false central gap**.
- [ ] Resize windows continuously; ensure content and navigation reflow and
      state stays intact.

**Known limit / TODO:** no real fold/posture API is installed. The hook therefore
reports no fold and a zero crease gap on both platforms. Exact dimensions never
identify a crease. Real Duo/Android hinge avoidance cannot be claimed until a
posture source is available. Safe-area insets are handled by SafeAreaView.
The pure geometry helpers accept only explicitly reported separating vertical
folds, reserve at least a 40pt band, and provide panes (or the largest reading
pane) for content. Unit tests confirm returned content rectangles never cross
that band. When connecting a real source, convert window fold coordinates to
container coordinates, route single-column pages/sheets into one pane, split
lists at the band, and verify no text/control rectangle crosses it. Horizontal
fold posture needs a vertical-axis pane implementation before enabling it.
