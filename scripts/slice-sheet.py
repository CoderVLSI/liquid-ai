#!/usr/bin/env python3
"""
Turns a character sheet (a grid of poses, e.g. made with ChatGPT) into the buddy folder the app reads.

  python3 scripts/slice-sheet.py sheet.png --id axo --name Axo --tagline "A sleepy axolotl" --color "#ff8fb1"

  --cols 4 --rows 2          grid of the sheet (default 4 x 2)
  --poses idle,blink,...     what each cell is, left to right, top to bottom
                             (default: idle,blink,talk,happy,think,wait,sleep,sad)
  --bg auto|#rrggbb          flat background colour to remove (auto = the sheet's corners); skipped when the
                             sheet is already transparent
  --tolerance 48             how different from the background a pixel must be to count as the character
  --erase-shadow             also remove soft drop shadows under the character
  --inset 8                  pixels to ignore at the edge of each cell (grid lines, neighbours)
  --size 512                 output size of each pose

Needs Pillow:  pip install pillow
Poses end up the same size and standing on the same baseline, so the app can swap between them without jumping.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

DEFAULT_POSES = "idle,blink,talk,happy,think,wait,sleep,sad"


def parse_color(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def corner_color(im):
    w, h = im.size
    px = [im.getpixel(p)[:3] for p in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]
    return tuple(sorted(c[i] for c in px)[len(px) // 2] for i in range(3))


def is_transparent(im):
    w, h = im.size
    return all(im.getpixel(p)[3] < 12 for p in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)))


def cut_background(cell, bg, tol, erase_shadow=False):
    """Makes the flat background transparent. Only background connected to the border goes, so a same-coloured
    patch inside the character stays. Edge pixels are un-mixed from the background colour to avoid a halo."""
    rgb = cell.convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg))
    r, g, b = diff.split()
    maxdiff = ImageChops.lighter(ImageChops.lighter(r, g), b)
    is_bg = maxdiff.point(lambda v: 255 if v <= tol else 0)  # 255 = looks like background
    if erase_shadow:
        # a soft shadow on a flat background is the background colour, darkened: p = s * bg for some 0.25 < s < 1
        dd = sum(c * c for c in bg) or 1
        shadow = []
        raw = rgb.tobytes()
        for j in range(0, len(raw), 3):
            p = (raw[j], raw[j + 1], raw[j + 2])
            k = sum(p[i] * bg[i] for i in range(3)) / dd
            res = max(abs(p[i] - k * bg[i]) for i in range(3))
            shadow.append(255 if (0.2 < k < 1.0 and res <= tol) else 0)
        sh = Image.new("L", rgb.size)
        sh.putdata(shadow)
        is_bg = ImageChops.lighter(is_bg, sh)
    # flood from every border pixel through background-looking pixels
    marked = is_bg.copy()
    w, h = marked.size
    for x in range(w):
        for y in (0, h - 1):
            if marked.getpixel((x, y)) == 255:
                ImageDraw.floodfill(marked, (x, y), 128)
    for y in range(h):
        for x in (0, w - 1):
            if marked.getpixel((x, y)) == 255:
                ImageDraw.floodfill(marked, (x, y), 128)
    alpha = marked.point(lambda v: 0 if v == 128 else 255)
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    # un-mix the background colour from the semi-transparent rim
    px, a = out.load(), alpha.load()
    for y in range(h):
        for x in range(w):
            al = a[x, y]
            if 0 < al < 255:
                k = al / 255.0
                c = px[x, y]
                px[x, y] = tuple(max(0, min(255, int((c[i] - (1 - k) * bg[i]) / k))) for i in range(3)) + (al,)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet")
    ap.add_argument("--id", required=True, help="folder name: lowercase letters, digits, - or _")
    ap.add_argument("--name", default="")
    ap.add_argument("--tagline", default="")
    ap.add_argument("--color", default="#27E8F6")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--rows", type=int, default=2)
    ap.add_argument("--poses", default=DEFAULT_POSES)
    ap.add_argument("--bg", default="auto")
    ap.add_argument("--tolerance", type=int, default=48)
    ap.add_argument("--erase-shadow", action="store_true", help="also remove soft shadows (darker versions of the background colour)")
    ap.add_argument("--inset", type=int, default=8)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "buddies"))
    a = ap.parse_args()

    poses = [p.strip() for p in a.poses.split(",") if p.strip()]
    if len(poses) != a.cols * a.rows:
        sys.exit("%d poses given but the grid has %d cells" % (len(poses), a.cols * a.rows))

    sheet = Image.open(a.sheet).convert("RGBA")
    W, H = sheet.size
    cw, ch = W // a.cols, H // a.rows
    transparent = is_transparent(sheet)
    bg = None if transparent else (corner_color(sheet) if a.bg == "auto" else parse_color(a.bg))
    print("sheet %dx%d, cells %dx%d, background: %s" % (W, H, cw, ch, "already transparent" if transparent else "#%02x%02x%02x" % bg))

    cut = {}
    for i, pose in enumerate(poses):
        x, y = (i % a.cols) * cw, (i // a.cols) * ch
        cell = sheet.crop((x + a.inset, y + a.inset, x + cw - a.inset, y + ch - a.inset))
        cell = cell if transparent else cut_background(cell, bg, a.tolerance, a.erase_shadow)
        box = cell.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
        if not box:
            sys.exit("cell %d (%s) is empty: check --cols/--rows or --tolerance" % (i + 1, pose))
        cut[pose] = cell.crop(box)

    # one scale for every pose, so the character keeps its size from pose to pose
    inner = int(a.size * 0.92)
    scale = min(inner / max(c.width for c in cut.values()), inner / max(c.height for c in cut.values()))
    folder = os.path.join(a.out, a.id)
    os.makedirs(folder, exist_ok=True)
    for pose, c in cut.items():
        c = c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.LANCZOS)
        canvas = Image.new("RGBA", (a.size, a.size), (0, 0, 0, 0))
        canvas.alpha_composite(c, ((a.size - c.width) // 2, a.size - c.height - int(a.size * 0.04)))  # feet on one baseline
        canvas.save(os.path.join(folder, pose + ".png"))
    with open(os.path.join(folder, "buddy.json"), "w") as f:
        json.dump({"name": a.name or a.id.capitalize(), "tagline": a.tagline, "color": a.color}, f, indent=2)
    print("wrote %d poses to %s" % (len(cut), os.path.abspath(folder)))
    print("next: npm run buddies   (CI does it for you when you push)")


if __name__ == "__main__":
    main()
