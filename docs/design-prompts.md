# Design prompts for Codex

Two prompts to paste into Codex, plus ideas for BuilderIcons styles.

---

## 1. Emote wheel designs

```text
You are designing replacement artwork for the Roblox emote wheel (the radial menu opened with "."),
packaged so Ruby Launcher can import it. Produce 6 distinct, polished wheel designs.

DELIVERABLE
For each design, a folder named after the design (kebab-case) containing exactly these PNGs
(RGBA, transparent background, sRGB, no colour profile, each size an exact scale of 1x):

  CircleBackground.png      400x400   CircleBackground@2x.png  800x800   CircleBackground@3x.png  1200x1200
  SegmentedCircle.png       400x400   SegmentedCircle@2x.png   800x800   SegmentedCircle@3x.png   1200x1200
  SelectedGradient.png      183x141   SelectedGradient@2x.png  365x281   SelectedGradient@3x.png  548x422
  SelectedLine.png           11x67    SelectedLine@2x.png       22x134   SelectedLine@3x.png       33x201

Zip each folder (files at the zip root). Also render preview.png (800x800) of the layers stacked
with one slice "selected", so the design can be judged at a glance.

WHAT EACH LAYER IS (Roblox stacks them; keep geometry identical to the originals)
- CircleBackground: the disc behind everything. Full circle centred in the canvas, diameter = canvas
  width. Roblox draws emote thumbnails ON TOP of it, so keep the area where the 8 slices' icons sit
  calm (low contrast, no busy texture) or icons will be unreadable.
- SegmentedCircle: the divider lines + outer/inner ring, as a separate transparent layer. Measure the
  slice count, divider angles and hub radius from the original files (provided in ./reference) and
  match them exactly; Roblox places emotes by that geometry. Lines must be crisp at 1x (min 2px).
- SelectedGradient: the glow painted over the hovered slice. Roblox rotates this image to the slice,
  anchored at the bottom-centre of the image (the hub side), pointing outward. It must be a
  45°-wide wedge glow that fades to transparent toward the hub and the edges.
- SelectedLine: the thin accent drawn along the outer arc of the hovered slice. Vertical bar,
  bright in the middle, feathered ends.

DESIGN RULES
- Readability first: emote thumbnails (white-ish 3D renders) must stay legible on the background.
  Test by pasting a white silhouette into each slice in the preview.
- Each design gets a short name and a one-line mood description in a README.md.
- No logos, trademarks, copyrighted characters or text. Original artwork only.
- Keep file sizes small (optimise PNGs losslessly, e.g. oxipng -o 4).
- Anti-alias every edge; no stray semi-transparent pixels in the transparent areas.

THE 6 DESIGNS (make each feel genuinely different, not recolours)
1. "Obsidian Glass": smoked glass disc, faint inner bevel, hairline silver dividers, ruby-red
   selection bloom.
2. "Neon Arcade": deep navy disc, cyan/magenta dual-tone dividers with a soft outer glow,
   scanline texture kept outside the icon area only.
3. "Paper Minimal": off-white flat disc, 1px charcoal dividers, the selection is a solid soft
   pastel wedge with no glow (a light theme).
4. "Aurora": dark disc with a slow northern-lights gradient around the rim only, dividers that
   fade out toward the hub, green-violet selection.
5. "Brutalist": pure black disc, thick white dividers with square ends, the selection is a hard-edged
   yellow wedge with no gradient.
6. "Holo Ring": transparent centre with only a thick iridescent outer ring (rainbow sheen), very thin
   dividers, white selection line.

Build it with a script (Python + Pillow or Node + sharp/skia-canvas), drawing every layer from code
in vector-style geometry, so all three sizes come from the same parameters. Commit the generator
script next to the output so designs can be tweaked and re-rendered.
```

Give Codex the originals as `./reference`. They're in your Roblox install under
`content/textures/ui/Emotes/Large/`. To import a result, drop the zip onto the Mods page in Ruby (or use its import button).

---

## 2. BuilderIcons master prompt

BuilderIcons is the icon font Roblox's in-game UI uses (menu, chat, settings, the logo on the menu
button). Ruby can swap the whole font: any `.ttf` files placed in Ruby's `icon-font` folder replace
Roblox's on the next launch, and the Ruby logo is added on top automatically.

```text
You are restyling Roblox's "BuilderIcons" icon font into a complete, cohesive new icon style.

INPUT
Two TrueType fonts: BuilderIcons-Regular.ttf (outline icons) and BuilderIcons-Filled.ttf (solid
"selected" variants). About 820 glyphs each, unitsPerEm 2048, icons mapped to Private Use Area
codepoints. Every glyph name, codepoint, advance width and the cmap must stay exactly the same;
only outlines change. Roblox loads these files by name, so output the same two file names.

GOAL
Apply ONE style consistently across every glyph in both files (the style is given below).
Regular and Filled must still read as the "off" and "on" states of the same icon.

APPROACH
1. Parse with fontTools. Convert each glyph to a path; decompose composites first.
2. Implement the style as a geometric transform pipeline built on skia-pathops (boolean ops,
   stroking) so it works on all ~1640 glyphs automatically, with per-glyph overrides in a JSON file
   for the few that need hand fixes.
3. Write outlines back as TrueType quadratics (cu2qu for any cubics), with outer contours clockwise,
   and remove overlaps. Drop hinting (no instructions); keep the hmtx, cmap and name tables as they are.
4. Recompute glyf/loca, maxp limits, head bbox and checksums. Validate with fontTools (ttx
   round-trip) and FreeType rendering (no errors).
5. Render a contact sheet (PNG) of all glyphs, original vs new side by side, at 16px, 24px and 48px,
   on dark and light backgrounds. The 16px row matters most: icons must stay readable there.

QUALITY BARS
- No glyph may vanish, invert, or lose a meaningful detail (numbers inside icons, small badges,
  warning triangles, the tiny "2D" labels). Detect lost area automatically: compare ink area before
  and after, and flag any glyph whose area change exceeds 60% for manual review.
- Consistent stroke weight across the set (measure the median stroke width and keep it ±10%).
- Corners, terminals and dots treated identically everywhere.
- Optical size: keep each icon inside the original glyph's bounding box.

STYLE TO APPLY
<pick one from the list below, or describe your own>

Deliver: the two .ttf files, the generator script, overrides.json and the contact sheet.
```

---

## 3. Styles worth trying (paste one into "STYLE TO APPLY")

| Style | What it looks like | How it's built |
|---|---|---|
| **Hairline** | Ultra-thin 1px-at-24px lines, like iOS settings | Erode outlines heavily, then add stroke-only rebuilds for glyphs that vanish |
| **Rounded soft** | Bubbly and friendly; every corner and terminal rounded | Morphological open (shrink, then grow with round joins), round caps |
| **Duotone** | Outline icon plus a 30%-opacity filled backing shape | Regular outline + offset fill (fonts are one colour, so do it as a lighter hatch or dotted fill) |
| **Pixel / 8-bit** | Icons snapped to a 16×16 grid of square pixels | Rasterise at 16px, threshold, rebuild as merged squares |
| **Neo-brutal** | Very heavy strokes, square ends, chunky | Dilate outlines, square joins |
| **Stencil** | Military stencil bridges cut through each shape | Subtract evenly spaced thin bars from closed shapes |
| **Outline-from-filled** | Hollow versions of the Filled set as the "on" state | Filled glyph minus an inset copy of itself |
| **Sketch** | Hand-drawn wobble, slightly uneven lines | Flatten, then jitter points with low-frequency noise and smooth |
| **Glyph-in-badge** | Every icon sits inside a rounded square | Union of a rounded-rect frame with the icon cut out of it |
| **Dotted** | Lines made of evenly spaced round dots | Stroke the centrelines with a dash pattern of round dots |

The **minimal** set already installed is the "Rounded soft" idea pushed thinner. It was built with
Ruby's own small generator (the Node script `minimal.cjs`), which you can extend for the others.
