const MB = require('./mb.js');
const fs = MB.VFS.fromSpec({
  '/home/student/notes.txt': 'alpha\nbeta\ngamma\nbeta\n',
  '/home/student/data/emp.csv': 'id,name,dept,salary\n1,Ana,Eng,90000\n2,Bo,Ops,55000\n3,Cy,Eng,72000\n4,Di,Sales,61000\n',
});
const sh = new MB.Shell({ fs });
const src = process.argv[2];
const r = sh.run(src, { tty: false });
process.stdout.write(r.output.map(c => (c.stream === 'err' ? '[ERR]' : '') + c.s).join(''));
console.log('[status ' + r.status + ']');
