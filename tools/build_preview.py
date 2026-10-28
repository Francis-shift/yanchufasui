"""把 game/ 打成一个不依赖网络的单文件页面（preview/index.html），用于在只能看静态页面的地方验画面。

- 库（three、cannon-es、后期处理）取 jsdelivr 的压缩版，缓存在 preview/vendor-min/；
- game/ 下的本地模块逐个收进来，相对引用改写成内部名字；
- 全部模块合成一份、gzip + base64 内联，页面启动时用浏览器自带的 DecompressionStream 解开，动态写 importmap 再启动。
预览页没有服务器，解析只走关键词（等同断网模式）。
用法：python tools/build_preview.py          → preview/index.html（游戏）
      python tools/build_preview.py check    → preview/check.html（手机检查页）
      python tools/build_preview.py --dragon preview/assets/dragon-6k.bin  → 游戏页另外内嵌一条龙（减面版，无贴图）
        正式的上色龙 gzip 后 310 KB、贴图 220 KB，塞进来就超过面板 512 KB 的上限，所以预览只验召唤的代码路径和飞行路线。
      python tools/build_preview.py props --asset public/models/lion.drg2.gz --asset ...  → preview/props.html（物件材质检查页）
        --asset 可重复，文件原样内嵌，页面里按文件名取（game/dev/propcheck.js）。
      python tools/build_preview.py dragons --dragon preview/assets/dragon-6k.bin  → preview/dragons.html（五条龙的动作检查页，game/dev/dragoncheck.js）
只打包页面真正引用到的库（扫本地模块里的 import）：检查页用不到物理引擎，省下来给模型。
"""
import sys
import base64
import gzip
import json
import pathlib
import posixpath
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "preview"
VENDOR = OUT / "vendor-min"
CDN = "https://cdn.jsdelivr.net/npm/"
THREE = "three@0.186.1"
ENTRIES = {
    "three": f"{THREE}/build/three.module.js",
    "cannon-es": "cannon-es@0.20.0/dist/cannon-es.js",
    "three/addons/postprocessing/EffectComposer.js": f"{THREE}/examples/jsm/postprocessing/EffectComposer.js",
    "three/addons/postprocessing/RenderPass.js": f"{THREE}/examples/jsm/postprocessing/RenderPass.js",
    "three/addons/postprocessing/UnrealBloomPass.js": f"{THREE}/examples/jsm/postprocessing/UnrealBloomPass.js",
    "three/addons/postprocessing/OutputPass.js": f"{THREE}/examples/jsm/postprocessing/OutputPass.js",
    "three/addons/postprocessing/ShaderPass.js": f"{THREE}/examples/jsm/postprocessing/ShaderPass.js",
    "three/addons/objects/Reflector.js": f"{THREE}/examples/jsm/objects/Reflector.js",
}
REL_IMPORT = re.compile(r"""((?:import|export)\b[^'"]*?\bfrom\s*|import\s*\(?\s*)(['"])(\.{1,2}/[^'"]+)\2""")


def fetch_pkg(path: str) -> str:
    min_path = re.sub(r"\.js$", ".min.js", path)
    local = VENDOR / min_path
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(3):  # 本机 Python 的 TLS 握手会被掐断，用 curl 并重试
            if subprocess.run(["curl", "-sSfL", "-m", "60", "-o", str(local), CDN + min_path]).returncode == 0:
                break
        else:
            raise SystemExit(f"下载失败：{CDN + min_path}")
    return local.read_text(encoding="utf-8")


def collect_pkg(path: str, out: dict):
    if path in out:
        return
    out[path] = None
    src, base = fetch_pkg(path), path.rsplit("/", 1)[0]

    def rewrite(m):
        dep = re.sub(r"\.min\.js$", ".js", posixpath.normpath(posixpath.join(base, m.group(3))))
        collect_pkg(dep, out)
        return f"{m.group(1)}{m.group(2)}@pkg/{dep}{m.group(2)}"

    out[path] = REL_IMPORT.sub(rewrite, src)


def collect_local(rel: str, out: dict):
    """rel 是相对仓库根的路径，如 game/main.js"""
    if rel in out:
        return
    out[rel] = None
    src, base = (ROOT / rel).read_text(encoding="utf-8"), posixpath.dirname(rel)

    def rewrite(m):
        dep = posixpath.normpath(posixpath.join(base, m.group(3)))
        collect_local(dep, out)
        return f"{m.group(1)}{m.group(2)}@local/{dep}{m.group(2)}"

    out[rel] = REL_IMPORT.sub(rewrite, src)


def gz_b64(s: str) -> str:
    return base64.b64encode(gzip.compress(s.encode("utf-8"), 9)).decode()


BOOT = """<script>
(async () => {
  try {
    const unzip = async (b64) => {
      const bin = Uint8Array.from(atob(b64.trim()), c => c.charCodeAt(0));
      return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    };
    const urls = {};
    for (const s of document.querySelectorAll('script[data-bundle]')) {
      for (const [name, src] of Object.entries(JSON.parse(await unzip(s.textContent)))) {
        urls[name] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
    }
    for (const [name, key] of Object.entries(%s)) urls[name] = urls[key];
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: urls });
    document.head.appendChild(map);
    const main = document.createElement('script');
    main.type = 'module';
    main.textContent = %s;
    document.body.appendChild(main);
  } catch (e) { document.body.insertAdjacentHTML('beforeend', '<pre style="color:#b00">' + e + '</pre>'); }
})();
</script>"""

SHELL = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<style>html,body{margin:0;height:100%%;overflow:hidden;background:#9fc3e8}#app{position:fixed;inset:0}</style></head>
<body><div id="app"></div>
%s
</body></html>"""


TARGETS = {
    # 名字: (入口模块, 启动语句, 页面标题, 输出文件)
    "game": ("game/main.js", "import { start } from '@local/game/main.js';"
             " const d = document.getElementById('asset-dragon');"
             " const mesh = d ? URL.createObjectURL(new Blob([Uint8Array.from(atob(d.textContent.trim()), (c) => c.charCodeAt(0))])) : undefined;"
             " start(document.getElementById('app'), mesh ? { dragon: { mesh } } : {});",
             "言出法随 · 预览", "index.html"),
    "check": ("game/check.js", "import { startCheck } from '@local/game/check.js'; startCheck(document.getElementById('app'));",
              "言出法随 · 手机检查", "check.html"),
    "props": ("game/dev/propcheck.js", "import { startPropCheck } from '@local/game/dev/propcheck.js';"
              " const assets = {};"
              " for (const s of document.querySelectorAll('script[data-asset]'))"
              " assets[s.dataset.asset] = URL.createObjectURL(new Blob([Uint8Array.from(atob(s.textContent.trim()), (c) => c.charCodeAt(0))]));"
              " startPropCheck(document.getElementById('app'), assets);",
              "言出法随 · 物件材质检查", "props.html"),
    "dragons": ("game/dev/dragoncheck.js", "import { startDragonCheck } from '@local/game/dev/dragoncheck.js';"
                " const d = document.getElementById('asset-dragon');"
                " startDragonCheck(document.getElementById('app'), d ? URL.createObjectURL(new Blob([Uint8Array.from(atob(d.textContent.trim()), (c) => c.charCodeAt(0))])) : undefined);",
                "言出法随 · 五龙检查", "dragons.html"),
}
BARE_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'".][^'"]*)\1""")


def main():
    args = sys.argv[1:]
    dragon = None
    if "--dragon" in args:
        i = args.index("--dragon")
        dragon = pathlib.Path(args[i + 1]).read_bytes()
        del args[i:i + 2]
    assets = []
    while "--asset" in args:
        i = args.index("--asset")
        assets.append(pathlib.Path(args[i + 1]))
        del args[i:i + 2]
    entry, boot, title, out_name = TARGETS[args[0] if args else "game"]
    locs: dict = {}
    collect_local(entry, locs)
    used = {m.group(2) for src in locs.values() for m in BARE_IMPORT.finditer(src)}
    # 去掉本地模块里的注释（面板 512 KB 的上限很紧；见 tools/strip-comments.mjs）
    r = subprocess.run(["node", str(ROOT / "tools" / "strip-comments.mjs")], input=json.dumps(locs), capture_output=True,
                       text=True, encoding="utf-8", cwd=ROOT, shell=sys.platform == "win32")
    if r.returncode != 0:
        raise SystemExit("去注释失败：" + r.stderr[-500:])
    locs = json.loads(r.stdout)
    pkgs: dict = {}
    for name, p in ENTRIES.items():
        if name in used:
            collect_pkg(p, pkgs)
    # 所有模块压成一个 gzip 流（模块之间重复的写法能互相引用，比逐个压小几十 KB；10-27 逐个压时超了 512 KB）
    mods = {f"@pkg/{p}": c for p, c in pkgs.items()} | {f"@local/{p}": c for p, c in locs.items()}
    blocks = [f'<script type="application/octet-stream" data-bundle>{gz_b64(json.dumps(mods, ensure_ascii=False))}</script>']
    if dragon:   # 模型数据 gzip 后内联，游戏里按开头两个字节自己判断要不要解压
        blocks.append(f'<script type="application/octet-stream" id="asset-dragon">{base64.b64encode(gzip.compress(dragon, 9)).decode()}</script>')
    blocks += [f'<script type="application/octet-stream" data-asset="{a.name}">{base64.b64encode(a.read_bytes()).decode()}</script>' for a in assets]
    alias = {name: f"@pkg/{path}" for name, path in ENTRIES.items() if name in used}
    page = SHELL % (title, "\n".join(blocks) + "\n" + BOOT % (json.dumps(alias), json.dumps(boot)))
    OUT.mkdir(exist_ok=True)
    (OUT / out_name).write_text(page, encoding="utf-8")
    size = len(page.encode("utf-8"))
    print(f"本地模块 {len(locs)} 个，库 {len(pkgs)} 个；preview/{out_name} {size / 1024:.0f} KB" +
          ("  WARN=超过 512 KB" if size > 512 * 1024 else ""))


if __name__ == "__main__":
    main()
