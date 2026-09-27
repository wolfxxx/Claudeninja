#!/usr/bin/env python3
"""Build a copy of the game that can be hosted as a claude.ai artifact.

Artifact hosting serves only common web file types (no .glb/.bin) and blocks
fetching data: URIs, so this script:
  1. builds with relative URLs (ARTIFACT=1),
  2. shrinks the two big environment models,
  3. converts every .glb into .gltf.json (+ separate texture images),
     which src/game/gltfJsonLoader.ts repacks in memory at runtime,
  4. writes dist/claudeninja.html (page body only) and dist/files.json (publish map).
Run from the repo root:  python3 tools/build-artifact.py
"""
import base64, glob, json, os, re, shutil, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
GT = [os.path.join(ROOT, "node_modules/.bin/gltf-transform")]

def run(cmd, **kw):
    subprocess.run(cmd, check=True, cwd=ROOT, stdout=subprocess.DEVNULL, **kw)

shutil.rmtree(DIST, ignore_errors=True)
run(["npm", "run", "build"], env={**os.environ, "ARTIFACT": "1"})
tmp = tempfile.mkdtemp()

# 2. Shrink: shrine textures -> 1024 WebP (keep Draco); maple normal/roughness -> WebP.
shrine = glob.glob(f"{DIST}/assets/japanese_shrine-*.glb")[0]
run(GT + ["resize", shrine, f"{tmp}/s1.glb", "--width", "1024", "--height", "1024"])
run(GT + ["webp", f"{tmp}/s1.glb", f"{tmp}/s2.glb", "--quality", "88"])
run(GT + ["draco", f"{tmp}/s2.glb", shrine])
maple = glob.glob(f"{DIST}/assets/japanese_maple_tree-*.glb")[0]
run(GT + ["webp", maple, f"{tmp}/m.glb", "--slots", "{normalTexture,metallicRoughnessTexture}", "--quality", "90"])
shutil.move(f"{tmp}/m.glb", maple)

# 3. GLB -> .gltf.json with embedded buffers and external images.
renamed = []
for glb in glob.glob(f"{DIST}/**/*.glb", recursive=True):
    d, name = os.path.split(glb)
    stem = name[:-4]
    work = os.path.join(tmp, stem)
    os.makedirs(work, exist_ok=True)
    run(GT + ["copy", glb, f"{work}/{stem}.gltf"])
    g = json.load(open(f"{work}/{stem}.gltf"))
    for buf in g.get("buffers", []):
        if "uri" in buf and not buf["uri"].startswith("data:"):
            data = open(os.path.join(work, buf["uri"]), "rb").read()
            buf["uri"] = "data:application/octet-stream;base64," + base64.b64encode(data).decode()
    for img in g.get("images", []):
        if "uri" in img:
            new = f"{stem}-{img['uri']}"
            shutil.copy(os.path.join(work, img["uri"]), os.path.join(d, new))
            img["uri"] = new
    json.dump(g, open(os.path.join(d, f"{stem}.gltf.json"), "w"), separators=(",", ":"))
    os.remove(glb)
    renamed.append(stem)

for js in glob.glob(f"{DIST}/assets/index-*.js"):
    src = open(js).read()
    for stem in renamed:
        src = src.replace(f"{stem}.glb", f"{stem}.gltf.json")
    open(js, "w").write(src)

# 4. Page fragment (the host adds doctype/head) and the publish file map.
html = open(f"{DIST}/index.html", encoding="utf-8").read()
body = re.search(r"<body>(.*)</body>", html, re.S).group(1).strip()
js = re.search(r'src="(\./assets/index-[^"]+\.js)"', html).group(1)
css = re.search(r'href="(\./assets/index-[^"]+\.css)"', html).group(1)
body = body.replace("·", "&middot;").replace("…", "&hellip;")
page = f"""<title>ClaudeNinja</title>
<meta name="description" content="Third-person ninja brawler: fight the Red Clan in a Japanese village" />
<link rel="stylesheet" href="{css}">
<style>html,body{{height:100%;background:#e6c9a4;color-scheme:light}}:root{{padding:0!important}}</style>
{body}
<script type="module" src="{js}"></script>
"""
open(f"{DIST}/claudeninja.html", "w", encoding="utf-8").write(page)
files = {}
for path in glob.glob(f"{DIST}/**/*", recursive=True):
    rel = os.path.relpath(path, DIST)
    if os.path.isfile(path) and rel not in ("index.html", "claudeninja.html", "files.json") and not rel.endswith(".map"):
        files[rel] = rel
json.dump(files, open(f"{DIST}/files.json", "w"))
print(f"{len(files)} files, {sum(os.path.getsize(os.path.join(DIST, f)) for f in files) / 1e6:.1f} MB")
