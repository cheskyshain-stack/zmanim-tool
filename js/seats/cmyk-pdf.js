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
    const transform = lcms.cmsCreateTransform(input, module.TYPE_RGBA_8, output, module.TYPE_CMYK_8, module.INTENT_RELATIVE_COLORIMETRIC, module.cmsFLAGS_BLACKPOINTCOMPENSATION);
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
  const result = monochrome ? new Uint8Array(count * 4) : tools.lcms.cmsDoTransform(tools.transform, rgba, count);
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
    const header = new DataView(data.buffer, data.byteOffset, 8);
    return { width: header.getUint32(0), height: header.getUint32(4), data: seatsPdfBinary(data.subarray(8)), index, alias,
      colorSpace: 'DeviceCMYK', bitsPerComponent: 8, filter: 'FlateDecode' };
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

// Artwork is sampled at 300 dpi in small strips. Text stays vector and selectable.
export async function seatsBuildCmykPdf(pages, { monochrome = false, progress = () => {} } = {}) {
  if (!pages.length) throw new Error('There is nothing to export.');
  const tools = await seatsLoadCmykTools();
  seatsPdfRegisterImages(tools.jsPDF);
  const first = pages[0], doc = new tools.jsPDF({ unit: 'pt', format: first.size, orientation: first.size[0] > first.size[1] ? 'landscape' : 'portrait', compress: true, putOnlyUsedFonts: true });
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
    const art = svg.cloneNode(true), text = svg.cloneNode(true);
    for (const node of art.querySelectorAll('text')) node.remove();
    for (const node of [...text.querySelectorAll('*')].reverse()) if (!['svg', 'g', 'text', 'tspan'].includes(node.localName) || (!node.closest('text') && !node.querySelector('text'))) node.remove();
    const picture = await seatsPdfImage(art), width = Math.round(size[0] / 72 * 300), height = Math.round(size[1] / 72 * 300);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 128;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    for (let top = 0; top < height; top += 128) {
      const rows = Math.min(128, height - top);
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, 128);
      context.drawImage(picture, 0, -top, width, height);
      const rgba = context.getImageData(0, 0, width, rows).data;
      const cmyk = seatsPdfCmyk(tools, rgba, monochrome);
      // jsPDF writes an inverted Decode array for every CMYK image.
      for (let byte = 0; byte < cmyk.length; byte++) cmyk[byte] = 255 - cmyk[byte];
      const compressed = await seatsPdfDeflate(cmyk);
      const image = new Uint8Array(compressed.length + 8), header = new DataView(image.buffer);
      header.setUint32(0, width); header.setUint32(4, rows); image.set(compressed, 8);
      doc.addImage(image, 'CMYK', 0, top / height * size[1], size[0], rows / height * size[1], 'cmyk-' + number + '-' + top);
      progress((number + (top + rows) / height) / pages.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await doc.svg(text, { x: 0, y: 0, width: size[0], height: size[1] });
    canvas.width = canvas.height = 0;
  }
  return doc.output('blob');
}
