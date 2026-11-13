// Loads the minibash engine into node for testing.
const path = require('path');
for (const f of ['textutil.js', 'awk.js', 'sed.js', 'shell.js', 'docker.js', 'grade.js']) require(path.join(__dirname, '../site/engine', f));
module.exports = globalThis.MB;
