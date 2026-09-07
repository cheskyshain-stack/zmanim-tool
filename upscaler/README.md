# Print Upscaler

A mobile-first web app that upscales an image with a real super resolution neural
network and writes a print ready file for very large format printing.

Built around one job in particular: take artwork generated on a phone, often only about
2048 x 768 pixels, and turn it into a **3 ft x 8 ft banner** (36" x 96") that still
looks sharp when somebody walks up to it. At 300 DPI that is 28,800 x 10,800 pixels,
which is 311 megapixels and about a fourteen times enlargement.

Everything runs on the device. No uploads, no account, no server, no API keys, nothing
to pay for.

---

## Contents

- [What it actually does](#what-it-actually-does)
- [Quick start](#quick-start)
- [The 3 ft x 8 ft workflow](#the-3-ft-x-8-ft-workflow)
- [How it works](#how-it-works)
- [What is AI here, and what is not](#what-is-ai-here-and-what-is-not)
- [Requirements](#requirements)
- [Performance and how long a job takes](#performance-and-how-long-a-job-takes)
- [Deployment](#deployment)
- [What is free and what could cost money](#what-is-free-and-what-could-cost-money)
- [Testing](#testing)
- [Folder structure](#folder-structure)
- [Known limits](#known-limits)
- [Credits and licences](#credits-and-licences)

---

## What it actually does

**Upload** a JPG, PNG or WEBP. It reads the dimensions, the aspect ratio and the file
size, applies any EXIF rotation, and shows you a large preview.

**Print size**: seven presets (18x36, 24x48, 24x72, 24x96, 36x48, 36x72 and the
featured 36x96), landscape or portrait, or type any size in inches or feet. Pick 100,
150, 200, 250 or 300 DPI and it shows the pixels every one of those needs, what DPI your
image manages at that size today, and how much enlargement is required.

**Crop check**: it compares your image's ratio against the print's. If they match it
says so. If they do not, it shows you exactly what would be lost and offers crop to
fill, fit the whole image inside borders, or a custom crop you drag. The image is never
stretched, and nothing is ever cropped without telling you.

**Upscale** with an ESRGAN family neural network, in as many passes as the enlargement
needs. Five modes, four sharpening levels, optional noise and JPEG artifact reduction.

**Inspect** the result before downloading: a split slider comparing the upscaled result
against an ordinary resize of the same patch, at 50%, 100% and 200% of print resolution.
Both sides are rendered through the real pipeline, not mocked up.

**Download** as PNG, TIFF or JPEG, at the exact pixel count, with the DPI and sRGB
written into the file.

---

## Quick start

Node 20 or newer.

```bash
cd upscaler
npm install
npm run dev
```

Open the address it prints. `npm run dev` also copies the model weights out of
`node_modules` into `public/models` (see [Models](#models) below); that step is part of
`dev` and `build`, so there is nothing extra to remember.

```bash
npm run build     # writes dist/
npm run preview   # serves dist/ so you can check the real build
npm run typecheck
```

To try it from your phone on the same network, run
`npm run dev -- --host` and open the network address it prints. Note that **WebGPU and
service workers need a secure context**: `localhost` counts as secure, a bare LAN IP
does not, so over the network you will get the WebGL path and no offline install. For
the full experience on a phone, deploy it (below) or put a TLS tunnel in front.

### Models

The neural network weights are not committed. `scripts/fetch-models.mjs` copies them out
of the `@upscalerjs/esrgan-slim` and `@upscalerjs/esrgan-medium` npm packages into
`public/models`, about 10.7 MB in total. This is deliberate:

- the weights come from npm, which you already trust to build the project,
- there is no runtime dependency on a model host, so the app cannot break because
  somebody else moved a file,
- and once the app is installed the weights are in the service worker cache, so it
  upscales with no network at all.

Run `npm run models` by hand after a fresh clone if you want to populate them without
starting a dev server.

---

## The 3 ft x 8 ft workflow

This is the path the app is tuned for, and the one to try first.

1. Upload the artwork.
2. On **Print size**, the 36" x 96" preset is already selected and marked with a star.
   Leave orientation on Landscape, so the print is 96" wide and 36" high.
3. The DPI table fills in as soon as the size is set:

   | DPI | Pixels |
   |----:|:-------|
   | 100 | 9,600 x 3,600 |
   | 150 | 14,400 x 5,400 |
   | 200 | 19,200 x 7,200 |
   | 250 | 24,000 x 9,000 |
   | 300 | 28,800 x 10,800 |

4. A 2048 x 768 source is exactly 8:3, and so is a 36 x 96 print, so the crop screen
   says **fits perfectly** and nothing is lost.
5. On **Enhance**, press **Maximum Print Quality**.

What that button does with these numbers: the target needs 28800 / 2048 = **14.06x**.
The planner searches every chain of 2x, 3x and 4x passes and takes the smallest product
that reaches it, which is **16x** (two 4x passes, or four 2x passes in Artwork mode).
That produces 32,768 x 12,288, and the final Lanczos step brings it **down** to exactly
28,800 x 10,800.

That last downscale is the point, not a rounding error. Coming down from 32,768 packs
slightly more than one upscaled pixel into every printed pixel, which is what reads as
crisp up close. Reaching 28,800 from below would be the network's guesses stretched
further by a resize, which reads as soft.

---

## How it works

### The memory problem, and the answer

28,800 x 10,800 pixels is 311 megapixels. As RGBA that is 1.24 GB, and the intermediate
after the AI passes (32,768 x 12,288) is 402 megapixels. Neither fits in a phone's
memory, and neither fits in a canvas: Chrome caps a canvas at 2^28 pixels and phones cap
it far lower. `canvas.toBlob()` is not an option for this job at all.

So the pipeline inverts the obvious loop. Instead of "upscale everything, then resize,
then encode", it walks the **output** in horizontal bands, and for each band:

1. works out which rows of the intermediate that band reads from (the Lanczos tap table
   knows this exactly),
2. walks back through the AI passes to find which source rows those came from, widening
   by the tile padding at every level,
3. runs only those rows through the network, tile by tile,
4. resizes that slab to the exact print size,
5. sharpens it, with extra rows of context above and below that are then thrown away,
6. and hands the finished rows straight to a streaming encoder.

Peak memory is one band, whatever the final size is. The band height is chosen from a
memory budget that comes from `navigator.deviceMemory`, and can be overridden in
Settings.

Passes whose output still fits in the budget are run whole and kept, as bytes rather
than floats: for the flagship job, the first 4x pass produces 8192 x 3072, which costs
75 MB to hold as bytes instead of 300 MB as floats, and recomputing it once per band
would cost far more than it saves. Only the last pass streams. From that pass onward
everything stays in float, because the resize and the sharpen both want the precision
and by then only one band exists at a time.

Two properties are checked by the test suite rather than asserted here:

- **Tiling changes nothing.** Tile padding is 20 source pixels, which is the receptive
  field radius of the deeper network, counted from its layer stack. Upscaling with 48 px
  tiles and with one 1024 px tile gives byte for byte identical output.
- **Band count changes nothing.** Rendering the same job in 8 row bands and in one
  single band gives byte for byte identical files. If it did not, every export would
  have faint horizontal lines across it.

### The encoders

All three are written from scratch in `src/lib/encode/`, because all three have to take
rows a band at a time and none of the usual options can.

**PNG** streams through fflate's deflate. Per row it tries four filters and keeps the
smallest, writes `pHYs` for the DPI, and `sRGB` + `gAMA` + `cHRM` for the colour space.
(PNG stores resolution as whole pixels per metre, so 300 DPI is stored as 11,811 ppm and
reads back as 299.9994. That is the format, not a bug.)

**TIFF** writes Deflate compressed strips with a horizontal differencing predictor, the
DPI in the resolution tags, and a real 588 byte sRGB ICC profile embedded, because TIFF
has no "this is sRGB" flag the way PNG does. This is usually what a large format print
shop asks for.

**JPEG** is a baseline encoder at **4:4:4**, so chroma is kept at full resolution.
Ordinary photo JPEG throws away three quarters of the colour detail; on a print somebody
walks up to, that shows. It writes the DPI into the JFIF header.

PNG and TIFF round trip pixel for pixel through Pillow. The JPEG encoder produces
140,903 bytes at 36.41 dB where libjpeg at the same quality and subsampling produces
141,636 bytes at 36.35 dB, so it is a real encoder and not an approximation.

### The final resize

Separable Lanczos 3, in float, with the kernel widened by the shrink factor when
shrinking so the downscale does not alias, and weights normalised per output sample so
edge pixels do not darken.

### A note on OffscreenCanvas

There is not one in the pipeline, on purpose. A canvas is used exactly twice, both on
the main thread: once to apply EXIF rotation, and once to read the cropped region out of
the decoded bitmap. From that point on the worker holds raw typed arrays and never needs
a drawing surface again, which is better than moving a canvas into the worker: it avoids
the canvas size ceiling entirely, avoids Safari's patchier OffscreenCanvas support, and
makes the whole pipeline testable in plain Node. `structuredClone` transfer of the pixel
buffer is what crosses the thread boundary, and it is zero copy.

---

## What is AI here, and what is not

This matters, so it is spelled out.

**The upscaling is a neural network.** The models are ESRGAN family RDN (residual dense
network) super resolution models trained on DIV2K, from the
[UpscalerJS](https://github.com/thekevinscott/UpscalerJS) project, run through
TensorFlow.js. `esrgan-slim` is about 900 KB per scale, `esrgan-medium` is about 2.8 MB
and ten times deeper. Two scales of evidence that they are being run correctly and are
doing real work:

- Fed the model author's own fixture image, this code reproduces their published output
  at **59 dB PSNR**, with a maximum channel difference of 0.5, which is 8 bit rounding.
  The inference is exact.
- Shrink a real photograph by 4 and put it back: the network recovers **21% more edge
  energy** than a Lanczos resize of the same input (11.5 against 9.5, where the original
  measures 24.0).

Note what the second number is not. PSNR against the original comes out roughly level
between the two (24.7 dB for the network, 24.8 dB for the resize), and that is expected
rather than disappointing: a network that reconstructs a brick edge half a pixel from
where it really was is punished by mean squared error exactly as hard as one that left
the edge blurred. Edge energy is the measurement that separates them, and by eye the
difference is obvious.

**Lanczos is used, and is labelled as such**, for exactly two things: the final resize
from the AI output to the exact print pixel count, and the "before" side of the compare
viewer. It is never presented as upscaling.

**The five modes are five different pipelines**, not one pipeline with five labels. They
differ in which network runs, in the order of scale steps the planner is allowed to
chain, and in the pre and post processing:

| Mode | Network | Scale preference | Sharpen | Source cleanup |
|:--|:--|:--|:--|:--|
| Natural | medium | 2, 4, 3 | light | none |
| High Detail | medium | 4, 2, 3 | medium | none |
| Ultra Sharp | medium | 4, 2, 3 | strong | none |
| Artwork / AI Generated | medium | 2, 3, 4 | light | deblock |
| Photograph | medium | 2, 4, 3 | light | denoise + deblock |

Artwork mode prefers chains of 2x because generated art is where one large jump goes
wrong: the network invents an edge, and the next pass treats that invention as ground
truth and hardens it. Keeping each step small is what keeps stone looking like stone
rather than like plastic, and it is the same reasoning for wood, leaves, fabric and
architectural detail.

**Noise and JPEG artifact reduction run on the source, before any upscaling.** That is
the whole trick: block edges and sensor grain live in the source pixels, an upscaler
treats both as detail, and enlarging them first makes them far harder to remove.
Sharpening is the opposite and runs last, at the final print resolution, with a halo
guard: no pixel may end up further than a small margin past the brightest or darkest of
its neighbours, which is the definition of a halo.

---

## Requirements

**On the device.** A browser with WebGL2, which in practice means any phone or desktop
from the last several years. WebGPU is used when available (Chrome and Edge on Android
and desktop), which is several times faster. If neither works the app falls back to CPU
rather than refusing to run, but a large job on CPU is not practical.

The backend is chosen by running a tiny tensor through each candidate and reading the
answer back, not by feature detection, because a WebGL context that fails on first use
is common on older phones and it is better to fall through than to fail mid job.

**No GPU server is required, and there is none.** All inference is client side.

**Memory** is the real constraint, not compute. The app reads `navigator.deviceMemory`
and sizes its tiles and bands from it, and Settings exposes both if a particular device
needs smaller. If an export fails part way through, lower both a step.

**iOS note**: printing and downloading a very large file from Safari can be
memory-limited in ways the app cannot see. If a 300 MB PNG will not save, try TIFF,
which is usually smaller on photographic content, or drop to 150 DPI.

---

## Performance and how long a job takes

The app does not guess. When you reach the Enhance screen it loads the model you have
chosen, runs a real tile through it, times it, and quotes the job from that measurement
plus the size of the plan. Once a job is a fiftieth of the way in it switches to the
rate the job itself is achieving.

Two things dominate:

- **The last pass is most of the work.** For the flagship job the two passes generate
  25 MP and 402 MP respectively, so 94% of the time is the second one.
- **DPI is quadratic.** 150 DPI is a quarter of the pixels of 300 DPI, and for a banner
  seen from more than a few feet away the difference is usually invisible. Most wide
  format printers RIP somewhere between 150 and 200 DPI. If a job is quoted at hours,
  this is the setting to change.

Measured throughput in this repository's test environment, which is **software rendered
WebGL (SwiftShader) with no GPU at all**, is in the table below. Treat it as a floor: it
is the number a machine gets when it has no graphics hardware whatsoever, and any real
phone GPU is far above it.

<!-- MEASURED -->

---

## Deployment

The build is a folder of static files. There is no server component to deploy.

### Any static host

```bash
npm run build
# upload dist/ to Netlify, Vercel, Cloudflare Pages, S3, nginx, anything
```

Two headers are worth setting if your host lets you, though nothing here requires them:

- `Cache-Control: public, max-age=31536000, immutable` on `/assets/*` and `/models/*`
  (both are content hashed or immutable), and a short max-age on `index.html`.
- HTTPS. WebGPU and the service worker both need a secure context, so over plain HTTP
  you lose the fast backend and the offline install.

### GitHub Pages under a subpath

A project site serves from `/<repo>/`, so the base path has to match:

```bash
BASE_PATH=/zmanim-tool/upscaler/ npm run build
```

`vite.config.ts` reads `BASE_PATH` and feeds it to the bundler, the web manifest's
`start_url` and `scope`, and the model URLs, so setting that one variable is the whole
change.

### Installing it on a phone

Open the deployed site and use **Add to Home screen** (Chrome's menu on Android, the
Share button on an iPhone). After that first visit the app, its code and all 10.7 MB of
model weights are in the service worker cache, and it upscales with no network at all.

The manifest carries **both** `display_override: ["standalone"]` and
`display: "browser"`, and that pair is deliberate. Android reads `display_override`, so
Chrome installs this as a real app with no browser chrome and the maskable icon on the
launcher. Safari does not implement `display_override` and falls through to `browser`,
so an iPhone keeps opening it in Safari with the address bar. That is the outcome we
want there: saving a large file from a standalone web app on iOS is unreliable, and
downloading the print file is the entire point. Collapsing the two into a plain
`"standalone"` would take downloads away from every iPhone that installs it.

Updates are picked up on the next launch rather than applied immediately, on purpose: a
service worker swapping code out from under a job that has been running for half an hour
would lose the job.

---

## What is free and what could cost money

**Free, and with no way for that to change:**

- The app, the models and every library in it. See
  [Credits and licences](#credits-and-licences).
- Running it. All processing is on the device, so there is no compute bill however many
  banners you make.
- Hosting. It is static files; GitHub Pages, Cloudflare Pages and Netlify all have free
  tiers that cover this comfortably. Roughly 12 MB per first visit, then nothing.

**There are no API keys anywhere in this project and no third party service is called at
runtime.** Your images never leave the device.

**What would cost money**, if you ever wanted it, is a server. You do not need one for
anything described above. The two reasons somebody might add one:

- **Speed on weak devices.** A GPU worker running Real-ESRGAN would finish a 300
  megapixel job in minutes rather than the much longer time an old phone would take.
  That means a machine with an NVIDIA GPU, so roughly $0.30 to $1.00 per hour on a cloud
  provider, or a one off cost for hardware you own. It also means uploading the image,
  which is the thing this design deliberately avoids.
- **Formats a browser cannot write**, such as CMYK TIFF with a press specific ICC
  profile. Colour separation belongs to whoever is printing, so in practice this is
  better handled by sending them the sRGB file this app produces.

If you do add a backend, the split is already clean: `src/worker/pipeline.ts` talks to
the engine through `loadModel` and `upscaleInto` in `src/worker/engine.ts`, so a remote
implementation of those two functions is the entire change, and the band loop, the
resize, the sharpening and all three encoders keep working untouched.

---

## Testing

```bash
npm run test            # logic, then browser, then the full app end to end
npm run test:logic      # print maths, crops, planning, resampler, sharpener (under a second)
npm run test:browser    # models, tiling, band seams, borders, throughput, large exports
npm run test:app        # drives the built app in a 375 px browser
npm run test:encoders   # PNG, TIFF and JPEG against Pillow (needs python + pillow)
```

`test:logic` is pure functions and runs instantly, so it is the one to run while working.
It checks the things a wrong number would silently ruin a print with: that 36" x 96" at
300 DPI really is 28,800 x 10,800, that a 2048 x 768 source really needs 14.06x, that the
planner reaches that with 16x and comes back down rather than up, that Artwork mode
really does chain four 2x passes where High Detail uses two 4x, that Lanczos weights sum
to one so edges do not darken, and that a strong sharpen on a hard edge does not overshoot
into a halo.

The browser checks need two fixtures in `tests/tmp/`, which is gitignored:

```bash
mkdir -p tests/tmp
cp ../assets/shul-1400.jpg tests/tmp/photo.jpg        # any photo will do
cp node_modules/@upscalerjs/esrgan-medium/assets/fixture.png tests/tmp/fixture.png
cp node_modules/@upscalerjs/esrgan-medium/assets/samples/2x/result.png tests/tmp/expected-2x.png
cp node_modules/@upscalerjs/esrgan-medium/assets/samples/4x/result.png tests/tmp/expected-4x.png
```

Everything runs in a real Chromium against the real WebGL backend. There are no mocked
tensors and no stubbed models, because the questions worth asking here (does the network
run correctly, do tiles seam, does a band boundary show) cannot be answered by a mock.

`npm run test:app` writes a screenshot of every screen to `tests/tmp/shots/`.

---

## Folder structure

```
upscaler/
├── index.html
├── vite.config.ts             base path, PWA manifest, chunking
├── scripts/
│   ├── fetch-models.mjs       copies weights from node_modules to public/models
│   └── make-icons.py          regenerates public/icons (only when artwork changes)
├── public/
│   ├── icons/                 app icons, committed
│   └── models/                weights, generated, gitignored
├── src/
│   ├── App.tsx                the six step flow and all shared state
│   ├── main.tsx
│   ├── index.css              Tailwind v4 theme and tokens
│   ├── lib/
│   │   ├── print.ts           units, DPI, presets, required pixels, quality grade
│   │   ├── aspect.ts          ratios, crop rects, fit modes
│   │   ├── plan.ts            how many AI passes, at what scale
│   │   ├── models.ts          the shipped networks and the five modes
│   │   ├── lanczos.ts         separable Lanczos with a band aware tap table
│   │   ├── enhance.ts         sharpen with halo guard, denoise, deblock
│   │   ├── image.ts           decoding, EXIF orientation, region extraction
│   │   ├── storage.ts         settings, and the device memory profile
│   │   └── encode/
│   │       ├── png.ts         streaming PNG
│   │       ├── tiff.ts        streaming TIFF
│   │       ├── jpeg.ts        streaming baseline JPEG, 4:4:4
│   │       ├── icc.ts         embedded sRGB profile
│   │       └── crc.ts
│   ├── worker/
│   │   ├── index.ts           worker entry, message handling, cancellation
│   │   ├── engine.ts          backend selection, model loading, tiled inference
│   │   ├── pipeline.ts        the streaming band loop
│   │   └── protocol.ts        message types shared with the UI
│   ├── state/worker-client.ts
│   └── ui/                    one component per step, plus the compare viewer
└── tests/
    ├── logic.test.mts         pure maths, runs in under a second
    ├── run-browser.mjs        model, tiling, band and export checks
    ├── run-app.mjs            end to end through the built app
    ├── browser/harness.ts     what those checks actually run
    ├── encoders.test.mts      writes sample files for the Pillow check
    └── verify-encoders.py
```

---

## Known limits

Worth knowing before you rely on it.

- **Four AI passes maximum**, so 256x at the very most and in practice 64x. Beyond that
  the planner says so plainly and lets Lanczos cover the remainder rather than quietly
  producing something soft.
- **TIFF is capped at 4 GB** by the format's 32 bit offsets. The encoder refuses with a
  clear message rather than writing a corrupt file; use PNG, which has no such limit.
- **JPEG is 4:4:4 baseline**, not progressive and not 12 bit.
- **sRGB only.** No CMYK and no custom ICC profiles; colour separation is the printer's
  job and they will want to do it themselves.
- **Intermediates between cached passes are stored as bytes, not floats.** That is a
  4x memory saving for a maximum difference of a few levels out of 255 in the final
  file, which the test suite measures. It is the right trade on a phone, and it is the
  reason a 300 megapixel job fits at all.
- **Leaving the browser can suspend a long job on a phone.** The app says so on the
  progress screen. There is no way around this from a web page.
- **A device reporting 2 GB or less streams every pass**, including the first, rather
  than holding an intermediate. That is a lot of repeated work at the tile padding, so
  those devices are noticeably slower. It is deliberate: slow beats out of memory, and
  the progress screen switches to the rate the job is really achieving within the first
  couple of percent, so the estimate corrects itself.
- **Integer pixel counts can leave a rounding-sized aspect difference.** A crop is whole
  pixels and so is a print, so a crop cannot always be the print's exact ratio. The
  residual is under a tenth of a percent, far below anything a printer resolves, and the
  app never stretches beyond it.
- **The models are trained on DIV2K**, a photographic dataset. They are strong on
  texture, stone, foliage, fabric and architecture, and weaker on large flat areas of
  synthetic colour and on text, where Ultra Sharp mode helps.

---

## Credits and licences

- **Model weights**: [UpscalerJS](https://github.com/thekevinscott/UpscalerJS) by Kevin
  Scott, MIT. The architecture and training approach come from
  [idealo/image-super-resolution](https://github.com/idealo/image-super-resolution),
  Apache 2.0.
- **[TensorFlow.js](https://www.tensorflow.org/js)**, Apache 2.0.
- **[fflate](https://github.com/101arrowz/fflate)** for deflate, MIT.
- **React**, **Vite**, **Tailwind CSS**, **vite-plugin-pwa**, all MIT.
- The embedded sRGB ICC profile was generated with **littleCMS** via Pillow.
