const fs = require('fs');

const P = 'E:/TO-DO-Panel/cloud/src/index.js';
const WEB = 'E:/TO-DO-Panel/cloud/web/';

function readConst(src, name) {
  const marker = 'const ' + name + ' = ';
  const si = src.indexOf(marker);
  if (si < 0) throw new Error(name + ' not found');
  let i = si + marker.length;
  if (src[i] !== '"') throw new Error(name + ' not a string');
  i++;
  let end = i;
  while (end < src.length) {
    if (src[end] === '\\') { end += 2; continue; }
    if (src[end] === '"') break;
    end++;
  }
  return { si, end, value: JSON.parse('"' + src.substring(i, end) + '"') };
}

function writeConst(src, name, value) {
  const marker = 'const ' + name + ' = ';
  const si = src.indexOf(marker);
  const { end } = readConst(src, name);
  const out = marker + JSON.stringify(value) + ';';
  return src.substring(0, si) + out + src.substring(end + 1);
}

let src = fs.readFileSync(P, 'utf8');

// 注入新 CSS / JS
const newCss = fs.readFileSync(WEB + 'app.css', 'utf8');
const newJs = fs.readFileSync(WEB + 'app.js', 'utf8');

// CSS 语法检查（简易：括号配平）
function checkCss(css) {
  let open = 0;
  for (const ch of css) {
    if (ch === '{') open++;
    if (ch === '}') open--;
    if (open < 0) return false;
  }
  return open === 0;
}
if (!checkCss(newCss)) { console.log('CSS brace mismatch'); process.exit(1); }

// JS 语法检查
try {
  new Function(newJs);
  console.log('JS syntax OK, len:', newJs.length);
} catch (e) {
  console.log('JS SYNTAX ERROR:', e.message);
  process.exit(1);
}

src = writeConst(src, 'CSS', newCss);
src = writeConst(src, 'APP_JS', newJs);

fs.writeFileSync(P, src, 'utf8');
console.log('BUILD DONE');
