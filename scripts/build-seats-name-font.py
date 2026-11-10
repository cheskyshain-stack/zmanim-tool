"""Build the subtly stronger seat-name face from the shipped Liberation Serif.

Requires fontTools with WOFF2 support and the system FreeType library. The normal
website build uses these checked-in fonts and does not run this generator.
The renamed derivative retains the source font's SIL Open Font License.
"""
import ctypes as ct
import ctypes.util
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates

ROOT = Path(__file__).resolve().parents[1]
STRENGTH_EM = 0.004


class Vector(ct.Structure):
    _fields_ = [('x', ct.c_long), ('y', ct.c_long)]


class Outline(ct.Structure):
    _fields_ = [
        ('n_contours', ct.c_short), ('n_points', ct.c_short),
        ('points', ct.POINTER(Vector)), ('tags', ct.POINTER(ct.c_char)),
        ('contours', ct.POINTER(ct.c_short)), ('flags', ct.c_int),
    ]


def build_font():
    library = ctypes.util.find_library('freetype')
    if not library:
        raise RuntimeError('Install FreeType to regenerate the seat-name font.')
    freetype = ct.CDLL(library)
    freetype.FT_Outline_EmboldenXY.argtypes = [ct.POINTER(Outline), ct.c_long, ct.c_long]
    freetype.FT_Outline_EmboldenXY.restype = ct.c_int

    source = ROOT / 'assets/print/LiberationSerif-Regular.ttf'
    font = TTFont(source, recalcTimestamp=False)
    strength = round(font['head'].unitsPerEm * STRENGTH_EM * 64)
    glyf = font['glyf']
    old_minima = {
        name: glyf[name].xMin for name in font.getGlyphOrder()
        if glyf[name].numberOfContours != 0
    }
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        # Composite glyphs reuse these same strengthened component outlines.
        if glyph.isComposite() or glyph.numberOfContours <= 0:
            continue
        coordinates = glyph.coordinates
        points = (Vector * len(coordinates))(*(
            Vector(round(x * 64), round(y * 64)) for x, y in coordinates
        ))
        tags = (ct.c_char * len(coordinates))(*(
            bytes([int(flag) & 1]) for flag in glyph.flags
        ))
        contours = (ct.c_short * len(glyph.endPtsOfContours))(*glyph.endPtsOfContours)
        outline = Outline(glyph.numberOfContours, len(coordinates), points, tags, contours, 0)
        error = freetype.FT_Outline_EmboldenXY(ct.byref(outline), strength, strength)
        if error:
            raise RuntimeError(f'FreeType could not strengthen glyph {name}: {error}')
        # Center the tiny expansion and preserve point indices for existing hinting.
        glyph.coordinates = GlyphCoordinates(
            (round((point.x - strength / 2) / 64), round((point.y - strength / 2) / 64))
            for point in points
        )
    for name, old_minimum in old_minima.items():
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        advance, bearing = font['hmtx'].metrics[name]
        font['hmtx'].metrics[name] = (advance, bearing + glyph.xMin - old_minimum)

    names = {
        1: 'Seats Serif', 2: 'Regular', 3: 'SeatsSerif-Regular-004',
        4: 'Seats Serif Regular', 6: 'SeatsSerif-Regular',
        16: 'Seats Serif', 17: 'Regular', 18: 'Seats Serif Regular',
        21: 'Seats Serif', 22: 'Regular',
    }
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding(), errors='replace')
    font['OS/2'].usWeightClass = 450
    target = ROOT / 'assets/print/SeatsSerif-Regular.ttf'
    font.save(target)
    font.flavor = 'woff2'
    font.save(ROOT / 'assets/fonts/seats-serif-450.woff2')

    original, adjusted = TTFont(source), TTFont(target)
    assert original.getBestCmap() == adjusted.getBestCmap()
    assert original.getGlyphOrder() == adjusted.getGlyphOrder()
    assert {key: value[0] for key, value in original['hmtx'].metrics.items()} == {
        key: value[0] for key, value in adjusted['hmtx'].metrics.items()
    }
    print(f'Built {target.name}: {STRENGTH_EM}em stronger outlines; unchanged advances and characters.')


if __name__ == '__main__':
    build_font()
