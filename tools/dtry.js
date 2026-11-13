// Runs shell source against the docker fixture: node tools/dtry.js 'cmds'  (or -f file)
const fs = require('fs'), path = require('path');
const MB = require('./mb.js');
function spec(base) {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const full = path.join(d, e.name); const v = '/' + path.relative(base, full); if (e.isDirectory()) { out[v] = { dir: true }; walk(full); } else out[v] = { content: fs.readFileSync(full, 'utf8'), mode: e.name === 'mvnw' ? 0o755 : 0o644 }; } };
  walk(base); return out;
}
const sh = new MB.Shell({ fs: MB.VFS.fromSpec(spec(path.join(__dirname, '../src/fs-docker'))) });
const src = process.argv[2] === '-f' ? fs.readFileSync(process.argv[3], 'utf8') : process.argv[2];
for (const block of src.split('\n#---\n')) {
  const r = sh.run(block, { tty: false });
  process.stdout.write('$ ' + block.trim().split('\n').join('\n> ') + '\n' + r.output.map(c => (c.stream === 'err' ? '\x1b[31m' : '') + c.s + (c.stream === 'err' ? '\x1b[0m' : '')).join('') + `[${r.status}]\n`);
}
