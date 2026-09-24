import { readdir, readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {createHash} from 'node:crypto';
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
// The offline calculation uses the exact saved calendar engine used by the API.
await bundle({entryPoints:[join(root,'public/display-assets/offline-engine.js')],
  outfile:join(root,'dist/display-assets/offline-engine.js'),bundle:true,format:'esm',platform:'browser',minify:true,
  legalComments:'none',target:'es2022'});
const original = join(root, 'dist/display-assets/original');
await mkdir(join(original, 'css'), { recursive: true });
await mkdir(join(original, 'assets/fonts'), { recursive: true });
await copyFile(join(root, '../css/app.css'), join(original, 'css/app.css'));
for (const font of ['david-libre-400.woff2', 'david-libre-700.woff2', 'frank-ruhl-libre.woff2', 'OFL-david-libre.txt', 'OFL-frank-ruhl-libre.txt']) {
  await copyFile(join(root, '../assets/fonts', font), join(original, 'assets/fonts', font));
}
// An explicit allowlist prevents offline caches from ever including admin pages,
// protected preview responses, credentials, or internal item metadata.
const assets=['/display/'];
async function publicAssets(relative='display-assets'){
  for(const entry of await readdir(join(root,'dist',relative),{withFileTypes:true})){
    if(entry.isDirectory())await publicAssets(relative+'/'+entry.name);
    else if(!/^(admin\.|preview-calendar\.)/.test(entry.name))assets.push('/'+relative+'/'+entry.name);
  }
}
await publicAssets();assets.sort();
const version=createHash('sha256');
for(const asset of assets)version.update(await readFile(join(root,'dist',asset==='/display/'?'display/index.html':asset.slice(1))));
const sw=(await readFile(join(root,'public/display/sw.js'),'utf8')).replace('__CACHE_VERSION__',version.digest('hex').slice(0,16)).replace('__PUBLIC_ASSETS__',JSON.stringify(assets));
await writeFile(join(root,'dist/display/sw.js'),(await transform(sw,{loader:'js',minify:true,target:'es2022'})).code);
console.log("TV assets built in tv/dist. No deployment performed.");
