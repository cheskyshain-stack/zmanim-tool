"""Builds the app icons in public/icons.

Not part of the build: run it only when the artwork changes, then commit what it writes.
It needs Pillow, which nothing else in this project does.

    pip install pillow && python scripts/make-icons.py

The mark is a small square growing into a large one, which is the whole app in one
picture. It is drawn with plain shapes so it stays legible at 48 px on a home screen.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"

INK = (11, 18, 32, 255)
BRAND = (79, 147, 245, 255)
LIGHT = (191, 214, 250, 255)


def geometry(size: float, inset: float) -> dict:
    """The shapes, in units of a `size` x `size` canvas.

    Both the PNG drawing and the SVG read from here, so the favicon and the home screen
    icon cannot drift apart when the artwork is adjusted.
    """
    pad = size * inset
    box = size - pad * 2
    line = max(2.0, box * 0.075)

    small = box * 0.3
    sx, sy = pad, pad + box - small
    large = box * 0.62
    lx, ly = pad + box - large, pad

    start = (sx + small * 0.5, sy + small * 0.5)
    end = (lx + large * 0.5, ly + large * 0.5)
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    head = box * 0.15
    # Stop the shaft short of the head so the two do not pile up at the tip.
    shaft_end = (end[0] - ux * head * 0.8, end[1] - uy * head * 0.8)

    # Barbs are the direction vector rotated either side of the tip, so the head always
    # points along the shaft however the squares are placed.
    spread = math.radians(26)
    barbs = []
    for angle in (spread, -spread):
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        bx = ux * cos_a - uy * sin_a
        by = ux * sin_a + uy * cos_a
        barbs.append((end[0] - bx * head, end[1] - by * head))

    return {
        "radius": size * 0.22,
        "line": line,
        "small": (sx, sy, small),
        "large": (lx, ly, large),
        "start": start,
        "shaft_end": shaft_end,
        "tip": end,
        "barbs": barbs,
    }


def draw_mark(size: int, inset: float) -> Image.Image:
    """Draws the icon at `size`, with the artwork inside `inset` of the canvas.

    A maskable icon gets a large inset: Android may crop anything outside the middle
    80%, and a mark that runs to the edge comes back with its corners shaved off.
    """
    scale = 4  # draw big and downsample, which is the cheapest antialiasing there is
    px = size * scale
    g = geometry(px, inset)
    image = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(g["radius"]), fill=INK)

    line = int(g["line"])
    sx, sy, small = g["small"]
    lx, ly, large = g["large"]

    # Small solid square, lower left: the image you start with.
    draw.rectangle([sx, sy, sx + small, sy + small], fill=LIGHT)
    # Large outlined square, upper right: the print you end up with.
    draw.rounded_rectangle(
        [lx, ly, lx + large, ly + large],
        radius=int(line * 1.2),
        outline=BRAND,
        width=line,
    )
    draw.line([g["start"], g["shaft_end"]], fill=BRAND, width=line)
    draw.polygon([g["tip"], g["barbs"][0], g["barbs"][1]], fill=BRAND)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_mark(192, 0.16).save(OUT / "icon-192.png")
    draw_mark(512, 0.16).save(OUT / "icon-512.png")
    # Maskable: everything important inside the middle 80%, so a circular mask on an
    # Android launcher cannot clip it.
    draw_mark(512, 0.26).save(OUT / "icon-maskable-512.png")
    draw_mark(180, 0.16).save(OUT / "apple-touch-icon.png")

    g = geometry(100, 0.16)
    sx, sy, small = g["small"]
    lx, ly, large = g["large"]
    n = lambda v: f"{v:.2f}"
    (OUT / "icon.svg").write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="{n(g['radius'])}" fill="#0b1220"/>
  <rect x="{n(sx)}" y="{n(sy)}" width="{n(small)}" height="{n(small)}" fill="#bfd6fa"/>
  <rect x="{n(lx)}" y="{n(ly)}" width="{n(large)}" height="{n(large)}"
        rx="{n(g['line'] * 1.2)}" fill="none" stroke="#4f93f5"
        stroke-width="{n(g['line'])}"/>
  <path d="M{n(g['start'][0])} {n(g['start'][1])} L{n(g['shaft_end'][0])} {n(g['shaft_end'][1])}"
        stroke="#4f93f5" stroke-width="{n(g['line'])}" stroke-linecap="round"/>
  <path d="M{n(g['tip'][0])} {n(g['tip'][1])} L{n(g['barbs'][0][0])} {n(g['barbs'][0][1])} """
        f"""L{n(g['barbs'][1][0])} {n(g['barbs'][1][1])} Z" fill="#4f93f5"/>
</svg>
""",
        encoding="utf-8",
    )
    print(f"icons: wrote {len(list(OUT.iterdir()))} files to public/icons")


if __name__ == "__main__":
    main()
