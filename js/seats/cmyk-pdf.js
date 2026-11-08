const SEATS_CMYK_PROFILE = '/assets/print/FOGRA39L_coated.icc';
let seatsCmykLibraries;

function seatsPdfScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('PDF tools could not load.')); };
    document.head.append(script);
  });
}

function seatsPdfBinary(bytes) {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) result += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return result;
}

async function seatsPdfBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('A PDF resource could not load.');
  return new Uint8Array(await response.arrayBuffer());
}

async function seatsLoadCmykTools() {
  if (!seatsCmykLibraries) seatsCmykLibraries = (async () => {
    await seatsPdfScript('/vendor/cmyk/jspdf-4.2.1.umd.min.js');
    await seatsPdfScript('/vendor/cmyk/svg2pdf-2.9.0.umd.min.js');
    const module = await import('/vendor/cmyk/lcms-1.0.5.js');
    const [lcms, profile, ...fonts] = await Promise.all([
      module.instantiate({ locateFile: () => '/vendor/cmyk/lcms.wasm' }),
      seatsPdfBytes(SEATS_CMYK_PROFILE),
      ...['Sans-Regular', 'Sans-Bold', 'Serif-Regular', 'Serif-Bold'].map(name => seatsPdfBytes('/assets/print/Liberation' + name + '.ttf')),
    ]);
    const input = lcms.cmsCreate_sRGBProfile(), output = lcms.cmsOpenProfileFromMem(profile, profile.length);
    if (!output || lcms.cmsGetColorSpaceASCII(output) !== 'CMYK') throw new Error('The CMYK printing profile is invalid.');
    const transform = lcms.cmsCreateTransform(input, module.TYPE_RGB_8, output, module.TYPE_CMYK_8, module.INTENT_RELATIVE_COLORIMETRIC, module.cmsFLAGS_BLACKPOINTCOMPENSATION);
    lcms.cmsCloseProfile(input); lcms.cmsCloseProfile(output);
    if (!transform) throw new Error('CMYK color conversion is unavailable.');
    const names = ['SeatsSans', 'SeatsSans', 'SeatsSerif', 'SeatsSerif'];
    await Promise.all(fonts.map(async (bytes, index) => {
      const face = new FontFace(names[index], bytes, { weight: index % 2 ? '700' : '400' });
      await face.load(); document.fonts.add(face);
    }));
    return { lcms, transform, profile, fonts, jsPDF: window.jspdf.jsPDF };
  })().catch(error => { seatsCmykLibraries = null; throw error; });
  return seatsCmykLibraries;
}

function seatsPdfCmyk(tools, rgba, monochrome) {
  const count = rgba.length / 4;
  let result = new Uint8Array(count * 4);
  if (!monochrome) {
    const rgb = new Uint8Array(count * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      rgb[target++] = rgba[source]; rgb[target++] = rgba[source + 1]; rgb[target++] = rgba[source + 2];
    }
    result = tools.lcms.cmsDoTransform(tools.transform, rgb, count);
  }
  if (result.length !== count * 4) throw new Error('The printing profile produced invalid CMYK pixels.');
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    const r = rgba[pixel], g = rgba[pixel + 1], b = rgba[pixel + 2];
    // Neutral text, white paper and grayscale artwork use black ink only.
    if (monochrome || Math.max(r, g, b) - Math.min(r, g, b) <= 1) {
      result[pixel] = result[pixel + 1] = result[pixel + 2] = 0;
      result[pixel + 3] = 255 - Math.round(r * .2126 + g * .7152 + b * .0722);
    }
    const colorInk = result[pixel] + result[pixel + 1] + result[pixel + 2], allowed = 765 - result[pixel + 3];
    // Bound interpolation overshoot at the profile's 300% total ink limit, preserving K.
    if (colorInk > allowed) for (let channel = 0; channel < 3; channel++) result[pixel + channel] = Math.floor(result[pixel + channel] * allowed / colorInk);
  }
  return result;
}

async function seatsPdfDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function seatsPdfOutputIntent(doc, profile) {
  let profileId;
  doc.internal.events.subscribe('putPage', () => {
    doc.internal.write('/Group << /Type /Group /S /Transparency /CS /DeviceCMYK /I true >>');
  });
  doc.internal.events.subscribe('putResources', () => {
    profileId = doc.internal.newObject();
    doc.internal.putStream({ data: seatsPdfBinary(profile), additionalKeyValues: [{ key: 'N', value: '4' }, { key: 'Alternate', value: '/DeviceCMYK' }] });
    doc.internal.write('endobj');
  });
  doc.internal.events.subscribe('putCatalog', () => {
    doc.internal.write('/OutputIntents [<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (FOGRA39) /RegistryName (http://www.color.org) /Info (FOGRA39L Coated, 300 percent ink limit) /DestOutputProfile ' + profileId + ' 0 R >>]');
  });
}

function seatsPdfVectorColors(doc, tools, monochrome) {
  for (const method of ['setTextColor', 'setFillColor', 'setDrawColor']) {
    const original = doc[method];
    doc[method] = function (red, green, blue, black) {
      if (black !== undefined) return original.call(this, red, green, blue, black);
      const rgb = [Number(red), Number(green ?? red), Number(blue ?? red), 255];
      if (!rgb.every(Number.isFinite)) throw new Error('Unsupported PDF text color.');
      const cmyk = seatsPdfCmyk(tools, new Uint8Array(rgb), monochrome);
      return original.apply(this, [...cmyk].map(value => (value / 255).toFixed(5)));
    };
  }
}

function seatsPdfRegisterImages(jsPDF) {
  if (jsPDF.API.processCMYK) return;
  jsPDF.API.processCMYK = function (data, index, alias) {
    const header = new DataView(data.buffer, data.byteOffset, 12), length = header.getUint32(8);
    const result = { width: header.getUint32(0), height: header.getUint32(4), data: seatsPdfBinary(data.subarray(12, 12 + length)), index, alias,
      colorSpace: 'DeviceCMYK', bitsPerComponent: 8, filter: 'FlateDecode', predictor: 1 };
    if (data.length > length + 12) result.sMask = seatsPdfBinary(data.subarray(length + 12));
    return result;
  };
}

function seatsPdfImage(svg) {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error('The room artwork could not be prepared.'));
    picture.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  });
}

function seatsPdfSubset(svg, keep, keepDefinitions = false) {
  const result = svg.cloneNode(true), definitions = new Set(result.querySelectorAll('defs,defs *'));
  for (const node of [...result.querySelectorAll('*')].reverse()) {
    if (definitions.has(node)) { if (!keepDefinitions) node.remove(); continue; }
    if (!keep(node) && !node.children.length) node.remove();
  }
  return result;
}

// Photos are sampled at 300 dpi. Grout and text stay vector, with furniture above the grout.
export async function seatsBuildCmykPdf(pages, { monochrome = false, progress = () => {} } = {}) {
  if (!pages.length) throw new Error('There is nothing to export.');
  const tools = await seatsLoadCmykTools();
  seatsPdfRegisterImages(tools.jsPDF);
  const first = pages[0], doc = new tools.jsPDF({ unit: 'pt', format: first.size, orientation: first.size[0] > first.size[1] ? 'landscape' : 'portrait', compress: true, putOnlyUsedFonts: true });
  doc.__private__.setPdfVersion('1.7');
  // SVG strings are logical Unicode, not preordered visual Hebrew text.
  doc.internal.events.subscribe('preProcessText', payload => {
    payload.options.isInputVisual = false;
    payload.options.isOutputVisual = true;
    payload.options.isOutputRtl = false;
  });
  for (let index = 0; index < tools.fonts.length; index++) {
    const file = 'seats-font-' + index + '.ttf';
    doc.addFileToVFS(file, seatsPdfBinary(tools.fonts[index]));
    doc.addFont(file, index < 2 ? 'SeatsSans' : 'SeatsSerif', index % 2 ? 'bold' : 'normal');
  }
  seatsPdfOutputIntent(doc, tools.profile); seatsPdfVectorColors(doc, tools, monochrome);
  doc.setProperties({ title: 'Seating chart', subject: 'CMYK print file, FOGRA39L Coated', creator: 'Bais Medrash of Lakewood Commons' });
  for (let number = 0; number < pages.length; number++) {
    const { svg, size } = pages[number];
    if (number) doc.addPage(size, size[0] > size[1] ? 'landscape' : 'portrait');
    const text = seatsPdfSubset(svg, node => ['text', 'tspan'].includes(node.localName));
    const art = svg.cloneNode(true), hasFloor = Boolean(art.querySelector('[data-pdf-layer="floor"]'));
    for (const node of art.querySelectorAll('text,[data-pdf-layer="floor"],[data-pdf-layer="grid"]')) node.remove();
    const grid = hasFloor ? seatsPdfSubset(svg, node => Boolean(node.closest('[data-pdf-layer="grid"]'))) : null;
    const layers = hasFloor ? [
      { svg: seatsPdfSubset(svg, node => node.getAttribute('data-pdf-layer') === 'floor', true), alpha: false },
      { svg: art, alpha: true },
    ] : [{ svg: art, alpha: false }];
    const width = Math.round(size[0] / 72 * 300), height = Math.round(size[1] / 72 * 300);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 128;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    for (let layer = 0; layer < layers.length; layer++) {
      if (layer === 1 && grid) await doc.svg(grid, { x: 0, y: 0, width: size[0], height: size[1] });
      const picture = await seatsPdfImage(layers[layer].svg);
      for (let top = 0; top < height; top += 128) {
        const rows = Math.min(128, height - top);
        context.clearRect(0, 0, width, 128);
        if (!layers[layer].alpha) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, 128); }
        context.drawImage(picture, 0, -top, width, height);
        const rgba = context.getImageData(0, 0, width, rows).data;
        const cmyk = seatsPdfCmyk(tools, rgba, monochrome);
        // jsPDF writes an inverted Decode array for every CMYK image.
        for (let byte = 0; byte < cmyk.length; byte++) cmyk[byte] = 255 - cmyk[byte];
        const compressed = await seatsPdfDeflate(cmyk);
        const alpha = layers[layer].alpha ? await seatsPdfDeflate(Uint8Array.from({ length: width * rows }, (_, pixel) => rgba[pixel * 4 + 3])) : new Uint8Array();
        const image = new Uint8Array(compressed.length + alpha.length + 12), header = new DataView(image.buffer);
        header.setUint32(0, width); header.setUint32(4, rows); header.setUint32(8, compressed.length); image.set(compressed, 12); image.set(alpha, 12 + compressed.length);
        doc.addImage(image, 'CMYK', 0, top / height * size[1], size[0], rows / height * size[1], 'cmyk-' + number + '-' + layer + '-' + top);
        progress((number + (layer + (top + rows) / height) / layers.length) / pages.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    await doc.svg(text, { x: 0, y: 0, width: size[0], height: size[1] });
    canvas.width = canvas.height = 0;
  }
  return doc.output('blob');
}
