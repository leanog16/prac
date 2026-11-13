// Prints each shell exercise's solution output: node tools/show.js <module-id>
const MB = require('./mb.js');
global.window = {}; require('../site/content.js');
const PJ = window.PJ;
const mod = PJ.tracks.flatMap(t => t.modules).find(m => m.id === process.argv[2]);
for (const ex of mod.exercises) {
  if (ex.kind !== 'shell') { console.log(`## ${ex.id} [${ex.kind}] answer: ${JSON.stringify(ex.solution).slice(0, 80)}`); continue; }
  const tests = ex.mode === 'script' ? ex.tests : [null];
  for (const t of tests) {
    const sh = new MB.Shell({ fs: MB.VFS.fromSpec(PJ.fixtures[ex.fixture]), cwd: ex.cwd });
    if (ex.setup) { sh.run(ex.setup, { tty: false }); sh.cwd = ex.cwd; }
    let r;
    if (ex.mode === 'script') { sh.writeFile('script.sh', ex.solution + '\n'); r = sh.run('bash script.sh ' + t.args, { tty: false }); }
    else if (ex.mode === 'file') { sh.writeFile(ex.file, ex.solution + '\n'); r = sh.run(ex.run, { tty: false }); }
    else r = sh.run(ex.solution, { tty: false });
    let v = null;
    if (ex.verify) { sh.cwd = ex.cwd; v = sh.run(ex.verify, { tty: false }); }
    console.log(`## ${ex.id} (${ex.compare})${t ? ' ' + t.args : ''}\n` + (ex.compare !== 'verify' ? r.stdout : '') + (v ? '-- verify:\n' + v.stdout : ''));
  }
}
