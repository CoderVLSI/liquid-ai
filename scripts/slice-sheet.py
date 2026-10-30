#!/usr/bin/env python3
"""
Turns a character sheet (a grid of poses, e.g. made with ChatGPT) into the buddy folder the app reads.

  python3 scripts/slice-sheet.py sheet.png --id axo --name Axo --tagline "A sleepy axolotl" --color "#ff8fb1"
  python3 scripts/slice-sheet.py my_poses_folder/ --id axo ...     (a folder with idle.png, blink.png ... one image per pose)

  --cols 4 --rows 2          grid of the sheet (default 4 x 2)
  --poses idle,blink,...     what each cell is, left to right, top to bottom
                             (default: idle,blink,talk,happy,think,wait,sleep,sad)
  --bg auto|#rrggbb          flat background colour to remove (auto = the sheet's corners); skipped when the
                             sheet is already transparent
  --tolerance 48             how different from the background a pixel must be to count as the character
  --erase-shadow             also remove soft drop shadows under the character
  --auto                     find poses by their own outline (use when a tail/arm crosses a grid line)
  --inset 8                  pixels to ignore at the edge of each cell (grid lines, neighbours)
  --size 512                 output size of each pose
  --form stage2|stage3|mega  write an evolved form into <id>/<form>/ (the base buddy must already exist)
  --form-name "Bloopa"       display name of that form

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
    # background trapped inside the picture (between an arm and a tail, inside a ring...) is not reached by the flood
    # from the border: clear pixels that are almost exactly the background colour wherever they are
    exact = maxdiff.point(lambda v: 0 if v <= max(10, tol * 2 // 3) else 255)
    alpha = ImageChops.multiply(alpha, exact)
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


def auto_cells(sheet, bg, tol, n, cols, rows):
    """Finds each pose by its own outline instead of a rigid grid, so a tail or an arm that crosses the grid line is
    kept whole. Returns [(box, mask)] in reading order, or None when it cannot tell exactly n poses apart."""
    from collections import deque
    S = 4  # work on a quarter-size picture
    small = sheet.convert("RGB").resize((sheet.width // S, sheet.height // S), Image.BOX)
    diff = ImageChops.difference(small, Image.new("RGB", small.size, bg))
    r, g, b = diff.split()
    fg = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v > tol else 0)
    w, h = fg.size
    for radius in range(3, 30):  # grow the shapes until the props join their character and nothing else joins
        grown = fg.filter(ImageFilter.MaxFilter(2 * radius + 1))
        gp = grown.load()
        seen = [[False] * w for _ in range(h)]
        found = []
        for y in range(h):
            for x in range(w):
                if gp[x, y] and not seen[y][x]:
                    q = deque([(x, y)])
                    seen[y][x] = True
                    pts = []
                    while q:
                        cx, cy = q.popleft()
                        pts.append((cx, cy))
                        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                            if 0 <= nx < w and 0 <= ny < h and gp[nx, ny] and not seen[ny][nx]:
                                seen[ny][nx] = True
                                q.append((nx, ny))
                    if len(pts) > 40:  # ignore specks
                        found.append(pts)
        if len(found) == n:
            break
        if len(found) < n:
            return None
    else:
        return None
    items = []
    for pts in found:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        m = Image.new("L", (w, h), 0)
        mp = m.load()
        for (x, y) in pts:
            mp[x, y] = 255
        items.append(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(xs), min(ys), max(xs) + 1, max(ys) + 1), m))
    items.sort(key=lambda it: it[1])
    ordered = []
    for r_i in range(rows):  # split into rows by height, each row left to right
        row = sorted(items[r_i * cols:(r_i + 1) * cols], key=lambda it: it[0])
        ordered.extend(row)
    out = []
    for cx, cy, (x0, y0, x1, y1), m in ordered:
        pad = 4
        box = (max(0, (x0 - pad) * S), max(0, (y0 - pad) * S), min(sheet.width, (x1 + pad) * S), min(sheet.height, (y1 + pad) * S))
        out.append((box, m.resize((w * S, h * S), Image.NEAREST).crop(box)))
    return out


def prepare(cell, pose, a, index):
    """Background removal + tight crop for one pose image."""
    if is_transparent(cell):
        out = cell
    else:
        bg = corner_color(cell) if a.bg == "auto" else parse_color(a.bg)
        out = cut_background(cell, bg, a.tolerance, a.erase_shadow)
    alpha_ch = out.getchannel("A")
    aw, ah = alpha_ch.size
    ap = alpha_ch.load()
    touching = [side for side, pts in (
        ("left", ((0, y) for y in range(ah))), ("right", ((aw - 1, y) for y in range(ah))),
        ("top", ((x, 0) for x in range(aw))), ("bottom", ((x, ah - 1) for x in range(aw))))
        if sum(1 for pt in pts if ap[pt] > 24) >= 8]  # a real run of picture on the edge, not one stray pixel
    if touching and index is not None:
        print("WARNING: %s touches the %s edge of its cell: it is probably CUT OFF. Regenerate the sheet with more empty "
              "margin around each pose." % ("cell %d (%s)" % (index + 1, pose), " and ".join(touching)))
    box = alpha_ch.point(lambda v: 255 if v > 24 else 0).getbbox()
    if not box:
        where = "cell %d (%s)" % (index + 1, pose) if index is not None else pose
        sys.exit("%s is empty: check --cols/--rows or --tolerance" % where)
    return out.crop(box)


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
    ap.add_argument("--auto", action="store_true", help="find each pose by its own outline instead of an equal grid (fixes tails/arms that cross a grid line)")
    ap.add_argument("--form", choices=["stage2", "stage3", "mega"], default="")
    ap.add_argument("--form-name", default="")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "buddies"))
    a = ap.parse_args()

    poses = [p.strip() for p in a.poses.split(",") if p.strip()]
    if len(poses) != a.cols * a.rows:
        sys.exit("%d poses given but the grid has %d cells" % (len(poses), a.cols * a.rows))

    cut = {}
    if os.path.isdir(a.sheet):
        # one image per pose, named after the pose (idle.png, blink.jpg, ...)
        for pose in poses:
            path = next((os.path.join(a.sheet, pose + e) for e in (".png", ".webp", ".jpg", ".jpeg") if os.path.exists(os.path.join(a.sheet, pose + e))), None)
            if not path:
                sys.exit("missing %s.png (or .webp/.jpg) in %s" % (pose, a.sheet))
            cut[pose] = prepare(Image.open(path).convert("RGBA"), pose, a, None)
    else:
        sheet = Image.open(a.sheet).convert("RGBA")
        W, H = sheet.size
        cw, ch = W // a.cols, H // a.rows
        print("sheet %dx%d, cells %dx%d" % (W, H, cw, ch))
        auto = None
        if a.auto:
            bgc = corner_color(sheet) if a.bg == "auto" else parse_color(a.bg)
            auto = auto_cells(sheet, bgc, a.tolerance, len(poses), a.cols, a.rows)
            print("auto: found %s poses by outline" % ("all %d" % len(poses) if auto else "NOT all"))
        for i, pose in enumerate(poses):
            if auto:
                (box, mask) = auto[i]
                cell = sheet.crop(box)
                bgc = corner_color(sheet) if a.bg == "auto" else parse_color(a.bg)
                flat = Image.new("RGBA", cell.size, bgc + (255,))
                flat.paste(cell, (0, 0), mask)  # only this pose's own pixels; a neighbour's bleed becomes background
                cut[pose] = prepare(flat, pose, a, i)
                continue
            x, y = (i % a.cols) * cw, (i // a.cols) * ch
            cell = sheet.crop((x + a.inset, y + a.inset, x + cw - a.inset, y + ch - a.inset))
            cut[pose] = prepare(cell, pose, a, i)

    # one scale for every pose, so the character keeps its size from pose to pose
    inner = int(a.size * 0.92)
    scale = min(inner / max(c.width for c in cut.values()), inner / max(c.height for c in cut.values()))
    folder = os.path.join(a.out, a.id, a.form) if a.form else os.path.join(a.out, a.id)
    os.makedirs(folder, exist_ok=True)
    for pose, c in cut.items():
        c = c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.LANCZOS)
        canvas = Image.new("RGBA", (a.size, a.size), (0, 0, 0, 0))
        canvas.alpha_composite(c, ((a.size - c.width) // 2, a.size - c.height - int(a.size * 0.04)))  # feet on one baseline
        canvas.save(os.path.join(folder, pose + ".png"))
    meta_path = os.path.join(a.out, a.id, "buddy.json")
    if a.form:
        meta = {}
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
        if a.form_name:
            meta.setdefault("forms", {}).setdefault(a.form, {})["name"] = a.form_name
            with open(meta_path, "w") as f:
                json.dump(meta, f, indent=2)
    else:
        with open(meta_path, "w") as f:
            json.dump({"name": a.name or a.id.capitalize(), "tagline": a.tagline, "color": a.color}, f, indent=2)
    print("wrote %d poses to %s" % (len(cut), os.path.abspath(folder)))
    print("next: npm run buddies   (CI does it for you when you push)")


if __name__ == "__main__":
    main()
