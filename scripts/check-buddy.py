#!/usr/bin/env python3
"""Quality check for buddy art, the same checks a human reviewer would do.

  python3 scripts/check-buddy.py assets/buddies/axo                 # a base buddy
  python3 scripts/check-buddy.py assets/buddies/axo/stage2          # an evolved form
  python3 scripts/check-buddy.py assets/buddies/*                   # everything

Prints PASS / WARN / FAIL per buddy and exits with 1 if anything FAILS. WARN = look at it, probably fine.
Checks: 512x512 transparent PNGs, transparent corners, nothing touching the canvas edge, feet on one line,
same silhouette in idle/blink/talk, no magenta left over, and the right number of separate props per pose
(happy: 3 sparkles, think: 3 bubbles, wait: one "?", sleep: two "z"). Needs Pillow.
"""
import os
import sys
from collections import deque

from PIL import Image, ImageChops

POSES = ["idle", "blink", "talk", "happy", "think", "wait", "sleep", "sad"]
# separate pieces besides the body: (min, max). Props that touch the body merge with it, so the minimum is low.
PIECES = {"idle": (0, 0), "blink": (0, 0), "talk": (0, 0), "sad": (0, 1), "happy": (2, 3), "think": (0, 3), "wait": (1, 2), "sleep": (0, 2)}
MEGA_POSES = ["idle", "blink", "talk", "happy"]


def alpha_mask(im, t=24):
    return im.getchannel("A").point(lambda v: 255 if v > t else 0)


def count_pieces(alpha):
    s = 4
    small = alpha.resize((alpha.width // s, alpha.height // s), Image.BOX).point(lambda v: 255 if v > 30 else 0)
    w, h = small.size
    px = small.load()
    seen = [[False] * w for _ in range(h)]
    n = 0
    for y in range(h):
        for x in range(w):
            if px[x, y] and not seen[y][x]:
                n += 1
                q = deque([(x, y)])
                seen[y][x] = True
                while q:
                    cx, cy = q.popleft()
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny][nx]:
                                seen[ny][nx] = True
                                q.append((nx, ny))
    return max(0, n - 1)


def magenta(im):
    px = im.load()
    n = 0
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a > 20 and r > 190 and b > 190 and g < 90 and abs(r - b) < 70:  # true magenta; hot-pink art has a much lower blue
                n += 1
    return n


def check(folder):
    form = os.path.basename(folder) in ("stage2", "stage3", "mega")
    poses = MEGA_POSES if os.path.basename(folder) == "mega" else POSES
    res = []  # (level, text)
    ims = {}
    for p in poses:
        path = os.path.join(folder, p + ".png")
        if not os.path.exists(path):
            res.append(("FAIL", "missing %s.png" % p))
            continue
        im = Image.open(path).convert("RGBA")
        ims[p] = im
        if im.size != (512, 512):
            res.append(("FAIL", "%s is %dx%d, expected 512x512" % (p, im.width, im.height)))
        w, h = im.size
        if any(im.getpixel(c)[3] > 10 for c in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))):
            res.append(("FAIL", "%s: background is not transparent" % p))
        a = alpha_mask(im)
        bb = a.getbbox()
        if not bb:
            res.append(("FAIL", "%s is empty" % p))
            continue
        if bb[0] <= 1 or bb[1] <= 1 or bb[2] >= w - 1 or bb[3] >= h - 1:
            res.append(("FAIL", "%s touches the canvas edge (cut off?)" % p))
        m = magenta(im)
        if m > 8:
            res.append(("FAIL", "%s has %d leftover magenta pixels (run clean-sprite.py --erase-magenta)" % (p, m)))
        lo, hi = PIECES[p]
        extra = count_pieces(a)
        if extra > hi:
            res.append(("FAIL" if p == "happy" or extra > hi + 1 else "WARN", "%s has %d separate pieces besides the body, expected at most %d (an extra sparkle/bubble/speck? see clean-sprite.py --list)" % (p, extra, hi)))
        elif extra < lo:
            res.append(("FAIL" if lo - extra > 1 or p in ("happy", "wait") else "WARN", "%s has only %d separate pieces besides the body, expected at least %d (missing sparkles/question mark/z?)" % (p, extra, lo)))
    bottoms = {p: alpha_mask(i).getbbox()[3] for p, i in ims.items() if alpha_mask(i).getbbox()}
    if bottoms and max(bottoms.values()) - min(bottoms.values()) > 3:
        res.append(("FAIL", "feet are not on one line: bottoms %s" % bottoms))
    if "idle" in ims:
        idle = alpha_mask(ims["idle"])
        for o in ("blink", "talk"):
            if o in ims:
                s = alpha_mask(ims[o])
                inter = sum(ImageChops.multiply(idle, s).histogram()[1:])  # pixels that are inside both outlines
                uni = sum(ImageChops.lighter(idle, s).histogram()[1:])  # pixels inside either
                iou = inter / uni if uni else 0
                if iou < 0.93:
                    res.append(("FAIL", "%s has a different outline than idle (overlap %.3f, need 0.93+): redraw it as idle with only the eyes/mouth changed" % (o, iou)))
                elif iou < 0.975:
                    res.append(("WARN", "%s outline differs a little from idle (overlap %.3f); expect slight shimmer when it blinks/talks" % (o, iou)))
    if not form:
        meta = os.path.join(folder, "buddy.json")
        if not os.path.exists(meta):
            res.append(("FAIL", "buddy.json missing"))
    return res


def main():
    folders = [a for a in sys.argv[1:] if os.path.isdir(a) and not os.path.basename(a).startswith("_")]
    if not folders:
        sys.exit(__doc__)
    bad = 0
    for f in folders:
        res = check(f)
        worst = "FAIL" if any(l == "FAIL" for l, _ in res) else "WARN" if res else "PASS"
        bad += worst == "FAIL"
        print("%-5s %s" % (worst, f))
        for level, text in res:
            print("        %s: %s" % (level, text))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
