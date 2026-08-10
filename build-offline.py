#!/usr/bin/env python3
"""Builds a fully offline, dependency-free copy of the app into offline/ —
no ES modules, no fetch(), nothing that requires a local server: just
double-click offline/index.html (via file://) in any modern browser, so it
can be copied to a USB drive and run on a computer with no internet access.

How it works:
  - Every js/**/*.js module is concatenated into one plain <script> (no
    type="module"), in dependency order. `export` is stripped (everything
    becomes a normal top-level declaration in one shared scope — verified
    there are no name collisions across modules) and `import {a,b} from`
    lines are dropped entirely, since after flattening the names already
    exist. `import * as X from '...'` becomes a generated `const X = {...}`
    object built from that module's own export names.
  - The four data/*.json lookup tables are inlined as JS constants and
    data-loader.js's fetch()-based loadTables() is replaced with a version
    that just returns them directly — fetch() of local files is blocked
    under file:// in most browsers, same reason ES modules are.
  - assets/*.png are copied alongside index.html (plain <img src="..."> to
    a relative file works fine under file://, unlike fetch/modules).

Re-run this any time the js/ source changes to refresh offline/.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
JS_DIR = ROOT / "js"
OUT_DIR = ROOT / "offline"
ENTRY = "app.js"

EXPORT_FUNC_RE = re.compile(r"^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)", re.M)
EXPORT_CONST_RE = re.compile(r"^export\s+const\s+([A-Za-z0-9_]+)", re.M)
IMPORT_NAMED_RE = re.compile(r"^import\s*\{[^}]*\}\s*from\s*['\"][^'\"]+['\"];?\s*$", re.M)
IMPORT_STAR_RE = re.compile(r"^import\s*\*\s*as\s+([A-Za-z0-9_]+)\s*from\s*['\"]([^'\"]+)['\"];?\s*$", re.M)


def all_js_files():
    return sorted(JS_DIR.rglob("*.js"))


def rel_key(path: Path) -> str:
    return path.relative_to(JS_DIR).as_posix()


def resolve_import(from_file: Path, spec: str) -> str:
    resolved = (from_file.parent / spec).resolve()
    return rel_key(resolved)


def export_names(text: str) -> list:
    return EXPORT_FUNC_RE.findall(text) + EXPORT_CONST_RE.findall(text)


def build_dep_graph(files):
    texts = {rel_key(f): f.read_text(encoding="utf-8") for f in files}
    deps = {}
    for key, text in texts.items():
        f = JS_DIR / key
        d = set()
        for m in IMPORT_NAMED_RE.finditer(text):
            spec = re.search(r"from\s*['\"]([^'\"]+)['\"]", m.group(0)).group(1)
            d.add(resolve_import(f, spec))
        for m in IMPORT_STAR_RE.finditer(text):
            d.add(resolve_import(f, m.group(2)))
        deps[key] = d
    return texts, deps


def topo_sort(deps):
    order = []
    visited = set()
    temp = set()

    def visit(key):
        if key in visited:
            return
        if key in temp:
            raise RuntimeError(f"circular dependency at {key}")
        temp.add(key)
        for d in sorted(deps.get(key, [])):
            visit(d)
        temp.discard(key)
        visited.add(key)
        order.append(key)

    for key in sorted(deps):
        visit(key)
    return order


def transform_module(key, text, all_exports):
    # Record namespace-import requests, then strip all import lines.
    namespace_consts = []
    for m in IMPORT_STAR_RE.finditer(text):
        local_name, spec = m.group(1), m.group(2)
        target = resolve_import(JS_DIR / key, spec)
        names = all_exports[target]
        namespace_consts.append(f"const {local_name} = {{ {', '.join(names)} }};")
    text = IMPORT_STAR_RE.sub("", text)
    text = IMPORT_NAMED_RE.sub("", text)
    # Strip the `export ` keyword, leaving the declaration itself.
    text = re.sub(r"^export\s+(?=(async\s+)?function\s)", "", text, flags=re.M)
    text = re.sub(r"^export\s+(?=const\s)", "", text, flags=re.M)
    return text.strip("\n"), namespace_consts


def build_data_loader_replacement():
    tables = {}
    for name, filename in [
        ("parshaChutz", "parsha_chutz.json"),
        ("parshaEY", "parsha_ey.json"),
        ("parshaNames", "parsha_names.json"),
        ("specialDays", "special_days.json"),
    ]:
        tables[name] = json.loads((ROOT / "data" / filename).read_text(encoding="utf-8"))
    lines = ["// --- inlined data/*.json (offline build: fetch() of local files is blocked under file://) ---"]
    for name, data in tables.items():
        lines.append(f"const __TABLE_{name} = {json.dumps(data, ensure_ascii=False)};")
    lines.append("let cached = null;")
    lines.append("async function loadTables() {")
    lines.append("  if (cached) return cached;")
    lines.append("  cached = { parshaChutz: __TABLE_parshaChutz, parshaEY: __TABLE_parshaEY, parshaNames: __TABLE_parshaNames, specialDays: __TABLE_specialDays };")
    lines.append("  return cached;")
    lines.append("}")
    return "\n".join(lines)


def main():
    files = all_js_files()
    texts, deps = build_dep_graph(files)
    order = topo_sort(deps)
    all_exports = {key: export_names(text) for key, text in texts.items()}

    chunks = []
    trailing_namespace_consts = []
    for key in order:
        if key == "data-loader.js":
            chunks.append(f"// ==== {key} (replaced: inlined data, no fetch) ====\n" + build_data_loader_replacement())
            continue
        body, ns_consts = transform_module(key, texts[key], all_exports)
        chunks.append(f"// ==== {key} ====\n{body}")
        trailing_namespace_consts.extend(ns_consts)

    # Namespace-object consts (from `import * as X`) are safe to declare anywhere
    # before the app actually starts running (see build-offline.py's module
    # docstring) — putting them all together right before app.js keeps the output
    # readable without needing per-file interleaving.
    entry_idx = order.index(ENTRY)
    bundle = "\n\n".join(chunks[:entry_idx]) + "\n\n// ==== namespace shims for `import * as X` ====\n" + "\n".join(sorted(set(trailing_namespace_consts))) + "\n\n" + chunks[entry_idx]

    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "bundle.js").write_text(bundle, encoding="utf-8")

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = html.replace('<script type="module" src="js/app.js"></script>', '<script src="bundle.js"></script>')
    (OUT_DIR / "index.html").write_text(html, encoding="utf-8")

    assets_out = OUT_DIR / "assets"
    assets_out.mkdir(exist_ok=True)
    for f in (ROOT / "assets").glob("*"):
        (assets_out / f.name).write_bytes(f.read_bytes())

    css_out = OUT_DIR / "css"
    css_out.mkdir(exist_ok=True)
    for f in (ROOT / "css").glob("*.css"):
        (css_out / f.name).write_bytes(f.read_bytes())

    print(f"Built {OUT_DIR} ({len(order)} modules, {len(bundle.splitlines())} lines)")


if __name__ == "__main__":
    main()
