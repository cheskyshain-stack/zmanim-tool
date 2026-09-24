import { readdir, readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { transform, build as bundle } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
async function build(relative = "") {
  const from = join(root, "public", relative), to = join(root, "dist", relative);
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await build(join(relative, entry.name));
      continue;
    }
    const src = join(from, entry.name), dest = join(to, entry.name);
    if (/\.(js|css)$/.test(entry.name)) {
      const { code } = await transform(await readFile(src, "utf8"), { loader: entry.name.endsWith(".js") ? "js" : "css", minify: true, legalComments: "none", target: "es2022" });
      await writeFile(dest, code);
    } else await copyFile(src, dest);
  }
}
await build();
// The special schedule is the site's original page inside an isolated shadow
// root. Bundle its renderer and copy its own stylesheet/font dependencies.
await bundle({
  entryPoints: [join(root, 'public/display-assets/original-sheet.js')],
  outfile: join(root, 'dist/display-assets/original-sheet.js'),
  bundle: true, format: 'esm', platform: 'browser', minify: true,
  legalComments: 'none', target: 'es2022',
});
const original = join(root, 'dist/display-assets/original');
await mkdir(join(original, 'css'), { recursive: true });
await mkdir(join(original, 'assets/fonts'), { recursive: true });
await copyFile(join(root, '../css/app.css'), join(original, 'css/app.css'));
for (const font of ['david-libre-400.woff2', 'david-libre-700.woff2', 'frank-ruhl-libre.woff2', 'OFL-david-libre.txt', 'OFL-frank-ruhl-libre.txt']) {
  await copyFile(join(root, '../assets/fonts', font), join(original, 'assets/fonts', font));
}
console.log("TV assets built in tv/dist. No deployment performed.");
