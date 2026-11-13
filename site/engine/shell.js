/* shell.js — minibash: a bash-like interpreter running over an in-memory
   filesystem. Supports pipelines, redirection, heredocs, variables, arrays,
   parameter expansion, arithmetic, globbing, brace expansion, functions,
   if/for/while/until/case, [ ] and [[ ]], and subshell semantics. */
(function () {
  'use strict';
  const MB = globalThis.MB || (globalThis.MB = {});

  // ------------------------------------------------------------------ signals
  class ShellError extends Error {}
  class SyntaxErr extends Error {}
  class LimitError extends Error {}
  class BreakSig { constructor(n) { this.n = n; } }
  class ContinueSig { constructor(n) { this.n = n; } }
  class ReturnSig { constructor(code) { this.code = code; } }
  class ExitSig { constructor(code) { this.code = code; } }

  // ------------------------------------------------------------------ streams
  class Stream {
    constructor(data) { this.data = data || ''; this.pos = 0; }
    readAll() { const s = this.data.slice(this.pos); this.pos = this.data.length; return s; }
    readLine() { // returns null at EOF; {line, nl} otherwise
      if (this.pos >= this.data.length) return null;
      const k = this.data.indexOf('\n', this.pos);
      if (k < 0) { const s = this.data.slice(this.pos); this.pos = this.data.length; return { line: s, nl: false }; }
      const s = this.data.slice(this.pos, k); this.pos = k + 1; return { line: s, nl: true };
    }
  }

  // --------------------------------------------------------------- filesystem
  const BASE_TIME = Date.UTC(2026, 9, 20, 13, 0, 0);
  function mkDir(mtime) { return { type: 'dir', children: Object.create(null), mode: 0o755, mtime: mtime || Date.now() }; }
  function mkFile(content, mtime) { return { type: 'file', content: content || '', mode: 0o644, mtime: mtime || Date.now() }; }

  class VFS {
    constructor() { this.root = mkDir(BASE_TIME); }
    static fromSpec(spec) {
      // spec: { "/abs/path": "content" | {dir:true} | {content, mode, mtime} }
      const fs = new VFS();
      let k = 0;
      for (const p of Object.keys(spec)) {
        const v = spec[p];
        const t = BASE_TIME + (k++) * 61000;
        if (v && typeof v === 'object' && v.dir) fs.mkdirp(p, t);
        else {
          const content = typeof v === 'string' ? v : v.content;
          fs.mkdirp(p.replace(/\/[^/]*$/, '') || '/', t);
          const node = mkFile(content, (v && v.mtime) || t);
          if (v && v.mode) node.mode = v.mode;
          fs.parentDir(p).children[p.split('/').pop()] = node;
        }
      }
      return fs;
    }
    clone() {
      const c = new VFS();
      const copy = (n) => {
        if (n.type === 'file') return { type: 'file', content: n.content, mode: n.mode, mtime: n.mtime };
        const d = { type: 'dir', children: Object.create(null), mode: n.mode, mtime: n.mtime };
        for (const k of Object.keys(n.children)) d.children[k] = copy(n.children[k]);
        return d;
      };
      c.root = copy(this.root);
      return c;
    }
    static norm(path, cwd) {
      if (!path.startsWith('/')) path = (cwd === '/' ? '' : cwd) + '/' + path;
      const parts = [];
      for (const p of path.split('/')) {
        if (!p || p === '.') continue;
        if (p === '..') { parts.pop(); continue; }
        parts.push(p);
      }
      return '/' + parts.join('/');
    }
    get(abs) {
      if (abs === '/') return this.root;
      let n = this.root;
      for (const p of abs.slice(1).split('/')) {
        if (!n || n.type !== 'dir') return null;
        n = n.children[p];
      }
      return n || null;
    }
    parentDir(abs) { const p = abs.replace(/\/[^/]*$/, '') || '/'; const n = this.get(p); return n && n.type === 'dir' ? n : null; }
    mkdirp(abs, t) {
      let n = this.root;
      if (abs === '/') return n;
      for (const p of abs.slice(1).split('/')) {
        if (!n.children[p]) n.children[p] = mkDir(t);
        n = n.children[p];
        if (n.type !== 'dir') return null;
      }
      return n;
    }
  }

  // ------------------------------------------------------------------- lexer
  const META = ' \t\n;&|<>()';
  function skipQuoteDouble(src, i) { // i just after opening "
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '(') { i = skipParens(src, i + 1); continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i = skipBraces(src, i + 1); continue; }
      if (src[i] === '`') { i = skipBacktick(src, i + 1); continue; }
      i++;
    }
    if (i >= src.length) throw new SyntaxErr('unexpected EOF while looking for matching `"\'');
    return i + 1;
  }
  function skipBacktick(src, i) {
    while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
    if (i >= src.length) throw new SyntaxErr('unexpected EOF while looking for matching ``\'');
    return i + 1;
  }
  function skipParens(src, i) { // src[i] === '('
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === "'") { const k = src.indexOf("'", i + 1); if (k < 0) throw new SyntaxErr("unexpected EOF while looking for matching `''"); i = k + 1; continue; }
      if (c === '"') { i = skipQuoteDouble(src, i + 1); continue; }
      if (c === '`') { i = skipBacktick(src, i + 1); continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    throw new SyntaxErr("unexpected EOF while looking for matching `)'");
  }
  function skipBraces(src, i) { // src[i] === '{'
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === "'") { const k = src.indexOf("'", i + 1); i = k < 0 ? src.length : k + 1; continue; }
      if (c === '"') { i = skipQuoteDouble(src, i + 1); continue; }
      if (c === '$' && src[i + 1] === '(') { i = skipParens(src, i + 1); continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    throw new SyntaxErr("unexpected EOF while looking for matching `}'");
  }
  function scanWord(src, i) {
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '(' && src[i - 1] === '=' && i > start) { i = skipParens(src, i); continue; }
      if (META.includes(c)) break;
      if (c === '\\') { i += 2; continue; }
      if (c === "'") { const k = src.indexOf("'", i + 1); if (k < 0) throw new SyntaxErr("unexpected EOF while looking for matching `''"); i = k + 1; continue; }
      if (c === '"') { i = skipQuoteDouble(src, i + 1); continue; }
      if (c === '`') { i = skipBacktick(src, i + 1); continue; }
      if (c === '$' && src[i + 1] === '(') { i = skipParens(src, i + 1); continue; }
      if (c === '$' && src[i + 1] === '{') { i = skipBraces(src, i + 1); continue; }
      i++;
    }
    return Math.min(i, src.length);
  }

  const OPS = ['&&', '||', ';;', '&>>', '&>', '>>', '>|', '>&', '<&', '<<<', '<<-', '<<', '<>', '|&', '|', '&', ';', '(', ')', '<', '>'];
  function lex(src) {
    const toks = [];
    const pendingHeredocs = [];
    let i = 0;
    const n = src.length;
    // true when the next word would be a command name (so (( and [[ are keywords)
    const atCmd = () => {
      const p = toks[toks.length - 1];
      if (!p || p.t === 'nl') return true;
      if (p.t === 'op') return !['>', '>>', '<', '>|', '>&', '<&', '&>', '&>>', '<<<', '<>'].includes(p.v);
      if (p.t === 'word') {
        if (['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', 'for', 'time'].includes(p.v)) {
          const q = toks[toks.length - 2];
          return !q || q.t !== 'word' || ['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', 'time'].includes(q.v) || (q.t === 'op');
        }
        return false;
      }
      return false;
    };
    const prevIsWordish = () => !atCmd();
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '\n') {
        toks.push({ t: 'nl' });
        i++;
        for (const h of pendingHeredocs) {
          const lines = [];
          let found = false;
          while (i < n) {
            let k = src.indexOf('\n', i);
            if (k < 0) k = n;
            let line = src.slice(i, k);
            i = k + 1;
            if (h.strip) line = line.replace(/^\t+/, '');
            if (line === h.delim) { found = true; break; }
            lines.push(line);
          }
          h.tok.body = lines.length ? lines.join('\n') + '\n' : '';
          if (!found) h.tok.unterminated = true;
        }
        pendingHeredocs.length = 0;
        continue;
      }
      // arithmetic command (( ... ))
      if (c === '(' && src[i + 1] === '(' && !prevIsWordish()) {
        let depth = 0, j = i;
        for (; j < n; j++) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')') { depth--; if (depth === 0) break; }
        }
        if (src[j] === ')' && src[j - 1] === ')') {
          toks.push({ t: 'arith', v: src.slice(i + 2, j - 1) });
          i = j + 1;
          continue;
        }
      }
      // fd-prefixed redirection, e.g. 2> 2>> 2>&1
      const fdm = /^(\d)(>>|>&|<&|>|<)/.exec(src.slice(i, i + 4));
      if (fdm) {
        toks.push({ t: 'op', v: fdm[2], fd: +fdm[1] });
        i += fdm[0].length;
        continue;
      }
      if ((c === '<' || c === '>') && src[i + 1] === '(') {
        const end = skipParens(src, i + 1);
        const e2 = scanWord(src, end);
        toks.push({ t: 'word', v: src.slice(i, e2) });
        i = e2;
        continue;
      }
      const op = OPS.find(o => src.startsWith(o, i));
      if (op) {
        i += op.length;
        if (op === '<<' || op === '<<-') {
          while (src[i] === ' ' || src[i] === '\t') i++;
          const e = scanWord(src, i);
          const raw = src.slice(i, e);
          i = e;
          if (!raw) throw new SyntaxErr("syntax error near unexpected token `newline'");
          const quoted = /['"\\]/.test(raw);
          const delim = raw.replace(/['"\\]/g, '');
          const tok = { t: 'heredoc', strip: op === '<<-', quoted, delim, body: '' };
          toks.push(tok);
          pendingHeredocs.push({ tok, delim, strip: op === '<<-' });
          continue;
        }
        toks.push({ t: 'op', v: op });
        continue;
      }
      const e = scanWord(src, i);
      const raw = src.slice(i, e);
      i = e;
      if (raw === '[[' && !prevIsWordish()) {
        // capture the raw conditional expression up to the matching ]]
        let j = i, inS = false, inD = false;
        for (; j < n; j++) {
          const ch = src[j];
          if (ch === '\\' && !inS) { j++; continue; }
          if (ch === "'" && !inD) inS = !inS;
          else if (ch === '"' && !inS) inD = !inD;
          else if (!inS && !inD && ch === ']' && src[j + 1] === ']' && /[\s;&|)]/.test(src[j - 1] || ' ') && (j + 2 >= n || /[\s;&|)]/.test(src[j + 2]))) break;
        }
        if (j >= n) throw new SyntaxErr("unexpected EOF while looking for `]]'");
        toks.push({ t: 'dbracket', v: src.slice(i, j) });
        i = j + 2;
        continue;
      }
      toks.push({ t: 'word', v: raw });
    }
    if (pendingHeredocs.length) {
      for (const h of pendingHeredocs) { h.tok.body = ''; h.tok.unterminated = true; }
    }
    toks.push({ t: 'eof' });
    return toks;
  }

  // ------------------------------------------------------------------ parser
  const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', '{', '}', '!', 'select']);
  const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+?)=/;

  class Parser {
    constructor(toks) { this.t = toks; this.i = 0; }
    peek(o = 0) { return this.t[this.i + o]; }
    next() { return this.t[this.i++]; }
    isWord(v, o = 0) { const k = this.peek(o); return k && k.t === 'word' && k.v === v; }
    isOp(v, o = 0) { const k = this.peek(o); return k && k.t === 'op' && k.v === v; }
    fail(k) {
      k = k || this.peek();
      const s = !k || k.t === 'eof' ? 'end of file' : k.t === 'nl' ? 'newline' : k.v;
      if (!k || k.t === 'eof') throw new SyntaxErr('syntax error: unexpected end of file');
      throw new SyntaxErr(`syntax error near unexpected token \`${s}'`);
    }
    skipNL() { while (this.peek().t === 'nl') this.i++; }
    expectWord(v) { if (!this.isWord(v)) this.fail(); this.i++; }
    program() {
      const l = this.list(() => false);
      if (this.peek().t !== 'eof') this.fail();
      return l;
    }
    atStop(stops) {
      const k = this.peek();
      if (k.t === 'eof') return true;
      if (k.t === 'word' && stops.includes(k.v)) return true;
      if (k.t === 'op' && (k.v === ')' || k.v === ';;') && stops.includes(k.v)) return true;
      return false;
    }
    list(stopFn, stops = []) {
      const items = [];
      const sep = () => { while (this.peek().t === 'nl' || this.isOp(';') || this.isOp('&')) this.i++; };
      this.skipNL();
      while (this.peek().t !== 'eof' && !this.atStop(stops)) {
        if (this.isOp(';') || this.isOp('&')) this.fail();
        items.push(this.andOr());
        const k = this.peek();
        if (k.t === 'nl' || (k.t === 'op' && (k.v === ';' || k.v === '&'))) sep();
        else break;
      }
      return { type: 'list', items };
    }
    andOr() {
      const first = this.pipeline();
      const rest = [];
      while (this.isOp('&&') || this.isOp('||')) {
        const op = this.next().v;
        this.skipNL();
        rest.push({ op, p: this.pipeline() });
      }
      return rest.length ? { type: 'andor', first, rest } : first;
    }
    pipeline() {
      let neg = false;
      if (this.isWord('!')) { this.i++; neg = true; }
      const cmds = [this.command()];
      while (this.isOp('|') || this.isOp('|&')) {
        const op = this.next().v;
        if (op === '|&') cmds[cmds.length - 1].mergeErr = true;
        this.skipNL();
        cmds.push(this.command());
      }
      if (cmds.length === 1 && !neg) return cmds[0];
      return { type: 'pipeline', cmds, neg };
    }
    redirects(node) {
      node.redirs = node.redirs || [];
      while (this.isRedir()) node.redirs.push(this.redirect());
      return node;
    }
    isRedir() {
      const k = this.peek();
      return k.t === 'heredoc' || (k.t === 'op' && ['>', '>>', '<', '>|', '>&', '<&', '&>', '&>>', '<<<', '<>'].includes(k.v));
    }
    redirect() {
      const k = this.next();
      if (k.t === 'heredoc') return { op: '<<', fd: 0, heredoc: k };
      const t = this.next();
      if (!t || t.t !== 'word') this.fail(t);
      const fd = k.fd !== undefined ? k.fd : (k.v[0] === '<' ? 0 : 1);
      return { op: k.v, fd, target: t.v };
    }
    command() {
      const k = this.peek();
      if (k.t === 'word') {
        switch (k.v) {
          case 'if': return this.redirects(this.ifCmd());
          case 'for': return this.redirects(this.forCmd());
          case 'while': case 'until': return this.redirects(this.whileCmd());
          case 'case': return this.redirects(this.caseCmd());
          case '{': { this.i++; const body = this.list(null, ['}']); this.expectWord('}'); return this.redirects({ type: 'group', body }); }
          case 'function': {
            this.i++;
            const name = this.next();
            if (name.t !== 'word') this.fail(name);
            if (this.isOp('(') && this.isOp(')', 1)) this.i += 2;
            this.skipNL();
            return { type: 'funcdef', name: name.v, body: this.command() };
          }
          case 'then': case 'elif': case 'else': case 'fi': case 'do': case 'done': case 'esac': case '}': case 'in':
            this.fail(k);
        }
        if (this.isOp('(', 1) && this.isOp(')', 2) && /^[A-Za-z_][\w.-]*$/.test(k.v)) {
          this.i += 3;
          this.skipNL();
          return { type: 'funcdef', name: k.v, body: this.command() };
        }
      }
      if (k.t === 'op' && k.v === '(') {
        this.i++;
        const body = this.list(null, [')']);
        if (!this.isOp(')')) this.fail();
        this.i++;
        return this.redirects({ type: 'subshell', body });
      }
      if (k.t === 'arith') { this.i++; return this.redirects({ type: 'arith', expr: k.v }); }
      if (k.t === 'dbracket') { this.i++; return this.redirects({ type: 'cond', raw: k.v }); }
      return this.simple();
    }
    simple() {
      const node = { type: 'simple', assigns: [], words: [], redirs: [] };
      for (;;) {
        const k = this.peek();
        if (this.isRedir()) { node.redirs.push(this.redirect()); continue; }
        if (k.t !== 'word') break;
        if (!node.words.length && ASSIGN_RE.test(k.v)) { node.assigns.push(k.v); this.i++; continue; }
        node.words.push(k.v);
        this.i++;
      }
      if (!node.words.length && !node.assigns.length && !node.redirs.length) this.fail();
      return node;
    }
    ifCmd() {
      this.i++;
      const clauses = [];
      const cond = this.list(null, ['then']);
      this.expectWord('then');
      const body = this.list(null, ['elif', 'else', 'fi']);
      clauses.push({ cond, body });
      let els = null;
      for (;;) {
        if (this.isWord('elif')) {
          this.i++;
          const c = this.list(null, ['then']); this.expectWord('then');
          clauses.push({ cond: c, body: this.list(null, ['elif', 'else', 'fi']) });
          continue;
        }
        if (this.isWord('else')) { this.i++; els = this.list(null, ['fi']); }
        this.expectWord('fi');
        break;
      }
      return { type: 'if', clauses, els };
    }
    doGroup() {
      this.skipNL();
      this.expectWord('do');
      const body = this.list(null, ['done']);
      this.expectWord('done');
      return body;
    }
    forCmd() {
      this.i++;
      if (this.peek().t === 'arith') {
        const expr = this.next().v;
        const parts = expr.split(';');
        if (parts.length !== 3) throw new SyntaxErr('syntax error: arithmetic for loop needs three expressions');
        if (this.isOp(';')) this.i++;
        this.skipNL();
        if (this.isWord('{')) { this.i++; const body = this.list(null, ['}']); this.expectWord('}'); return { type: 'cfor', init: parts[0], cond: parts[1], step: parts[2], body }; }
        return { type: 'cfor', init: parts[0], cond: parts[1], step: parts[2], body: this.doGroup() };
      }
      const name = this.next();
      if (!name || name.t !== 'word' || !/^[A-Za-z_]\w*$/.test(name.v)) throw new SyntaxErr(`\`${name && name.v}': not a valid identifier`);
      let words = null;
      this.skipNL();
      if (this.isWord('in')) {
        this.i++;
        words = [];
        while (this.peek().t === 'word') words.push(this.next().v);
      }
      if (this.isOp(';')) this.i++;
      return { type: 'for', name: name.v, words, body: this.doGroup() };
    }
    whileCmd() {
      const until = this.next().v === 'until';
      const cond = this.list(null, ['do']);
      return { type: 'while', until, cond, body: this.doGroup() };
    }
    caseCmd() {
      this.i++;
      const w = this.next();
      if (!w || w.t !== 'word') this.fail(w);
      this.skipNL();
      this.expectWord('in');
      this.skipNL();
      const items = [];
      while (!this.isWord('esac')) {
        if (this.peek().t === 'eof') this.fail();
        if (this.isOp('(')) this.i++;
        const pats = [];
        for (;;) {
          const p = this.next();
          if (!p || p.t !== 'word') this.fail(p);
          pats.push(p.v);
          if (this.isOp('|')) { this.i++; continue; }
          break;
        }
        if (!this.isOp(')')) this.fail();
        this.i++;
        const body = this.list(null, [';;', 'esac']);
        items.push({ pats, body });
        if (this.isOp(';;')) this.i++;
        this.skipNL();
      }
      this.i++;
      return { type: 'case', word: w.v, items };
    }
  }

  function parse(src) { return new Parser(lex(src)).program(); }
  // true when an interactive line is incomplete (open quote, block, heredoc, trailing | or &&)
  function needsMore(src) {
    try {
      const toks = lex(src);
      if (toks.some(t => t.t === 'heredoc' && t.unterminated)) return true;
      new Parser(toks).program();
      return false;
    } catch (e) {
      return e instanceof SyntaxErr && /unexpected (end of file|EOF)/.test(e.message);
    }
  }

  // ----------------------------------------------------------- arithmetic
  function arithTokens(s) {
    const toks = [];
    let i = 0;
    const ops = ['**=', '<<=', '>>=', '&&', '||', '==', '!=', '<=', '>=', '<<', '>>', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**',
      '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', '(', ')', ',', '[', ']'];
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      let m = /^(0[xX][0-9a-fA-F]+|\d+#[0-9a-zA-Z@_]+|\d+)/.exec(s.slice(i));
      if (m) {
        let v;
        const lit = m[0];
        if (/^0[xX]/.test(lit)) v = parseInt(lit, 16);
        else if (lit.includes('#')) { const [b, d] = lit.split('#'); v = parseInt(d, +b); }
        else if (lit.length > 1 && lit[0] === '0') v = parseInt(lit, 8);
        else v = parseInt(lit, 10);
        toks.push({ t: 'num', v }); i += lit.length; continue;
      }
      m = /^[A-Za-z_]\w*/.exec(s.slice(i));
      if (m) { toks.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
      const op = ops.find(o => s.startsWith(o, i));
      if (!op) throw new ShellError(`${s}: syntax error: invalid arithmetic operator (error token is "${s.slice(i)}")`);
      toks.push({ t: 'op', v: op }); i += op.length;
    }
    return toks;
  }

  class Arith {
    constructor(sh, src) { this.sh = sh; this.src = src; this.toks = arithTokens(src); this.i = 0; }
    peek() { return this.toks[this.i]; }
    isOp(v) { const k = this.peek(); return k && k.t === 'op' && k.v === v; }
    err(msg) { throw new ShellError(`${this.src.trim()}: ${msg || 'syntax error in expression'}`); }
    run() {
      if (!this.toks.length) return 0;
      const v = this.comma();
      if (this.i < this.toks.length) this.err(`syntax error: invalid arithmetic operator (error token is "${this.toks.slice(this.i).map(t => t.v).join('')}")`);
      return v;
    }
    comma() { let v = this.assign(); while (this.isOp(',')) { this.i++; v = this.assign(); } return v; }
    lvalue() {
      const k = this.peek();
      if (!k || k.t !== 'name') return null;
      const save = this.i;
      this.i++;
      let index = null;
      if (this.isOp('[')) {
        this.i++;
        const e = this.sh.lookup(k.v);
        if (e && e.v instanceof Map) {
          // associative arrays use the subscript text as a string key
          let depth = 0, key = '';
          while (this.i < this.toks.length && !(depth === 0 && this.isOp(']'))) {
            const t = this.toks[this.i++];
            if (t.v === '[') depth++; else if (t.v === ']') depth--;
            key += t.v;
          }
          index = key;
        } else index = this.comma();
        if (!this.isOp(']')) this.err();
        this.i++;
      }
      return { name: k.v, index, save };
    }
    getLv(lv) { return this.sh.arithValue(lv.name, lv.index); }
    setLv(lv, v) { this.sh.setVar(lv.name, String(v), lv.index === null ? undefined : String(lv.index)); return v; }
    assign() {
      const save = this.i;
      const lv = this.lvalue();
      if (lv) {
        const k = this.peek();
        if (k && k.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=', '**='].includes(k.v)) {
          this.i++;
          const r = this.assign();
          if (k.v === '=') return this.setLv(lv, r);
          return this.setLv(lv, this.binop(k.v.slice(0, -1), this.getLv(lv), r));
        }
      }
      this.i = save;
      return this.ternary();
    }
    ternary() {
      const c = this.lor();
      if (this.isOp('?')) {
        this.i++;
        const a = this.assign();
        if (!this.isOp(':')) this.err();
        this.i++;
        const b = this.assign();
        return c ? a : b;
      }
      return c;
    }
    lor() { let v = this.land(); while (this.isOp('||')) { this.i++; const r = this.land(); v = (v || r) ? 1 : 0; } return v; }
    land() { let v = this.bor(); while (this.isOp('&&')) { this.i++; const r = this.bor(); v = (v && r) ? 1 : 0; } return v; }
    bor() { let v = this.bxor(); while (this.isOp('|')) { this.i++; v = v | this.bxor(); } return v; }
    bxor() { let v = this.band(); while (this.isOp('^')) { this.i++; v = v ^ this.band(); } return v; }
    band() { let v = this.eq(); while (this.isOp('&')) { this.i++; v = v & this.eq(); } return v; }
    eq() { let v = this.rel(); for (;;) { if (this.isOp('==')) { this.i++; v = v === this.rel() ? 1 : 0; } else if (this.isOp('!=')) { this.i++; v = v !== this.rel() ? 1 : 0; } else return v; } }
    rel() {
      let v = this.shift();
      for (;;) {
        const k = this.peek();
        if (k && k.t === 'op' && ['<', '>', '<=', '>='].includes(k.v)) { this.i++; const r = this.shift(); v = this.binop(k.v, v, r); }
        else return v;
      }
    }
    shift() { let v = this.add(); for (;;) { if (this.isOp('<<')) { this.i++; v = v << this.add(); } else if (this.isOp('>>')) { this.i++; v = v >> this.add(); } else return v; } }
    add() { let v = this.mul(); for (;;) { if (this.isOp('+')) { this.i++; v = v + this.mul(); } else if (this.isOp('-')) { this.i++; v = v - this.mul(); } else return v; } }
    mul() {
      let v = this.pow();
      for (;;) {
        const k = this.peek();
        if (k && k.t === 'op' && ['*', '/', '%'].includes(k.v)) { this.i++; v = this.binop(k.v, v, this.pow()); }
        else return v;
      }
    }
    pow() { const b = this.unary(); if (this.isOp('**')) { this.i++; const e = this.pow(); if (e < 0) this.err('exponent less than 0'); return Math.trunc(Math.pow(b, e)); } return b; }
    unary() {
      const k = this.peek();
      if (k && k.t === 'op') {
        if (k.v === '-') { this.i++; return -this.unary(); }
        if (k.v === '+') { this.i++; return this.unary(); }
        if (k.v === '!') { this.i++; return this.unary() ? 0 : 1; }
        if (k.v === '~') { this.i++; return ~this.unary(); }
        if (k.v === '++' || k.v === '--') {
          this.i++;
          const lv = this.lvalue();
          if (!lv) this.err();
          return this.setLv(lv, this.getLv(lv) + (k.v === '++' ? 1 : -1));
        }
      }
      return this.postfix();
    }
    postfix() {
      const save = this.i;
      const lv = this.lvalue();
      if (lv) {
        if (this.isOp('++') || this.isOp('--')) {
          const d = this.peek().v === '++' ? 1 : -1; this.i++;
          const old = this.getLv(lv); this.setLv(lv, old + d); return old;
        }
        return this.getLv(lv);
      }
      this.i = save;
      return this.primary();
    }
    primary() {
      const k = this.peek();
      if (!k) this.err('syntax error: operand expected');
      if (k.t === 'num') { this.i++; return k.v; }
      if (k.t === 'op' && k.v === '(') {
        this.i++;
        const v = this.comma();
        if (!this.isOp(')')) this.err();
        this.i++;
        return v;
      }
      this.err(`syntax error: operand expected (error token is "${this.toks.slice(this.i).map(t => t.v).join(' ')}")`);
    }
    binop(op, a, b) {
      switch (op) {
        case '+': return a + b; case '-': return a - b; case '*': return Math.trunc(a * b);
        case '/': if (b === 0) this.err('division by 0 (error token is "' + b + '")'); return Math.trunc(a / b);
        case '%': if (b === 0) this.err('division by 0 (error token is "' + b + '")'); return a % b;
        case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
        case '<<': return a << b; case '>>': return a >> b; case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
        case '**': return Math.trunc(Math.pow(a, b));
      }
      this.err();
    }
  }

  // ------------------------------------------------------------ helpers
  function shQuote(s) { return /^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad2 = n => String(n).padStart(2, '0');

  // Brace expansion on a raw word: {a,b,c} and {1..5} / {a..e} / {01..10..2}
  function braceExpand(word) {
    // find first top-level unquoted { with a matching } containing , or ..
    let i = 0, inS = false, inD = false;
    for (; i < word.length; i++) {
      const c = word[i];
      if (c === '\\') { i++; continue; }
      if (c === "'" && !inD) { inS = !inS; continue; }
      if (c === '"' && !inS) { inD = !inD; continue; }
      if (inS || inD) continue;
      if (c === '$' && word[i + 1] === '{') { i = skipBraces(word, i + 1) - 1; continue; }
      if (c === '$' && word[i + 1] === '(') { i = skipParens(word, i + 1) - 1; continue; }
      if (c !== '{') continue;
      // find matching }
      let depth = 0, j = i, commas = [], qS = false, qD = false;
      for (; j < word.length; j++) {
        const d = word[j];
        if (d === '\\') { j++; continue; }
        if (d === "'" && !qD) { qS = !qS; continue; }
        if (d === '"' && !qS) { qD = !qD; continue; }
        if (qS || qD) continue;
        if (d === '{') depth++;
        else if (d === '}') { depth--; if (depth === 0) break; }
        else if (d === ',' && depth === 1) commas.push(j);
      }
      if (j >= word.length) return [word];
      const pre = word.slice(0, i), post = word.slice(j + 1), inner = word.slice(i + 1, j);
      let alts = null;
      if (commas.length) {
        alts = [];
        let last = i + 1;
        for (const c2 of commas) { alts.push(word.slice(last, c2)); last = c2 + 1; }
        alts.push(word.slice(last, j));
      } else {
        const m = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(inner) || /^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d+))?$/.exec(inner);
        if (m) {
          alts = [];
          const isNum = /\d/.test(m[1]);
          let step = Math.abs(parseInt(m[3] || '1', 10)) || 1;
          if (isNum) {
            const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
            const width = (/^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2])) ? Math.max(m[1].length, m[2].length) : 0;
            const fmt = v => width ? (v < 0 ? '-' + String(-v).padStart(width - 1, '0') : String(v).padStart(width, '0')) : String(v);
            if (a <= b) for (let v = a; v <= b; v += step) alts.push(fmt(v));
            else for (let v = a; v >= b; v -= step) alts.push(fmt(v));
          } else {
            const a = m[1].charCodeAt(0), b = m[2].charCodeAt(0);
            if (a <= b) for (let v = a; v <= b; v += step) alts.push(String.fromCharCode(v));
            else for (let v = a; v >= b; v -= step) alts.push(String.fromCharCode(v));
          }
          if (alts.length > 100000) throw new ShellError('brace expansion too large');
        }
      }
      if (!alts) {
        // not a valid brace expression; continue searching after it
        const rest = braceExpand(word.slice(i + 1));
        return rest.map(r => word.slice(0, i + 1) + r);
      }
      const out = [];
      for (const a of alts) for (const r of braceExpand(pre + a + post)) out.push(r);
      return out;
    }
    return [word];
  }

  function splitConditionRaw(raw) {
    // tokenizes the inside of [[ ]] into words and operators, keeping quotes raw
    const toks = [];
    let i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (/\s/.test(c)) { i++; continue; }
      if (raw.startsWith('&&', i) || raw.startsWith('||', i)) { toks.push({ op: raw.substr(i, 2) }); i += 2; continue; }
      if (c === '(' || c === ')') { toks.push({ op: c }); i++; continue; }
      let j = i;
      while (j < raw.length && !/\s/.test(raw[j])) {
        const d = raw[j];
        if ((d === '(' || d === ')') && j === i) break;
        if (d === ')' && !raw.slice(i, j).includes('(')) break;
        if (raw.startsWith('&&', j) || raw.startsWith('||', j)) break;
        if (d === '\\') { j += 2; continue; }
        if (d === "'") { const k = raw.indexOf("'", j + 1); j = k < 0 ? raw.length : k + 1; continue; }
        if (d === '"') { j = skipQuoteDouble(raw, j + 1); continue; }
        if (d === '$' && raw[j + 1] === '(') { j = skipParens(raw, j + 1); continue; }
        if (d === '$' && raw[j + 1] === '{') { j = skipBraces(raw, j + 1); continue; }
        j++;
      }
      toks.push({ w: raw.slice(i, j) });
      i = j;
    }
    return toks;
  }

  // ------------------------------------------------------------------ shell
  class Shell {
    constructor(opts = {}) {
      this.fs = opts.fs || new VFS();
      this.home = opts.home || '/home/student';
      this.user = opts.user || 'student';
      this.host = opts.host || 'lab';
      this.cwd = opts.cwd || this.home;
      this.fs.mkdirp(this.home, BASE_TIME);
      if (!this.fs.get('/tmp')) { const t = this.fs.mkdirp('/tmp', BASE_TIME); t.mode = 0o777; }
      this.scopes = [new Map()];
      this.funcs = new Map();
      this.pos = [];
      this.argv0 = 'bash';
      this.status = 0;
      this.steps = 0;
      this.maxSteps = opts.maxSteps || 300000;
      this.outLimit = opts.outLimit || 2e6;
      this.history = [];
      this.rand = 12345;
      this.options = { errexit: false, nounset: false, pipefail: false, xtrace: false };
      this.oldpwd = this.cwd;
      this.callDepth = 0;
      const env = Object.assign({
        HOME: this.home, USER: this.user, LOGNAME: this.user, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin',
        PWD: this.cwd, HOSTNAME: this.host, LANG: 'en_US.UTF-8', TERM: 'xterm-256color', IFS: ' \t\n'
      }, opts.env || {});
      for (const k of Object.keys(env)) this.scopes[0].set(k, { v: env[k], exported: k !== 'IFS' });
    }

    // ---------- variables ----------
    lookup(name) { for (let i = this.scopes.length - 1; i >= 0; i--) { const e = this.scopes[i].get(name); if (e) return e; } return null; }
    getVar(name) {
      switch (name) {
        case 'PWD': return this.cwd;
        case 'OLDPWD': return this.oldpwd;
        case 'RANDOM': this.rand = (this.rand * 1103515245 + 12345) & 0x7fffffff; return String(this.rand % 32768);
        case 'SECONDS': return '0';
        case 'BASHPID': return '4242';
      }
      const e = this.lookup(name);
      if (!e || e.v === undefined) return undefined;
      if (Array.isArray(e.v)) return e.v[0] === undefined ? '' : e.v[0];
      if (e.v instanceof Map) return e.v.get('0') === undefined ? '' : e.v.get('0');
      return e.v;
    }
    setVar(name, value, index, opts = {}) {
      if (!/^[A-Za-z_]\w*$/.test(name)) throw new ShellError(`\`${name}': not a valid identifier`);
      let e = this.lookup(name);
      if (e && e.readonly) throw new ShellError(`${name}: readonly variable`);
      if (!e) { e = { v: undefined }; this.scopes[opts.local ? this.scopes.length - 1 : 0].set(name, e); }
      if (name === 'PWD') { this.cwd = value; }
      if (e.integer && index === undefined && !Array.isArray(value)) value = String(this.arith(String(value)));
      if (index !== undefined) {
        if (e.v instanceof Map) { e.v.set(index, value); return; }
        if (!Array.isArray(e.v)) e.v = e.v === undefined ? [] : [e.v];
        let k = parseInt(index, 10);
        if (isNaN(k)) k = this.arith(index);
        if (k < 0) k = e.v.length + k;
        e.v[k] = value;
        return;
      }
      if (e.v instanceof Map && !(value instanceof Map)) { e.v.set('0', value); return; }
      if (Array.isArray(e.v) && !Array.isArray(value)) { e.v[0] = value; return; }
      e.v = value;
    }
    unsetVar(name) { for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) { const e = this.scopes[i].get(name); if (e.readonly) throw new ShellError(`unset: ${name}: cannot unset: readonly variable`); this.scopes[i].delete(name); return; } }
    arithValue(name, index) {
      let v;
      if (index !== null && index !== undefined) {
        const e = this.lookup(name);
        if (e && Array.isArray(e.v)) v = e.v[index < 0 ? e.v.length + index : index];
        else if (e && e.v instanceof Map) v = e.v.get(String(index));
        else if (index === 0 && e) v = e.v;
      } else v = this.getVar(name);
      if (v === undefined || v === '') {
        if (this.options.nounset && v === undefined) throw new ShellError(`${name}: unbound variable`);
        return 0;
      }
      v = String(v).trim();
      if (/^-?\d+$/.test(v)) return parseInt(v, 10);
      if (this._arithDepth > 20) throw new ShellError(`${v}: expression recursion level exceeded`);
      this._arithDepth = (this._arithDepth || 0) + 1;
      try { return this.arith(v); } finally { this._arithDepth--; }
    }
    arith(expr, io) {
      const expanded = this.expandString(expr, io || this.curIO, { arith: true });
      return new Arith(this, expanded).run();
    }

    // ---------- filesystem helpers used by commands ----------
    abs(p) { if (p === '~') return this.home; if (p.startsWith('~/')) p = this.home + p.slice(1); return VFS.norm(p, this.cwd); }
    readFile(p) { const n = this.fs.get(this.abs(p)); return n && n.type === 'file' ? n.content : null; }
    fileError(p) { const n = this.fs.get(this.abs(p)); if (n && n.type === 'dir') return 'Is a directory'; const parent = this.fs.parentDir(this.abs(p)); if (!parent && this.fs.get(this.abs(p).replace(/\/[^/]*$/, '') || '/')) return 'Not a directory'; return 'No such file or directory'; }
    writeFile(p, content, append) {
      const a = this.abs(p);
      if (a === '/dev/null') return true;
      const dir = this.fs.parentDir(a);
      if (!dir) throw new ShellError(`${p}: No such file or directory`);
      const name = a.split('/').pop();
      let node = dir.children[name];
      if (node && node.type === 'dir') throw new ShellError(`${p}: Is a directory`);
      if (!node) { node = mkFile(''); dir.children[name] = node; }
      node.content = append ? node.content + content : content;
      node.mtime = Date.now();
      return true;
    }
    openWriter(p, append, io) {
      const a = this.abs(p);
      if (a === '/dev/null') return () => {};
      if (a === '/dev/stdout') return io.out;
      if (a === '/dev/stderr') return io.err;
      const dir = this.fs.parentDir(a);
      if (!dir) throw new ShellError(`${p}: No such file or directory`);
      const name = a.split('/').pop();
      let node = dir.children[name];
      if (node && node.type === 'dir') throw new ShellError(`${p}: Is a directory`);
      if (!node) { node = mkFile(''); dir.children[name] = node; }
      if (!append) node.content = '';
      node.mtime = Date.now();
      return s => { node.content += s; };
    }

    // ---------- expansion ----------
    // Turns a raw word into pieces: {s, k} where k is 'lit' (unquoted literal),
    // 'exp' (unquoted expansion result) or 'q' (quoted); {brk:true} splits fields.
    pieces(raw, io, mode) {
      const out = [];
      let i = 0;
      const n = raw.length;
      const inDq = mode === 'dq' || mode === 'heredoc';
      const push = (s, k) => out.push({ s, k });
      while (i < n) {
        const c = raw[i];
        if (c === '\\') {
          if (inDq) {
            const d = raw[i + 1];
            if (d !== undefined && ('$`\\\n'.includes(d) || (d === '"' && mode === 'dq'))) { if (d !== '\n') push(d, 'q'); i += 2; continue; }
            push('\\', 'q'); i++; continue;
          }
          if (i + 1 < n) { if (raw[i + 1] !== '\n') push(raw[i + 1], 'q'); i += 2; continue; }
          push('\\', 'q'); i++; continue;
        }
        if (c === "'" && !inDq) {
          const k = raw.indexOf("'", i + 1);
          push(raw.slice(i + 1, k < 0 ? n : k), 'q');
          i = k < 0 ? n : k + 1;
          continue;
        }
        if (c === '$' && raw[i + 1] === "'" && !inDq) {
          // ANSI-C quoting $'...'
          let j = i + 2, s = '';
          while (j < n && raw[j] !== "'") { if (raw[j] === '\\') { s += raw[j] + raw[j + 1]; j += 2; continue; } s += raw[j++]; }
          push(MB.backslashEscapes(s.replace(/\\'/g, "'"), { octalNoZero: true }), 'q');
          i = j + 1;
          continue;
        }
        if (c === '"' && !inDq) {
          const end = skipQuoteDouble(raw, i + 1);
          const inner = this.pieces(raw.slice(i + 1, end - 1), io, 'dq');
          if (!inner.length) push('', 'q');
          for (const p of inner) out.push(p);
          i = end;
          continue;
        }
        if ((c === '<' || c === '>') && raw[i + 1] === '(' && !inDq) {
          const end = skipParens(raw, i + 1);
          const data = this.commandSub(raw.slice(i + 2, end - 1), io) ;
          this.fs.mkdirp('/dev/fd');
          const path = '/dev/fd/' + (63 + (this.psub = (this.psub || 0) + 1) % 100);
          this.writeFile(path, data ? data + '\n' : '', false);
          push(path, 'q');
          i = end;
          continue;
        }
        if (c === '`') {
          const end = skipBacktick(raw, i + 1);
          const cmd = raw.slice(i + 1, end - 1).replace(/\\([`$\\])/g, '$1');
          push(this.commandSub(cmd, io), inDq ? 'q' : 'exp');
          i = end;
          continue;
        }
        if (c === '$') {
          const d = raw[i + 1];
          if (d === '(' && raw[i + 2] === '(') {
            // could be $(( arith )) or $( (subshell) )
            const end = skipParens(raw, i + 1);
            const inner = raw.slice(i + 3, end - 2);
            if (raw[end - 2] === ')') {
              push(String(this.arith(inner, io)), inDq ? 'q' : 'exp');
              i = end;
              continue;
            }
          }
          if (d === '(') {
            const end = skipParens(raw, i + 1);
            push(this.commandSub(raw.slice(i + 2, end - 1), io), inDq ? 'q' : 'exp');
            i = end;
            continue;
          }
          if (d === '{') {
            const end = skipBraces(raw, i + 1);
            const r = this.paramExpand(raw.slice(i + 2, end - 1), io, inDq);
            this.emitParam(r, out, inDq);
            i = end;
            continue;
          }
          if (d === '@' || d === '*') {
            this.emitParam({ list: this.pos.slice(), star: d === '*' }, out, inDq);
            i += 2;
            continue;
          }
          const m = /^([A-Za-z_]\w*|[0-9]|[#?$!\-])/.exec(raw.slice(i + 1));
          if (m) {
            const v = this.simpleParam(m[1]);
            push(v, inDq ? 'q' : 'exp');
            i += 1 + m[1].length;
            continue;
          }
          push('$', inDq ? 'q' : 'lit');
          i++;
          continue;
        }
        if (c === '~' && i === 0 && mode === 'word') {
          const m = /^~([A-Za-z_]*)(?=\/|$|:)/.exec(raw);
          if (m) {
            push(m[1] ? (m[1] === this.user ? this.home : '/home/' + m[1]) : (this.getVar('HOME') || this.home), 'q');
            i += m[0].length;
            continue;
          }
        }
        if (mode === 'assign' && c === '~' && (raw[i - 1] === ':' || raw[i - 1] === '=') && (raw[i + 1] === '/' || raw[i + 1] === undefined || raw[i + 1] === ':')) {
          push(this.home, 'q'); i++; continue;
        }
        push(c, inDq ? 'q' : 'lit');
        i++;
      }
      return out;
    }
    emitParam(r, out, inDq) {
      if (r.list) {
        if (r.star) {
          const sep = (this.getVar('IFS') ?? ' \t\n')[0] || '';
          out.push({ s: r.list.join(inDq ? sep : ' '), k: inDq ? 'q' : 'exp' });
          return;
        }
        r.list.forEach((v, idx) => {
          if (idx > 0) out.push({ brk: true });
          out.push({ s: v, k: inDq ? 'q' : 'exp' });
        });
        if (!r.list.length && inDq) out.push({ empty: true });
        return;
      }
      out.push({ s: r.s, k: inDq ? 'q' : 'exp' });
    }
    simpleParam(name) {
      switch (name) {
        case '#': return String(this.pos.length);
        case '?': return String(this.status);
        case '$': return '4242';
        case '!': return '';
        case '-': return 'hB';
        case '0': return this.argv0;
      }
      if (/^\d+$/.test(name)) {
        const v = this.pos[+name - 1];
        if (v === undefined && this.options.nounset) throw new ShellError(`$${name}: unbound variable`);
        return v === undefined ? '' : v;
      }
      const v = this.getVar(name);
      if (v === undefined && this.options.nounset) throw new ShellError(`${name}: unbound variable`);
      return v === undefined ? '' : v;
    }
    arrayValues(name) {
      if (name === '@' || name === '*') return this.pos.slice();
      const e = this.lookup(name);
      if (!e || e.v === undefined) return [];
      if (Array.isArray(e.v)) return e.v.filter(x => x !== undefined);
      if (e.v instanceof Map) return [...e.v.values()];
      return [e.v];
    }
    arrayKeys(name) {
      const e = this.lookup(name);
      if (!e || e.v === undefined) return [];
      if (Array.isArray(e.v)) return e.v.map((x, i) => x === undefined ? null : String(i)).filter(x => x !== null);
      if (e.v instanceof Map) return [...e.v.keys()];
      return ['0'];
    }
    expandString(raw, io, opts = {}) {
      // expands $, `, quotes and escapes without splitting/globbing
      const mode = opts.heredoc ? 'heredoc' : opts.arith ? 'dq' : (opts.mode || 'word');
      return this.pieces(raw, io, mode).map(p => p.brk ? ' ' : (p.s || '')).join('');
    }
    expandPattern(raw, io) {
      // like expandString but quoted characters are escaped for glob matching
      return this.pieces(raw, io, 'word').map(p => p.brk ? ' ' : p.k === 'q' ? (p.s || '').replace(/[\\*?[\]!^-]/g, '\\$&') : (p.s || '')).join('');
    }
    paramExpand(body, io, inDq) {
      // ${#name} ${#arr[@]}
      let m;
      if (body === '#') return { s: String(this.pos.length) };
      if ((m = /^#([A-Za-z_]\w*|\d+|[@*])(?:\[([@*])\])?$/.exec(body))) {
        if (m[2] || m[1] === '@' || m[1] === '*') return { s: String(this.arrayValues(m[1]).length) };
        return { s: String(this.simpleParam(m[1]).length) };
      }
      if ((m = /^#([A-Za-z_]\w*)\[(.+)\]$/.exec(body))) {
        return { s: String(this.indexValue(m[1], m[2], io).length) };
      }
      if ((m = /^!([A-Za-z_]\w*)\[([@*])\]$/.exec(body))) return { list: this.arrayKeys(m[1]), star: m[2] === '*' };
      if ((m = /^!([A-Za-z_]\w*)$/.exec(body))) { const target = this.getVar(m[1]) || ''; return { s: /^[A-Za-z_]\w*$|^\d+$/.test(target) ? this.simpleParam(target) : '' }; }
      m = /^([A-Za-z_]\w*|\d+|[@*#?$!0-])(?:\[([^\]]*)\])?/.exec(body);
      if (!m) throw new ShellError(`\${${body}}: bad substitution`);
      const name = m[1], idx = m[2];
      const rest = body.slice(m[0].length);
      let isList = false, star = false, val, list, isSet;
      if (idx === '@' || idx === '*' || ((name === '@' || name === '*') && idx === undefined)) {
        isList = true; star = idx === '*' || name === '*';
        list = this.arrayValues(name);
        isSet = list.length > 0;
      } else if (idx !== undefined) {
        val = this.indexValue(name, idx, io, true);
        isSet = val !== undefined;
        if (val === undefined) val = '';
      } else {
        if (/^\d+$/.test(name)) { isSet = +name === 0 || this.pos[+name - 1] !== undefined; val = +name === 0 ? this.argv0 : (this.pos[+name - 1] ?? ''); }
        else if ('#?$!-'.includes(name)) { isSet = true; val = this.simpleParam(name); }
        else { const v = this.getVar(name); isSet = v !== undefined; val = v === undefined ? '' : v; }
      }
      if (!rest) {
        if (!isSet && this.options.nounset && !isList) throw new ShellError(`${name}: unbound variable`);
        return isList ? { list, star } : { s: val };
      }
      const word = (w) => this.expandString(w, io, { mode: inDq ? 'dq' : 'word' });
      let op;
      if ((op = /^(:?)([-=+?])([\s\S]*)$/.exec(rest))) {
        const colon = op[1] === ':', kind = op[2], arg = op[3];
        const empty = isList ? list.length === 0 : (!isSet || (colon && val === ''));
        switch (kind) {
          case '-': return empty ? { s: word(arg) } : (isList ? { list, star } : { s: val });
          case '=': if (empty) { const w = word(arg); this.setVar(name, w); return { s: w }; } return { s: val };
          case '+': return empty ? { s: '' } : { s: word(arg) };
          case '?': if (empty) throw new ShellError(`${name}: ${arg ? word(arg) : 'parameter null or not set'}`); return { s: val };
        }
      }
      const apply = (fn) => isList ? { list: list.map(fn), star } : { s: fn(val) };
      if ((op = /^(##?|%%?)([\s\S]*)$/.exec(rest))) {
        const pat = this.expandPattern(op[2], io);
        return apply(v => MB.trimPattern(v, pat, op[1]));
      }
      if ((op = /^\/([#%/]?)((?:\\.|[^/])*)(?:\/([\s\S]*))?$/.exec(rest))) {
        const pat = this.expandPattern(op[2], io);
        const rep = op[3] === undefined ? '' : word(op[3]);
        const mode = op[1] === '/' ? '//' : op[1] === '#' ? '/#' : op[1] === '%' ? '/%' : '/';
        return apply(v => MB.replacePattern(v, pat, rep, mode));
      }
      if ((op = /^(\^\^?|,,?)([\s\S]*)$/.exec(rest))) {
        const all = op[1].length === 2, up = op[1][0] === '^';
        return apply(v => all ? (up ? v.toUpperCase() : v.toLowerCase()) : (v ? (up ? v[0].toUpperCase() : v[0].toLowerCase()) + v.slice(1) : v));
      }
      if ((op = /^:([^:]*)(?::([\s\S]*))?$/.exec(rest))) {
        const off = this.arith(op[1] || '0', io);
        const len = op[2] === undefined ? undefined : this.arith(op[2], io);
        if (isList) {
          let start = off < 0 ? Math.max(0, list.length + off) : off;
          let sub = list.slice(start);
          if (len !== undefined) sub = sub.slice(0, len);
          return { list: sub, star };
        }
        let start = off < 0 ? Math.max(0, val.length + off) : off;
        if (len === undefined) return { s: val.slice(start) };
        const end = len < 0 ? val.length + len : start + len;
        if (end < start) throw new ShellError(`${len}: substring expression < 0`);
        return { s: val.slice(start, end) };
      }
      throw new ShellError(`\${${body}}: bad substitution`);
    }
    indexValue(name, idx, io, raw) {
      const e = this.lookup(name);
      if (!e || e.v === undefined) return raw ? undefined : '';
      if (e.v instanceof Map) { const k = this.expandString(idx, io); const v = e.v.get(k); return v === undefined && raw ? undefined : (v ?? ''); }
      let k = this.arith(idx, io);
      if (Array.isArray(e.v)) { if (k < 0) k = e.v.length + k; const v = e.v[k]; return v === undefined && raw ? undefined : (v ?? ''); }
      return k === 0 ? e.v : (raw ? undefined : '');
    }
    commandSub(src, io) {
      let buf = '';
      const sub = { stdin: io ? io.stdin : new Stream(''), out: s => { buf += s; }, err: io ? io.err : () => {}, tty: false };
      this.subshell(() => {
        try { this.status = this.execSource(src, sub); }
        catch (e) { if (e instanceof ExitSig) this.status = e.code; else throw e; }
      }, true);
      return buf.replace(/\n+$/, '');
    }
    // Full word expansion: brace -> pieces -> field splitting -> globbing
    expandWords(words, io) {
      const out = [];
      for (const w of words) for (const b of braceExpand(w)) this.expandOne(b, io, out);
      return out;
    }
    expandOne(raw, io, out, noGlob) {
      const ps = this.pieces(raw, io, 'word');
      const ifs = this.getVar('IFS') ?? ' \t\n';
      const fields = [];
      let cur = null;
      const start = () => { if (!cur) cur = { text: '', pat: '', glob: false, real: false }; };
      const finish = () => { if (cur && (cur.real || cur.text !== '')) fields.push(cur); cur = null; };
      for (const p of ps) {
        if (p.brk) { finish(); start(); cur.real = true; continue; }
        if (p.empty) continue;
        if (p.k === 'q') { start(); cur.text += p.s; cur.pat += p.s.replace(/[\\*?[\]]/g, '\\$&'); cur.real = true; continue; }
        if (p.k === 'lit') {
          start(); cur.text += p.s; cur.pat += p.s;
          if (/[*?[]/.test(p.s)) cur.glob = true;
          continue;
        }
        // unquoted expansion: split on IFS
        for (const ch of p.s) {
          if (ifs.includes(ch)) {
            if (/\s/.test(ch)) { finish(); }
            else { start(); cur.real = true; finish(); start(); }
            continue;
          }
          start();
          cur.text += ch; cur.pat += ch;
          if ('*?['.includes(ch)) cur.glob = true;
        }
      }
      finish();
      for (const f of fields) {
        if (f.glob && !noGlob && !this.options.noglob) {
          const matches = this.glob(f.pat);
          if (matches.length) { out.push(...matches); continue; }
        }
        out.push(f.text);
      }
    }
    glob(pat) {
      const absolute = pat.startsWith('/');
      const parts = pat.split('/').filter((x, i) => x !== '' || i === 0);
      let results = [{ path: absolute ? '/' : '', node: absolute ? this.fs.root : this.fs.get(this.cwd) }];
      const comps = absolute ? parts.slice(1) : parts;
      comps.forEach((comp, ci) => {
        const last = ci === comps.length - 1;
        const next = [];
        for (const r of results) {
          if (!r.node || r.node.type !== 'dir') continue;
          if (!MB.hasGlobChars(comp)) {
            const name = MB.unescapeGlob(comp);
            const child = name === '..' || name === '.' ? this.fs.get(VFS.norm((r.path || '.') + '/' + name, this.cwd)) : r.node.children[name];
            if (child && (last || child.type === 'dir')) next.push({ path: r.path === '' ? name : (r.path === '/' ? '/' + name : r.path + '/' + name), node: child });
            continue;
          }
          const names = Object.keys(r.node.children).sort(nameCompare);
          for (const name of names) {
            if (name.startsWith('.') && !comp.startsWith('.') && !comp.startsWith('\\.')) continue;
            if (!MB.globMatch(comp, name)) continue;
            const child = r.node.children[name];
            if (!last && child.type !== 'dir') continue;
            next.push({ path: r.path === '' ? name : (r.path === '/' ? '/' + name : r.path + '/' + name), node: child });
          }
        }
        results = next;
      });
      if (pat.endsWith('/')) return results.filter(r => r.node.type === 'dir').map(r => r.path + '/');
      return results.map(r => r.path);
    }

    // ---------- execution ----------
    tick() {
      if (++this.steps > this.maxSteps) throw new LimitError('execution limit reached — is there an infinite loop?');
    }
    subshell(fn, keepStatus) {
      const saved = {
        scopes: this.scopes.map(m => { const c = new Map(); for (const [k, e] of m) c.set(k, Object.assign({}, e, { v: Array.isArray(e.v) ? e.v.slice() : e.v instanceof Map ? new Map(e.v) : e.v })); return c; }),
        funcs: new Map(this.funcs), cwd: this.cwd, oldpwd: this.oldpwd, pos: this.pos.slice(), argv0: this.argv0, options: Object.assign({}, this.options)
      };
      const status = this.status;
      try { return fn(); }
      finally {
        const st = this.status;
        Object.assign(this, saved);
        this.status = keepStatus ? st : status;
      }
    }
    execSource(src, io) {
      const ast = parse(src);
      return this.exec(ast, io);
    }
    exec(node, io) {
      this.tick();
      switch (node.type) {
        case 'list': {
          let st = 0;
          for (const item of node.items) {
            st = this.exec(item, io);
            this.status = st;
            if (st !== 0 && this.options.errexit && !this.inCondition && !(item.type === 'andor') && !(item.type === 'pipeline' && item.neg)) throw new ExitSig(st);
          }
          return st;
        }
        case 'andor': {
          let st;
          const prevCond = this.inCondition;
          this.inCondition = true;
          try { st = this.exec(node.first, io); } finally { this.inCondition = prevCond; }
          this.status = st;
          node.rest.forEach((r, idx) => {
            if ((r.op === '&&' && st === 0) || (r.op === '||' && st !== 0)) {
              const isLast = idx === node.rest.length - 1;
              const pc = this.inCondition;
              if (!isLast) this.inCondition = true;
              try { st = this.exec(r.p, io); } finally { this.inCondition = pc; }
              this.status = st;
            }
          });
          return st;
        }
        case 'pipeline': {
          let st;
          if (node.cmds.length === 1) {
            const pc = this.inCondition;
            if (node.neg) this.inCondition = true;
            try { st = this.exec(node.cmds[0], io); } finally { this.inCondition = pc; }
          } else {
            let input = io.stdin;
            const statuses = [];
            node.cmds.forEach((cmd, idx) => {
              const last = idx === node.cmds.length - 1;
              let buf = '';
              const sio = { stdin: input, out: last ? io.out : (s => { buf += s; }), err: io.err, tty: last ? io.tty : false };
              if (cmd.mergeErr && !last) sio.err = sio.out;
              const s = this.subshell(() => {
                try { return this.exec(cmd, sio); }
                catch (e) { if (e instanceof ExitSig) return e.code; throw e; }
              });
              statuses.push(s);
              input = new Stream(buf);
            });
            st = statuses[statuses.length - 1];
            if (this.options.pipefail) { const bad = statuses.filter(x => x !== 0); if (bad.length) st = bad[bad.length - 1]; }
          }
          if (node.neg) st = st === 0 ? 1 : 0;
          this.status = st;
          return st;
        }
        case 'simple': return this.execSimple(node, io);
        case 'funcdef': this.funcs.set(node.name, node.body); return 0;
      }
      // compound commands with redirections
      let rio;
      try { rio = this.applyRedirs(node.redirs || [], io); }
      catch (e) { if (e instanceof ShellError) { io.err(`bash: ${e.message}\n`); return 1; } throw e; }
      switch (node.type) {
        case 'group': return this.exec(node.body, rio);
        case 'subshell': return this.subshell(() => {
          try { return this.exec(node.body, rio); }
          catch (e) { if (e instanceof ExitSig) return e.code; throw e; }
        });
        case 'arith': {
          try { return this.arith(node.expr, rio) !== 0 ? 0 : 1; }
          catch (e) { if (e instanceof ShellError) { rio.err(`bash: ((: ${e.message}\n`); return 1; } throw e; }
        }
        case 'cond': {
          try { return this.evalCond(node.raw, rio) ? 0 : 1; }
          catch (e) { if (e instanceof ShellError) { rio.err(`bash: ${e.message}\n`); return 2; } throw e; }
        }
        case 'if': {
          for (const cl of node.clauses) {
            const pc = this.inCondition; this.inCondition = true;
            let c;
            try { c = this.exec(cl.cond, rio); } finally { this.inCondition = pc; }
            if (c === 0) return this.exec(cl.body, rio);
          }
          if (node.els) return this.exec(node.els, rio);
          return 0;
        }
        case 'for': {
          const items = node.words === null ? this.pos.slice() : this.expandWords(node.words, rio);
          let st = 0;
          for (const it of items) {
            this.tick();
            this.setVar(node.name, it);
            try { st = this.exec(node.body, rio); }
            catch (e) {
              if (e instanceof BreakSig) { if (e.n > 1) { e.n--; throw e; } break; }
              if (e instanceof ContinueSig) { if (e.n > 1) { e.n--; throw e; } continue; }
              throw e;
            }
          }
          return st;
        }
        case 'cfor': {
          let st = 0;
          if (node.init.trim()) this.arith(node.init, rio);
          for (;;) {
            this.tick();
            if (node.cond.trim() && this.arith(node.cond, rio) === 0) break;
            try { st = this.exec(node.body, rio); }
            catch (e) {
              if (e instanceof BreakSig) { if (e.n > 1) { e.n--; throw e; } break; }
              if (e instanceof ContinueSig) { if (e.n > 1) { e.n--; throw e; } }
              else throw e;
            }
            if (node.step.trim()) this.arith(node.step, rio);
          }
          return st;
        }
        case 'while': {
          let st = 0;
          for (;;) {
            this.tick();
            const pc = this.inCondition; this.inCondition = true;
            let c;
            try { c = this.exec(node.cond, rio); } finally { this.inCondition = pc; }
            if (node.until ? c === 0 : c !== 0) break;
            try { st = this.exec(node.body, rio); }
            catch (e) {
              if (e instanceof BreakSig) { if (e.n > 1) { e.n--; throw e; } break; }
              if (e instanceof ContinueSig) { if (e.n > 1) { e.n--; throw e; } continue; }
              throw e;
            }
          }
          return st;
        }
        case 'case': {
          const w = this.expandString(node.word, rio);
          for (const item of node.items) {
            for (const p of item.pats) {
              if (MB.globMatch(this.expandPattern(p, rio), w)) return this.exec(item.body, rio);
            }
          }
          return 0;
        }
      }
      throw new ShellError('unsupported construct: ' + node.type);
    }

    applyRedirs(redirs, io) {
      if (!redirs.length) return io;
      const nio = Object.assign({}, io);
      for (const r of redirs) {
        if (r.heredoc) {
          const body = r.heredoc.quoted ? r.heredoc.body : this.expandString(r.heredoc.body, io, { heredoc: true });
          nio.stdin = new Stream(body);
          continue;
        }
        const words = [];
        this.expandOne(r.target, io, words);
        if (r.op !== '<<<' && words.length !== 1) throw new ShellError(`${r.target}: ambiguous redirect`);
        const target = r.op === '<<<' ? this.expandString(r.target, io) : words[0];
        switch (r.op) {
          case '>': case '>|': case '>>': {
            const w = this.openWriter(target, r.op === '>>', nio);
            if (r.fd === 2) nio.err = w; else { nio.out = w; nio.tty = false; }
            break;
          }
          case '&>': case '&>>': {
            const w = this.openWriter(target, r.op === '&>>', nio);
            nio.out = w; nio.err = w; nio.tty = false;
            break;
          }
          case '<': case '<>': {
            const c = this.readFile(target);
            if (c === null) throw new ShellError(`${target}: ${this.fileError(target)}`);
            nio.stdin = new Stream(c);
            break;
          }
          case '<<<': nio.stdin = new Stream(target + '\n'); break;
          case '>&': {
            if (target === '1') { if (r.fd === 2) nio.err = nio.out; }
            else if (target === '2') { if (r.fd === 1) { nio.out = nio.err; nio.tty = false; } }
            else if (target === '-') { if (r.fd === 2) nio.err = () => {}; else nio.out = () => {}; }
            else { const w = this.openWriter(target, false, nio); nio.out = w; nio.err = w; nio.tty = false; }
            break;
          }
          case '<&': break;
        }
      }
      return nio;
    }

    execSimple(node, io) {
      this.curIO = io;
      let argv;
      try {
        argv = this.expandWords(node.words, io);
      } catch (e) {
        if (e instanceof ShellError) { io.err(`bash: ${e.message}\n`); this.status = 1; if (this.argv0 !== 'bash') throw new ExitSig(1); return 1; }
        throw e;
      }
      // assignments
      const doAssigns = (persist) => {
        const saved = [];
        for (const a of node.assigns) {
          const m = ASSIGN_RE.exec(a);
          const name = m[1], idxRaw = m[2] ? m[2].slice(1, -1) : undefined, append = m[3] === '+';
          const rawVal = a.slice(m[0].length);
          if (!persist) saved.push([name, this.lookup(name) ? Object.assign({}, this.lookup(name)) : null]);
          if (rawVal.startsWith('(') && rawVal.endsWith(')') && idxRaw === undefined) {
            const inner = rawVal.slice(1, -1);
            const toks = lex(inner).filter(t => t.t === 'word');
            const e = this.lookup(name);
            if (e && e.v instanceof Map) {
              const map = append ? e.v : new Map();
              for (const t of toks) {
                const mm = /^\[([^\]]*)\]=([\s\S]*)$/.exec(t.v);
                if (mm) map.set(this.expandString(mm[1], io), this.expandString(mm[2], io));
              }
              e.v = map;
            } else {
              const vals = [];
              let explicit = null;
              for (const t of toks) {
                const mm = /^\[([^\]]*)\]=([\s\S]*)$/.exec(t.v);
                if (mm) { explicit = explicit || []; explicit.push([this.arith(mm[1], io), this.expandString(mm[2], io)]); }
                else this.expandOne(t.v, io, vals);
              }
              let arr = append ? (e && Array.isArray(e.v) ? e.v.slice() : (e && e.v !== undefined ? [e.v] : [])) : [];
              arr.push(...vals);
              if (explicit) for (const [k, v] of explicit) arr[k] = v;
              this.setVar(name, arr);
            }
            continue;
          }
          let val = this.expandString(rawVal, io, { mode: 'assign' });
          if (append) {
            const e = this.lookup(name);
            if (e && e.integer) val = String(this.arithValue(name, null) + this.arith(val));
            else if (idxRaw !== undefined) val = this.indexValue(name, idxRaw, io) + val;
            else if (e && Array.isArray(e.v) && false) { /* unreachable */ }
            else val = (this.getVar(name) || '') + val;
          }
          if (idxRaw !== undefined) {
            const e = this.lookup(name);
            const key = e && e.v instanceof Map ? this.expandString(idxRaw, io) : String(this.arith(idxRaw, io));
            this.setVar(name, val, key);
          } else this.setVar(name, val);
          if (!persist) { const e = this.lookup(name); if (e) e.exported = true; }
        }
        return saved;
      };
      if (!argv.length) {
        try {
          const prevStatus = this.status;
          this.status = 0;
          doAssigns(true);
          const st = node.words.length ? this.status : (node.assigns.some(a => /\$\(|`/.test(a)) ? this.status : 0);
          void prevStatus;
          if (node.redirs.length) this.applyRedirs(node.redirs, io);
          return st;
        } catch (e) {
          if (e instanceof ShellError) { io.err(`bash: ${e.message}\n`); return 1; }
          throw e;
        }
      }
      if (this.options.xtrace) io.err('+ ' + argv.map(shQuote).join(' ') + '\n');
      let rio;
      try { rio = this.applyRedirs(node.redirs, io); }
      catch (e) { if (e instanceof ShellError) { io.err(`bash: ${e.message}\n`); return 1; } throw e; }
      let saved = null;
      try {
        if (node.assigns.length) {
          // prefix assignments are temporary for the command
          this.scopes.push(new Map());
          saved = true;
          for (const a of node.assigns) {
            const m = ASSIGN_RE.exec(a);
            this.scopes[this.scopes.length - 1].set(m[1], { v: this.expandString(a.slice(m[0].length), io, { mode: 'assign' }), exported: true });
          }
        }
        return this.invoke(argv, rio);
      } finally {
        if (saved) this.scopes.pop();
      }
    }

    invoke(argv, io) {
      const name = argv[0];
      const args = argv.slice(1);
      let st;
      try {
        if (this.funcs.has(name)) st = this.callFunction(name, args, io);
        else if (BUILTINS[name]) st = BUILTINS[name].call(this, args, io, this);
        else if (this.extraCommands && this.extraCommands[name]) st = this.extraCommands[name](args, io, this);
        else if (COMMANDS[name] && !(this.hiddenCommands && this.hiddenCommands.has(name))) st = COMMANDS[name](args, io, this);
        else if (name.includes('/')) st = this.runScriptFile(name, args, io, true);
        else { io.err(`bash: ${name}: command not found\n`); st = 127; }
      } catch (e) {
        if (e instanceof ShellError) { io.err(`bash: ${name}: ${e.message}\n`); st = 1; }
        else if (e instanceof MB.AwkError) { io.err(`awk: ${e.message}\n`); st = 2; }
        else throw e;
      }
      this.status = st;
      return st;
    }
    commandExists(name) {
      if (this.funcs.has(name) || BUILTINS[name] || (this.extraCommands && this.extraCommands[name])) return true;
      if (COMMANDS[name] && !(this.hiddenCommands && this.hiddenCommands.has(name))) return true;
      if (name.includes('/')) { const n = this.fs.get(this.abs(name)); return !!n && n.type === 'file'; }
      return false;
    }
    callFunction(name, args, io) {
      if (++this.callDepth > 200) { this.callDepth = 0; throw new LimitError('maximum function nesting level exceeded (infinite recursion?)'); }
      const savedPos = this.pos;
      this.pos = args;
      this.scopes.push(new Map());
      try { return this.exec(this.funcs.get(name), io); }
      catch (e) { if (e instanceof ReturnSig) return e.code; throw e; }
      finally { this.scopes.pop(); this.pos = savedPos; this.callDepth--; }
    }
    runScriptFile(path, args, io, needExec) {
      const a = this.abs(path);
      const node = this.fs.get(a);
      if (!node) { io.err(`bash: ${path}: No such file or directory\n`); return 127; }
      if (node.type === 'dir') { io.err(`bash: ${path}: Is a directory\n`); return 126; }
      if (needExec && !(node.mode & 0o100)) { io.err(`bash: ${path}: Permission denied\n`); return 126; }
      let src = node.content;
      const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(src);
      if (shebang && /python|node|ruby|perl/.test(shebang[1] + ' ' + (shebang[2] || ''))) {
        io.err(`bash: ${path}: this simulator can only run bash scripts\n`);
        return 126;
      }
      return this.subshell(() => {
        this.pos = args.slice();
        this.argv0 = path;
        this.scopes = [new Map([...this.scopes[0]].filter(([, e]) => e.exported).map(([k, e]) => [k, Object.assign({}, e)]))];
        this.funcs = new Map();
        this.options = { errexit: false, nounset: false, pipefail: false, xtrace: false };
        try { return this.execSource(src, io); }
        catch (e) {
          if (e instanceof ExitSig) return e.code;
          if (e instanceof SyntaxErr) { io.err(`${path}: line 1: ${e.message}\n`); return 2; }
          if (e instanceof ReturnSig) return e.code;
          throw e;
        }
      }, true);
    }
    runSubcommand(cmd, io, stdinData) {
      // used by awk system() and print | "cmd"
      const sio = { stdin: new Stream(stdinData || ''), out: io.out, err: io.err, tty: false };
      return this.subshell(() => {
        try { return this.execSource(cmd, sio); }
        catch (e) { if (e instanceof ExitSig) return e.code; if (e instanceof SyntaxErr) { io.err(`sh: ${e.message}\n`); return 2; } throw e; }
      });
    }

    // ---------- conditional expressions ----------
    testFile(op, f) {
      const n = f === '' ? null : this.fs.get(this.abs(f));
      switch (op) {
        case '-e': case '-a': return !!n;
        case '-f': return !!n && n.type === 'file';
        case '-d': return !!n && n.type === 'dir';
        case '-s': return !!n && (n.type === 'dir' || n.content.length > 0);
        case '-r': return !!n && !!(n.mode & 0o400);
        case '-w': return !!n && !!(n.mode & 0o200);
        case '-x': return !!n && !!(n.mode & 0o100);
        case '-L': case '-h': case '-p': case '-S': case '-b': case '-c': return false;
      }
      return null;
    }
    intArg(s, inBrackets) {
      if (inBrackets) return this.arith(s);
      const t = s.trim();
      if (!/^[-+]?\d+$/.test(t)) throw new ShellError(`${s}: integer expression expected`);
      return parseInt(t, 10);
    }
    binaryTest(a, op, b, dbl, rawB) {
      switch (op) {
        case '=': case '==':
          if (dbl) return MB.globMatch(rawB, a);
          return a === b;
        case '!=': if (dbl) return !MB.globMatch(rawB, a); return a !== b;
        case '<': return a < b;
        case '>': return a > b;
        case '-eq': return this.intArg(a, dbl) === this.intArg(b, dbl);
        case '-ne': return this.intArg(a, dbl) !== this.intArg(b, dbl);
        case '-lt': return this.intArg(a, dbl) < this.intArg(b, dbl);
        case '-le': return this.intArg(a, dbl) <= this.intArg(b, dbl);
        case '-gt': return this.intArg(a, dbl) > this.intArg(b, dbl);
        case '-ge': return this.intArg(a, dbl) >= this.intArg(b, dbl);
        case '-nt': case '-ot': {
          const x = this.fs.get(this.abs(a)), y = this.fs.get(this.abs(b));
          if (op === '-nt') return !!x && (!y || x.mtime > y.mtime);
          return !!y && (!x || x.mtime < y.mtime);
        }
        case '=~': {
          let re;
          try { re = new RegExp(MB.ereToJs(b)); } catch (e) { throw new ShellError(`invalid regex: ${b}`); }
          const m = re.exec(a);
          this.setVar('BASH_REMATCH', m ? Array.from(m, x => x === undefined ? '' : x) : []);
          return !!m;
        }
      }
      throw new ShellError(`${op}: binary operator expected`);
    }
    evalTest(args) {
      // POSIX test / [ ]
      let i = 0;
      const BIN = ['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot'];
      const UN = ['-e', '-a', '-f', '-d', '-s', '-r', '-w', '-x', '-L', '-h', '-p', '-S', '-b', '-c', '-z', '-n', '-t'];
      const primary = () => {
        if (i >= args.length) throw new ShellError('argument expected');
        const a = args[i];
        if (a === '!' ) { i++; return !primary(); }
        if (a === '(' && args.length - i > 1) { i++; const v = orExpr(); if (args[i] !== ')') throw new ShellError("`)' expected"); i++; return v; }
        if (i + 2 < args.length + 0 && BIN.includes(args[i + 1]) && i + 2 <= args.length - 1) { const v = this.binaryTest(args[i], args[i + 1], args[i + 2], false); i += 3; return v; }
        if (UN.includes(a) && i + 1 < args.length) {
          const f = args[i + 1]; i += 2;
          if (a === '-z') return f === '';
          if (a === '-n') return f !== '';
          if (a === '-t') return false;
          return this.testFile(a, f);
        }
        i++;
        return a !== '';
      };
      const andExpr = () => { let v = primary(); while (args[i] === '-a') { i++; const r = primary(); v = v && r; } return v; };
      const orExpr = () => { let v = andExpr(); while (args[i] === '-o') { i++; const r = andExpr(); v = v || r; } return v; };
      if (!args.length) return false;
      const v = orExpr();
      if (i < args.length) throw new ShellError(`${args[i]}: unexpected operator`);
      return v;
    }
    evalCond(raw, io) {
      const toks = splitConditionRaw(raw);
      let i = 0;
      const BIN = ['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '=~', '-nt', '-ot'];
      const UN = ['-e', '-a', '-f', '-d', '-s', '-r', '-w', '-x', '-L', '-h', '-p', '-z', '-n', '-v'];
      const word = t => this.expandString(t.w, io);
      const primary = () => {
        const t = toks[i];
        if (!t) throw new ShellError('conditional: unexpected end of expression');
        if (t.w === '!') { i++; return !primary(); }
        if (t.op === '(') { i++; const v = orE(); if (!toks[i] || toks[i].op !== ')') throw new ShellError("conditional: expected `)'"); i++; return v; }
        if (t.w !== undefined && UN.includes(t.w) && toks[i + 1] && toks[i + 1].w !== undefined && !(toks[i + 2] && BIN.includes(toks[i + 2].w))) {
          const arg = word(toks[i + 1]); i += 2;
          if (t.w === '-z') return arg === '';
          if (t.w === '-n') return arg !== '';
          if (t.w === '-v') return this.lookup(arg) !== null;
          return this.testFile(t.w, arg);
        }
        if (toks[i + 1] && toks[i + 1].w !== undefined && BIN.includes(toks[i + 1].w)) {
          const a = word(t), op = toks[i + 1].w;
          const rt = toks[i + 2];
          if (!rt || rt.w === undefined) throw new ShellError(`conditional binary operator expected`);
          i += 3;
          if (op === '=~') {
            // quoted parts of the regex are literal
            const re = this.pieces(rt.w, io, 'word').map(p => p.k === 'q' ? (p.s || '').replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') : (p.s || '')).join('');
            return this.binaryTest(a, op, re, true);
          }
          return this.binaryTest(a, op, word(rt), true, this.expandPattern(rt.w, io));
        }
        i++;
        if (t.w === undefined) throw new ShellError(`syntax error in conditional expression: unexpected token \`${t.op}'`);
        return word(t) !== '';
      };
      const andE = () => { let v = primary(); while (toks[i] && toks[i].op === '&&') { i++; const r = primary(); v = v && r; } return v; };
      const orE = () => { let v = andE(); while (toks[i] && toks[i].op === '||') { i++; const r = andE(); v = v || r; } return v; };
      const v = orE();
      if (i < toks.length) throw new ShellError('syntax error in conditional expression');
      return v;
    }

    // ---------- top-level entry ----------
    // Runs source text. Returns {output:[{s,stream}], stdout, stderr, status}.
    run(src, opts = {}) {
      const chunks = [];
      let stdout = '', stderr = '', total = 0;
      const guard = (s) => { total += s.length; if (total > this.outLimit) throw new LimitError('output limit reached'); };
      const io = {
        stdin: new Stream(opts.stdin || ''),
        out: s => { if (!s) return; guard(s); stdout += s; chunks.push({ s, stream: 'out' }); },
        err: s => { if (!s) return; guard(s); stderr += s; chunks.push({ s, stream: 'err' }); },
        tty: opts.tty !== undefined ? opts.tty : true
      };
      this.steps = 0;
      this.callDepth = 0;
      this.interactive = opts.interactive !== false;
      let ast;
      try { ast = parse(src); }
      catch (e) {
        if (e instanceof SyntaxErr || e instanceof ShellError) { io.err(`bash: ${e.message}\n`); this.status = 2; return { output: chunks, stdout, stderr, status: 2 }; }
        throw e;
      }
      try {
        this.status = this.exec(ast, io);
      } catch (e) {
        if (e instanceof ExitSig) { this.status = e.code; this.exited = true; }
        else if (e instanceof LimitError) { try { io.err(`bash: ${e.message}\n`); } catch (x) { chunks.push({ s: `bash: ${e.message}\n`, stream: 'err' }); } this.status = 124; }
        else if (e instanceof BreakSig || e instanceof ContinueSig) { this.status = 0; }
        else if (e instanceof ReturnSig) { io.err('bash: return: can only `return\' from a function or sourced script\n'); this.status = 1; }
        else if (e instanceof ShellError || e instanceof SyntaxErr) { io.err(`bash: ${e.message}\n`); this.status = 1; }
        else { io.err(`bash: internal error: ${e.message}\n`); this.status = 1; if (globalThis.process && process.env && process.env.MB_DEBUG) console.error(e); }
      }
      return { output: chunks, stdout, stderr, status: this.status };
    }
    prompt() {
      const d = this.cwd === this.home ? '~' : this.cwd.startsWith(this.home + '/') ? '~' + this.cwd.slice(this.home.length) : this.cwd;
      return { user: this.user, host: this.host, dir: d };
    }
    complete(prefix) {
      // filename completion for the last word
      const m = /(\S*)$/.exec(prefix);
      const word = m[1];
      const dirPart = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : '';
      const base = word.slice(dirPart.length);
      const dirAbs = this.abs(dirPart || '.');
      const node = this.fs.get(dirAbs);
      const isCmd = !/\s/.test(prefix.trim()) && !word.includes('/');
      let names = [];
      if (isCmd) names = [...new Set([...Object.keys(BUILTINS), ...Object.keys(COMMANDS), ...this.funcs.keys()])].filter(n => n.startsWith(base) && /^[a-z]/.test(n));
      if (node && node.type === 'dir') names = names.concat(Object.keys(node.children).filter(n => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.'))).map(n => node.children[n].type === 'dir' ? n + '/' : n));
      names = [...new Set(names)].sort();
      return { word, dirPart, base, names };
    }
  }

  function nameCompare(a, b) {
    const x = a.replace(/^\./, '').toLowerCase(), y = b.replace(/^\./, '').toLowerCase();
    return x < y ? -1 : x > y ? 1 : (a < b ? -1 : a > b ? 1 : 0);
  }

  // ------------------------------------------------------------- builtins
  const BUILTINS = {
    ':'() { return 0; },
    true() { return 0; },
    false() { return 1; },
    echo(args, io) {
      let nl = true, esc = false, i = 0;
      for (; i < args.length; i++) {
        if (!/^-[neE]+$/.test(args[i])) break;
        if (args[i].includes('n')) nl = false;
        if (args[i].includes('e')) esc = true;
        if (args[i].includes('E')) esc = false;
      }
      let s = args.slice(i).join(' ');
      let stop = false;
      if (esc) s = MB.backslashEscapes(s, { stop: () => { stop = true; } });
      io.out(s + (nl && !stop ? '\n' : ''));
      return 0;
    },
    printf(args, io, sh) {
      let varName = null;
      if (args[0] === '-v') { varName = args[1]; args = args.slice(2); }
      if (args[0] === '--') args = args.slice(1);
      if (!args.length) { io.err('printf: usage: printf [-v var] format [arguments]\n'); return 2; }
      const fmt = MB.backslashEscapes(args[0]);
      let rest = args.slice(1);
      let out = '';
      let bad = false;
      const conv = {
        toNum: x => {
          if (x === undefined || x === '') return 0;
          const t = String(x).trim();
          if (/^'./.test(t) || /^"./.test(t)) return t.charCodeAt(1);
          if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
          if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return parseFloat(t);
          io.err(`bash: printf: ${x}: invalid number\n`); bad = true;
          const m = /^[-+]?\d+/.exec(t); return m ? parseInt(m[0], 10) : 0;
        },
        toStr: x => x === undefined ? '' : String(x),
        escapes: s => MB.backslashEscapes(s)
      };
      let guard = 0;
      do {
        const r = MB.sprintf(fmt, rest, conv);
        out += r.text;
        if (!r.consumed || r.used === 0) break;
        rest = rest.slice(r.used);
      } while (rest.length && ++guard < 10000);
      if (varName) sh.setVar(varName, out); else io.out(out);
      return bad ? 1 : 0;
    },
    cd(args, io, sh) {
      let target = args.filter(a => a !== '-P' && a !== '-L' && a !== '--')[0];
      if (target === undefined || target === '') target = sh.getVar('HOME') || sh.home;
      if (target === '-') { target = sh.oldpwd; io.out(target + '\n'); }
      const a = sh.abs(target);
      const n = sh.fs.get(a);
      if (!n) { io.err(`bash: cd: ${target}: No such file or directory\n`); return 1; }
      if (n.type !== 'dir') { io.err(`bash: cd: ${target}: Not a directory\n`); return 1; }
      if (!(n.mode & 0o100)) { io.err(`bash: cd: ${target}: Permission denied\n`); return 1; }
      sh.oldpwd = sh.cwd;
      sh.cwd = a;
      return 0;
    },
    pwd(args, io, sh) { io.out(sh.cwd + '\n'); return 0; },
    export(args, io, sh) {
      if (!args.length || args[0] === '-p') {
        for (const [k, e] of [...sh.scopes[0]].sort()) if (e.exported) io.out(`declare -x ${k}="${e.v}"\n`);
        return 0;
      }
      for (const a of args) {
        if (a === '-n') continue;
        const m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(a);
        if (!m) { io.err(`bash: export: \`${a}': not a valid identifier\n`); return 1; }
        if (m[2] !== undefined) sh.setVar(m[1], m[2]);
        let e = sh.lookup(m[1]);
        if (!e) { e = { v: undefined }; sh.scopes[0].set(m[1], e); }
        e.exported = true;
      }
      return 0;
    },
    unset(args, io, sh) {
      for (const a of args) {
        if (a === '-v') continue;
        if (a === '-f') continue;
        const m = /^([A-Za-z_]\w*)\[(.*)\]$/.exec(a);
        if (m) {
          const e = sh.lookup(m[1]);
          if (e && e.v instanceof Map) e.v.delete(sh.expandString(m[2]));
          else if (e && Array.isArray(e.v)) delete e.v[sh.arith(m[2])];
          continue;
        }
        if (args.includes('-f')) sh.funcs.delete(a); else { sh.unsetVar(a); if (!args.includes('-v')) { /* bash also unsets functions only with -f */ } }
      }
      return 0;
    },
    local(args, io, sh) {
      if (sh.scopes.length < 2) { io.err('bash: local: can only be used in a function\n'); return 1; }
      return declareImpl(args, io, sh, true);
    },
    declare(args, io, sh) { return declareImpl(args, io, sh, sh.scopes.length > 1); },
    typeset(args, io, sh) { return declareImpl(args, io, sh, sh.scopes.length > 1); },
    readonly(args, io, sh) { return declareImpl(['-r', ...args], io, sh, false); },
    let(args, io, sh) {
      let v = 0;
      for (const a of args) v = sh.arith(a, io);
      return v !== 0 ? 0 : 1;
    },
    read(args, io, sh) {
      let raw = false, prompt = null, arrName = null, delim = '\n', nchars = null, silent = false;
      const names = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-r') raw = true;
        else if (a === '-p') prompt = args[++i];
        else if (a === '-a') arrName = args[++i];
        else if (a === '-d') delim = args[++i] || '\0';
        else if (a === '-n' || a === '-N') nchars = parseInt(args[++i], 10);
        else if (a === '-s') silent = true;
        else if (a === '-t') i++;
        else if (/^-[rse]+[padnNt]?$/.test(a)) {
          if (a.includes('r')) raw = true;
          const last = a[a.length - 1];
          if ('padnNt'.includes(last)) {
            const v = args[++i];
            if (last === 'p') prompt = v; else if (last === 'a') arrName = v; else if (last === 'd') delim = v || '\0'; else if (last === 'n' || last === 'N') nchars = parseInt(v, 10);
          }
        }
        else names.push(a);
      }
      void silent;
      if (prompt !== null) io.err(prompt);
      const st = io.stdin;
      if (st.pos >= st.data.length) {
        for (const n of names) sh.setVar(n, '');
        if (arrName) sh.setVar(arrName, []);
        if (!names.length && !arrName) sh.setVar('REPLY', '');
        return 1;
      }
      let line, eof = false;
      if (nchars !== null) { line = st.data.substr(st.pos, nchars); st.pos += line.length; }
      else {
        const k = st.data.indexOf(delim, st.pos);
        if (k < 0) { line = st.data.slice(st.pos); st.pos = st.data.length; eof = true; }
        else { line = st.data.slice(st.pos, k); st.pos = k + delim.length; }
      }
      if (!raw) {
        while (line.endsWith('\\') && !eof) {
          const k = st.data.indexOf('\n', st.pos);
          const more = k < 0 ? st.data.slice(st.pos) : st.data.slice(st.pos, k);
          st.pos = k < 0 ? st.data.length : k + 1;
          line = line.slice(0, -1) + more;
          if (k < 0) eof = true;
        }
        line = line.replace(/\\(.)/g, '$1');
      }
      const ifs = sh.getVar('IFS') ?? ' \t\n';
      if (arrName) {
        const parts = splitIFS(line, ifs, Infinity);
        sh.setVar(arrName, parts);
      } else if (!names.length) {
        sh.setVar('REPLY', line);
      } else {
        const parts = splitIFS(line, ifs, names.length);
        names.forEach((n, i) => sh.setVar(n, parts[i] === undefined ? '' : parts[i]));
      }
      return eof ? 1 : 0;
    },
    return(args, io, sh) {
      if (sh.scopes.length < 2 && !sh.sourcing) { io.err('bash: return: can only `return\' from a function or sourced script\n'); return 1; }
      throw new ReturnSig(args.length ? (parseInt(args[0], 10) & 255) : sh.status);
    },
    exit(args, io, sh) {
      const code = args.length ? parseInt(args[0], 10) : sh.status;
      throw new ExitSig(isNaN(code) ? 2 : (code & 255));
    },
    break(args) { throw new BreakSig(args.length ? Math.max(1, parseInt(args[0], 10)) : 1); },
    continue(args) { throw new ContinueSig(args.length ? Math.max(1, parseInt(args[0], 10)) : 1); },
    shift(args, io, sh) {
      const n = args.length ? parseInt(args[0], 10) : 1;
      if (n > sh.pos.length) return 1;
      sh.pos = sh.pos.slice(n);
      return 0;
    },
    set(args, io, sh) {
      if (!args.length) {
        for (const [k, e] of [...sh.scopes[0]].sort()) if (typeof e.v === 'string') io.out(`${k}=${shQuote(e.v)}\n`);
        return 0;
      }
      let i = 0;
      for (; i < args.length; i++) {
        const a = args[i];
        if (a === '--') { i++; sh.pos = args.slice(i); return 0; }
        if (a === '-o' || a === '+o') {
          const on = a === '-o', opt = args[++i];
          if (opt in sh.options || opt === 'noglob') sh.options[opt] = on;
          continue;
        }
        if (/^[-+][euxfvo]+$/.test(a)) {
          const on = a[0] === '-';
          for (const f of a.slice(1)) {
            if (f === 'e') sh.options.errexit = on;
            if (f === 'u') sh.options.nounset = on;
            if (f === 'x') sh.options.xtrace = on;
            if (f === 'f') sh.options.noglob = on;
            if (f === 'o') { const opt = args[++i]; if (opt) sh.options[opt] = on; }
          }
          continue;
        }
        break;
      }
      if (i < args.length) sh.pos = args.slice(i);
      return 0;
    },
    shopt() { return 0; },
    test(args, io, sh) {
      try { return sh.evalTest(args) ? 0 : 1; }
      catch (e) { if (e instanceof ShellError) { io.err(`bash: test: ${e.message}\n`); return 2; } throw e; }
    },
    '['(args, io, sh) {
      if (args[args.length - 1] !== ']') { io.err("bash: [: missing `]'\n"); return 2; }
      try { return sh.evalTest(args.slice(0, -1)) ? 0 : 1; }
      catch (e) { if (e instanceof ShellError) { io.err(`bash: [: ${e.message}\n`); return 2; } throw e; }
    },
    source(args, io, sh) {
      if (!args.length) { io.err('bash: source: filename argument required\n'); return 2; }
      const c = sh.readFile(args[0]);
      if (c === null) { io.err(`bash: ${args[0]}: No such file or directory\n`); return 1; }
      const savedPos = sh.pos;
      if (args.length > 1) sh.pos = args.slice(1);
      sh.sourcing = (sh.sourcing || 0) + 1;
      try { return sh.execSource(c, io); }
      catch (e) { if (e instanceof ReturnSig) return e.code; if (e instanceof SyntaxErr) { io.err(`bash: ${args[0]}: ${e.message}\n`); return 2; } throw e; }
      finally { sh.sourcing--; if (args.length > 1) sh.pos = savedPos; }
    },
    '.'(args, io, sh) { return BUILTINS.source(args, io, sh); },
    eval(args, io, sh) {
      try { return sh.execSource(args.join(' '), io); }
      catch (e) { if (e instanceof SyntaxErr) { io.err(`bash: eval: ${e.message}\n`); return 2; } throw e; }
    },
    type(args, io, sh) {
      let st = 0;
      const tflag = args[0] === '-t';
      for (const a of args.filter(x => x !== '-t' && x !== '-a')) {
        if (sh.funcs.has(a)) io.out(tflag ? 'function\n' : `${a} is a function\n`);
        else if (['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'until', 'function', '[[', ']]', '{', '}'].includes(a)) io.out(tflag ? 'keyword\n' : `${a} is a shell keyword\n`);
        else if (BUILTINS[a]) io.out(tflag ? 'builtin\n' : `${a} is a shell builtin\n`);
        else if (COMMANDS[a]) io.out(tflag ? 'file\n' : `${a} is /usr/bin/${a}\n`);
        else { io.err(`bash: type: ${a}: not found\n`); st = 1; }
      }
      return st;
    },
    command(args, io, sh) {
      if (args[0] === '-v') { const a = args[1]; if (BUILTINS[a] || sh.funcs.has(a)) { io.out(a + '\n'); return 0; } if (COMMANDS[a]) { io.out('/usr/bin/' + a + '\n'); return 0; } return 1; }
      const name = args[0];
      if (BUILTINS[name]) return BUILTINS[name].call(sh, args.slice(1), io, sh);
      if (COMMANDS[name]) return COMMANDS[name](args.slice(1), io, sh);
      io.err(`bash: ${name}: command not found\n`); return 127;
    },
    history(args, io, sh) {
      const h = sh.history;
      const n = args.length ? parseInt(args[0], 10) : h.length;
      h.slice(-n).forEach((c, i) => io.out(String(h.length - Math.min(n, h.length) + i + 1).padStart(5) + '  ' + c + '\n'));
      return 0;
    },
    alias() { return 0; },
    unalias() { return 0; },
    wait() { return 0; },
    trap() { return 0; },
    umask(args, io) { io.out('0022\n'); return 0; },
    getopts(args, io, sh) {
      const [spec, name] = args;
      const params = args.length > 2 ? args.slice(2) : sh.pos;
      let ind = parseInt(sh.getVar('OPTIND') || '1', 10);
      let sub = parseInt(sh.getVar('_OPTSUB') || '1', 10);
      const arg = params[ind - 1];
      if (arg === undefined || !arg.startsWith('-') || arg === '-' ) { sh.setVar(name, '?'); return 1; }
      if (arg === '--') { sh.setVar('OPTIND', String(ind + 1)); sh.setVar(name, '?'); return 1; }
      const ch = arg[sub];
      const k = spec.indexOf(ch);
      const advance = () => { if (sub + 1 < arg.length) sh.setVar('_OPTSUB', String(sub + 1)); else { sh.setVar('_OPTSUB', '1'); sh.setVar('OPTIND', String(ind + 1)); } };
      if (k < 0 || ch === ':') {
        if (!spec.startsWith(':')) io.err(`bash: illegal option -- ${ch}\n`);
        sh.setVar(name, '?'); sh.setVar('OPTARG', spec.startsWith(':') ? ch : ''); advance(); return 0;
      }
      sh.setVar(name, ch);
      if (spec[k + 1] === ':') {
        if (sub + 1 < arg.length) { sh.setVar('OPTARG', arg.slice(sub + 1)); sh.setVar('_OPTSUB', '1'); sh.setVar('OPTIND', String(ind + 1)); }
        else if (params[ind] !== undefined) { sh.setVar('OPTARG', params[ind]); sh.setVar('_OPTSUB', '1'); sh.setVar('OPTIND', String(ind + 2)); }
        else { io.err(`bash: option requires an argument -- ${ch}\n`); sh.setVar(name, '?'); sh.setVar('_OPTSUB', '1'); sh.setVar('OPTIND', String(ind + 1)); }
      } else advance();
      return 0;
    },
    mapfile(args, io, sh) {
      let strip = false; let name = 'MAPFILE';
      for (const a of args) { if (a === '-t') strip = true; else if (!a.startsWith('-')) name = a; }
      const data = io.stdin.readAll();
      const lines = data === '' ? [] : data.replace(/\n$/, '').split('\n').map(l => strip ? l : l + '\n');
      sh.setVar(name, lines);
      return 0;
    },
    clear(args, io) { io.out('\x1b[clear]'); return 0; },
    help(args, io) {
      io.out('minibash — a teaching shell that runs in your browser.\nBuiltins: ' + Object.keys(BUILTINS).filter(k => /^[a-z]/.test(k)).sort().join(' ') + '\nCommands: ' + Object.keys(COMMANDS).sort().join(' ') + '\nTry: man <command> for a short summary.\n');
      return 0;
    }
  };
  BUILTINS.readarray = BUILTINS.mapfile;

  function splitIFS(line, ifs, max) {
    const ws = [...ifs].filter(c => /\s/.test(c)).join('');
    const isWs = c => ws.includes(c);
    const isSep = c => ifs.includes(c);
    const parts = [];
    let i = 0;
    while (i < line.length && isWs(line[i])) i++;
    let cur = '';
    while (i < line.length) {
      if (parts.length === max - 1) {
        let rest = line.slice(i);
        // trailing IFS whitespace is trimmed from the last field
        let j = rest.length; while (j > 0 && isWs(rest[j - 1])) j--;
        rest = rest.slice(0, j);
        parts.push(rest);
        return parts;
      }
      const c = line[i];
      if (isSep(c)) {
        parts.push(cur); cur = '';
        while (i < line.length && isWs(line[i])) i++;
        if (!isWs(c) && i < line.length) { /* already advanced */ }
        if (isWs(c) && i < line.length && isSep(line[i]) && !isWs(line[i])) { i++; while (i < line.length && isWs(line[i])) i++; }
        if (!isWs(c)) { i++; while (i < line.length && isWs(line[i])) i++; }
        continue;
      }
      cur += c; i++;
    }
    if (cur !== '' || (line.length && isSep(line[line.length - 1]) && !isWs(line[line.length - 1]) && false)) parts.push(cur);
    return parts;
  }

  function declareImpl(args, io, sh, local) {
    const flags = new Set();
    const items = [];
    for (const a of args) {
      if (/^[-+][aAirxgpf]+$/.test(a)) { for (const f of a.slice(1)) if (a[0] === '-') flags.add(f); continue; }
      items.push(a);
    }
    if (flags.has('g')) local = false;
    if (flags.has('p') || (!items.length)) {
      const names = items.length ? items : [...new Set(sh.scopes.flatMap(m => [...m.keys()]))].sort();
      for (const n of names) {
        const e = sh.lookup(n);
        if (!e) { io.err(`bash: declare: ${n}: not found\n`); continue; }
        if (Array.isArray(e.v)) io.out(`declare -a ${n}=(${e.v.map((v, i) => v === undefined ? null : `[${i}]="${v}"`).filter(Boolean).join(' ')})\n`);
        else if (e.v instanceof Map) io.out(`declare -A ${n}=(${[...e.v].map(([k, v]) => `[${k}]="${v}" `).join('')})\n`);
        else io.out(`declare -${e.integer ? 'i' : e.exported ? 'x' : '-'} ${n}="${e.v ?? ''}"\n`);
      }
      return 0;
    }
    if (flags.has('f')) { for (const n of items) if (sh.funcs.has(n)) io.out(n + ' ()\n'); return 0; }
    for (const it of items) {
      const m = /^([A-Za-z_]\w*)(\+?=)?([\s\S]*)$/.exec(it);
      if (!m) { io.err(`bash: declare: \`${it}': not a valid identifier\n`); return 1; }
      const name = m[1];
      const scope = local ? sh.scopes[sh.scopes.length - 1] : sh.scopes[0];
      let e = scope.get(name);
      if (!e) { e = { v: undefined }; scope.set(name, e); }
      if (flags.has('A') && !(e.v instanceof Map)) e.v = new Map();
      if (flags.has('a') && !Array.isArray(e.v)) e.v = e.v === undefined ? [] : [e.v];
      if (flags.has('i')) e.integer = true;
      if (flags.has('x')) e.exported = true;
      if (m[2]) {
        const raw = m[3];
        if (raw.startsWith('(') && raw.endsWith(')')) {
          // re-run as an array assignment
          const node = { type: 'simple', assigns: [name + m[2] + raw], words: [], redirs: [] };
          sh.scopes.push(scope === sh.scopes[0] ? new Map() : new Map());
          sh.scopes.pop();
          const savedScopes = sh.scopes;
          if (!local) sh.scopes = [sh.scopes[0]];
          try { sh.execSimple(node, io); } finally { sh.scopes = savedScopes; }
        } else {
          const val = e.integer ? String(sh.arith(raw)) : raw;
          if (e.v instanceof Map) e.v.set('0', val);
          else if (Array.isArray(e.v)) e.v[0] = val;
          else e.v = m[2] === '+=' ? (e.v || '') + val : val;
        }
      } else if (e.v === undefined && !flags.has('a') && !flags.has('A')) {
        if (local) e.v = '';
      }
      if (flags.has('r')) e.readonly = true;
    }
    return 0;
  }

  // ------------------------------------------------------------- commands
  // Option parser: letters in `withVal` take a value; returns {o, rest}.
  function getopt(args, withVal, opts = {}) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { rest.push(...args.slice(i + 1)); break; }
      if (a.startsWith('--') && a.length > 2) {
        const eq = a.indexOf('=');
        const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
        const mapped = (opts.long || {})[k];
        if (mapped === undefined) throw new ShellError(`unrecognized option '${a}'`);
        if (withVal.includes(mapped)) o[mapped] = eq > 0 ? a.slice(eq + 1) : args[++i];
        else o[mapped] = true;
        continue;
      }
      if (a.startsWith('-') && a.length > 1 && !(opts.numericOk && /^-\d/.test(a))) {
        for (let j = 1; j < a.length; j++) {
          const f = a[j];
          if (withVal.includes(f)) {
            const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
            if (v === undefined) throw new ShellError(`option requires an argument -- '${f}'`);
            if (opts.multi && opts.multi.includes(f)) (o[f] = o[f] || []).push(v); else o[f] = v;
            break;
          }
          if (opts.allowed && !opts.allowed.includes(f)) throw new ShellError(`invalid option -- '${f}'`);
          o[f] = (o[f] || 0) + 1;
        }
        continue;
      }
      rest.push(a);
    }
    return { o, rest };
  }

  // Reads inputs for filter commands. Returns array of {name, content} (null content on error).
  function inputs(files, io, sh, cmd) {
    if (!files.length) return [{ name: '-', content: io.stdin.readAll() }];
    return files.map(f => {
      if (f === '-') return { name: '-', content: io.stdin.readAll() };
      const c = sh.readFile(f);
      if (c === null) { io.err(`${cmd}: ${f}: ${sh.fileError(f)}\n`); return { name: f, content: null }; }
      return { name: f, content: c };
    });
  }
  const linesOf = s => s === '' ? [] : s.replace(/\n$/, '').split('\n');
  const joinLines = ls => ls.length ? ls.join('\n') + '\n' : '';

  function modeString(n) {
    const m = n.mode;
    const r = (b, ch) => (m & b ? ch : '-');
    return (n.type === 'dir' ? 'd' : '-') + r(0o400, 'r') + r(0o200, 'w') + r(0o100, 'x') + r(0o40, 'r') + r(0o20, 'w') + r(0o10, 'x') + r(0o4, 'r') + r(0o2, 'w') + r(0o1, 'x');
  }
  function sizeOf(n) { return n.type === 'dir' ? 4096 : (n.vsize || new TextEncoder().encode(n.content).length); }
  function human(n) {
    if (n < 1024) return String(n);
    const u = ['K', 'M', 'G', 'T'];
    let v = n, i = -1;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + u[i];
  }
  function lsDate(t) {
    const d = new Date(t);
    return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function columns(names, width) {
    if (!names.length) return '';
    width = width || 80;
    for (let cols = names.length; cols >= 1; cols--) {
      const rows = Math.ceil(names.length / cols);
      const widths = [];
      for (let c = 0; c < cols; c++) {
        const col = names.slice(c * rows, (c + 1) * rows);
        if (!col.length) { widths.push(0); continue; }
        widths.push(Math.max(...col.map(s => s.length)) + 2);
      }
      const total = widths.reduce((a, b) => a + b, 0) - 2;
      if (total <= width || cols === 1) {
        let out = '';
        for (let r = 0; r < rows; r++) {
          let line = '';
          for (let c = 0; c < cols; c++) {
            const s = names[c * rows + r];
            if (s === undefined) continue;
            const isLast = c === cols - 1 || names[(c + 1) * rows + r] === undefined;
            line += isLast ? s : s.padEnd(widths[c]);
          }
          out += line + '\n';
        }
        return out;
      }
    }
    return names.join('\n') + '\n';
  }

  // Sorting helper shared by sort and ls
  function parseKeySpec(spec) {
    const m = /^(\d+)(?:\.(\d+))?([bdfgnrhMV]*)(?:,(\d+)(?:\.(\d+))?([bdfgnrhMV]*))?$/.exec(spec);
    if (!m) throw new ShellError(`invalid key specification: '${spec}'`);
    return { f1: +m[1], c1: m[2] ? +m[2] : 0, f2: m[4] ? +m[4] : null, c2: m[5] ? +m[5] : 0, flags: (m[3] || '') + (m[6] || '') };
  }
  function humanVal(s) {
    const m = /^\s*([-+]?\d*\.?\d+)\s*([KMGTPkmgtp]?)/.exec(s);
    if (!m) return 0;
    const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }[m[2].toUpperCase()];
    return parseFloat(m[1]) * mult;
  }
  function numPrefix(s) { const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)/.exec(s); return m ? parseFloat(m[0]) : 0; }
  function versionCmp(a, b) {
    const pa = a.match(/\d+|\D+/g) || [], pb = b.match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i], y = pb[i];
      if (x === undefined) return -1; if (y === undefined) return 1;
      if (/^\d/.test(x) && /^\d/.test(y)) { const d = parseInt(x, 10) - parseInt(y, 10); if (d) return d; }
      else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  const MAN = {
    ls: 'ls [-laAhrtS1dRF] [path...] — list directory contents', cd: 'cd [dir] — change the working directory (cd - goes back)',
    pwd: 'pwd — print the working directory', cat: 'cat [-nA] [file...] — concatenate and print files', echo: 'echo [-neE] [text] — print text',
    mkdir: 'mkdir [-p] dir... — make directories', touch: 'touch file... — create files or update timestamps', rm: 'rm [-rfi] path... — remove files',
    cp: 'cp [-r] src... dest — copy files', mv: 'mv src... dest — move/rename', head: 'head [-n N] [file] — first lines', tail: 'tail [-n N|+N] [file] — last lines',
    wc: 'wc [-lwc] [file] — count lines, words, bytes', sort: 'sort [-nrufhVk F[,F] -t SEP] — sort lines', uniq: 'uniq [-cdui] — collapse adjacent duplicates',
    cut: 'cut -d SEP -f LIST | -c LIST — select columns', tr: "tr [-dsc] SET1 [SET2] — translate characters", grep: 'grep [-ivcnlLowxErhqABC] PATTERN [file...] — search text',
    sed: "sed [-nEi] 'script' [file] — stream editor (s///, d, p, ...)", awk: "awk [-F fs] [-v x=y] 'program' [file] — pattern scanning language",
    find: 'find [path] [-name P] [-iname P] [-type f|d] [-maxdepth N] [-size N] [-empty] [-exec cmd {} \\;] — search the tree',
    xargs: 'xargs [-n N] [-I {}] cmd — build commands from stdin', chmod: 'chmod MODE file... — change permissions (755, u+x, go-w)',
    tee: 'tee [-a] file — copy stdin to file and stdout', seq: 'seq [first [step]] last — print a number sequence', tree: 'tree [dir] — show a directory tree',
    printf: 'printf FORMAT [args] — formatted output', read: 'read [-r] [-p prompt] [-a arr] var... — read a line into variables', test: 'test EXPR / [ EXPR ] — evaluate a condition',
    diff: 'diff file1 file2 — compare files line by line', basename: 'basename path [suffix]', dirname: 'dirname path', date: 'date [+FORMAT]', bc: 'bc [-l] — arbitrary precision calculator (subset)',
    nl: 'nl [file] — number lines', rev: 'rev — reverse each line', tac: 'tac — print lines in reverse order', paste: 'paste [-d SEP] [-s] files — merge lines', comm: 'comm [-123] a b — compare sorted files',
    column: 'column -t [-s SEP] — align into a table', du: 'du [-sh] [path] — disk usage', file: 'file path — guess file type', stat: 'stat file — file details', expr: 'expr ARGS — evaluate an expression',
    which: 'which cmd — locate a command', env: 'env — print environment', sleep: 'sleep N — pause (instant here)', history: 'history — show previous commands', man: 'man cmd — this help'
  };

  const COMMANDS = {
    ls(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: 'laAhrtS1dRFG', long: { all: 'a', 'almost-all': 'A', human: 'h', reverse: 'r', recursive: 'R', classify: 'F' } });
      const targets = rest.length ? rest : ['.'];
      let status = 0;
      const files = [], dirs = [];
      for (const t of targets) {
        const n = sh.fs.get(sh.abs(t));
        if (!n) { io.err(`ls: cannot access '${t}': No such file or directory\n`); status = 2; continue; }
        if (n.type === 'dir' && !o.d) dirs.push([t, n]); else files.push([t, n]);
      }
      const sortEntries = (list) => {
        if (o.t) list.sort((a, b) => b[1].mtime - a[1].mtime || nameCompare(a[0], b[0]));
        else if (o.S) list.sort((a, b) => sizeOf(b[1]) - sizeOf(a[1]) || nameCompare(a[0], b[0]));
        else list.sort((a, b) => nameCompare(a[0], b[0]));
        if (o.r) list.reverse();
        return list;
      };
      const label = (name, n) => name + (o.F && n.type === 'dir' ? '/' : o.F && n.type === 'file' && (n.mode & 0o100) ? '*' : '');
      const render = (entries, showTotal) => {
        if (o.l) {
          const sizes = entries.map(([, n]) => o.h ? human(sizeOf(n)) : String(sizeOf(n)));
          const w = Math.max(1, ...sizes.map(s => s.length));
          const links = entries.map(([, n]) => n.type === 'dir' ? String(2 + Object.values(n.children).filter(c => c.type === 'dir').length) : '1');
          const lw = Math.max(1, ...links.map(s => s.length));
          let out = '';
          if (showTotal) out += `total ${entries.reduce((a, [, n]) => a + (n.type === 'dir' ? 4 : Math.ceil(sizeOf(n) / 4096) * 4), 0)}\n`;
          entries.forEach(([name, n], i) => {
            out += `${modeString(n)} ${links[i].padStart(lw)} ${sh.user} ${sh.user} ${sizes[i].padStart(w)} ${lsDate(n.mtime)} ${label(name, n)}\n`;
          });
          return out;
        }
        const names = entries.map(([name, n]) => label(name, n));
        if (io.tty && !o['1']) return columns(names);
        return joinLines(names);
      };
      let out = '';
      if (files.length) out += render(sortEntries(files), false);
      const listDir = (t, n, header) => {
        let entries = Object.keys(n.children).filter(k => o.a || o.A || !k.startsWith('.')).map(k => [k, n.children[k]]);
        if (o.a) entries.push(['.', n], ['..', sh.fs.get(VFS.norm(sh.abs(t) + '/..', '/')) || n]);
        entries = sortEntries(entries);
        if (header) out += (out ? '\n' : '') + `${t}:\n`;
        out += render(entries, true);
        if (o.R) for (const [name, c] of entries) if (c.type === 'dir' && name !== '.' && name !== '..') listDir((t === '.' ? '.' : t.replace(/\/$/, '')) + '/' + name, c, true);
      };
      const multi = dirs.length + files.length > 1 || o.R;
      for (const [t, n] of sortEntries(dirs)) listDir(t, n, multi);
      io.out(out);
      return status;
    },
    cat(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: 'nAEbsT' });
      let status = 0, n = 0;
      for (const inp of inputs(rest, io, sh, 'cat')) {
        if (inp.content === null) { status = 1; continue; }
        let c = inp.content;
        if (o.s) c = c.replace(/\n{3,}/g, '\n\n');
        if (o.n || o.b) {
          const ls = c.split('\n');
          const hasTrail = c.endsWith('\n');
          if (hasTrail) ls.pop();
          c = ls.map(l => (o.b && l === '') ? l : `${String(++n).padStart(6)}\t${l}`).join('\n') + (hasTrail ? '\n' : '');
        }
        if (o.A || o.E) c = c.replace(/\t/g, o.A ? '^I' : '\t').replace(/\n/g, '$\n');
        io.out(c);
      }
      return status;
    },
    mkdir(args, io, sh) {
      const { o, rest } = getopt(args, 'm', { allowed: 'pvm', long: { parents: 'p', verbose: 'v' } });
      if (!rest.length) { io.err('mkdir: missing operand\n'); return 1; }
      let st = 0;
      for (const d of rest) {
        const a = sh.abs(d);
        const exists = sh.fs.get(a);
        if (exists) { if (!o.p) { io.err(`mkdir: cannot create directory '${d}': File exists\n`); st = 1; } continue; }
        if (o.p) {
          const r = sh.fs.mkdirp(a, Date.now());
          if (!r) { io.err(`mkdir: cannot create directory '${d}': Not a directory\n`); st = 1; }
          else if (o.v) io.out(`mkdir: created directory '${d}'\n`);
          continue;
        }
        const parent = sh.fs.parentDir(a);
        if (!parent) { io.err(`mkdir: cannot create directory '${d}': No such file or directory\n`); st = 1; continue; }
        parent.children[a.split('/').pop()] = mkDir();
        if (o.v) io.out(`mkdir: created directory '${d}'\n`);
      }
      return st;
    },
    rmdir(args, io, sh) {
      const { rest } = getopt(args, '', { allowed: 'p' });
      let st = 0;
      for (const d of rest) {
        const a = sh.abs(d), n = sh.fs.get(a);
        if (!n) { io.err(`rmdir: failed to remove '${d}': No such file or directory\n`); st = 1; continue; }
        if (n.type !== 'dir') { io.err(`rmdir: failed to remove '${d}': Not a directory\n`); st = 1; continue; }
        if (Object.keys(n.children).length) { io.err(`rmdir: failed to remove '${d}': Directory not empty\n`); st = 1; continue; }
        delete sh.fs.parentDir(a).children[a.split('/').pop()];
      }
      return st;
    },
    touch(args, io, sh) {
      const { rest } = getopt(args, 'dt', { allowed: 'acmdt' });
      if (!rest.length) { io.err('touch: missing file operand\n'); return 1; }
      let st = 0;
      for (const f of rest) {
        const a = sh.abs(f), n = sh.fs.get(a);
        if (n) { n.mtime = Date.now(); continue; }
        const p = sh.fs.parentDir(a);
        if (!p) { io.err(`touch: cannot touch '${f}': No such file or directory\n`); st = 1; continue; }
        p.children[a.split('/').pop()] = mkFile('');
      }
      return st;
    },
    rm(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: 'rRfiv', long: { recursive: 'r', force: 'f', verbose: 'v' } });
      if (!rest.length) { if (!o.f) { io.err('rm: missing operand\n'); return 1; } return 0; }
      let st = 0;
      for (const f of rest) {
        const a = sh.abs(f), n = sh.fs.get(a);
        if (a === '/' || a === sh.home && (o.r || o.R)) { io.err(`rm: refusing to remove '${f}' in this practice shell\n`); st = 1; continue; }
        if (!n) { if (!o.f) { io.err(`rm: cannot remove '${f}': No such file or directory\n`); st = 1; } continue; }
        if (n.type === 'dir' && !(o.r || o.R)) { io.err(`rm: cannot remove '${f}': Is a directory\n`); st = 1; continue; }
        if (sh.cwd === a || sh.cwd.startsWith(a + '/')) { /* allowed in bash; cwd becomes dangling */ }
        delete sh.fs.parentDir(a).children[a.split('/').pop()];
        if (o.v) io.out(`removed '${f}'\n`);
      }
      return st;
    },
    cp(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: 'rRivfnpa', long: { recursive: 'r' } });
      if (rest.length < 2) { io.err(rest.length ? `cp: missing destination file operand after '${rest[0]}'\n` : 'cp: missing file operand\n'); return 1; }
      const dest = rest.pop();
      const da = sh.abs(dest), dn = sh.fs.get(da);
      if (rest.length > 1 && (!dn || dn.type !== 'dir')) { io.err(`cp: target '${dest}' is not a directory\n`); return 1; }
      let st = 0;
      const copy = (n) => n.type === 'file' ? { type: 'file', content: n.content, mode: n.mode, mtime: Date.now() } : (() => { const d = mkDir(); d.mode = n.mode; for (const k of Object.keys(n.children)) d.children[k] = copy(n.children[k]); return d; })();
      for (const s of rest) {
        const sa = sh.abs(s), sn = sh.fs.get(sa);
        if (!sn) { io.err(`cp: cannot stat '${s}': No such file or directory\n`); st = 1; continue; }
        if (sn.type === 'dir' && !(o.r || o.R || o.a)) { io.err(`cp: -r not specified; omitting directory '${s}'\n`); st = 1; continue; }
        let target = da;
        if (dn && dn.type === 'dir') target = da + '/' + sa.split('/').pop();
        if (target === sa) { io.err(`cp: '${s}' and '${dest}' are the same file\n`); st = 1; continue; }
        if ((target + '/').startsWith(sa + '/')) { io.err(`cp: cannot copy a directory, '${s}', into itself\n`); st = 1; continue; }
        const parent = sh.fs.parentDir(target);
        if (!parent) { io.err(`cp: cannot create regular file '${dest}': No such file or directory\n`); st = 1; continue; }
        const existing = parent.children[target.split('/').pop()];
        if (existing && o.n) continue;
        if (existing && existing.type === 'dir' && sn.type === 'file') { io.err(`cp: cannot overwrite directory '${dest}' with non-directory\n`); st = 1; continue; }
        parent.children[target.split('/').pop()] = copy(sn);
        if (o.v) io.out(`'${s}' -> '${target.replace(sh.cwd + '/', '')}'\n`);
      }
      return st;
    },
    mv(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: 'ivfn' });
      if (rest.length < 2) { io.err(rest.length ? `mv: missing destination file operand after '${rest[0]}'\n` : 'mv: missing file operand\n'); return 1; }
      const dest = rest.pop();
      const da = sh.abs(dest), dn = sh.fs.get(da);
      if (rest.length > 1 && (!dn || dn.type !== 'dir')) { io.err(`mv: target '${dest}' is not a directory\n`); return 1; }
      let st = 0;
      for (const s of rest) {
        const sa = sh.abs(s), sn = sh.fs.get(sa);
        if (!sn) { io.err(`mv: cannot stat '${s}': No such file or directory\n`); st = 1; continue; }
        let target = da;
        if (dn && dn.type === 'dir') target = da + '/' + sa.split('/').pop();
        if (target === sa) continue;
        if ((target + '/').startsWith(sa + '/')) { io.err(`mv: cannot move '${s}' to a subdirectory of itself\n`); st = 1; continue; }
        const parent = sh.fs.parentDir(target);
        if (!parent) { io.err(`mv: cannot move '${s}' to '${dest}': No such file or directory\n`); st = 1; continue; }
        if (parent.children[target.split('/').pop()] && o.n) continue;
        delete sh.fs.parentDir(sa).children[sa.split('/').pop()];
        parent.children[target.split('/').pop()] = sn;
        if (o.v) io.out(`renamed '${s}' -> '${dest}'\n`);
      }
      return st;
    },
    head(args, io, sh) { return headTail(args, io, sh, 'head'); },
    tail(args, io, sh) { return headTail(args, io, sh, 'tail'); },
    wc(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: 'lwcmL', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
      const sel = ['l', 'w', 'c', 'm', 'L'].filter(k => o[k]);
      const want = sel.length ? sel : ['l', 'w', 'c'];
      const rows = [];
      let st = 0;
      const tot = { l: 0, w: 0, c: 0, m: 0, L: 0 };
      for (const inp of inputs(rest, io, sh, 'wc')) {
        if (inp.content === null) { st = 1; continue; }
        const c = inp.content;
        const v = {
          l: (c.match(/\n/g) || []).length, w: (c.match(/\S+/g) || []).length,
          c: new TextEncoder().encode(c).length, m: [...c].length, L: Math.max(0, ...c.split('\n').map(x => x.length))
        };
        for (const k of Object.keys(tot)) tot[k] = k === 'L' ? Math.max(tot[k], v[k]) : tot[k] + v[k];
        rows.push([v, inp.name === '-' ? '' : inp.name]);
      }
      if (rows.length > 1) rows.push([tot, 'total']);
      const fromStdin = !rest.length;
      let width = 1;
      if (rows.length === 1 && want.length === 1) width = 1;
      else if (fromStdin) width = 7;
      else width = String(tot.c).length;
      for (const [v, name] of rows) io.out(want.map(k => String(v[k]).padStart(width)).join(' ') + (name ? ' ' + name : '') + '\n');
      return st;
    },
    sort(args, io, sh) {
      const { o, rest } = getopt(args, 'tko', { allowed: 'nrufhbdsVkto', multi: 'k', long: { numeric: 'n', reverse: 'r', unique: 'u', 'ignore-case': 'f', 'human-numeric-sort': 'h', 'version-sort': 'V', key: 'k', 'field-separator': 't', stable: 's', output: 'o' } });
      let lines = [];
      let st = 0;
      for (const inp of inputs(rest, io, sh, 'sort')) { if (inp.content === null) { st = 2; continue; } lines.push(...linesOf(inp.content)); }
      const sep = o.t === undefined ? null : MB.backslashEscapes(o.t);
      const keys = (o.k || []).map(parseKeySpec);
      const fieldsOf = (line) => {
        if (sep !== null) return line.split(sep);
        const out = []; const re = /\s*\S+/g; let m;
        while ((m = re.exec(line))) out.push(m[0]);
        return out;
      };
      const extract = (line, k) => {
        const f = fieldsOf(line);
        const end = k.f2 === null ? f.length : k.f2;
        let parts = f.slice(k.f1 - 1, end);
        let s = parts.join(sep === null ? '' : sep);
        if (k.c1) s = s.slice(k.c1 - 1);
        return s;
      };
      const cmpBy = (flags) => (a, b) => {
        const fl = flags || '';
        const has = (c) => fl.includes(c) || (!flags || !/[nhgVf]/.test(flags) ? !!o[c] : false);
        let x = a, y = b;
        if (has('b') || sep === null) { x = x.replace(/^\s+/, ''); y = y.replace(/^\s+/, ''); }
        let r;
        if (has('n') || has('g')) r = numPrefix(x) - numPrefix(y);
        else if (has('h')) r = humanVal(x) - humanVal(y);
        else if (has('V')) r = versionCmp(x, y);
        else { if (has('f')) { x = x.toUpperCase(); y = y.toUpperCase(); } r = x < y ? -1 : x > y ? 1 : 0; }
        const rev = fl.includes('r') || (!/[r]/.test(fl) && o.r && !keys.length) || (keys.length && o.r && !/r/.test(fl));
        return rev ? -r : r;
      };
      const compare = (a, b) => {
        if (keys.length) {
          for (const k of keys) {
            const r = cmpBy(k.flags || ((o.n ? 'n' : '') + (o.f ? 'f' : '') + (o.h ? 'h' : '') + (o.V ? 'V' : '')) || null)(extract(a, k), extract(b, k));
            if (r) return r;
          }
          if (o.u || o.s) return 0;
          const r = a < b ? -1 : a > b ? 1 : 0;
          return o.r ? -r : r;
        }
        const r = cmpBy(null)(a, b);
        if (r || o.u || o.s) return r;
        if (o.n || o.h || o.f || o.V) { const t = a < b ? -1 : a > b ? 1 : 0; return o.r ? -t : t; }
        return r;
      };
      lines = lines.map((l, i) => [l, i]).sort((A, B) => compare(A[0], B[0]) || A[1] - B[1]).map(x => x[0]);
      if (o.u) lines = lines.filter((l, i) => i === 0 || compare(lines[i - 1], l) !== 0);
      if (o.o) { sh.writeFile(o.o, joinLines(lines), false); return st; }
      io.out(joinLines(lines));
      return st;
    },
    uniq(args, io, sh) {
      const { o, rest } = getopt(args, 'fs', { allowed: 'cduifs', long: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i' } });
      const inp = inputs(rest.slice(0, 1), io, sh, 'uniq')[0];
      if (inp.content === null) return 1;
      const lines = linesOf(inp.content);
      const key = l => { let s = l; if (o.f) s = s.split(/\s+/).filter(Boolean).slice(+o.f).join(' '); if (o.s) s = s.slice(+o.s); return o.i ? s.toLowerCase() : s; };
      const groups = [];
      for (const l of lines) {
        const g = groups[groups.length - 1];
        if (g && key(g.line) === key(l)) g.n++;
        else groups.push({ line: l, n: 1 });
      }
      let out = '';
      for (const g of groups) {
        if (o.d && g.n < 2) continue;
        if (o.u && g.n > 1) continue;
        out += (o.c ? String(g.n).padStart(7) + ' ' : '') + g.line + '\n';
      }
      if (rest[1]) { sh.writeFile(rest[1], out, false); return 0; }
      io.out(out);
      return 0;
    },
    cut(args, io, sh) {
      const { o, rest } = getopt(args, 'dfcb', { allowed: 'dfcbs', long: { delimiter: 'd', fields: 'f', characters: 'c', bytes: 'b', 'only-delimited': 's', complement: 'C', 'output-delimiter': 'O' } });
      const list = o.f || o.c || o.b;
      if (!list) { io.err('cut: you must specify a list of bytes, characters, or fields\n'); return 1; }
      const ranges = list.split(',').map(r => {
        const m = /^(\d*)(-?)(\d*)$/.exec(r);
        if (!m || (!m[1] && !m[3])) throw new ShellError(`invalid field range`);
        const a = m[1] ? +m[1] : 1;
        const b = m[2] ? (m[3] ? +m[3] : Infinity) : a;
        if (a === 0) throw new ShellError('fields and positions are numbered from 1');
        return [a, b];
      });
      const inRange = i => ranges.some(([a, b]) => i >= a && i <= b);
      const d = o.d === undefined ? '\t' : o.d;
      if (o.d !== undefined && d.length !== 1) { io.err('cut: the delimiter must be a single character\n'); return 1; }
      const outD = o.O !== undefined ? o.O : d;
      let st = 0, out = '';
      for (const inp of inputs(rest, io, sh, 'cut')) {
        if (inp.content === null) { st = 1; continue; }
        for (const line of linesOf(inp.content)) {
          if (o.f) {
            if (!line.includes(d)) { if (!o.s) out += line + '\n'; continue; }
            const parts = line.split(d);
            out += parts.filter((p, i) => o.C ? !inRange(i + 1) : inRange(i + 1)).join(outD) + '\n';
          } else {
            const chars = [...line];
            out += chars.filter((c, i) => o.C ? !inRange(i + 1) : inRange(i + 1)).join('') + '\n';
          }
        }
      }
      io.out(out);
      return st;
    },
    tr(args, io) {
      const { o, rest } = getopt(args, '', { allowed: 'dscCt' });
      const expand = (set) => {
        set = set.replace(/\[:(\w+):\]/g, (m, c) => ({ upper: 'A-Z', lower: 'a-z', digit: '0-9', alpha: 'a-zA-Z', alnum: 'a-zA-Z0-9', space: ' \t\n\r\f\v', blank: ' \t', punct: '!-/:-@[-`{-~', xdigit: '0-9A-Fa-f' })[c] || m);
        set = MB.backslashEscapes(set);
        const out = [];
        for (let i = 0; i < set.length; i++) {
          if (set[i + 1] === '-' && i + 2 < set.length) {
            const a = set.charCodeAt(i), b = set.charCodeAt(i + 2);
            if (a > b) throw new ShellError(`range-endpoints of '${set.substr(i, 3)}' are in reverse collating sequence order`);
            for (let c = a; c <= b; c++) out.push(String.fromCharCode(c));
            i += 2;
          } else out.push(set[i]);
        }
        return out;
      };
      if (!rest.length) { io.err('tr: missing operand\n'); return 1; }
      let s1 = expand(rest[0]);
      const s2 = rest[1] !== undefined ? expand(rest[1]) : [];
      const comp = o.c || o.C;
      const inS1 = c => comp ? !s1.includes(c) : s1.includes(c);
      const data = io.stdin.readAll();
      let out = '';
      if (o.d) {
        for (const c of data) if (!inS1(c)) out += c;
        if (o.s && s2.length) { let r = '', prev = null; for (const c of out) { if (c === prev && s2.includes(c)) continue; r += c; prev = c; } out = r; }
        io.out(out); return 0;
      }
      if (!s2.length) {
        if (!o.s) { io.err("tr: missing operand after '" + rest[0] + "'\n"); return 1; }
        let prev = null;
        for (const c of data) { if (c === prev && inS1(c)) continue; out += c; prev = c; }
        io.out(out); return 0;
      }
      const map = new Map();
      if (comp) {
        for (const c of new Set(data)) if (!s1.includes(c)) map.set(c, s2[s2.length - 1]);
      } else {
        s1.forEach((c, i) => map.set(c, i < s2.length ? s2[i] : s2[s2.length - 1]));
      }
      let prev = null;
      for (const c of data) {
        const t = map.has(c) ? map.get(c) : c;
        if (o.s && t === prev && s2.includes(t) && map.has(c)) continue;
        out += t; prev = t;
      }
      io.out(out);
      return 0;
    },
    grep(args, io, sh) { return grepImpl(args, io, sh, false); },
    egrep(args, io, sh) { return grepImpl(args, io, sh, true); },
    sed(args, io, sh) { return MB.sed(args, io, sh); },
    awk(args, io, sh) { return MB.awk(args, io, sh); },
    find(args, io, sh) {
      let i = 0;
      const roots = [];
      while (i < args.length && !args[i].startsWith('-') && args[i] !== '!' && args[i] !== '(') roots.push(args[i++]);
      if (!roots.length) roots.push('.');
      const expr = args.slice(i);
      // parse expression into a list of tests (implicit AND), with ! and -o support
      let p = 0;
      const tests = [];
      const parseOr = () => { let l = parseAnd(); while (expr[p] === '-o' || expr[p] === '-or') { p++; const r = parseAnd(); const L = l; l = (e) => L(e) || r(e); } return l; };
      const parseAnd = () => {
        let l = parseNot();
        while (p < expr.length && expr[p] !== '-o' && expr[p] !== '-or' && expr[p] !== ')') { if (expr[p] === '-a' || expr[p] === '-and') p++; const r = parseNot(); const L = l; l = (e) => L(e) && r(e); }
        return l;
      };
      const parseNot = () => { if (expr[p] === '!' || expr[p] === '-not') { p++; const t = parseNot(); return (e) => !t(e); } return parsePrim(); };
      let maxdepth = Infinity, mindepth = 0, hasAction = false;
      const parsePrim = () => {
        const t = expr[p++];
        const arg = () => { if (p >= expr.length) throw new ShellError(`missing argument to \`${t}'`); return expr[p++]; };
        switch (t) {
          case '(': { const v = parseOr(); if (expr[p++] !== ')') throw new ShellError("invalid expression; I was expecting to find a ')'"); return v; }
          case '-name': { const g = arg(); return e => MB.globMatch(g, e.name); }
          case '-iname': { const g = arg(); return e => MB.globMatch(g, e.name, true); }
          case '-path': case '-wholename': { const g = arg(); return e => MB.globMatch(g, e.path); }
          case '-type': { const ty = arg(); return e => (ty === 'f' && e.node.type === 'file') || (ty === 'd' && e.node.type === 'dir'); }
          case '-maxdepth': maxdepth = +arg(); return () => true;
          case '-mindepth': mindepth = +arg(); return () => true;
          case '-empty': return e => e.node.type === 'file' ? e.node.content.length === 0 : Object.keys(e.node.children).length === 0;
          case '-size': {
            const s = arg(); const m = /^([+-]?)(\d+)([ckMG]?)$/.exec(s);
            if (!m) throw new ShellError(`invalid -size argument '${s}'`);
            const unit = { '': 512, c: 1, k: 1024, M: 1048576, G: 1073741824 }[m[3]];
            return e => { const sz = Math.ceil(sizeOf(e.node) / unit); return m[1] === '+' ? sz > +m[2] : m[1] === '-' ? sz < +m[2] : sz === +m[2]; };
          }
          case '-newer': { const ref = sh.fs.get(sh.abs(arg())); return e => !!ref && e.node.mtime > ref.mtime; }
          case '-perm': { const m = parseInt(arg(), 8); return e => (e.node.mode & 0o777) === m; }
          case '-mtime': case '-mmin': { arg(); return () => true; }
          case '-print': hasAction = true; return e => { e.print = true; return true; };
          case '-delete': hasAction = true; return e => { e.del = true; return true; };
          case '-exec': case '-ok': {
            hasAction = true;
            const cmd = [];
            while (p < expr.length && expr[p] !== ';' && expr[p] !== '+') cmd.push(expr[p++]);
            const plus = expr[p] === '+';
            if (p >= expr.length) throw new ShellError("missing argument to `-exec'");
            p++;
            return e => { (e.exec = e.exec || []).push({ cmd, plus }); return true; };
          }
          case '-true': return () => true;
          case '-false': return () => false;
          default: throw new ShellError(`unknown predicate \`${t}'`);
        }
      };
      let pred = () => true;
      try { if (expr.length) pred = parseOr(); } catch (e) { if (e instanceof ShellError) { io.err(`find: ${e.message}\n`); return 1; } throw e; }
      const results = [];
      let st = 0;
      const plusBatches = new Map();
      const visit = (path, node, depth, name) => {
        const e = { path, node, name, depth };
        if (depth >= mindepth && depth <= maxdepth) {
          const ok = pred(e);
          if (ok && (!hasAction || e.print)) results.push(path);
          if (ok && e.exec) for (const x of e.exec) {
            if (x.plus) { const k = x.cmd.join('\0'); if (!plusBatches.has(k)) plusBatches.set(k, { cmd: x.cmd, paths: [] }); plusBatches.get(k).paths.push(path); }
            else { flush(); const argv = x.cmd.map(a => a.replace(/\{\}/g, path)); sh.invoke(argv, Object.assign({}, io, { stdin: new Stream('') })); }
          }
          if (ok && e.del) e.deleteMe = true;
        }
        if (node.type === 'dir' && depth < maxdepth) {
          for (const k of Object.keys(node.children).sort(nameCompare)) visit(path === '/' ? '/' + k : path + '/' + k, node.children[k], depth + 1, k);
        }
        if (e.deleteMe) { const a = sh.abs(path); const par = sh.fs.parentDir(a); if (par) delete par.children[a.split('/').pop()]; }
      };
      const flush = () => { if (results.length) { io.out(joinLines(results)); results.length = 0; } };
      for (const r of roots) {
        const n = sh.fs.get(sh.abs(r));
        if (!n) { io.err(`find: '${r}': No such file or directory\n`); st = 1; continue; }
        visit(r.length > 1 ? r.replace(/\/$/, '') : r, n, 0, r.split('/').filter(Boolean).pop() || r);
      }
      flush();
      for (const b of plusBatches.values()) {
        const idx = b.cmd.indexOf('{}');
        const argv = idx >= 0 ? [...b.cmd.slice(0, idx), ...b.paths, ...b.cmd.slice(idx + 1)] : [...b.cmd, ...b.paths];
        sh.invoke(argv, Object.assign({}, io, { stdin: new Stream('') }));
      }
      return st;
    },
    xargs(args, io, sh) {
      let i = 0, n = null, rep = null, delim = null, verbose = false;
      for (; i < args.length; i++) {
        const a = args[i];
        if (a === '-n') n = +args[++i];
        else if (/^-n\d+$/.test(a)) n = +a.slice(2);
        else if (a === '-I') rep = args[++i];
        else if (a.startsWith('-I') && a.length > 2) rep = a.slice(2);
        else if (a === '-d') delim = MB.backslashEscapes(args[++i]);
        else if (a === '-0') delim = '\0';
        else if (a === '-t') verbose = true;
        else if (a === '-r' || a === '--no-run-if-empty') continue;
        else break;
      }
      const cmd = args.slice(i);
      if (!cmd.length) cmd.push('echo');
      const data = io.stdin.readAll();
      let items;
      if (rep !== null) items = linesOf(data);
      else if (delim !== null) items = data.split(delim).filter(x => x !== '' && x !== '\n').map(x => x.replace(/\n$/, ''));
      else items = (data.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(x => x.replace(/^(["'])([\s\S]*)\1$/, '$2'));
      const run = (argv) => { if (verbose) io.err(argv.join(' ') + '\n'); const st = sh.invoke(argv, Object.assign({}, io, { stdin: new Stream('') })); return st; };
      let st = 0;
      if (rep !== null) {
        for (const it of items) if (run(cmd.map(a => a.split(rep).join(it)))) st = 123;
      } else if (n) {
        for (let k = 0; k < items.length; k += n) if (run([...cmd, ...items.slice(k, k + n)])) st = 123;
      } else if (items.length || !args.includes('-r')) {
        if (run([...cmd, ...items])) st = 123;
      }
      return st;
    },
    chmod(args, io, sh) {
      const rec = args.includes('-R');
      const rest = args.filter(a => a !== '-R' && a !== '-v');
      if (rest.length < 2) { io.err('chmod: missing operand\n'); return 1; }
      const mode = rest[0];
      let st = 0;
      const apply = (n) => {
        if (/^[0-7]{3,4}$/.test(mode)) { n.mode = parseInt(mode, 8) & 0o777; return; }
        for (const clause of mode.split(',')) {
          const m = /^([ugoa]*)([-+=])([rwxX]*)$/.exec(clause);
          if (!m) throw new ShellError(`invalid mode: '${mode}'`);
          const who = m[1] || 'a';
          let bits = 0;
          for (const w of who) {
            const shift = w === 'u' ? 6 : w === 'g' ? 3 : w === 'o' ? 0 : -1;
            const shifts = shift < 0 ? [6, 3, 0] : [shift];
            for (const s of shifts) for (const p of m[3]) bits |= ({ r: 4, w: 2, x: 1, X: n.type === 'dir' || (n.mode & 0o111) ? 1 : 0 }[p]) << s;
          }
          if (m[2] === '+') n.mode |= bits;
          else if (m[2] === '-') n.mode &= ~bits;
          else {
            let mask = 0;
            for (const w of who) { const shift = w === 'u' ? 6 : w === 'g' ? 3 : w === 'o' ? 0 : -1; (shift < 0 ? [6, 3, 0] : [shift]).forEach(s => mask |= 7 << s); }
            n.mode = (n.mode & ~mask) | bits;
          }
        }
      };
      const walk = (n) => { apply(n); if (rec && n.type === 'dir') Object.values(n.children).forEach(walk); };
      for (const f of rest.slice(1)) {
        const n = sh.fs.get(sh.abs(f));
        if (!n) { io.err(`chmod: cannot access '${f}': No such file or directory\n`); st = 1; continue; }
        walk(n);
      }
      return st;
    },
    chown() { return 0; },
    tee(args, io, sh) {
      const append = args.includes('-a');
      const files = args.filter(a => a !== '-a');
      const data = io.stdin.readAll();
      for (const f of files) { try { sh.writeFile(f, data, append); } catch (e) { io.err(`tee: ${f}: No such file or directory\n`); } }
      io.out(data);
      return 0;
    },
    seq(args, io) {
      const { o, rest } = getopt(args, 'sf', { allowed: 'swf', numericOk: true });
      const nums = rest.map(Number);
      if (!nums.length || nums.some(isNaN)) { io.err('seq: missing or invalid operand\n'); return 1; }
      let [first, step, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
      if (step === 0) { io.err('seq: invalid Zero increment value\n'); return 1; }
      const decimals = Math.max(...rest.map(r => (r.split('.')[1] || '').length));
      const out = [];
      for (let v = first, k = 0; step > 0 ? v <= last + 1e-9 : v >= last - 1e-9; k++, v = first + k * step) {
        out.push(decimals ? v.toFixed(decimals) : String(Math.round(v)));
        if (out.length > 1e5) break;
      }
      const w = o.w ? Math.max(...out.map(s => s.length)) : 0;
      io.out(out.map(s => w ? s.padStart(w, '0') : s).join(o.s !== undefined ? MB.backslashEscapes(o.s) : '\n') + '\n');
      return 0;
    },
    basename(args, io) {
      const a = args.filter(x => x !== '-a');
      if (!a.length) { io.err('basename: missing operand\n'); return 1; }
      const list = args.includes('-a') ? a : [a[0]];
      for (const p of list) {
        let b = p.replace(/\/+$/, '').split('/').pop() || '/';
        if (!args.includes('-a') && a[1] && b.endsWith(a[1]) && b !== a[1]) b = b.slice(0, -a[1].length);
        io.out(b + '\n');
      }
      return 0;
    },
    dirname(args, io) {
      if (!args.length) { io.err('dirname: missing operand\n'); return 1; }
      for (const p of args) { const t = p.replace(/\/+$/, ''); const k = t.lastIndexOf('/'); io.out((k < 0 ? '.' : k === 0 ? '/' : t.slice(0, k)) + '\n'); }
      return 0;
    },
    date(args, io) {
      const d = new Date();
      const fmt = args.find(a => a.startsWith('+'));
      const tz = 'EDT';
      if (!fmt) { io.out(`${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${tz} ${d.getFullYear()}\n`); return 0; }
      const map = {
        Y: d.getFullYear(), m: pad2(d.getMonth() + 1), d: pad2(d.getDate()), H: pad2(d.getHours()), M: pad2(d.getMinutes()), S: pad2(d.getSeconds()),
        y: pad2(d.getFullYear() % 100), b: MONTHS[d.getMonth()], B: d.toLocaleString('en-US', { month: 'long' }), a: DAYS[d.getDay()], A: d.toLocaleString('en-US', { weekday: 'long' }),
        j: String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5)).padStart(3, '0'), s: Math.floor(d / 1000), F: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
        T: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`, Z: tz, e: String(d.getDate()).padStart(2), u: d.getDay() || 7, n: '\n', t: '\t', '%': '%'
      };
      io.out(fmt.slice(1).replace(/%([a-zA-Z%])/g, (m, c) => map[c] !== undefined ? map[c] : m) + '\n');
      return 0;
    },
    whoami(args, io, sh) { io.out(sh.user + '\n'); return 0; },
    hostname(args, io, sh) { io.out(sh.host + '\n'); return 0; },
    id(args, io, sh) { io.out(`uid=1000(${sh.user}) gid=1000(${sh.user}) groups=1000(${sh.user}),27(sudo)\n`); return 0; },
    uname(args, io) { io.out(args.includes('-a') ? 'Linux lab 6.8.0-minibash #1 SMP x86_64 GNU/Linux\n' : 'Linux\n'); return 0; },
    sleep() { return 0; },
    sudo(args, io, sh) { io.err('[sudo] this practice shell has no root account; running as student\n'); return args.length ? sh.invoke(args, io) : 1; },
    rev(args, io, sh) {
      let st = 0;
      for (const inp of inputs(args, io, sh, 'rev')) { if (inp.content === null) { st = 1; continue; } io.out(joinLines(linesOf(inp.content).map(l => [...l].reverse().join('')))); }
      return st;
    },
    tac(args, io, sh) {
      let st = 0;
      for (const inp of inputs(args, io, sh, 'tac')) { if (inp.content === null) { st = 1; continue; } io.out(joinLines(linesOf(inp.content).reverse())); }
      return st;
    },
    nl(args, io, sh) {
      const { o, rest } = getopt(args, 'bswv', { allowed: 'bswv' });
      let n = o.v ? +o.v - 1 : 0;
      const w = o.w ? +o.w : 6;
      const sep = o.s !== undefined ? o.s : '\t';
      let st = 0;
      for (const inp of inputs(rest, io, sh, 'nl')) {
        if (inp.content === null) { st = 1; continue; }
        io.out(joinLines(linesOf(inp.content).map(l => (l === '' && o.b !== 'a') ? '' : `${String(++n).padStart(w)}${sep}${l}`)));
      }
      return st;
    },
    paste(args, io, sh) {
      const { o, rest } = getopt(args, 'd', { allowed: 'ds' });
      const delims = o.d !== undefined ? [...MB.backslashEscapes(o.d)] : ['\t'];
      const ins = inputs(rest, io, sh, 'paste');
      if (ins.some(x => x.content === null)) return 1;
      const cols = ins.map(x => linesOf(x.content));
      if (o.s) { io.out(cols.map(ls => ls.reduce((acc, l, i) => i === 0 ? l : acc + delims[(i - 1) % delims.length] + l, '')).join('\n') + '\n'); return 0; }
      const rows = Math.max(0, ...cols.map(c => c.length));
      let out = '';
      for (let r = 0; r < rows; r++) out += cols.map(c => c[r] ?? '').reduce((acc, v, i) => i === 0 ? v : acc + delims[(i - 1) % delims.length] + v, '') + '\n';
      io.out(out);
      return 0;
    },
    comm(args, io, sh) {
      const { o, rest } = getopt(args, '', { allowed: '123' });
      const ins = inputs(rest, io, sh, 'comm');
      if (ins.length < 2 || ins.some(x => x.content === null)) { if (ins.length < 2) io.err('comm: missing operand\n'); return 1; }
      const a = linesOf(ins[0].content), b = linesOf(ins[1].content);
      let i = 0, j = 0, out = '';
      const col = (k, s) => {
        if (o[String(k)]) return;
        let pre = '';
        for (let c = 1; c < k; c++) if (!o[String(c)]) pre += '\t';
        out += pre + s + '\n';
      };
      while (i < a.length || j < b.length) {
        if (j >= b.length || (i < a.length && a[i] < b[j])) col(1, a[i++]);
        else if (i >= a.length || b[j] < a[i]) col(2, b[j++]);
        else { col(3, a[i]); i++; j++; }
      }
      io.out(out);
      return 0;
    },
    diff(args, io, sh) {
      const files = args.filter(a => !a.startsWith('-'));
      const ins = inputs(files, io, sh, 'diff');
      if (ins.length < 2 || ins.some(x => x.content === null)) return 2;
      const a = linesOf(ins[0].content), b = linesOf(ins[1].content);
      if (args.includes('-q')) { if (ins[0].content !== ins[1].content) { io.out(`Files ${files[0]} and ${files[1]} differ\n`); return 1; } return 0; }
      // LCS-based normal diff
      const n = a.length, m = b.length;
      const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      const hunks = [];
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { i++; j++; continue; }
        const si = i, sj = j;
        while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
          if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) i++; else j++;
        }
        hunks.push([si, i, sj, j]);
      }
      const rng = (s, e) => e - s === 1 ? String(s + 1) : `${s + 1},${e}`;
      let out = '';
      for (const [si, ei, sj, ej] of hunks) {
        if (si === ei) out += `${si}a${rng(sj, ej)}\n`;
        else if (sj === ej) out += `${rng(si, ei)}d${sj}\n`;
        else out += `${rng(si, ei)}c${rng(sj, ej)}\n`;
        for (let k = si; k < ei; k++) out += `< ${a[k]}\n`;
        if (si !== ei && sj !== ej) out += '---\n';
        for (let k = sj; k < ej; k++) out += `> ${b[k]}\n`;
      }
      io.out(out);
      return hunks.length ? 1 : 0;
    },
    column(args, io, sh) {
      const { o, rest } = getopt(args, 's', { allowed: 'ts' });
      let st = 0;
      const lines = [];
      for (const inp of inputs(rest, io, sh, 'column')) { if (inp.content === null) { st = 1; continue; } lines.push(...linesOf(inp.content)); }
      if (!o.t) { io.out(columns(lines.filter(Boolean))); return st; }
      const sep = o.s !== undefined ? new RegExp('[' + o.s.replace(/[\]\\^-]/g, '\\$&') + ']') : /\s+/;
      const rows = lines.filter(l => l.trim() !== '').map(l => (o.s !== undefined ? l : l.trim()).split(sep));
      const widths = [];
      rows.forEach(r => r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, c.length); }));
      io.out(rows.map(r => r.map((c, i) => i === r.length - 1 ? c : c.padEnd(widths[i] + 2)).join('')).join('\n') + (rows.length ? '\n' : ''));
      return st;
    },
    tree(args, io, sh) {
      const { o, rest } = getopt(args, 'L', { allowed: 'adL' });
      const root = rest[0] || '.';
      const n = sh.fs.get(sh.abs(root));
      if (!n || n.type !== 'dir') { io.err(`${root} [error opening dir]\n`); return 2; }
      let dirs = 0, files = 0, out = root + '\n';
      const max = o.L ? +o.L : Infinity;
      const walk = (node, prefix, depth) => {
        if (depth > max) return;
        const keys = Object.keys(node.children).filter(k => o.a || !k.startsWith('.')).filter(k => !o.d || node.children[k].type === 'dir').sort(nameCompare);
        keys.forEach((k, i) => {
          const last = i === keys.length - 1;
          const c = node.children[k];
          out += prefix + (last ? '└── ' : '├── ') + k + '\n';
          if (c.type === 'dir') { dirs++; walk(c, prefix + (last ? '    ' : '│   '), depth + 1); } else files++;
        });
      };
      walk(n, '', 1);
      out += `\n${dirs} director${dirs === 1 ? 'y' : 'ies'}${o.d ? '' : `, ${files} file${files === 1 ? '' : 's'}`}\n`;
      io.out(out);
      return 0;
    },
    du(args, io, sh) {
      const { o, rest } = getopt(args, 'd', { allowed: 'shacd' });
      const targets = rest.length ? rest : ['.'];
      const size = (n) => n.type === 'file' ? Math.max(4, Math.ceil(sizeOf(n) / 4096) * 4) : 4 + Object.values(n.children).reduce((a, c) => a + size(c), 0);
      const fmt = k => o.h ? human(k * 1024) : String(k);
      for (const t of targets) {
        const n = sh.fs.get(sh.abs(t));
        if (!n) { io.err(`du: cannot access '${t}': No such file or directory\n`); continue; }
        const walk = (node, path) => {
          if (node.type === 'dir' && !o.s) for (const k of Object.keys(node.children).sort(nameCompare)) { const c = node.children[k]; if (c.type === 'dir' || o.a) walk(c, path + '/' + k); }
          if (node.type === 'dir' || o.a || path === t) io.out(`${fmt(size(node))}\t${path}\n`);
        };
        walk(n, t.replace(/\/$/, '') || '/');
      }
      return 0;
    },
    file(args, io, sh) {
      for (const f of args) {
        const n = sh.fs.get(sh.abs(f));
        if (!n) { io.out(`${f}: cannot open \`${f}' (No such file or directory)\n`); continue; }
        let t;
        if (n.type === 'dir') t = 'directory';
        else if (!n.content.length) t = 'empty';
        else if (/^#!.*\b(bash|sh)\b/.test(n.content)) t = 'Bourne-Again shell script, ASCII text executable';
        else if (/^#!.*python/.test(n.content)) t = 'Python script, ASCII text executable';
        else if (/\.csv$/.test(f)) t = 'CSV text';
        else if (/\.(jpg|jpeg)$/i.test(f)) t = 'JPEG image data';
        else if (/\.png$/i.test(f)) t = 'PNG image data';
        else if (/<html/i.test(n.content)) t = 'HTML document, ASCII text';
        else t = 'ASCII text';
        io.out(`${f}: ${t}\n`);
      }
      return 0;
    },
    stat(args, io, sh) {
      let st = 0;
      for (const f of args.filter(a => !a.startsWith('-'))) {
        const n = sh.fs.get(sh.abs(f));
        if (!n) { io.err(`stat: cannot statx '${f}': No such file or directory\n`); st = 1; continue; }
        const d = new Date(n.mtime);
        io.out(`  File: ${f}\n  Size: ${sizeOf(n)}\tBlocks: ${Math.ceil(sizeOf(n) / 512)}\t${n.type === 'dir' ? 'directory' : 'regular file'}\nAccess: (0${(n.mode & 0o777).toString(8)}/${modeString(n)})  Uid: ( 1000/ ${sh.user})   Gid: ( 1000/ ${sh.user})\nModify: ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}\n`);
      }
      return st;
    },
    expr(args, io) {
      // supports: a op b with + - * / % = != < > <= >=, length STR, substr, index, match/:
      try {
        let v;
        if (args[0] === 'length') v = args[1].length;
        else if (args[0] === 'substr') v = args[1].substr(+args[2] - 1, +args[3]);
        else if (args[0] === 'index') { const k = [...args[1]].findIndex(c => args[2].includes(c)); v = k + 1; }
        else if (args.length === 3 && (args[1] === ':' || args[0] === 'match')) {
          const s = args[1] === ':' ? args[0] : args[1], p = args[2];
          const m = new RegExp('^(?:' + MB.breToJs(p) + ')').exec(s);
          v = m ? (m[1] !== undefined ? m[1] : m[0].length) : (/\\\(/.test(p) ? '' : 0);
        } else {
          let i = 0;
          const prim = () => { const t = args[i++]; if (t === '(') { const r = orE(); i++; return r; } return t; };
          const num = x => { if (!/^-?\d+$/.test(String(x))) throw new ShellError('non-integer argument'); return parseInt(x, 10); };
          const mulE = () => { let l = prim(); while (['*', '/', '%'].includes(args[i])) { const op = args[i++]; const r = prim(); if ((op === '/' || op === '%') && num(r) === 0) throw new ShellError('division by zero'); l = op === '*' ? num(l) * num(r) : op === '/' ? Math.trunc(num(l) / num(r)) : num(l) % num(r); } return l; };
          const addE = () => { let l = mulE(); while (['+', '-'].includes(args[i])) { const op = args[i++]; const r = mulE(); l = op === '+' ? num(l) + num(r) : num(l) - num(r); } return l; };
          const cmpE = () => { let l = addE(); while (['=', '!=', '<', '>', '<=', '>='].includes(args[i])) { const op = args[i++]; const r = addE(); const both = /^-?\d+$/.test(l) && /^-?\d+$/.test(r); const x = both ? +l : String(l), y = both ? +r : String(r); l = ({ '=': x === y, '!=': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[op]) ? 1 : 0; } return l; };
          const andE = () => { let l = cmpE(); while (args[i] === '&') { i++; const r = cmpE(); l = (l && l !== '0' && r && r !== '0') ? l : 0; } return l; };
          const orE = () => { let l = andE(); while (args[i] === '|') { i++; const r = andE(); l = (l && l !== '0') ? l : r; } return l; };
          v = orE();
          if (i < args.length) throw new ShellError('syntax error');
        }
        io.out(v + '\n');
        return (v === 0 || v === '' || v === '0') ? 1 : 0;
      } catch (e) {
        if (e instanceof ShellError) { io.err(`expr: ${e.message}\n`); return 2; }
        throw e;
      }
    },
    bc(args, io) {
      const mathlib = args.includes('-l');
      let scale = mathlib ? 20 : 0;
      const vars = Object.create(null);
      const src = io.stdin.readAll();
      let out = '';
      const fmtNum = v => {
        if (scale === 0) return String(Math.trunc(v));
        let s = (Math.trunc(v * Math.pow(10, scale)) / Math.pow(10, scale)).toFixed(scale);
        if (s.startsWith('0.')) s = s.slice(1);
        if (s.startsWith('-0.')) s = '-' + s.slice(2);
        return s;
      };
      for (let stmt of src.split(/[;\n]/)) {
        stmt = stmt.replace(/#.*$/, '').trim();
        if (!stmt || stmt === 'quit') continue;
        const am = /^([a-z_]\w*)\s*=\s*([\s\S]+)$/.exec(stmt);
        const evalExpr = (e) => {
          const toks = e.match(/\d*\.\d+|\d+|[a-z_]\w*|\*\*|[-+*/%^()]/g) || [];
          let i = 0;
          const prim = () => {
            const t = toks[i++];
            if (t === '(') { const v = add(); i++; return v; }
            if (t === '-') return -pw();
            if (/^[\d.]/.test(t)) return parseFloat(t);
            if (toks[i] === '(') { i++; const a = add(); i++; const f = { s: Math.sin, c: Math.cos, l: Math.log, e: Math.exp, a: Math.atan, sqrt: Math.sqrt, length: x => String(x).replace(/[-.]/g, '').length }[t]; return f ? f(a) : 0; }
            if (t === 'scale') return scale;
            return vars[t] || 0;
          };
          const pw = () => { const b = prim(); if (toks[i] === '^') { i++; return Math.pow(b, pw()); } return b; };
          const trunc = v => scale ? Math.trunc(v * Math.pow(10, scale)) / Math.pow(10, scale) : Math.trunc(v);
          const mul = () => { let v = pw(); while ('*/%'.includes(toks[i]) && toks[i]) { const op = toks[i++]; const r = pw(); if (op !== '*' && r === 0) throw new ShellError('Runtime error: Divide by zero'); v = op === '*' ? v * r : op === '/' ? trunc(v / r) : v - r * trunc(v / r); } return v; };
          const add = () => { let v = mul(); while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++]; const r = mul(); v = op === '+' ? v + r : v - r; } return v; };
          return add();
        };
        try {
          if (am) { const v = evalExpr(am[2]); if (am[1] === 'scale') scale = Math.trunc(v); else vars[am[1]] = v; continue; }
          out += fmtNum(evalExpr(stmt)) + '\n';
        } catch (e) { if (e instanceof ShellError) { io.err(e.message + '\n'); continue; } throw e; }
      }
      io.out(out);
      return 0;
    },
    which(args, io, sh) {
      let st = 0;
      for (const a of args) { if (COMMANDS[a] || BUILTINS[a]) io.out(`/usr/bin/${a}\n`); else st = 1; }
      void sh;
      return st;
    },
    env(args, io, sh) {
      if (args.length) {
        const assigns = []; let i = 0;
        while (i < args.length && /^[A-Za-z_]\w*=/.test(args[i])) assigns.push(args[i++]);
        sh.scopes.push(new Map(assigns.map(a => { const k = a.indexOf('='); return [a.slice(0, k), { v: a.slice(k + 1), exported: true }]; })));
        try { return i < args.length ? sh.invoke(args.slice(i), io) : 0; } finally { sh.scopes.pop(); }
      }
      const seen = new Map();
      for (const m of sh.scopes) for (const [k, e] of m) if (e.exported && typeof e.v === 'string') seen.set(k, e.v);
      seen.set('PWD', sh.cwd);
      io.out([...seen].sort().map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
      return 0;
    },
    printenv(args, io, sh) {
      if (!args.length) return COMMANDS.env([], io, sh);
      let st = 0;
      for (const a of args) { const e = sh.lookup(a); if (e && e.exported) io.out((a === 'PWD' ? sh.cwd : e.v) + '\n'); else st = 1; }
      return st;
    },
    bash(args, io, sh) { return shellCmd(args, io, sh); },
    sh(args, io, sh) { return shellCmd(args, io, sh); },
    man(args, io) {
      if (!args.length) { io.err('What manual page do you want?\n'); return 1; }
      const t = MAN[args[0]] || (BUILTINS[args[0]] ? `${args[0]} — shell builtin. Try: help` : null);
      if (!t) { io.err(`No manual entry for ${args[0]}\n`); return 16; }
      io.out(`${args[0].toUpperCase()}(1)\n\n  ${t}\n\n(This is a short summary. Real man pages: run \`man ${args[0]}\` in a real terminal.)\n`);
      return 0;
    },
    less(args, io, sh) { return COMMANDS.cat(args, io, sh); },
    more(args, io, sh) { return COMMANDS.cat(args, io, sh); },
    yes(args, io) { io.out(Array(200).fill(args.join(' ') || 'y').join('\n') + '\n'); return 0; },
    ln(args, io) { io.err('ln: links are not supported in this simulator\n'); return 1; },
    nano(args, io) { io.err('nano: interactive editors are not available here — use echo/cat with > or a heredoc to write files\n'); return 1; },
    vim(args, io) { io.err('vim: interactive editors are not available here — use echo/cat with > or a heredoc to write files\n'); return 1; },
    vi(args, io) { return COMMANDS.vim(args, io); },
    python3(args, io) { io.err('python3: not available in this bash simulator\n'); return 127; }
  };
  COMMANDS.python = COMMANDS.python3;

  function shellCmd(args, io, sh) {
    if (args[0] === '-c') {
      const savedPos = sh.pos;
      return sh.subshell(() => {
        sh.pos = args.slice(3);
        if (args[2]) sh.argv0 = args[2];
        try { return sh.execSource(args[1] || '', io); }
        catch (e) { if (e instanceof ExitSig) return e.code; if (e instanceof SyntaxErr) { io.err(`bash: -c: ${e.message}\n`); return 2; } throw e; }
        finally { void savedPos; }
      }, true);
    }
    const flags = [];
    while (args[0] && /^-[xeun]+$/.test(args[0])) flags.push(args.shift());
    if (!args.length) { io.err('bash: interactive subshells are not supported here; pass a script file\n'); return 1; }
    if (flags.some(f => f.includes('n'))) {
      const c = sh.readFile(args[0]);
      if (c === null) { io.err(`bash: ${args[0]}: No such file or directory\n`); return 127; }
      try { parse(c); return 0; } catch (e) { if (e instanceof SyntaxErr) { io.err(`${args[0]}: ${e.message}\n`); return 2; } throw e; }
    }
    if (flags.length) {
      const c = sh.readFile(args[0]);
      if (c === null) { io.err(`bash: ${args[0]}: No such file or directory\n`); return 127; }
      const pre = flags.map(f => `set ${f}`).join('\n') + '\n';
      const tmp = '/tmp/.mb_' + Math.random().toString(36).slice(2);
      sh.fs.mkdirp('/tmp');
      sh.writeFile(tmp, pre + c, false);
      try { return sh.runScriptFile(tmp, args.slice(1), io, false); } finally { delete sh.fs.get('/tmp').children[tmp.split('/').pop()]; }
    }
    return sh.runScriptFile(args[0], args.slice(1), io, false);
  }

  function headTail(args, io, sh, which) {
    const norm = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (/^-\d+$/.test(a) && args[i - 1] !== '-n' && args[i - 1] !== '-c') { norm.push('-n', a.slice(1)); continue; }
      norm.push(a);
    }
    const { o, rest } = getopt(norm, 'nc', { allowed: 'ncqvf', long: { lines: 'n', bytes: 'c', quiet: 'q', verbose: 'v', follow: 'f' } });
    let st = 0;
    const ins = inputs(rest, io, sh, which);
    const multi = ins.length > 1 && !o.q;
    ins.forEach((inp, idx) => {
      if (inp.content === null) { st = 1; return; }
      if (multi || o.v) io.out(`${idx ? '\n' : ''}==> ${inp.name === '-' ? 'standard input' : inp.name} <==\n`);
      if (o.c !== undefined) {
        const s = String(o.c); const k = parseInt(s, 10);
        const c = inp.content;
        io.out(which === 'head' ? (k < 0 ? c.slice(0, k) : c.slice(0, k)) : (s.startsWith('+') ? c.slice(k - 1) : c.slice(-k)));
        return;
      }
      const s = o.n === undefined ? '10' : String(o.n);
      const ls = linesOf(inp.content);
      let k = parseInt(s, 10);
      if (isNaN(k)) throw new ShellError(`invalid number of lines: '${s}'`);
      let sel;
      if (which === 'head') sel = k < 0 || s.startsWith('-') ? ls.slice(0, Math.max(0, ls.length + k)) : ls.slice(0, k);
      else sel = s.startsWith('+') ? ls.slice(Math.max(0, k - 1)) : (k === 0 ? [] : ls.slice(-Math.abs(k)));
      const trailing = inp.content.endsWith('\n') || !inp.content.length;
      let text = joinLines(sel);
      if (!trailing && sel.length && sel[sel.length - 1] === ls[ls.length - 1] && (which === 'tail' || sel.length === ls.length)) text = text.slice(0, -1);
      io.out(text);
    });
    return st;
  }

  function grepImpl(args, io, sh, extended) {
    const norm = [];
    for (const a of args) norm.push(a);
    let o, rest;
    ({ o, rest } = getopt(norm, 'eABCmf', {
      allowed: 'ivcnlLowxErhHqsFRABCmeIPzZf', multi: 'e',
      long: { 'ignore-case': 'i', 'invert-match': 'v', count: 'c', 'line-number': 'n', 'files-with-matches': 'l', 'files-without-match': 'L', 'only-matching': 'o', 'word-regexp': 'w', 'line-regexp': 'x', 'extended-regexp': 'E', recursive: 'r', 'no-filename': 'h', 'with-filename': 'H', quiet: 'q', silent: 'q', 'fixed-strings': 'F', 'max-count': 'm', include: 'U', color: 'K' }
    }));
    const patterns = o.e ? o.e.slice() : [];
    if (o.f) { const c = sh.readFile(o.f); if (c === null) { io.err(`grep: ${o.f}: No such file or directory\n`); return 2; } patterns.push(...linesOf(c)); }
    if (!patterns.length) {
      if (!rest.length) { io.err('Usage: grep [OPTION]... PATTERNS [FILE]...\n'); return 2; }
      patterns.push(rest.shift());
    }
    const ere = extended || !!o.E || !!o.P;
    let re;
    try {
      const srcs = patterns.flatMap(p => p.split('\n')).map(p => {
        const r = MB.makeRegex(p, { ere, fixed: !!o.F, word: !!o.w, line: !!o.x });
        return r.source;
      });
      re = new RegExp(srcs.map(s => '(?:' + s + ')').join('|'), 'g' + (o.i ? 'i' : ''));
    } catch (e) { io.err(`grep: Invalid regular expression\n`); return 2; }
    const recursive = o.r || o.R;
    let files = rest;
    if (recursive && !files.length) files = ['.'];
    const list = [];
    if (recursive) {
      for (const f of files) {
        const n = sh.fs.get(sh.abs(f));
        if (!n) { io.err(`grep: ${f}: No such file or directory\n`); continue; }
        const walk = (node, path) => {
          if (node.type === 'file') { if (!o.U || MB.globMatch(o.U, path.split('/').pop())) list.push({ name: path, content: node.content }); return; }
          for (const k of Object.keys(node.children).sort(nameCompare)) walk(node.children[k], path === '.' ? k : path.replace(/\/$/, '') + '/' + k);
        };
        walk(n, f === '.' && !rest.length ? '.' : f);
        if (f === '.' && !rest.length) list.forEach(x => { x.name = x.name.replace(/^\.\//, ''); });
      }
    } else {
      for (const inp of inputs(files, io, sh, 'grep')) {
        if (inp.content === null) { list.push(null); continue; }
        const node = inp.name !== '-' ? sh.fs.get(sh.abs(inp.name)) : null;
        if (node && node.type === 'dir') { io.err(`grep: ${inp.name}: Is a directory\n`); continue; }
        list.push({ name: inp.name === '-' ? '(standard input)' : inp.name, content: inp.content });
      }
    }
    const showName = o.H || (!o.h && (list.length > 1 || recursive || files.length > 1));
    let any = false, err = list.includes(null);
    const A = +(o.A || o.C || 0), B = +(o.B || o.C || 0);
    let out = '';
    for (const f of list) {
      if (!f) continue;
      const lines = linesOf(f.content);
      let count = 0;
      const pre = (sep, i) => (showName ? f.name + sep : '') + (o.n ? (i + 1) + sep : '');
      let lastPrinted = -1;
      let afterLeft = 0;
      const max = o.m !== undefined ? +o.m : Infinity;
      for (let i = 0; i < lines.length; i++) {
        if (count >= max) break;
        re.lastIndex = 0;
        const hit = re.test(lines[i]) !== !!o.v;
        if (!hit) {
          if (afterLeft > 0 && !o.c && !o.l && !o.L && !o.q && !o.o) { out += pre('-', i) + lines[i] + '\n'; lastPrinted = i; afterLeft--; }
          continue;
        }
        count++; any = true;
        if (o.q || o.l || o.L || o.c) continue;
        if (B || A) {
          const from = Math.max(lastPrinted + 1, i - B);
          if (lastPrinted >= 0 && from > lastPrinted + 1) out += '--\n';
          for (let k = from; k < i; k++) out += pre('-', k) + lines[k] + '\n';
        }
        if (o.o && !o.v) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(lines[i]))) { if (m[0] === '') { re.lastIndex++; continue; } out += pre(':', i) + m[0] + '\n'; }
        } else out += pre(':', i) + lines[i] + '\n';
        lastPrinted = i;
        afterLeft = A;
      }
      if (o.c) out += (showName ? f.name + ':' : '') + count + '\n';
      if (o.l && count) out += f.name + '\n';
      if (o.L && !count) out += f.name + '\n';
    }
    if (o.q) return any ? 0 : (err ? 2 : 1);
    io.out(out);
    if (o.L) return out ? 0 : 1;
    return err && !any ? 2 : (any ? 0 : 1);
  }

  Object.assign(MB, { Shell, VFS, Stream, parse, lex, needsMore, getopt, nameCompare, humanSize: human, mkFile, mkDir, splitIFS, ShellError, SyntaxErr, BUILTINS, COMMANDS, BASE_TIME, shQuote });
})();
