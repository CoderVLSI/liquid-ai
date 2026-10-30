#!/usr/bin/env python3
"""Small, repeatable touch-ups for a finished buddy pose PNG (edited in place; git keeps the original).

  python3 scripts/clean-sprite.py assets/buddies/ember/happy.png --erase-magenta
        removes leftover #FF00FF background that was trapped inside the picture (e.g. between an arm and a tail)
  python3 scripts/clean-sprite.py assets/buddies/nimbus/happy.png --list
        lists the separate pieces of the picture (body, sparkles, bubbles...) with their boxes
  python3 scripts/clean-sprite.py assets/buddies/nimbus/happy.png --remove-at 466,218
        deletes the separate piece that contains (or is nearest to) that pixel, e.g. one sparkle too many
"""
import argparse
import sys
from collections import deque

from PIL import Image, ImageFilter


def components(alpha, thresh=24):
    w, h = alpha.size
    px = alpha.load()
    seen = [[False] * w for _ in range(h)]
    out = []
    for y in range(h):
        for x in range(w):
            if px[x, y] > thresh and not seen[y][x]:
                q = deque([(x, y)])
                seen[y][x] = True
                pts = []
                while q:
                    cx, cy = q.popleft()
                    pts.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] > thresh:
                                seen[ny][nx] = True
                                q.append((nx, ny))
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                out.append({"n": len(pts), "box": (min(xs), min(ys), max(xs), max(ys)), "pts": pts})
    out.sort(key=lambda c: -c["n"])
    return out


def is_magenta(r, g, b, loose=False):
    if loose:  # a semi-transparent rim that is mostly magenta
        return r > 150 and b > 120 and g < 140 and (r - g) > 50 and (b - g) > 40
    return r > 170 and b > 150 and g < 110 and (r - g) > 80 and (b - g) > 60


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("png")
    ap.add_argument("--erase-magenta", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--remove-at", default="", help="x,y of a pixel of the piece to delete")
    a = ap.parse_args()

    im = Image.open(a.png).convert("RGBA")
    if a.list:
        for i, c in enumerate(components(im.getchannel("A"))):
            print("piece %d: %6d px  box %s" % (i, c["n"], c["box"]))
        return

    changed = 0
    px = im.load()
    w, h = im.size
    if a.erase_magenta:
        for y in range(h):
            for x in range(w):
                r, g, b, al = px[x, y]
                if al and is_magenta(r, g, b, loose=al < 255):
                    px[x, y] = (r, g, b, 0)
                    changed += 1
        # one more pass for the soft edge next to what was removed
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                r, g, b, al = px[x, y]
                if 0 < al < 255 and is_magenta(r, g, b, loose=True):
                    px[x, y] = (r, g, b, 0)
                    changed += 1
    if a.remove_at:
        x0, y0 = (int(v) for v in a.remove_at.split(","))
        comps = components(im.getchannel("A"))
        best, bd = None, 1e9
        for c in comps:
            for (x, y) in c["pts"][:: max(1, len(c["pts"]) // 400)]:
                d = (x - x0) ** 2 + (y - y0) ** 2
                if d < bd:
                    best, bd = c, d
        if best is None or bd > 40 ** 2:
            sys.exit("nothing near %s" % a.remove_at)
        if best is comps[0]:
            sys.exit("that is the main body, not a separate piece; refusing")
        mask = Image.new("L", im.size, 0)
        mp = mask.load()
        for (x, y) in best["pts"]:
            mp[x, y] = 255
        mask = mask.filter(ImageFilter.MaxFilter(7))  # also the soft edge around it
        for y in range(h):
            for x in range(w):
                if mp[x, y]:
                    r, g, b, _ = px[x, y]
                    if (r, g, b, _) != (0, 0, 0, 0):
                        px[x, y] = (r, g, b, 0)
                        changed += 1
        print("removed piece with box", best["box"])
    im.save(a.png)
    print("%s: %d pixels cleared" % (a.png, changed))


if __name__ == "__main__":
    main()
