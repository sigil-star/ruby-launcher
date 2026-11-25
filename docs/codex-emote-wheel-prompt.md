# Codex prompt: generate emote wheel packs for Ruby Launcher

Paste everything below the line into Codex.

---

You are making new emote wheel styles for Ruby Launcher, a Roblox launcher. Ruby swaps
Roblox's emote wheel textures for a pack's files. Your job is to produce several complete,
working packs using image generation for the art and code (Python + Pillow) for the exact
sizing, transparency and layout. Generated art alone will NOT work: every file must match
Roblox's dimensions, alpha and geometry exactly, or the wheel renders misaligned or opaque.

## What Roblox's wheel is made of

The wheel is built from three layers, each shipped at 1x, @2x and @3x. File names, sizes
and roles (all PNG, RGBA, transparent background):

| File (in `content/textures/ui/Emotes/Large/`) | 1x | @2x | @3x | Role |
|---|---|---|---|---|
| `CircleBackground.png` | 400x400 | 800x800 | 1200x1200 | The disc behind everything. A filled circle (a ring, really: the centre is part of it) with soft edges. |
| `SegmentedCircle.png` | 400x400 | 800x800 | 1200x1200 | The thin divider lines and outer ring that split the disc into 8 slices. Mostly transparent. |
| `SelectedGradient.png` | 183x141 | 365x281 | 548x422 | The highlight drawn over the hovered slice (one slice's shape, a wedge of the ring, with a gradient). Roblox rotates it into place itself. |
| `SelectedLine.png` | 11x67 | 22x134 | 33x201 | The bright edge line on the hovered slice. |

Rules that make a pack work:
1. Exact pixel sizes above, PNG RGBA, transparent where Roblox's original is transparent.
2. Use Roblox's own files as masks/templates so the geometry matches perfectly. The originals
   are on this PC at:
   `%LOCALAPPDATA%\Roblox\Versions\<newest version-*>\content\textures\ui\Emotes\Large\`
   (if Ruby has modded that build, the untouched copies are in
   `%APPDATA%\com.rubylauncher.tauri\texture-backup\<version>\content\textures\ui\Emotes\Large\`).
   Take each original's alpha channel as the shape mask, then fill it with your generated art.
   Never change the shape, the segment angles, the wedge's size or the line's size.
3. Keep the disc readable: emote thumbnails sit on top of it, so the background must not be busy
   in the 8 slice centres. Put detail at the rim and keep the middle calm (or darken it).
4. The 8 divider lines in `SegmentedCircle` must stay thin and evenly spaced (copy their
   positions from the original's alpha; only recolour or texture them).
5. `SelectedGradient` must stay the same wedge shape and should fade toward the centre like the
   original; `SelectedLine` is a bright accent in the theme's highlight colour.
6. Make @2x and @3x by rendering at @3x and downscaling with LANCZOS, so all three match.

## How to build each pack

For each style:
1. Use image generation to make a square, seamless, centred circular artwork at 1200x1200
   (for example "ornate obsidian and gold ring, top-down, symmetric, transparent background,
   game UI"). Ask for radial symmetry so it reads well when split into 8 slices.
2. In Python, load the original `CircleBackground@3x.png`, use its alpha as the mask, and
   composite your art into it (scale the art to cover, keep the original alpha exactly, and
   optionally multiply the alpha by the art's own alpha for a cut-out rim). Save, then
   downscale to @2x and 1x.
3. For `SegmentedCircle`, take the original's alpha and colour the lines with the style's line
   colour (a solid colour or a subtle generated texture), keeping the alpha exactly.
4. For `SelectedGradient`, take the original's alpha and fill it with the style's highlight
   gradient (bright at the rim, fading inward), alpha from the original.
5. For `SelectedLine`, the original's alpha filled with the highlight colour.
6. Check every output with a script: exact sizes, mode RGBA, alpha identical in shape to the
   original (compare masks; allow anti-aliasing differences of a few levels only).
7. Render a preview: composite the 1x layers into a 400x400 image the way Roblox does (background,
   then lines, then the selected wedge rotated into slice 0 with its line), save it as
   `preview.png` in the pack folder.

## Output layout (this is exactly what Ruby imports)

Create one folder per style under `./emote-wheels/<Style Name>/` containing:

```
content/textures/ui/Emotes/Large/CircleBackground.png
content/textures/ui/Emotes/Large/CircleBackground@2x.png
content/textures/ui/Emotes/Large/CircleBackground@3x.png
content/textures/ui/Emotes/Large/SegmentedCircle.png
content/textures/ui/Emotes/Large/SegmentedCircle@2x.png
content/textures/ui/Emotes/Large/SegmentedCircle@3x.png
content/textures/ui/Emotes/Large/SelectedGradient.png
content/textures/ui/Emotes/Large/SelectedGradient@2x.png
content/textures/ui/Emotes/Large/SelectedGradient@3x.png
content/textures/ui/Emotes/Large/SelectedLine.png
content/textures/ui/Emotes/Large/SelectedLine@2x.png
content/textures/ui/Emotes/Large/SelectedLine@3x.png
preview.png
```

Then zip each folder as `<Style Name>.zip` (the zip's root holds `content/` and `preview.png`).
Ruby imports these zips directly: Mods → Emote wheel → Import (or drop them in Ruby's packs folder).

## Styles to make (8)

1. Obsidian & Gold: black volcanic glass disc, thin gold dividers, warm gold highlight.
2. Neon Cyber: dark navy disc with a faint grid, cyan dividers, magenta highlight.
3. Sakura: soft pink disc with falling petals at the rim, white dividers, deep pink highlight.
4. Frost: icy blue translucent disc (keep it at about 80% opacity), white crystal dividers, pale cyan highlight.
5. Lava: dark rock disc with glowing cracks at the rim, orange dividers, yellow-orange highlight.
6. Galaxy: deep purple nebula with stars, kept dark in the slice centres, violet highlight.
7. Minimal Glass: frosted white at about 35% opacity, hairline dividers, accent-blue highlight.
8. Retro Pixel: 8-bit pixel-art ring (render at 1x scale with nearest-neighbour upscaling for @2x/@3x), green highlight.

## Done means

- 8 folders and 8 zips, each with all 12 PNGs at the exact sizes and a `preview.png`.
- A validation script (`validate_wheels.py`) that checks every file's size, mode and alpha
  shape against Roblox's originals and prints PASS/FAIL per file; all PASS.
- A contact sheet `emote-wheels/previews.png` showing all 8 previews side by side.
- No copyrighted characters or logos in any art.

---

## Follow-up prompt: turn one generated wheel picture into a complete pack

Paste this into Codex after it has made a wheel picture.

---

The wheel picture you generated is only the look. Roblox draws its emote wheel from separate
layers, so it needs to be cut into the full set before Ruby can use it. Build the pack from the
picture:

1. **Find the originals.** Copy Roblox's own `CircleBackground`, `SegmentedCircle`,
   `SelectedGradient` and `SelectedLine` (1x, @2x, @3x each) from the newest
   `%LOCALAPPDATA%\Roblox\Versions\version-*\content\textures\ui\Emotes\Large\` folder (or Ruby's
   untouched backup in `%APPDATA%\com.rubylauncher.tauri\texture-backup\<version>\...`). They are
   the templates: same sizes, same positions.

2. **Line the picture up.** Detect the wheel's circle in the picture (centre and radius) and
   scale/translate the picture so that circle matches the template's circle in
   `CircleBackground@3x.png` (1200x1200). Rotate it so one divider line points straight up, like
   Roblox's: the 8 slices must sit exactly where Roblox's do or the hover highlight won't match.

3. **Background (`CircleBackground`).** The ring and disc art, with the 8 dividers painted out (fill
   them from neighbouring pixels) and without any built-in "selected" slice, so every slice looks
   the same when nothing is hovered. Keep the slice centres calm and dark so the emote icons on top
   stay readable. Anything that sticks out past the circle (wings, hair, ornaments) must still fit
   inside the 1200x1200 square: if it doesn't, shrink the whole wheel a little and keep the
   dividers aligned to the new circle in every other layer too.

4. **Dividers (`SegmentedCircle`).** Only the 8 divider lines and the outer rim lines, cut out of the
   picture (or redrawn in its line colour), everything else transparent. Use the original
   `SegmentedCircle` alpha as the guide for where the lines go.

5. **Hover wedge (`SelectedGradient`, 183x141 at 1x).** The look of one hovered slice: take one
   wedge's shape from the original's alpha and fill it with the theme's glow (for a crimson theme,
   a bright red gradient fading toward the centre). Roblox rotates this one image to whichever slice
   you hover, so it must be a single slice in the original's orientation.

6. **Hover edge (`SelectedLine`, 11x67 at 1x).** The bright line along the hovered slice's edge,
   in the highlight colour, shape from the original's alpha.

7. **Sizes.** Make everything at @3x, then downscale to @2x and 1x with LANCZOS. Validate exact
   sizes, RGBA mode, and that each mask lines up with the original (PASS/FAIL per file).

8. **Check it.** Render `preview.png`: background, then dividers, then the hover wedge rotated
   into one slice with its edge line, plus a second copy with the wedge in another slice. If the
   wedge doesn't fill a slice exactly, go back to step 2.

9. **Package.** `content/textures/ui/Emotes/Large/` with all 12 PNGs and `preview.png` at the
   root, zipped as `<Name>.zip`. Ruby imports it from Mods → Emote wheel → Import.
