// CMYK pixels are written directly into PDF image streams. The browser's canvas
// and Print / Save as PDF APIs only expose RGB, regardless of print-color-adjust.
export function cmykPixels(rgba) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    const r = Math.round(rgba[i] * alpha / 255 + 255 - alpha);
    const g = Math.round(rgba[i + 1] * alpha / 255 + 255 - alpha);
    const b = Math.round(rgba[i + 2] * alpha / 255 + 255 - alpha);
    const max = Math.max(r, g, b);
    out[i] = max ? 255 - Math.round(r * 255 / max) : 0;
    out[i + 1] = max ? 255 - Math.round(g * 255 / max) : 0;
    out[i + 2] = max ? 255 - Math.round(b * 255 / max) : 0;
    out[i + 3] = 255 - max;
  }
  return out;
}

export function cmykDocument() {
  const objects = [null, null], pages = [];
  const add = body => objects.push(body);
  return {
    addPage({ width, height, pixelsWide, pixelsHigh, compressed }) {
      const image = add(new Blob([
        `<< /Type /XObject /Subtype /Image /Width ${pixelsWide} /Height ${pixelsHigh} /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.byteLength} >>\nstream\n`,
        compressed, '\nendstream',
      ]));
      const contents = `q\n${width} 0 0 ${height} 0 0 cm\n/PrintImage Do\nQ\n`;
      const stream = add(`<< /Length ${contents.length} >>\nstream\n${contents}endstream`);
      pages.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /PrintImage ${image} 0 R >> >> /Contents ${stream} 0 R >>`));
    },
    finish() {
      if (!pages.length) throw new Error('The PDF has no pages.');
      objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
      objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] >>`;
      const parts = [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 37, 226, 227, 207, 211, 10])];
      const offsets = [0];
      let position = parts[0].length;
      objects.forEach((body, index) => {
        offsets.push(position);
        const object = new Blob([`${index + 1} 0 obj\n`, body, '\nendobj\n']);
        parts.push(object);
        position += object.size;
      });
      parts.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`);
      return new Blob(parts, { type: 'application/pdf' });
    },
  };
}

export async function cmykCanvasData(canvas, signal) {
  const stream = new CompressionStream('deflate');
  const compressed = new Response(stream.readable).arrayBuffer();
  // Handle either side's rejection even when cancellation interrupts the writer.
  compressed.catch(() => {});
  const writer = stream.writable.getWriter();
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (let y = 0; y < canvas.height; y += 64) {
      signal.throwIfAborted();
      const rows = Math.min(64, canvas.height - y);
      await writer.write(cmykPixels(ctx.getImageData(0, y, canvas.width, rows).data));
    }
    await writer.close();
    return await compressed;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
}
