// Builds site/content.js from src/: lesson modules, the SQL database and the
// practice filesystem. Every exercise solution is executed and validated.
// Usage: node tools/build.js
const fs = require('fs');
const path = require('path');
const MB = require('./mb.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ------------------------------------------------------------ markdown
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SQL_KW = new Set(('select from where and or not in is null like between group by having order asc desc limit offset as distinct join inner left right full outer cross on using union all intersect except with recursive case when then else end insert into values update set delete create table primary key foreign references unique check default index view drop alter add column if exists begin commit rollback transaction over partition rows range preceding following current row unbounded returning conflict do nothing replace natural filter glob escape cast integer text real numeric blob autoincrement constraint collate nocase temp temporary savepoint release vacuum explain query plan pragma trigger for each after before instead of rename to').split(' '));
const SQL_FN = new Set('count sum avg min max round abs upper lower length substr substring trim ltrim rtrim replace instr coalesce ifnull nullif date time datetime julianday strftime printf row_number rank dense_rank ntile lag lead first_value last_value group_concat total random typeof iif cume_dist percent_rank unixepoch concat'.split(' '));
function hlSQL(code) {
  let out = '';
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-n">${m[3]}</span>`;
    else if (m[4]) {
      const w = m[4].toLowerCase();
      if (SQL_KW.has(w)) out += `<span class="tk-k">${esc(m[4])}</span>`;
      else if (SQL_FN.has(w) && code[re.lastIndex] === '(') out += `<span class="tk-f">${esc(m[4])}</span>`;
      else out += esc(m[4]);
    } else out += esc(m[5]);
  }
  return out;
}
const SH_KW = new Set('if then elif else fi for in do done while until case esac function return break continue local export readonly declare select time'.split(' '));
const SH_CMD = new Set('echo printf cd ls pwd cat head tail wc sort uniq cut tr grep egrep sed awk find xargs mkdir rmdir touch rm cp mv chmod tee seq basename dirname date read test bash sh source exit shift set unset let tree diff paste comm rev tac nl column du file stat expr bc which env man less true false eval mapfile readarray getopts'.split(' '));
function hlBash(code) {
  let out = '';
  const re = /(#[^\n]*)|('(?:[^'])*')|("(?:\\.|[^"\\])*")|(\$\{[^}]*\}|\$\(\(|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9#?@*$!])|(\s-{1,2}[A-Za-z][\w-]*)|([A-Za-z_][\w.-]*)|([\s\S])/g;
  let m, atCmd = true;
  while ((m = re.exec(code))) {
    const [tok] = m;
    if (m[1] && (out === '' || /[\s;|&(]$/.test(code.slice(0, m.index)) || m.index === 0)) { out += `<span class="tk-c">${esc(m[1])}</span>`; continue; }
    if (m[1]) { out += esc(m[1]); continue; }
    if (m[2] || m[3]) { out += `<span class="tk-s">${esc(tok).replace(/(\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[0-9#?@])/g, '<span class="tk-v">$1</span>')}</span>`; atCmd = false; continue; }
    if (m[4]) { out += `<span class="tk-v">${esc(tok)}</span>`; atCmd = false; continue; }
    if (m[5]) { out += `<span class="tk-o">${esc(tok)}</span>`; continue; }
    if (m[6]) {
      if (SH_KW.has(tok)) { out += `<span class="tk-k">${tok}</span>`; atCmd = true; continue; }
      if (atCmd && SH_CMD.has(tok)) { out += `<span class="tk-f">${tok}</span>`; atCmd = false; continue; }
      out += esc(tok); atCmd = false; continue;
    }
    const ch = m[7];
    if ('|;&(\n{'.includes(ch)) atCmd = true;
    out += ('|><&'.includes(ch)) ? `<span class="tk-p">${esc(ch)}</span>` : esc(ch);
  }
  return out;
}
const LANGS = {
  python: { kw: 'def class return if elif else for while in not and or is import from as with try except finally raise pass yield async await lambda None True False global nonlocal del assert break continue', comment: /#[^\n]*/y, deco: /@[\w.]+/y },
  java: { kw: 'public private protected class interface record enum extends implements static final void return new if else for while do switch case default break continue try catch finally throw throws this super null true false import package var instanceof abstract synchronized', comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y, deco: /@\w+/y, types: /\b(?:String|Integer|Long|Double|Boolean|List|Map|Set|Optional|ResponseEntity|HttpStatus|Object|void|int|long|double|boolean)\b/y },
  dockerfile: { kw: 'FROM AS RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL', caseSensitive: true, comment: /#[^\n]*/y, lineStartKw: true },
  yaml: { comment: /#[^\n]*/y, key: /[\w.\-]+(?=\s*:(?:\s|$))/y },
  properties: { comment: /#[^\n]*/y, key: /[\w.\-]+(?=\s*[=:])/y },
  json: { kw: 'true false null' },
  xml: { comment: /<!--[\s\S]*?-->/y, tag: /<\/?[\w.:-]+|\/?>/y },
  http: { kw: 'GET POST PUT PATCH DELETE HTTP', caseSensitive: true }
};
LANGS.py = LANGS.python; LANGS.Dockerfile = LANGS.dockerfile; LANGS.yml = LANGS.yaml;
function hlGeneric(code, lang) {
  const L = LANGS[lang];
  const kws = new Set((L.kw || '').split(' ').filter(Boolean));
  let out = '', i = 0, lineStart = true;
  const at = (re) => { if (!re) return null; re.lastIndex = i; const m = re.exec(code); return m && m.index === i ? m[0] : null; };
  while (i < code.length) {
    let t;
    if ((t = at(L.comment)) !== null && (lang !== 'yaml' && lang !== 'properties' && lang !== 'dockerfile' || lineStart || /\s/.test(code[i - 1]))) { out += `<span class="tk-c">${esc(t)}</span>`; i += t.length; continue; }
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      const triple = code.startsWith(c.repeat(3), i);
      if (triple) { const e = code.indexOf(c.repeat(3), i + 3); j = e < 0 ? code.length : e + 3; }
      else { while (j < code.length && code[j] !== c && code[j] !== '\n') { if (code[j] === '\\') j++; j++; } j++; }
      out += `<span class="tk-s">${esc(code.slice(i, j))}</span>`; i = j; lineStart = false; continue;
    }
    if ((t = at(L.deco)) !== null) { out += `<span class="tk-f">${esc(t)}</span>`; i += t.length; lineStart = false; continue; }
    if ((t = at(L.tag)) !== null) { out += `<span class="tk-k">${esc(t)}</span>`; i += t.length; continue; }
    if (lineStart && (t = at(L.key)) !== null) { out += `<span class="tk-f">${esc(t)}</span>`; i += t.length; lineStart = false; continue; }
    const num = /^\d+(?:\.\d+)?/.exec(code.slice(i, i + 20));
    if (num && !/\w/.test(code[i - 1] || '')) { out += `<span class="tk-n">${num[0]}</span>`; i += num[0].length; lineStart = false; continue; }
    const w = /^[A-Za-z_][\w]*/.exec(code.slice(i, i + 80));
    if (w) {
      const word = w[0];
      const isKw = L.caseSensitive ? kws.has(word) : kws.has(word);
      if (isKw && (!L.lineStartKw || lineStart || word === 'AS')) out += `<span class="tk-k">${word}</span>`;
      else if (L.types && (L.types.lastIndex = 0, L.types.test(word)) && L.types.source.includes(word)) out += `<span class="tk-v">${word}</span>`;
      else out += esc(word);
      i += word.length; lineStart = false; continue;
    }
    if (c === '\n') lineStart = true; else if (!/\s/.test(c) && !(lang === 'yaml' && c === '-')) lineStart = false;
    out += esc(c); i++;
  }
  return out;
}
function highlight(code, lang) {
  if (lang === 'sql') return hlSQL(code);
  if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'console') return hlBash(code);
  if (LANGS[lang]) return hlGeneric(code, lang);
  return esc(code);
}
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\[([^\]]+)\]\(#([\w.~-]+)\)/g, '<a href="#$2">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}
function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^```(\w*)\s*(.*)$/.exec(line))) {
      const lang = m[1], flags = m[2].trim().split(/\s+/).filter(Boolean);
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      const run = flags.includes('run');
      const label = (flags.find(f => f.startsWith('title=')) || '').slice(6).replace(/_/g, ' ');
      html += `<div class="codeblock${run ? ' runnable' : ''}" data-lang="${lang}"${run ? ' data-run="1"' : ''}>` +
        (label ? `<div class="code-label">${esc(label)}</div>` : '') +
        `<pre><code>${highlight(code, lang)}</code></pre>` +
        (run ? `<textarea class="code-src" hidden>${esc(code)}</textarea>` : '') + `</div>\n`;
      continue;
    }
    if ((m = /^(#{2,4})\s+(.*)$/.exec(line))) {
      const lvl = m[1].length;
      const id = m[2].toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html += `<h${lvl} id="h-${id}">${inline(m[2])}</h${lvl}>\n`;
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      let kind = 'note', title = '';
      const km = /^\[!(\w+)\]\s*(.*)$/.exec(body[0] || '');
      if (km) { kind = km[1].toLowerCase(); title = km[2]; body.shift(); }
      const titles = { tip: 'Tip', warn: 'Watch out', note: 'Note', exam: 'Exam focus', why: 'Why it works', project: 'Project', plain: 'In plain English', mistake: 'Common mistake' };
      html += `<aside class="callout callout-${kind}"><div class="callout-title">${inline(title || titles[kind] || 'Note')}</div>${md(body.join('\n'))}</aside>\n`;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => {
        const s = r.trim().replace(/^\|/, '').replace(/\|$/, '');
        const out = []; let cur = '', code = false;
        for (let k = 0; k < s.length; k++) {
          const ch = s[k];
          if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
          if (ch === '`') code = !code;
          if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        out.push(cur.trim());
        return out;
      };
      const head = cells(rows[0]);
      const bodyRows = rows.slice(2).map(cells);
      html += `<div class="table-wrap"><table class="md-table"><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>` +
        bodyRows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + `</tbody></table></div>\n`;
      continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        if (/^\s*([-*]|\d+\.)\s+/.test(l)) items.push(l.replace(/^\s*([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ' ' + l.trim();
      }
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>\n`;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{2,4}\s|>|\||\s*([-*]|\d+\.)\s+)/.test(lines[i])) para.push(lines[i++]);
    html += `<p>${inline(para.join(' '))}</p>\n`;
  }
  return html;
}

// ------------------------------------------------------------ module parser
function parseModule(file, track) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const l of fm[1].split('\n')) { const m = /^(\w+):\s*(.*)$/.exec(l); if (m) meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1'); }
  const body = raw.slice(fm[0].length);
  const lines = body.split('\n');
  const lesson = [];
  const exercises = [];
  const quiz = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^:::exercise\s*$/.test(l)) {
      const blk = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) blk.push(lines[i++]);
      i++;
      exercises.push(parseExercise(blk, file, track, meta.id));
      continue;
    }
    if (/^:::quiz\s*$/.test(l)) {
      const blk = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) blk.push(lines[i++]);
      i++;
      quiz.push(parseQuiz(blk, file, meta.id, quiz.length));
      continue;
    }
    lesson.push(l);
    i++;
  }
  exercises.sort((a, b) => (a.project ? 1 : 0) - (b.project ? 1 : 0) || a.level - b.level);
  return { id: meta.id, title: meta.title, summary: meta.summary || '', minutes: +(meta.minutes || 20), track, lesson: md(lesson.join('\n')), exercises, quiz };
}
function parseExercise(blk, file, track, modId) {
  const ex = { fields: {}, sections: {} };
  let i = 0;
  while (i < blk.length && !/^---/.test(blk[i])) {
    const m = /^(\w+):\s*(.*)$/.exec(blk[i]);
    if (m) ex.fields[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    i++;
  }
  let cur = null;
  for (; i < blk.length; i++) {
    const m = /^---(\w*)\s*$/.exec(blk[i]);
    if (m) { cur = m[1] || 'prompt'; (ex.sections[cur] = ex.sections[cur] || []).push([]); continue; }
    if (cur) { const arr = ex.sections[cur]; arr[arr.length - 1].push(blk[i]); }
  }
  const sec = k => (ex.sections[k] || []).map(a => a.join('\n').replace(/^\n+|\n+$/g, ''));
  const f = ex.fields;
  if (!f.id || !f.level || !f.title) throw new Error(`${file}: exercise missing id/level/title: ${JSON.stringify(f)}`);
  const out = {
    id: f.id, level: +f.level, title: f.title, module: modId, track,
    prompt: md(sec('prompt')[0] || ''),
    hints: sec('hint').map(md),
    solution: sec('solution')[0] || '',
    explain: sec('explain').length ? md(sec('explain')[0]) : '',
    starter: sec('starter')[0] || '',
  };
  if (f.project === 'true' || /^proj-/.test(f.id)) out.project = true;
  if (!out.solution) throw new Error(`${file}: exercise ${f.id} has no solution`);
  const mode = f.mode || (track === 'sql' ? 'sql' : 'cmd');
  if (mode === 'code') {
    out.kind = 'code';
    out.lang = f.lang || 'python';
    out.file = f.file || '';
    out.rules = sec('rule').map(r => {
      const lines = r.split('\n');
      let re = lines[0], neg = false;
      if (re.startsWith('!')) { neg = true; re = re.slice(1); }
      return { re, neg, msg: inline(lines.slice(1).join(' ').trim() || 'requirement') };
    });
    if (!out.rules.length) throw new Error(`${file}: code exercise ${f.id} has no rules`);
    out.solutionHtml = highlight(out.solution, out.lang);
    return out;
  }
  if (mode === 'answer') {
    out.kind = 'answer';
    out.answers = sec('answer');
    if (!out.answers.length) out.answers = [out.solution];
    out.placeholder = f.placeholder || 'your answer';
    return out;
  }
  if (track === 'sql') {
    out.kind = 'sql';
    out.ordered = f.ordered === 'true';
    if (sec('check').length) out.check = sec('check')[0];
    if (f.colnames === 'true') out.colnames = true;
  } else {
    out.kind = 'shell';
    out.mode = f.mode || 'cmd';
    out.fixture = f.fs || (track === 'bash' ? 'base' : 'docker');
    out.cwd = f.cwd || '/home/student';
    if (f.run) out.run = f.run;
    if (sec('run').length) out.run = sec('run')[0];
    if (f.lang) out.lang = f.lang;
    if (f.setup) out.setup = f.setup;
    if (sec('setup').length) out.setup = sec('setup')[0];
    if (sec('verify').length) out.verify = sec('verify')[0];
    out.compare = f.compare || (out.verify ? 'verify' : 'output');
    if (f.unordered === 'true') out.unordered = true;
    if (f.file) out.file = f.file;
    if (f.stderr === 'true') out.stderr = true;
    if (f.status === 'true') out.status = true;
    out.tests = sec('test').map(t => {
      const m = /^args:\s*(.*)$/m.exec(t);
      const s = /^stdin:\n([\s\S]*)$/m.exec(t);
      return { args: m ? m[1] : '', stdin: s ? s[1] + '\n' : '' };
    });
    if (out.mode === 'script' && !out.tests.length) out.tests = [{ args: '', stdin: '' }];
  }
  return out;
}
function parseQuiz(blk, file, modId, n) {
  const q = { id: `${modId}-q${n + 1}`, q: '', options: [], answer: -1, why: '' };
  let code = null;
  for (const l of blk) {
    let m;
    if (code !== null) { if (/^```/.test(l)) { q.code = code.join('\n'); code = null; } else code.push(l); continue; }
    if (/^```/.test(l)) { code = []; q.codeLang = l.slice(3).trim(); continue; }
    if ((m = /^q:\s*(.*)$/.exec(l))) q.q = inline(m[1]);
    else if ((m = /^([-+])\s+(.*)$/.exec(l))) { if (m[1] === '+') q.answer = q.options.length; q.options.push(inline(m[2])); }
    else if ((m = /^why:\s*(.*)$/.exec(l))) q.why = inline(m[1]);
  }
  if (q.code) q.code = highlight(q.code, q.codeLang || 'sql');
  if (q.answer < 0 || q.options.length < 2) throw new Error(`${file}: bad quiz ${q.id}`);
  return q;
}

// ------------------------------------------------------------ fixture fs
function fsSpec(dirName) {
  const base = path.join(SRC, dirName || 'fs');
  const spec = {};
  const walk = (dir) => {
    const ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      const full = path.join(dir, e.name);
      const vpath = '/' + path.relative(base, full).split(path.sep).join('/');
      if (e.name === '.keep') continue; // placeholder so git keeps empty directories
      if (e.isDirectory()) { spec[vpath] = { dir: true }; walk(full); }
      else spec[vpath] = { content: fs.readFileSync(full, 'utf8'), mode: (e.name.endsWith('.sh') && vpath.includes('/scripts/') && e.name !== 'hello.sh') || e.name === 'mvnw' ? 0o755 : 0o644 };
    }
  };
  walk(base);
  return spec;
}

// ------------------------------------------------------------ validation
async function validate(tracks, dbSql, fixtures) {
  const initSqlJs = require('./sql-asm.js');
  const SQL = await initSqlJs();
  const problems = [];
  const freshDb = () => { const db = new SQL.Database(); db.exec(dbSql); return db; };
  const ids = new Set();
  for (const t of tracks) for (const m of t.modules) for (const ex of m.exercises) {
    if (ids.has(ex.id)) problems.push(`duplicate exercise id ${ex.id}`);
    ids.add(ex.id);
    if (ex.kind === 'code') {
      const g = MB.gradeCode(ex.solution, ex.rules, ex.lang);
      if (!g.ok) problems.push(`[${ex.id}] solution fails rules: ${g.results.filter(r => !r.ok).map(r => r.msg).join(' | ')}`);
      if (MB.gradeCode(ex.starter || '', ex.rules, ex.lang).ok) problems.push(`[${ex.id}] starter already passes every rule`);
      continue;
    }
    if (ex.kind === 'answer') {
      if (!MB.matchAnswer(ex.solution, ex.answers)) problems.push(`[${ex.id}] solution doesn't match its answers`);
      continue;
    }
    if (ex.kind === 'sql') {
      const db = freshDb();
      try {
        const res = db.exec(ex.solution);
        const last = res[res.length - 1];
        if (ex.check) {
          const c = db.exec(ex.check);
          if (!c.length || !c[0].values.length) problems.push(`[${ex.id}] check query returns no rows`);
          ex.expected = c.length ? { columns: c[0].columns, rows: c[0].values.slice(0, 60), total: c[0].values.length } : { columns: [], rows: [], total: 0 };
        } else {
          if (!last || !last.values.length) problems.push(`[${ex.id}] solution returns no rows`);
          ex.expected = last ? { columns: last.columns, rows: last.values.slice(0, 60), total: last.values.length } : { columns: [], rows: [], total: 0 };
        }
        if (ex.ordered && !/order\s+by/i.test(ex.solution)) problems.push(`[${ex.id}] ordered but no ORDER BY`);
        if (ex.ordered || (ex.check && /order\s+by/i.test(ex.check))) {
          // the required order must be fully determined: reversing unordered scans must not change it
          const db2 = freshDb();
          db2.exec('PRAGMA reverse_unordered_selects = ON');
          const r2 = db2.exec(ex.solution);
          const res2 = ex.check ? db2.exec(ex.check) : r2;
          const a = JSON.stringify(ex.expected.rows), b = JSON.stringify((res2[res2.length - 1] || { values: [] }).values.slice(0, 60));
          if (a !== b) problems.push(`[${ex.id}] ordering is not deterministic (ties in ORDER BY)`);
          db2.close();
        }
      } catch (e) { problems.push(`[${ex.id}] SQL error: ${e.message}`); }
      db.close();
    } else {
      const spec = fixtures[ex.fixture];
      if (!spec) { problems.push(`[${ex.id}] unknown fixture ${ex.fixture}`); continue; }
      const runOnce = (cmdline, stdin) => {
        const sh = new MB.Shell({ fs: MB.VFS.fromSpec(spec), cwd: ex.cwd });
        if (ex.setup) { const r = sh.run(ex.setup, { tty: false }); if (r.stderr && !/Unable to find image|Pull complete|Pulling from|Digest:|Status:|docker\.io/.test(r.stderr)) problems.push(`[${ex.id}] setup stderr: ${r.stderr.trim().slice(0, 300)}`); sh.cwd = ex.cwd; }
        let r;
        if (ex.mode === 'script') {
          sh.writeFile(ex.file || 'script.sh', ex.solution + '\n', false);
          r = sh.run(`bash ${ex.file || 'script.sh'} ${cmdline}`, { tty: false, stdin });
        } else if (ex.mode === 'file') {
          sh.writeFile(ex.file, ex.solution + '\n', false);
          r = sh.run(ex.run, { tty: false, stdin });
        } else r = sh.run(ex.solution, { tty: false, stdin });
        let v = null;
        if (ex.verify) { sh.cwd = ex.cwd; v = sh.run(ex.verify, { tty: false }); }
        return { r, v };
      };
      if (ex.mode === 'file' && ex.starter) {
        const run = code => { const sh = new MB.Shell({ fs: MB.VFS.fromSpec(spec), cwd: ex.cwd }); if (ex.setup) { sh.run(ex.setup, { tty: false }); sh.cwd = ex.cwd; } sh.writeFile(ex.file, code + '\n', false); const r = sh.run(ex.run, { tty: false }); let v = ''; if (ex.verify) { sh.cwd = ex.cwd; v = sh.run(ex.verify, { tty: false }).stdout; } return r.stdout + '|' + v; };
        if (run(ex.starter).replace(/\s+/g, ' ').trim() === run(ex.solution).replace(/\s+/g, ' ').trim()) problems.push(`[${ex.id}] starter already produces the expected output`);
      }
      const runs = ex.mode === 'script' ? ex.tests : [{ args: '', stdin: '' }];
      ex.expected = [];
      for (const tc of runs) {
        const { r, v } = runOnce(tc.args, tc.stdin);
        const errNoise = r.stderr.split('\n').filter(l => l && !/Unable to find image|Pull complete|Pulling from|^Digest:|^Status: |^docker\.io\/|^Using default tag|^\(simulator/.test(l)).join('\n');
        if (errNoise && !ex.stderr) problems.push(`[${ex.id}] stderr: ${errNoise.trim().slice(0, 300)}`);
        if (ex.compare !== 'verify' && !ex.status && !(r.stdout + (ex.stderr ? r.stderr : '')).trim()) problems.push(`[${ex.id}] solution printed nothing`);
        if (v && !v.stdout.trim()) problems.push(`[${ex.id}] verify printed nothing`);
        if (v && v.stderr) problems.push(`[${ex.id}] verify stderr: ${v.stderr.trim()}`);
        ex.expected.push({ args: tc.args, stdout: ex.compare === 'verify' ? v.stdout : r.stdout + (ex.stderr ? r.stderr : ''), verify: v ? v.stdout : undefined, status: r.status });
      }
    }
  }
  // runnable lesson snippets must run cleanly too
  for (const t of tracks) for (const m of t.modules) {
    const re = /<textarea class="code-src" hidden>([\s\S]*?)<\/textarea>/g;
    let mm;
    while ((mm = re.exec(m.lesson))) {
      const code = mm[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (t.id === 'sql') {
        const db = freshDb();
        try { db.exec(code); } catch (e) { problems.push(`[${m.id} lesson] SQL error: ${e.message}\n    ${code.split('\n')[0]}`); }
        db.close();
      } else {
        const sh = new MB.Shell({ fs: MB.VFS.fromSpec(fixtures[t.id === 'bash' ? 'base' : 'docker']) });
        const r = sh.run(code, { tty: false });
        const errNoise = r.stderr.split('\n').filter(l => l && !/Unable to find image|Pull complete|Pulling from|^Digest:|^Status: |^docker\.io\/|^Using default tag|^\(simulator/.test(l)).join('\n');
        if (errNoise && !/fails on purpose/.test(code)) problems.push(`[${m.id} lesson] stderr: ${errNoise.trim().slice(0, 200)}\n    ${code.split('\n')[0]}`);
      }
    }
  }
  return problems;
}

async function main() {
  const tracks = [
    { id: 'sql', title: 'SQL', modules: [] },
    { id: 'bash', title: 'Bash', modules: [] },
    { id: 'docker', title: 'Docker', modules: [] },
    { id: 'fastapi', title: 'FastAPI', modules: [] },
    { id: 'spring', title: 'Spring Boot', modules: [] },
    { id: 'cicd', title: 'CI/CD', modules: [] },
    { id: 'aws', title: 'AWS', modules: [] },
    { id: 'java', title: 'Java OOP', modules: [] },
    { id: 'design', title: 'System Design', modules: [] },
  ];
  for (const t of tracks) {
    const dir = path.join(SRC, t.id);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) t.modules.push(parseModule(path.join(dir, f), t.id));
  }
  const dbSql = fs.readFileSync(path.join(SRC, 'db.sql'), 'utf8');
  const fixtures = { base: fsSpec('fs'), docker: fsSpec('fs-docker') };
  const problems = await validate(tracks, dbSql, fixtures);
  const counts = tracks.map(t => `${t.id}: ${t.modules.length} modules, ${t.modules.reduce((a, m) => a + m.exercises.length, 0)} exercises, ${t.modules.reduce((a, m) => a + m.quiz.length, 0)} quiz questions`);
  const extra = {};
  for (const f of fs.readdirSync(SRC).filter(f => /^cheatsheet-.*\.md$/.test(f))) { const p = path.join(SRC, f); if (fs.existsSync(p)) extra[f.replace('.md', '')] = md(fs.readFileSync(p, 'utf8')); }
  for (const t of tracks) for (const m of t.modules) for (const ex of m.exercises) delete ex.expected;
  const payload = `/* generated by tools/build.js — do not edit */\nwindow.PJ = ${JSON.stringify({ tracks: tracks.filter(t => t.modules.length), dbSql, fs: fixtures.base, fixtures, extra, built: new Date().toISOString().slice(0, 10) })};\n`;
  fs.writeFileSync(path.join(ROOT, 'site', 'content.js'), payload);
  console.log(counts.join('\n'));
  console.log(`content.js: ${(payload.length / 1024).toFixed(0)} KB`);
  if (problems.length) { console.log(`\n${problems.length} problem(s):`); for (const p of problems) console.log(' - ' + p); process.exitCode = 1; }
  else console.log('all solutions validated');
}
main();
