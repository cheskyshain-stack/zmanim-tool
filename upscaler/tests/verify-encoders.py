"""Checks the files written by tests/encoders.test.mts against a real decoder.

    npm run build:encoder-fixtures   # writes the files
    pip install pillow numpy
    python tests/verify-encoders.py tests/tmp/encoders

PNG and TIFF must come back pixel for pixel identical, because both are lossless. JPEG
is lossy, so it is scored against libjpeg encoding the same image at the same quality:
the point is that this encoder is as good as the reference, not that it is perfect.
"""

import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

WIDTH, HEIGHT, DPI = 517, 233, 300


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = ((a.astype(np.float64) - b.astype(np.float64)) ** 2).mean()
    return float("inf") if mse == 0 else 10 * np.log10(255 * 255 / mse)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/tmp/encoders")
    source = np.frombuffer((out / "source.raw").read_bytes(), dtype=np.uint8)
    source = source.reshape(HEIGHT, WIDTH, 3)
    failures = 0

    for name in ("out.png", "out.tiff", "out-onestrip.tiff"):
        image = Image.open(out / name)
        pixels = np.array(image.convert("RGB"))
        same = pixels.shape == source.shape and int(np.abs(pixels.astype(int) - source.astype(int)).max()) == 0
        dpi = image.info.get("dpi")
        ok = same and dpi is not None and abs(dpi[0] - DPI) < 0.01
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} {name:20s} {image.size} exact={same} dpi={dpi}")

    tiff = Image.open(out / "out.tiff")
    icc = len(tiff.info.get("icc_profile") or b"")
    print(f"{'PASS' if icc > 100 else 'FAIL'} tiff icc profile   {icc} bytes")
    failures += 0 if icc > 100 else 1
    # Compression 8 is Adobe Deflate and predictor 2 is horizontal differencing. Both
    # are what makes a lossless 300 megapixel TIFF a sane size.
    tags = {tag: tiff.tag_v2.get(tag) for tag in (259, 262, 284, 296, 317)}
    expected = {259: 8, 262: 2, 284: 1, 296: 2, 317: 2}
    ok = tags == expected
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'} tiff tags          {tags}")

    mine = Image.open(out / "out.jpg")
    mine_pixels = np.array(mine.convert("RGB"))
    mine_bytes = (out / "out.jpg").stat().st_size
    reference = io.BytesIO()
    Image.fromarray(source).save(reference, "JPEG", quality=95, subsampling=0)
    ref_pixels = np.array(Image.open(io.BytesIO(reference.getvalue())).convert("RGB"))
    mine_psnr = psnr(source, mine_pixels)
    ref_psnr = psnr(source, ref_pixels)
    density = mine.info.get("jfif_density")
    ok = (
        mine_psnr >= ref_psnr - 0.2
        and mine_bytes <= len(reference.getvalue()) * 1.1
        and density == (DPI, DPI)
    )
    failures += 0 if ok else 1
    print(
        f"{'PASS' if ok else 'FAIL'} out.jpg              "
        f"{mine_bytes} bytes / {mine_psnr:.2f} dB "
        f"vs libjpeg {len(reference.getvalue())} bytes / {ref_psnr:.2f} dB, "
        f"density={density}"
    )

    print("\nall encoder checks passed" if failures == 0 else f"\n{failures} failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
