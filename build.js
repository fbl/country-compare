// Packs index.html, taxdata.js and engine.js into one self-contained file.
// Run: node build.js   →   country-compare.html
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
let html = read('index.html');
for (const f of ['taxdata.js', 'engine.js']) {
  const tag = `<script src="${f}"></script>`;
  if (!html.includes(tag)) throw new Error(`index.html has no ${tag}`);
  // a literal "</script" inside the code would end the inline block early
  const js = read(f).replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, () => `<script>\n${js}\n</script>`);
}
if (/<script src=/.test(html)) throw new Error('an external script is left in the page');
const out = path.join(__dirname, 'country-compare.html');
fs.writeFileSync(out, html);
console.log(`${path.basename(out)}: ${(html.length / 1024).toFixed(0)} kB`);
