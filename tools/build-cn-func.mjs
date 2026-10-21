// 打包北京线路的解析函数：从 server/parse-core.ts 顺着 import 找齐要用的文件，
// TS 转成 JS，全部摊平到一个目录、改名 .mjs 并改写 import 路径，外壳 cn-func/index.cjs 改名 index.js，最后打成 zip。
// 用法：node tools/build-cn-func.mjs → cn-func/dist/ 与 cn-func/yanchu-parse.zip（都不进仓库），zip 在函数服务控制台上传。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'server', 'parse-core.ts');
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

/** 相对路径 → 真实文件（写了 .js 的照写；没写扩展名的先找 .ts 再找 .js） */
function resolveSpec(from, spec) {
  const p = resolve(dirname(from), spec);
  if (extname(p)) return p;
  for (const ext of ['.ts', '.js']) if (existsSync(p + ext)) return p + ext;
  throw new Error(`找不到 ${spec}（在 ${from}）`);
}

const outName = (p) => basename(p, extname(p)) + '.mjs';

/** @param {string} outDir @returns {{ files: string[] }} */
export function build(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const seen = new Map();   // 源文件 → 输出文件名
  const queue = [ENTRY];
  while (queue.length) {
    const src = queue.shift();
    if (seen.has(src)) continue;
    const name = outName(src);
    for (const [other, n] of seen) if (n === name) throw new Error(`重名：${src} 与 ${other} 都会变成 ${name}`);
    seen.set(src, name);
    let code = readFileSync(src, 'utf8');
    if (src.endsWith('.ts')) {
      code = ts.transpileModule(code, {
        fileName: src,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
    }
    code = code.replace(SPEC, (_m, head, q, spec) => {
      const dep = resolveSpec(src, spec);
      queue.push(dep);
      return `${head}${q}./${outName(dep)}${q}`;
    });
    writeFileSync(join(outDir, name), code);
  }
  writeFileSync(join(outDir, 'index.js'), readFileSync(join(ROOT, 'cn-func', 'index.cjs'), 'utf8'));
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ name: 'yanchu-parse', private: true, type: 'commonjs' }, null, 2) + '\n');
  return { files: ['index.js', 'package.json', ...seen.values()] };
}

// ---------------------------------------------------------------- 最简 zip（只存不压，文件都很小）
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} dir @param {string[]} names @param {string} zipPath */
export function zip(dir, names, zipPath) {
  const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;   // 固定 2026-01-01，同样的内容打出同样的字节
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const data = readFileSync(join(dir, name));
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(DATE, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(zipPath, Buffer.concat([...locals, cd, end]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = join(ROOT, 'cn-func', 'dist');
  const { files } = build(dist);
  const zipPath = join(ROOT, 'cn-func', 'yanchu-parse.zip');
  zip(dist, files, zipPath);
  console.log(`打包完成：${files.length} 个文件 → ${zipPath}（${readFileSync(zipPath).length} 字节）`);
  console.log(files.join('  '));
}
