# TASK FOR CODEX: create 10 buddy mascots for the LFM3 Pocket app and push them to the repo

You are working in the git repo `CoderVLSI/liquid-ai`. Work on branch `claude/sweet-wright-7gqtmt` (check it out, then
`git pull --rebase origin claude/sweet-wright-7gqtmt` before your final push; another agent also pushes to it, so only
ever add files under `assets/buddies/` and `src/buddies/generated.ts`, and never edit any other file).

Your job: **generate 10 original chibi mascot characters, 8 expression poses each (80 images), turn them into
transparent aligned PNGs with the slicer script that is already in the repo, and push them.**
Another agent (Claude) will afterwards inspect and animate them in the app, so consistency between poses matters more
than anything else.

If you have no image-generation tool, STOP and say so. Do not draw the characters with code, do not use stock or
existing characters, and do not fake it.

---------------------------------------------------------------------------------------------------------------------

## 1. What a "buddy" is

A buddy is **8 pictures of the same character with different expressions**. The app swaps between them (blinking,
mouth open while talking, thinking face while the AI works, ...) and moves the picture itself (breathing, hopping,
wobbling). So the 8 pictures must be the SAME character, SAME size, SAME position, SAME outline, SAME colours. Only the
face, arms and the small props listed below may change.

The 8 poses (file names are exact, lowercase):

| file | meaning | what to draw |
|---|---|---|
| `idle.png`  | resting | calm, eyes open, small gentle smile, arms down |
| `blink.png` | blink | EXACTLY like idle but eyes closed as soft curved lines |
| `talk.png`  | speaking | EXACTLY like idle but mouth open as if speaking |
| `happy.png` | delighted | eyes closed in joy (^ ^), big open smile, arms up, 3 small gold sparkles near it |
| `think.png` | thinking | eyes looking up and to the side, tiny closed mouth, one paw/hand at the chin, 3 small white thought bubbles rising on one side |
| `wait.png`  | needs the user | eyes extra wide and round, tiny round "o" mouth, ears/crest/antennae raised, a gold "?" floating above |
| `sleep.png` | asleep | eyes closed, relaxed, body sagging a little lower, two light-blue "z" letters floating |
| `sad.png`   | error | droopy eyebrows, big watery eyes looking down, small frown, one tear |

`idle`, `blink` and `talk` must be pixel-for-pixel the same drawing except the eyes / mouth.

---------------------------------------------------------------------------------------------------------------------

## 2. Art style (identical for all 10 characters)

- **Original characters only.** No existing franchise characters, no look-alikes of Pokemon or any other brand, no
  logos, no trademarks, **no text or letters in the artwork** (except the "?" and "z" symbols in the poses above).
- Chibi proportions: very large head/body, tiny limbs, 2 to 3 heads tall at most. Big, glossy, expressive eyes with a
  white glint. Soft pink blush on the cheeks.
- Clean, thick, dark-navy outline (`#0E1E46`), the same thickness in every pose. Smooth cel shading: ONE soft shadow
  tone and ONE highlight tone, no gradients, no textures, no painterly noise, no glow outside the outline.
- Each character has a limited palette: 1 main colour, 1 secondary, 1 accent, plus white and the navy outline.
- Friendly, a little mischievous, never scary. Whole body visible, front or slight three-quarter view, feet or
  bottom resting on an invisible ground line.
- **No ground shadow, no floor, no background objects, no border, no watermark, no signature.**
- The background of every generated image is ONE perfectly flat solid colour **`#FF00FF`** (pure magenta). Never a
  checkerboard, never a gradient, never white. (The slicer removes it.) None of the characters may use magenta.

---------------------------------------------------------------------------------------------------------------------

## 3. The 10 characters

Use these exact `id`s (they become folder names). Colours in brackets are the accent colour for `buddy.json`.

1. **`bloop`** (`#27E8F6`), "Bloop". A chubby water droplet with a little curled tip on top. Glossy cyan body, lighter
   aqua belly, tiny stubby arms. Cheerful, curious, bouncy. (This REPLACES the placeholder drawing already in
   `assets/buddies/bloop/`: overwrite it.)
2. **`mochi`** (`#FFB3C7`), "Mochi". A round rice-cake cat: soft white-pink squishy body, two small triangle ears, a
   tiny pink nose, short stubby tail, always slightly sleepy half-moon eyes. Calm, cuddly, lazy.
3. **`axo`** (`#FF8FB1`), "Axo". A baby axolotl: pink body, three feathery coral gill-frills on each side of the head,
   a wide smile, tiny front paws, a short paddle tail. Gentle, silly, optimistic.
4. **`ember`** (`#FF8A3D`), "Ember". A small fox cub: orange fur, cream chest and cheeks, big pointed ears with dark
   tips, a bushy tail that ends in a small friendly flame. Bold, loyal, playful.
5. **`nimbus`** (`#8FB8FF`), "Nimbus". A fluffy storm-cloud lamb: white-grey cloud wool, tiny dark hooves, big round
   eyes, a little yellow lightning bolt mark on its forehead. Dreamy, shy, kind.
6. **`sprout`** (`#6BE08A`), "Sprout". A seed spirit: round green body, one big leaf as a hat that droops when sad and
   perks up when happy, tiny root feet. Hopeful, helpful, gentle.
7. **`pip`** (`#9C6AFF`), "Pip". A tiny round robot: glossy violet shell, a dark screen face that shows the eyes and
   mouth as glowing cyan shapes, a short antenna with a glowing tip, stubby feet. Logical, eager, a bit nerdy.
   (For Pip, "closed eyes" are ^ ^ or - - shapes on the screen; "tear" is a small cyan drop on the screen.)
8. **`glimmer`** (`#FFD65A`), "Glimmer". A firefly moth: soft yellow fuzzy body, two big feathery antennae, small
   translucent wings, a softly glowing round belly. Shy, curious, warm.
9. **`pebble`** (`#A8B5C8`), "Pebble". A tiny rock golem: smooth grey-blue rounded boulder body, a patch of green moss
   on top with one tiny flower, stubby stone arms and feet, a gentle sleepy smile. Steady, patient, protective.
10. **`zephyr`** (`#7FE3C9`), "Zephyr". A baby wind dragon: mint-green body, cream belly, small swirl-shaped wings,
    a curly tail, two tiny horns. Just the creature, no clouds or other objects around it. Adventurous, cheeky, brave.

Give each a one-line `tagline` (max 60 characters, friendly, no emoji) for `buddy.json`.

---------------------------------------------------------------------------------------------------------------------

## 4. How to generate each character (do this once per character, in this order)

**Method A: one sheet per character (preferred).** Generate ONE image at the largest size your tool offers (landscape
is best, at least 2048x1024 if possible) containing the 8 poses in a **strict grid of 4 columns x 2 rows**, 8 EQUAL
cells, left to right then top to bottom in the table order (idle, blink, talk, happy, think, wait, sleep, sad). Each pose
centred in its own cell with generous empty margin (at least 12% of the cell on every side), no grid lines, no labels,
no numbers, flat `#FF00FF` background everywhere, no shadows.

Use this wording for the image prompt (fill the `{...}`):

```
Original chibi mascot character sheet. Character: "{NAME}": {DESCRIPTION FROM SECTION 3}. Personality: {3 WORDS}.
ONE image: exactly 8 poses of the SAME character in a strict grid of 4 columns x 2 rows, 8 equal cells, each pose
centred in its own cell with generous empty margin around it, no grid lines, no labels, no numbers. Every pose is the
identical character at the identical size, in the same place in its cell, feet at the same height; only expression,
arms and the small listed props change. Style: chibi, huge head, big glossy eyes with white glint, pink blush, thick
dark-navy outline (#0E1E46) of identical thickness in all poses, smooth cel shading with one shadow tone and one
highlight tone, no gradients, no textures, limited palette. Background: perfectly flat solid #FF00FF everywhere, no
floor, no ground shadow, no glow, no text.
Poses left to right, top to bottom: 1 IDLE calm eyes open small smile; 2 BLINK like 1 with eyes closed as soft curves;
3 TALK like 1 with mouth open; 4 HAPPY eyes closed in joy, big open smile, arms up, 3 small gold sparkles; 5 THINK
eyes up and sideways, tiny closed mouth, paw at chin, 3 white thought bubbles; 6 WAIT eyes extra wide, tiny round
mouth, ears/crest raised, a gold question mark above; 7 SLEEP eyes closed, relaxed, body slightly lower, two light-blue
"z" letters; 8 SAD droopy eyebrows, watery eyes looking down, small frown, one tear.
```

If your tool supports it, generate pose 1 (IDLE) first, then use it as the reference image for the other poses so the
character stays identical.

**Method B: one image per pose (use if Method A gives uneven grids or inconsistent characters).** Generate 8 separate
square images (1024x1024), each ONE pose of the same character, centred, whole body visible, feet at the same height as
in IDLE, flat `#FF00FF` background. Always give the IDLE image as the reference ("same character, same size, same
position as this image, new pose: ..."). Save them as `idle.png`, `blink.png`, ... in a temporary folder.

**Reject and regenerate** (do not "fix" in code) when any of these is true:
- a pose is a visibly different size, colour, outline thickness or body shape than the others;
- poses touch each other or the cell edge, or the grid is uneven;
- a pose is missing, duplicated, or has text/letters other than the "?" / "z" symbols;
- the background is not flat magenta (checkerboard, white, gradient), or there is a floor/shadow;
- the character looks like an existing franchise character;
- `idle`/`blink`/`talk` differ in anything except eyes/mouth.
Try up to 4 times per character. If a character still fails, skip it, note why, and continue with the others.

---------------------------------------------------------------------------------------------------------------------

## 5. Turn the images into app assets

Keep the original generated image: save it as `assets/buddies/_sheets/<id>-sheet.png` (Method A) or the folder
`assets/buddies/_sheets/<id>/` (Method B). Folders starting with `_` are ignored by the app, so these stay as raw
material for later re-slicing.

Then run the slicer that is already in the repo (needs `pip install pillow`):

```bash
# Method A
python3 scripts/slice-sheet.py assets/buddies/_sheets/<id>-sheet.png --id <id> --name "<Name>" \
        --tagline "<tagline>" --color "<#accent>" --erase-shadow
# Method B
python3 scripts/slice-sheet.py assets/buddies/_sheets/<id>/ --id <id> --name "<Name>" \
        --tagline "<tagline>" --color "<#accent>" --erase-shadow
```

(`--bg "#rrggbb"` if the flat colour is not magenta, `--tolerance 60` if edges are rough, `--inset 16` if neighbouring
poses bleed into a cell.) The script writes `assets/buddies/<id>/{idle,blink,talk,happy,think,wait,sleep,sad}.png`
(512x512, transparent, all poses scaled together and standing on one baseline) and `buddy.json`.

**Check every character before committing** by opening the 8 PNGs (for example, paste them on a dark blue background
in one contact sheet and look at it):
- the background is fully transparent (no magenta fringe or halo around the outline; a thin dark outline is fine);
- no leftover shadow blob under the feet;
- all 8 are the same size and the feet sit on the same line, the character is centred;
- nothing is cropped at the canvas edge.
If something is wrong, adjust `--tolerance` / `--inset` and re-run, or regenerate the image.

Optional but welcome: shrink each PNG if a tool such as `oxipng -o4 --strip safe` or `pngquant --quality=80-95` is
available. Target: every pose under 350 KB.

---------------------------------------------------------------------------------------------------------------------

## 6. Commit and push

1. `npm run buddies` regenerates `src/buddies/generated.ts` (if Node is available; if not, skip, CI does it).
2. Only these paths may change: `assets/buddies/**` and `src/buddies/generated.ts`.
3. Commit in sensible chunks (for example, 2 to 3 buddies per commit), message style: `Add buddies: mochi, axo, ember`.
4. `git pull --rebase origin claude/sweet-wright-7gqtmt`, then `git push origin HEAD:claude/sweet-wright-7gqtmt`.
   Do NOT force-push. Do NOT open a pull request.

## 7. Final report (print this at the end)

A table: `id | method (A/B) | attempts | passed checks (yes/no) | notes`. Mention any buddy you skipped and why, and the
total size added under `assets/buddies/`.

## Definition of done

`assets/buddies/<id>/` exists for all 10 ids with 8 transparent 512x512 PNGs (`idle blink talk happy think wait sleep sad`)
plus `buddy.json`, raw sheets under `assets/buddies/_sheets/`, `src/buddies/generated.ts` up to date, everything pushed to
`claude/sweet-wright-7gqtmt`.
