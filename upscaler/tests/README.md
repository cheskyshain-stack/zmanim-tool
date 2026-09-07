# Tests

Everything here runs in a real Chromium against the real WebGL backend. There are no
mocked tensors and no stubbed models, because the questions worth asking (does the
network run correctly, do tiles seam, does a band boundary show on a 300 megapixel
export) cannot be answered by a mock.

## Fixtures

`tests/tmp/` is gitignored. Populate it once:

```bash
mkdir -p tests/tmp
cp ../assets/shul-1400.jpg tests/tmp/photo.jpg   # any photograph will do
cp node_modules/@upscalerjs/esrgan-medium/assets/fixture.png tests/tmp/fixture.png
cp node_modules/@upscalerjs/esrgan-medium/assets/samples/2x/result.png tests/tmp/expected-2x.png
cp node_modules/@upscalerjs/esrgan-medium/assets/samples/4x/result.png tests/tmp/expected-4x.png
```

The last three come from the model package itself and are the model author's own input
and published output, which is what makes the `referenceOutput` check meaningful.

## What each check asks

| Check | Question |
|:--|:--|
| `referenceOutput` | Do we reproduce the model author's published output for their own fixture? Anything above 45 dB means the model is being fed and read correctly. |
| `superResolution` | Shrink a photo by 4 and put it back. Does the network recover meaningfully more edge energy than a good Lanczos resize, without overshooting past the original? |
| `tileInvariance` | Does tiling change the answer? It must not, at all. |
| `bandInvariance` | Does the number of output bands change the file? It must not, at all, or exports get faint horizontal lines. Also measures what the byte cached intermediate costs in precision, and checks that cost is spread evenly rather than piling up at band boundaries. |
| `borders` | Does "fit whole image" put exactly the requested colour in exactly the right places, on all four sides, including more border rows than the writer emits in one block? |
| `throughput` | What does this machine actually sustain, per model and scale? Where the README's numbers come from. |
| `flagshipExport` | Does a real 28,800 x 10,800 file come out, inside a phone sized memory budget? Checks the size in the PNG header rather than trusting the request. |
| `largePng`, `largeTiff`, `largeJpeg` | Does a genuinely large streamed export complete and produce a real file in each format, with the AI passes included? |

`flagshipExport` leaves the AI passes out deliberately. 402 megapixels of inference on a
software renderer would run for hours and would prove nothing the other checks miss:
`bandInvariance` already shows the AI path is exact at any band count, and `largePng`
shows the network, the streaming and the encoder working together. What is left to prove
is the part that scales with the final print size rather than with the network, and that
is what this one covers.

Run one at a time by name:

```bash
node tests/run-browser.mjs tileInvariance bandInvariance
```

## Timing

These are slow here, and that is expected: the environment has no GPU, so TensorFlow.js
falls back to software rendered WebGL through SwiftShader. `bandInvariance` renders the
same job three times and takes several minutes, and the three `large*` checks each run a
25 megapixel job through two 4x passes. On a machine with a real GPU it is
seconds. Nothing about the test is waiting on a timeout; it is genuinely computing.

## Chromium

The runners look for Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
which is where this environment keeps it. Override with `CHROMIUM_PATH`, or delete the
`executablePath` line to let Playwright use its own download.
