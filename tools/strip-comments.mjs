// 预览打包用（tools/build_preview.py 调用）：去掉本地模块里的注释、再压掉空白和局部变量名，省下体积给内嵌的模型。
// 从标准输入读 {名字: 源码}，输出同样结构的 JSON。先用 TypeScript 的转译器去注释（目标 ESNext，不降级语法），
// 字符串和模板字符串（着色器代码）原样保留，比自己写正则去注释稳；再用 Next 自带的 terser 只做"去空白 + 改短局部名"
// （不开 compress：不改写语句，出了问题也好对回源码；导出名、属性名都不动）。只影响预览页，正式网站走 Next 自己的打包。
import { createRequire } from 'node:module';
import ts from 'typescript';

const { minify } = createRequire(import.meta.url)('next/dist/compiled/terser/bundle.min.js');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', async () => {
  const out = {};
  for (const [name, src] of Object.entries(JSON.parse(input))) {
    const js = ts.transpileModule(src, {
      fileName: name,
      compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, allowJs: true },
    }).outputText;
    out[name] = (await minify(js, { module: true, compress: false, mangle: true, format: { comments: false } })).code;
  }
  process.stdout.write(JSON.stringify(out));
});
