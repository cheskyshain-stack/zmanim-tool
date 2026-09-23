import { readdir, readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { transform } from "esbuild";
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
console.log("TV assets built in tv/dist. No deployment performed.");
