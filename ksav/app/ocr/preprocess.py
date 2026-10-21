"""Cleaning up a page before anything tries to read it.

On a clean modern scan this changes little. On a photograph of a sefer taken at
an angle under a shul light, it is the difference between usable text and
nonsense, so it is on by default and each step can be turned off.

Sauvola thresholding is implemented here rather than reached for from a library
because the OpenCV build that ships in a wheel does not include the contrib
module that has it, and Sauvola is markedly better than Otsu on old print, where
the paper is yellowed unevenly and a single global threshold either loses the
faint letters or fills in the bleed through from the other side.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..core.logging import get

log = get(__name__)

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


@dataclass
class Steps:
    """What was actually done, so the review screen can say so."""

    rotated: float = 0.0            # degrees, positive is anticlockwise
    orientation: int = 0            # 90 degree turns applied from OSD
    cropped: tuple[int, int, int, int] | None = None
    denoised: bool = False
    contrast: bool = False
    binarized: bool = False
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = []
        if self.orientation:
            parts.append(f"turned {self.orientation} degrees")
        if abs(self.rotated) >= 0.1:
            parts.append(f"straightened by {self.rotated:.1f} degrees")
        if self.cropped:
            parts.append("border trimmed")
        if self.denoised:
            parts.append("speckle removed")
        if self.contrast:
            parts.append("contrast lifted")
        if self.binarized:
            parts.append("converted to black and white")
        return ", ".join(parts).capitalize() if parts else "No cleanup was needed"


@dataclass
class Options:
    deskew: bool = True
    denoise: bool = True
    contrast: bool = True
    binarize: bool = True
    crop: bool = True
    auto_orient: bool = True
    # Anything beyond this is more likely a genuinely rotated photograph than a
    # skewed scan, and rotating by it would make matters worse.
    max_skew_degrees: float = 12.0


def load(path: Path | str):
    import cv2

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(
            f"{Path(path).name} could not be opened as an image. It may be corrupt, "
            f"or in a format Ksav does not handle."
        )
    return image


def to_grayscale(image):
    import cv2

    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _projection_score(binary, angle: float) -> float:
    """How sharply the ink stacks into rows at this angle.

    When a page is straight, every row of pixels is either mostly text or mostly
    empty, so the row totals vary wildly. Tilt it and the lines smear across
    rows and the variance collapses. Maximising that variance is a direct
    measurement of straightness.
    """
    import cv2

    if angle:
        height, width = binary.shape
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
        rotated = cv2.warpAffine(
            binary, matrix, (width, height),
            flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
    else:
        rotated = binary
    rows = rotated.sum(axis=1, dtype=np.float64)
    return float(np.var(np.diff(rows)))


def estimate_skew(gray, limit: float = 12.0) -> float:
    """How far to rotate the page to straighten it, in degrees.

    The returned value is the correction: pass it straight to
    ``cv2.getRotationMatrix2D``. A page tilted clockwise gives a positive number.

    This is a projection profile search rather than the more common
    ``minAreaRect`` on the ink. minAreaRect was tried first and abandoned: its
    angle convention differs between OpenCV versions (5.0 returns (-90, 0] and
    swaps the rectangle's sides depending on orientation), and the dilation
    needed to join letters into lines smears the measurement by close to a
    degree. Measured against pages tilted by known amounts, this lands within
    0.1 degrees and does not care which OpenCV is installed.
    """
    import cv2

    # Downscale first. The angle of a page does not need full resolution, and
    # the search rotates the image sixty times.
    height, width = gray.shape[:2]
    scale = min(1.0, 800.0 / max(height, width))
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) \
        if scale < 1.0 else gray

    inverted = cv2.bitwise_not(small)
    _t, binary = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if binary.sum() < 255 * 40:
        return 0.0
    binary = (binary > 0).astype(np.uint8)

    coarse = max(
        (a / 2 for a in range(int(-limit * 2), int(limit * 2) + 1)),
        key=lambda a: _projection_score(binary, a),
    )
    fine = max(
        (coarse + step / 20 for step in range(-10, 11)),
        key=lambda a: _projection_score(binary, a),
    )
    return round(float(fine), 2)


def deskew(image, options: Options, steps: Steps):
    import cv2

    gray = to_grayscale(image)
    angle = estimate_skew(gray, options.max_skew_degrees)
    # Below a third of a degree the tilt is invisible and rotating costs an
    # interpolation pass that softens the letter strokes slightly. The
    # measurement floor sits around 0.25, so this also stops a straight page
    # being resampled for nothing.
    if abs(angle) < 0.3 or abs(angle) >= options.max_skew_degrees:
        if abs(angle) >= options.max_skew_degrees:
            steps.notes.append(
                f"The page looks tilted by about {abs(angle):.0f} degrees, which is more "
                f"than a scan usually is. It was left as it is, in case that tilt is real. "
                f"Rotate it by hand if the text comes out wrong."
            )
        return image

    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    steps.rotated = angle
    return cv2.warpAffine(
        image, matrix, (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def crop_border(image, steps: Steps):
    """Trim the dark frame a flatbed scanner leaves around a smaller page."""
    import cv2

    gray = to_grayscale(image)
    _t, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    coords = cv2.findNonZero(binary)
    if coords is None:
        return image

    x, y, width, height = cv2.boundingRect(coords)
    page_height, page_width = gray.shape[:2]
    # Only trim if there is a real margin to remove, and never so much that the
    # content itself is at risk.
    if width < page_width * 0.5 or height < page_height * 0.5:
        return image
    if x < 4 and y < 4 and width > page_width - 8 and height > page_height - 8:
        return image

    pad = 6
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(page_width, x + width + pad)
    y1 = min(page_height, y + height + pad)
    steps.cropped = (x0, y0, x1 - x0, y1 - y0)
    return image[y0:y1, x0:x1]


def lift_contrast(image, steps: Steps):
    """CLAHE rather than a global stretch, because a photographed page is lit unevenly."""
    import cv2

    gray = to_grayscale(image)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    steps.contrast = True
    return clahe.apply(gray)


def remove_speckle(image, steps: Steps):
    """Median blur: kills scanner dust without softening letter strokes."""
    import cv2

    steps.denoised = True
    return cv2.medianBlur(to_grayscale(image), 3)


def sauvola(gray, window: int = 31, k: float = 0.2, r: float = 128.0):
    """Local thresholding, computed with integral images so it is fast.

    Otsu picks one threshold for the whole page. On an old sefer with yellowed
    paper and bleed through from the reverse, one threshold either drops the
    faint letters or fills the page with the ghost of the other side. Sauvola
    decides per pixel from its own neighbourhood.
    """
    import cv2

    gray = gray.astype(np.float64)
    if window % 2 == 0:
        window += 1
    pad = window // 2

    padded = cv2.copyMakeBorder(gray, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    integral, integral_sq = cv2.integral2(padded)

    height, width = gray.shape
    y0, x0 = np.meshgrid(np.arange(height), np.arange(width), indexing="ij")
    y1, x1 = y0 + window, x0 + window
    area = float(window * window)

    total = (integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0])
    total_sq = (integral_sq[y1, x1] - integral_sq[y0, x1]
                - integral_sq[y1, x0] + integral_sq[y0, x0])

    mean = total / area
    variance = np.maximum(total_sq / area - mean ** 2, 0.0)
    std = np.sqrt(variance)

    threshold = mean * (1.0 + k * (std / r - 1.0))
    return np.where(gray > threshold, 255, 0).astype(np.uint8)


def binarize(image, steps: Steps):
    steps.binarized = True
    return sauvola(to_grayscale(image))


def detect_orientation(image, steps: Steps):
    """Ask Tesseract which way up the page is, and turn it if it is not.

    Only a whole number of right angles. Fine skew is deskew's job, and OSD is
    not accurate enough about small angles to be trusted with them.
    """
    import cv2

    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return image

    try:
        rgb = cv2.cvtColor(to_grayscale(image), cv2.COLOR_GRAY2RGB)
        data = pytesseract.image_to_osd(
            Image.fromarray(rgb), output_type=pytesseract.Output.DICT
        )
        rotate = int(data.get("rotate", 0)) % 360
    except Exception as exc:
        log.info("orientation detection unavailable: %s", exc)
        return image

    if rotate == 0:
        return image
    codes = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180,
             270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    if rotate not in codes:
        return image
    steps.orientation = rotate
    return cv2.rotate(image, codes[rotate])


def run(image, options: Options | None = None) -> tuple[object, Steps]:
    """The whole pipeline, in the order that each step helps the next.

    Orientation before deskew (there is no point measuring the skew of a page
    that is on its side), cleanup before thresholding (a threshold amplifies
    whatever noise is left), and cropping before all of it so the border does
    not drag the measurements around.
    """
    options = options or Options()
    steps = Steps()

    if options.crop:
        image = crop_border(image, steps)
    if options.auto_orient:
        image = detect_orientation(image, steps)
    if options.deskew:
        image = deskew(image, options, steps)
    if options.denoise:
        image = remove_speckle(image, steps)
    if options.contrast:
        image = lift_contrast(image, steps)
    if options.binarize:
        image = binarize(image, steps)

    return image, steps
