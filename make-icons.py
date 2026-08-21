"""Build the home screen and browser tab icons from icons/source.png.

Run it after replacing icons/source.png, and not otherwise: everything else in
icons/ is output. It needs Pillow (pip install pillow), which nothing else here
does, so it is a separate script rather than part of build-offline.py.

Why several files rather than one:

- A phone does not use the icon as given. iOS rounds whatever it is handed into
  its own squircle, and an Android launcher may cut a circle, a rounded square
  or a teardrop out of it. So the icon has to be a full square of artwork with
  nothing important near the edges, and the corners of the source (which are
  black, around a rounded square) have to be filled in. Handing over the
  pre-rounded picture gets it rounded twice, with a dark fringe left in the
  corners.

- The maskable one is the same picture shrunk inside a larger navy square, so
  that everything stays inside the circle a launcher may cut. Measured on the
  source, the corners of the lettering sit 541px from the centre of a 1254px
  square, and the circle a launcher is allowed to cut has a radius of 0.4 of the
  width, which is 502px. Left alone, the L and the m would lose their edges.

- The favicon is the clock and the sunrise only. At 16px the words are three
  grey smudges, and the mark alone still reads.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
ICONS = ROOT / "icons"
SOURCE = ICONS / "source.png"

# The background of the artwork, used to fill the corners and to pad the
# maskable one. Sampled from the source rather than typed in, so replacing the
# picture with one on a different background does not need this edited.
def background(im):
    return im.getpixel((im.width // 2, 12))


# The clock and the sunrise, without the lettering, for the small sizes.
# Measured off the source: the mark occupies (334, 180) to (915, 766).
MARK = (334, 180, 915, 766)
MARK_PAD = 0.07

# How much of the maskable icon the artwork is allowed to take up. 0.88 puts the
# far corners of the lettering at 476 of the 502 a launcher may leave.
MASKABLE_SCALE = 0.88


def flatten_background(im, colour, tolerance=8):
    """Snap the near-background pixels to exactly the background colour.

    The artwork came out of a picture generator, so its navy is not one colour
    but thousands within a shade of each other. PNG cannot compress that, and
    the source arrived at 1.4MB for what is a flat navy square with a clock on
    it. Snapping the 86% of pixels that are within a shade of the background
    takes it to 280KB with no visible difference (compared side by side at
    360px: none). Everything with real colour in it, the clock, the sun and the
    lettering, is far outside the tolerance and is left alone.

    A no-op on a source that is already flat, so it is safe to leave in."""
    px = list(im.getdata())
    snapped = [
        colour if all(abs(v[i] - colour[i]) <= tolerance for i in range(3)) else v for v in px
    ]
    out = Image.new("RGB", im.size)
    out.putdata(snapped)
    return out


def square(im, colour):
    """The artwork on an opaque square of its own background, corners filled.

    The source has square black corners around a rounded square. Pasted onto a
    plain background of the same navy, the rounding disappears and the phone is
    free to put its own on."""
    out = Image.new("RGB", im.size, colour)
    mask = Image.new("L", im.size, 0)
    # A rounded rectangle slightly inside the artwork's own rounding, so the
    # antialiased edge of the original goes with the corners rather than being
    # left as a grey hairline.
    from PIL import ImageDraw

    ImageDraw.Draw(mask).rounded_rectangle(
        (10, 10, im.width - 11, im.height - 11), radius=int(im.width * 0.20), fill=255
    )
    out.paste(im, (0, 0), mask)
    return out


def resized(im, size):
    return im.resize((size, size), Image.LANCZOS)


def main():
    if not SOURCE.exists():
        raise SystemExit(f"no source artwork at {SOURCE}")
    src = Image.open(SOURCE).convert("RGB")
    if src.width != src.height:
        raise SystemExit(f"the source must be square, this one is {src.size}")
    colour = background(src)
    src = flatten_background(src, colour)
    full = square(src, colour)

    written = []

    def write(im, name):
        path = ICONS / name
        im.save(path, optimize=True)
        written.append((name, path.stat().st_size))

    # The manifest's own icons, and what iOS uses. Full bleed: the phone rounds it.
    write(resized(full, 512), "icon-512.png")
    write(resized(full, 192), "icon-192.png")
    write(resized(full, 180), "apple-touch-icon.png")

    # Shrunk inside its own background, for a launcher that cuts a shape out. This is
    # the one Android actually puts on the home screen once the site is installed, so
    # it is also the one that decides whether the lettering survives.
    for size in (512, 192):
        inner = int(size * MASKABLE_SCALE)
        maskable = Image.new("RGB", (size, size), colour)
        maskable.paste(resized(full, inner), ((size - inner) // 2, (size - inner) // 2))
        write(maskable, f"icon-maskable-{size}.png")

    # The tab, where only the mark fits.
    x0, y0, x1, y1 = MARK
    pad = int(max(x1 - x0, y1 - y0) * MARK_PAD)
    side = max(x1 - x0, y1 - y0) + pad * 2
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    mark = square(src, colour).crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))
    write(resized(mark, 32), "favicon-32.png")
    write(resized(mark, 16), "favicon-16.png")

    # /favicon.ico at the root, which every browser asks for whether or not it is
    # linked to. Without it the site 404s on every single page load.
    ico = ROOT / "favicon.ico"
    resized(mark, 64).save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    written.append(("../favicon.ico", ico.stat().st_size))

    for name, size in written:
        print(f"  {name:26} {size / 1024:6.1f} KB")
    print(f"background {colour}, from {SOURCE.name} at {src.width}px")


if __name__ == "__main__":
    main()
