// Packs index.html and every script it loads into one self-contained file.
// Run: node build.js   →   country-compare.html
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
let n = 0;
const html = read('index.html').replace(/<script src="([^"]+)"><\/script>/g, (tag, src) => {
  n++;
  // a literal "</script" inside the code would end the inline block early
  return `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`;
});
if (!n || /<script[^>]+src=/.test(html)) throw new Error('could not inline every script');
const out = path.join(__dirname, 'country-compare.html');
fs.writeFileSync(out, html);
console.log(`${path.basename(out)}: ${n} scripts inlined, ${(html.length / 1024).toFixed(0)} kB`);
