// 预览打包用（tools/build_preview.py 调用）：去掉本地模块里的注释，省下体积给内嵌的模型。
// 从标准输入读 {名字: 源码}，输出同样结构的 JSON。用 TypeScript 的转译器（目标 ESNext，不降级语法），
// 字符串和模板字符串（着色器代码）原样保留，比自己写正则去注释稳。
import ts from 'typescript';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const out = {};
  for (const [name, src] of Object.entries(JSON.parse(input))) {
    out[name] = ts.transpileModule(src, {
      fileName: name,
      compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, allowJs: true },
    }).outputText;
  }
  process.stdout.write(JSON.stringify(out));
});
