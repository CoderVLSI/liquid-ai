#!/usr/bin/env python3
"""Draws "Bloop", a placeholder chibi water-drop with all 8 poses, so the buddy system works before real art exists.
   python3 scripts/make-placeholder-buddy.py            -> assets/buddies/bloop/*.png + buddy.json
Replace the folder's PNGs with your own art any time (same file names)."""
import json
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 1024  # drawn big, saved at 512 for smooth edges
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "buddies", "bloop")

BODY = (58, 214, 238, 255)
BODY_DARK = (24, 128, 172, 255)
BELLY = (150, 240, 250, 255)
INK = (14, 30, 70, 255)
WHITE = (255, 255, 255, 255)
BLUSH = (255, 140, 170, 190)
GOLD = (255, 214, 90, 255)


def drop_polygon(cx, cy):
    pts = []
    # a chubby droplet: bezier tip on top, round bottom
    for i in range(41):
        t = i / 40
        x = (1 - t) ** 2 * (cx - 250) + 2 * (1 - t) * t * (cx - 40) + t ** 2 * cx
        y = (1 - t) ** 2 * (cy - 120) + 2 * (1 - t) * t * (cy - 300) + t ** 2 * (cy - 430)
        pts.append((x, y))
    for i in range(41):
        t = i / 40
        x = (1 - t) ** 2 * cx + 2 * (1 - t) * t * (cx + 40) + t ** 2 * (cx + 250)
        y = (1 - t) ** 2 * (cy - 430) + 2 * (1 - t) * t * (cy - 300) + t ** 2 * (cy - 120)
        pts.append((x, y))
    return pts


def body(d, cy):
    cx = S // 2
    for grow, color in ((16, BODY_DARK), (0, BODY)):
        d.polygon([(x + (0 if grow == 0 else (x - cx) * 0.0), y) for x, y in drop_polygon(cx, cy)], fill=color) if grow == 0 else None
    # outline: draw bigger shapes first
    d.ellipse([cx - 296, cy - 150, cx + 296, cy + 262], fill=BODY_DARK)
    d.polygon(drop_polygon(cx, cy), fill=BODY_DARK)
    d.ellipse([cx - 280, cy - 134, cx + 280, cy + 246], fill=BODY)
    inner = [(cx + (x - cx) * 0.95, cy + (y - cy) * 0.95 + 8) for x, y in drop_polygon(cx, cy)]
    d.polygon(inner, fill=BODY)
    d.ellipse([cx - 190, cy + 40, cx + 190, cy + 236], fill=BELLY)  # belly
    d.ellipse([cx - 200, cy - 120, cx - 110, cy - 20], fill=(255, 255, 255, 200))  # shine
    d.ellipse([cx - 150, cy - 170, cx - 120, cy - 140], fill=(255, 255, 255, 200))


def eye_open(d, x, y, r=64, look=(0, 0), glint=True):
    d.ellipse([x - r, y - r * 1.15, x + r, y + r * 1.15], fill=WHITE, outline=INK, width=8)
    px, py = x + look[0] * r * 0.35, y + look[1] * r * 0.35
    pr = r * 0.58
    d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=INK)
    if glint:
        d.ellipse([px - pr * 0.1, py - pr * 0.75, px + pr * 0.45, py - pr * 0.2], fill=WHITE)


def eye_arc(d, x, y, up=True, r=56):
    box = [x - r, y - r * 0.8, x + r, y + r * 0.8]
    d.arc(box, 200 if up else 20, 340 if up else 160, fill=INK, width=14)


def mouth_smile(d, cx, y, w=64, h=40, open_=False):
    if open_:
        d.pieslice([cx - w, y - h, cx + w, y + h * 1.9], 0, 180, fill=INK)
        d.pieslice([cx - w * 0.6, y + h * 0.6, cx + w * 0.6, y + h * 1.9], 0, 180, fill=(255, 120, 140, 255))
    else:
        d.arc([cx - w, y - h, cx + w, y + h], 20, 160, fill=INK, width=12)


def sparkle(d, x, y, r):
    d.polygon([(x, y - r), (x + r * 0.25, y - r * 0.25), (x + r, y), (x + r * 0.25, y + r * 0.25), (x, y + r), (x - r * 0.25, y + r * 0.25), (x - r, y), (x - r * 0.25, y - r * 0.25)], fill=GOLD)


def text(d, s, x, y, size, fill=INK):
    try:
        f = ImageFont.load_default(size=size)
    except TypeError:
        f = ImageFont.load_default()
    d.text((x, y), s, font=f, fill=fill, anchor="mm")


FORMS = {
    "base": ((58, 214, 238, 255), (24, 128, 172, 255), (150, 240, 250, 255)),
    "stage2": ((70, 160, 255, 255), (30, 80, 190, 255), (160, 205, 255, 255)),
    "stage3": ((150, 110, 255, 255), (80, 50, 170, 255), (205, 185, 255, 255)),
    "mega": ((255, 214, 90, 255), (200, 120, 30, 255), (255, 244, 190, 255)),
}


def decorate(d, form, cy):
    cx = S // 2
    if form in ("stage2", "stage3", "mega"):
        sparkle(d, cx, cy - 330, 46 if form == "stage2" else 54)  # a star on the tip
    if form in ("stage3", "mega"):
        for dx in (-150, 150):  # side crests
            d.polygon([(cx + dx, cy - 160), (cx + dx * 1.7, cy - 330), (cx + dx * 0.6, cy - 250)], fill=GOLD, outline=INK)
    if form == "mega":
        for x, y, r in ((cx - 330, cy - 200, 40), (cx + 340, cy - 120, 34), (cx - 300, cy + 120, 28), (cx + 300, cy + 200, 36)):
            sparkle(d, x, y, r)


def draw(pose, form="base"):
    global BODY, BODY_DARK, BELLY
    BODY, BODY_DARK, BELLY = FORMS[form]
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([S // 2 - 270, 880, S // 2 + 270, 960], fill=(0, 0, 0, 70))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im)
    cy = 600 + (24 if pose == "sleep" else 0)
    if form == "mega":
        glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([S // 2 - 400, cy - 420, S // 2 + 400, cy + 330], fill=(255, 230, 120, 110))
        im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40)))
        d = ImageDraw.Draw(im)
    body(d, cy)
    decorate(d, form, cy)
    cx = S // 2
    ex, ey = 150, cy + 20
    lx, rx = cx - ex, cx + ex
    for x in (lx - 20, rx + 20):  # cheeks
        d.ellipse([x - 44, ey + 70, x + 44, ey + 120], fill=BLUSH)

    if pose == "idle":
        eye_open(d, lx, ey); eye_open(d, rx, ey); mouth_smile(d, cx, ey + 95)
    elif pose == "blink":
        eye_arc(d, lx, ey, up=False); eye_arc(d, rx, ey, up=False); mouth_smile(d, cx, ey + 95)
    elif pose == "talk":
        eye_open(d, lx, ey); eye_open(d, rx, ey); mouth_smile(d, cx, ey + 80, w=58, h=44, open_=True)
    elif pose == "happy":
        eye_arc(d, lx, ey, up=True); eye_arc(d, rx, ey, up=True); mouth_smile(d, cx, ey + 70, w=70, h=46, open_=True)
        sparkle(d, cx - 330, cy - 260, 46); sparkle(d, cx + 340, cy - 220, 38); sparkle(d, cx + 250, cy - 380, 28)
    elif pose == "think":
        eye_open(d, lx, ey, look=(1, -1)); eye_open(d, rx, ey, look=(1, -1))
        d.arc([cx - 30, ey + 90, cx + 60, ey + 140], 200, 340, fill=INK, width=12)
        for i, r in enumerate((14, 20, 28)):
            d.ellipse([cx + 230 + i * 56 - r, cy - 360 - i * 36 - r, cx + 230 + i * 56 + r, cy - 360 - i * 36 + r], fill=WHITE, outline=INK, width=6)
    elif pose == "wait":
        eye_open(d, lx, ey - 6, r=72); eye_open(d, rx, ey - 6, r=72)
        d.ellipse([cx - 22, ey + 88, cx + 22, ey + 130], fill=INK)
        text(d, "?", cx + 290, cy - 320, 190, GOLD)
    elif pose == "sleep":
        eye_arc(d, lx, ey, up=False); eye_arc(d, rx, ey, up=False)
        d.ellipse([cx - 16, ey + 96, cx + 16, ey + 124], fill=INK)
        text(d, "z", cx + 270, cy - 280, 120, (200, 230, 255, 255)); text(d, "Z", cx + 340, cy - 380, 160, (200, 230, 255, 255))
    elif pose == "sad":
        eye_open(d, lx, ey + 8, look=(0, 1)); eye_open(d, rx, ey + 8, look=(0, 1))
        d.line([lx - 60, ey - 90, lx + 50, ey - 60], fill=INK, width=12); d.line([rx + 60, ey - 90, rx - 50, ey - 60], fill=INK, width=12)
        d.arc([cx - 52, ey + 100, cx + 52, ey + 170], 200, 340, fill=INK, width=12)
        d.ellipse([lx + 30, ey + 70, lx + 62, ey + 130], fill=(150, 220, 255, 255), outline=INK, width=4)
    return im.resize((512, 512), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    poses = ("idle", "blink", "talk", "happy", "think", "wait", "sleep", "sad")
    for form in ("base", "stage2", "stage3", "mega"):
        folder = OUT if form == "base" else os.path.join(OUT, form)
        os.makedirs(folder, exist_ok=True)
        for pose in poses:
            draw(pose, form).save(os.path.join(folder, pose + ".png"))
    with open(os.path.join(OUT, "buddy.json"), "w") as f:
        json.dump({"name": "Bloop", "tagline": "A placeholder water-drop. Swap in your own art any time.", "color": "#27E8F6",
                   "forms": {"stage2": {"name": "Bloopa"}, "stage3": {"name": "Tidalon"}, "mega": {"name": "Mega Tidalon"}}}, f, indent=2)
    print("wrote", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
