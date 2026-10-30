# Making buddies (mascots) for LFM3 Pocket

A buddy is **8 expression pictures of the same character**. The app swaps between them (blinks, opens its mouth while
it talks, thinks while the model works, looks alert when it needs you) and moves the picture itself (breathing,
bobbing, wobbling, hopping, a happy bounce when you tap it). So you only need good, *consistent* art; the animation
is code.

| pose | when it shows | what to draw |
|---|---|---|
| `idle` | resting, listening | calm, eyes open, small smile |
| `blink` | every few seconds, 0.1 s | same as idle, eyes closed (happy curves) |
| `talk` | while it speaks | same as idle, mouth open |
| `happy` | you tap it, task done | big smile, eyes closed in joy, sparkles |
| `think` | the model is working | looking up/sideways, thinking face, thought dots |
| `wait` | it needs your decision | wide eyes, small "o" mouth, a `?` above |
| `sleep` | no model loaded, muted | eyes closed, relaxed, "z" |
| `sad` | an error | droopy eyes, small frown, one tear |

## 1. Folder format

```
assets/buddies/<id>/idle.png        <- required
assets/buddies/<id>/blink.png ... sad.png   <- optional (missing poses fall back to idle)
assets/buddies/<id>/buddy.json      <- {"name": "Axo", "tagline": "A sleepy axolotl", "color": "#ff8fb1"}
```

`<id>` is lowercase letters, digits, `-`, `_`. PNG with a transparent background, square (512x512 is perfect), the
character centred, **feet on the same baseline in every pose, same size in every pose**. Push the folder: CI runs
`npm run buddies`, the buddy shows up in the picker. Nothing else to edit.

You don't have to get the transparency or alignment right in ChatGPT: `scripts/slice-sheet.py` does it (section 4).

## 2. Prompt 1: the style bible (start a fresh ChatGPT chat with this)

```
You are my character artist for a mobile app called "LFM3 Pocket". I need a family of original chibi creature mascots
("buddies"), in the spirit of cute collectible monsters, but every character must be completely original: no existing
characters, no trademarks, no logos, no text in the artwork.

STYLE (use it for every character I ask for in this chat):
- chibi proportions: huge head/body, tiny limbs, 2-3 heads tall at most, big expressive glossy eyes with a white glint
- clean thick dark-navy outline (#0E1E46), smooth cel shading with ONE soft shadow tone and ONE highlight, no gradients
  or textures, no painterly noise
- limited palette per character: 1 main colour, 1 secondary, 1 accent, plus white and the dark-navy outline
- friendly, a little mischievous, never scary; pink blush on the cheeks
- front-facing three-quarter-ish view, the whole body visible, feet/bottom touching an invisible ground line
- the background is ALWAYS one perfectly flat solid colour #FF00FF (pure magenta), with NO gradient, NO floor,
  NO drop shadow, NO glow outside the outline, NO checkerboard, NO border, NO text
Reply "ready" and wait for my first character.
```

## 3. Prompt 2: the character sheet (one per buddy, same chat)

Fill the `{...}` parts. Ask for the image at the **widest** size ChatGPT offers.

```
Create the character "{NAME}": {ONE-SENTENCE DESCRIPTION: species, body shape, signature features, colours}.
Personality: {3 words}.

Draw ONE image: a character sheet with exactly 8 poses of the SAME character in a strict grid of 4 columns x 2 rows,
8 equal cells, each pose centred in its own cell with generous empty margin around it, no grid lines, no labels, no
numbers. Every pose must be the identical character at the identical size, standing in the same place in its cell
with the feet on the same height, only the expression/arms change. Background: flat solid #FF00FF everywhere,
no shadows, no floor.

Poses, left to right, top to bottom:
1. IDLE - calm, eyes open, small gentle smile, arms down
2. BLINK - exactly like pose 1 but eyes closed in soft curved lines
3. TALK - exactly like pose 1 but mouth open as if speaking
4. HAPPY - eyes closed in joy (^ ^), big open smile, arms up, 3 small gold sparkles around it
5. THINK - eyes looking up and to the side, tiny closed mouth, one hand/paw at the chin, 3 small white thought bubbles
   rising on one side
6. WAIT - eyes extra wide and round, tiny round "o" mouth, ears/antennae/crest raised, a gold question mark floating
   above
7. SLEEP - eyes closed, relaxed, mouth slightly open, body sagging a little lower, two light-blue "z" letters floating
8. SAD - droopy eyebrows, big watery eyes looking down, small frown, one tear

Keep the outline thickness, colours and proportions identical in all 8 poses.
```

Then fix problems **in the same chat** with short follow-ups, for example:
- `Pose 6 is a different size from the others. Redraw the whole sheet with every pose the same size.`
- `The background has a soft shadow under the characters. Remove all shadows; flat #FF00FF only.`
- `The grid is uneven. Redraw as 8 perfectly equal cells, 4 across and 2 down.`
- `Make the eyes bigger and glossier, and the outline thicker, in all poses.`

If ChatGPT will not keep the poses on a clean grid, ask for **one pose per image** instead (section 4, folder mode):

```
Same character, same style, same size and position as the sheet above. Now only the {POSE NAME} pose, ONE character
centred on a flat #FF00FF square background, whole body visible, feet at the same height as in the IDLE pose.
```

## 4. Turn the picture into a buddy

```bash
pip install pillow
python3 scripts/slice-sheet.py sheet.png --id axo --name Axo --tagline "A sleepy axolotl" --color "#ff8fb1" --erase-shadow
# or, one image per pose in a folder (idle.png, blink.png, talk.png, happy.png, think.png, wait.png, sleep.png, sad.png):
python3 scripts/slice-sheet.py my_poses/ --id axo --name Axo --color "#ff8fb1"
npm run buddies         # optional: CI does this for you
git add assets/buddies/axo && git commit -m "Add Axo" && git push
```

What it does: cuts the grid, removes the flat background (and, with `--erase-shadow`, soft shadows), un-mixes the
magenta fringe from the edges, crops every pose tight, scales **all poses by the same factor** and puts them on one
baseline on a 512x512 transparent canvas. If a cell comes out wrong, raise/lower `--tolerance` (default 48) or
`--inset` (pixels ignored at each cell edge, default 8). If you asked for transparent PNGs directly, it detects that
and skips the background step. Pass `--bg "#00ff00"` if you used another flat colour.

## 5. Ready-made character ideas (copy into `{DESCRIPTION}`)

All original. Pick a few; each gets a different personality in the app.

1. **Bloop** (`#27E8F6`): a chubby water droplet with a little curled tip on top, glossy cyan body, lighter belly, tiny
   stubby arms. Cheerful, curious, bouncy.
2. **Mochi** (`#FFB3C7`): a round rice-cake cat, soft white-pink body, tiny triangle ears, a little pink nose, short
   stubby tail, always slightly sleepy. Calm, cuddly, lazy.
3. **Axo** (`#FF8FB1`): a baby axolotl, pink body, three feathery coral gill-frills on each side of the head, wide
   smile, tiny front paws, a short paddle tail. Gentle, silly, optimistic.
4. **Ember** (`#FF8A3D`): a small fox cub, orange fur, cream chest and cheeks, big pointed ears, a bushy tail that ends
   in a small friendly flame. Bold, loyal, playful.
5. **Nimbus** (`#8FB8FF`): a fluffy storm-cloud lamb, white-grey cloud wool, tiny dark hooves, a little yellow
   lightning bolt on its forehead. Dreamy, shy, kind.
6. **Sprout** (`#6BE08A`): a seed spirit with a round green body, a single leaf hat that droops and perks up, little
   root feet. Hopeful, helpful, gentle.
7. **Pip** (`#9C6AFF`): a tiny round robot, glossy violet shell, a dark screen face that shows the eyes, a short antenna
   with a glowing tip, stubby wheels or feet. Logical, eager, a bit nerdy.
8. **Glimmer** (`#FFD65A`): a firefly moth, soft yellow fuzzy body, two big feathery antennae, small translucent wings,
   a softly glowing round belly. Shy, curious, warm.

## 6. Optional extras (ask later, in the same chat)

- **Accessory variants** ("same character wearing a tiny wizard hat / headphones / scarf"): save as separate buddies
  such as `axo-wizard`.
- **App icon / splash for a buddy**: `Make a 1024x1024 app icon: only {NAME}'s idle face close-up on a deep navy
  (#080D1E) rounded square background with a soft cyan glow.`

## How the app uses them

- Setup screen: you pick a buddy and name it; the buddy then lives in Agent mode, the empty chat screen and the live
  voice screen.
- Voice: `talk` and `idle` alternate while it speaks; `wait` while it hears you; `think` while the model works.
- Agent: `think` while a task runs, `wait` when it needs your decision (it hops), `sleep` with no model loaded.
- Tap the buddy: it squashes, jumps and shows `happy`.
- With Android's "remove animations" on, the poses still swap but nothing moves.
