/* awk.js — a POSIX awk subset: patterns, ranges, fields, associative arrays,
   printf, user functions, output redirection and pipes to commands. */
(function () {
  'use strict';
  const MB = globalThis.MB || (globalThis.MB = {});

  const KEYWORDS = new Set(['BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'nextfile', 'exit', 'return', 'delete', 'in', 'getline', 'print', 'printf']);
  const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'sin', 'cos', 'atan2', 'exp', 'log', 'sqrt', 'int', 'rand', 'srand', 'tolower', 'toupper', 'system', 'close', 'fflush']);
  const OPS = ['**=', '+=', '-=', '*=', '/=', '%=', '^=', '==', '<=', '>=', '!=', '++', '--', '&&', '||', '>>', '!~', '**',
    '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '>', '<', '|', '?', ':', '~', '$', '='];
  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '^=', '**=']);

  class AwkError extends Error {}

  function lex(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    const operandBefore = () => {
      const p = toks[toks.length - 1];
      if (!p) return false;
      if (p.t === 'num' || p.t === 'str' || p.t === 'name' || p.t === 'regex') return true;
      if (p.t === 'builtin' && p.v === 'length') return true;
      return p.t === 'op' && (p.v === ')' || p.v === ']' || p.v === '$' || p.v === '++' || p.v === '--');
    };
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
      if (c === '\n') { toks.push({ t: 'nl' }); i++; continue; }
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      if (num) { toks.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
      if (c === '"') {
        let s = ''; i++;
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < n) {
            const d = src[i + 1];
            const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/', a: '\x07', b: '\b', f: '\f', v: '\v' };
            if (map[d] !== undefined) { s += map[d]; i += 2; continue; }
            if (/[0-7]/.test(d)) { const m = /^[0-7]{1,3}/.exec(src.slice(i + 1)); s += String.fromCharCode(parseInt(m[0], 8)); i += 1 + m[0].length; continue; }
            s += '\\' + d; i += 2; continue;
          }
          if (src[i] === '\n') throw new AwkError('newline in string');
          s += src[i++];
        }
        if (i >= n) throw new AwkError('non-terminated string');
        i++;
        toks.push({ t: 'str', v: s });
        continue;
      }
      if (c === '/' && !operandBefore()) {
        let s = '', inBr = false; i++;
        while (i < n && (src[i] !== '/' || inBr)) {
          if (src[i] === '\n') throw new AwkError('newline in regex');
          if (src[i] === '\\' && i + 1 < n) {
            if (src[i + 1] === '/') { s += '/'; i += 2; continue; }
            s += src[i] + src[i + 1]; i += 2; continue;
          }
          if (src[i] === '[' && !inBr) { inBr = true; s += src[i++]; if (src[i] === '^') s += src[i++]; if (src[i] === ']') s += src[i++]; continue; }
          if (src[i] === ']' && inBr) inBr = false;
          s += src[i++];
        }
        if (i >= n) throw new AwkError('non-terminated regular expression');
        i++;
        toks.push({ t: 'regex', v: s });
        continue;
      }
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (id) {
        const w = id[0]; i += w.length;
        if (KEYWORDS.has(w)) toks.push({ t: 'kw', v: w });
        else if (BUILTINS.has(w)) toks.push({ t: 'builtin', v: w });
        else if (src[i] === '(') toks.push({ t: 'funcname', v: w });
        else toks.push({ t: 'name', v: w });
        continue;
      }
      const op = OPS.find(o => src.startsWith(o, i));
      if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue; }
      throw new AwkError(`syntax error at source line 1: unexpected character '${c}'`);
    }
    toks.push({ t: 'eof' });
    return toks;
  }

  const isLvalue = e => e && (e.type === 'var' || e.type === 'index' || e.type === 'field');

  class Parser {
    constructor(toks) { this.t = toks; this.i = 0; }
    peek(o = 0) { return this.t[this.i + o] || { t: 'eof' }; }
    next() { return this.t[this.i++] || { t: 'eof' }; }
    is(t, v) { const k = this.peek(); return k.t === t && (v === undefined || k.v === v); }
    isOp(v) { return this.is('op', v); }
    eat(t, v) { return this.is(t, v) ? this.next() : null; }
    fail(k) { k = k || this.peek(); throw new AwkError(`syntax error near '${k.v !== undefined ? k.v : (k.t === 'nl' ? 'newline' : 'end of program')}'`); }
    expect(t, v) { const k = this.next(); if (k.t !== t || (v !== undefined && k.v !== v)) this.fail(k); return k; }
    optNL() { while (this.is('nl')) this.i++; }
    terms() { while (this.is('nl') || this.isOp(';')) this.i++; }

    program() {
      const prog = { begin: [], end: [], rules: [], funcs: Object.create(null) };
      this.terms();
      while (!this.is('eof')) {
        if (this.is('kw', 'BEGIN')) { this.next(); this.optNL(); prog.begin.push(this.block()); }
        else if (this.is('kw', 'END')) { this.next(); this.optNL(); prog.end.push(this.block()); }
        else if (this.is('kw', 'function') || this.is('kw', 'func')) {
          this.next();
          const nm = this.next();
          if (nm.t !== 'name' && nm.t !== 'funcname') this.fail(nm);
          this.expect('op', '(');
          const params = [];
          while (!this.isOp(')')) { this.optNL(); params.push(this.expect('name').v); this.optNL(); if (!this.eat('op', ',')) break; }
          this.expect('op', ')'); this.optNL();
          prog.funcs[nm.v] = { params, body: this.block() };
        } else {
          let pattern = null, pattern2 = null, action = null;
          if (!this.isOp('{')) {
            pattern = this.expr();
            if (this.eat('op', ',')) { this.optNL(); pattern2 = this.expr(); }
          }
          if (this.isOp('{')) action = this.block();
          prog.rules.push({ pattern, pattern2, action, inRange: false });
        }
        this.terms();
      }
      return prog;
    }
    block() {
      this.expect('op', '{');
      const body = [];
      this.terms();
      while (!this.isOp('}')) { if (this.is('eof')) this.fail(); body.push(this.stmt()); this.terms(); }
      this.expect('op', '}');
      return { type: 'block', body };
    }
    atEnd() { return this.isOp(';') || this.is('nl') || this.isOp('}') || this.is('eof'); }
    simpleEnd() {
      if (this.isOp(';') || this.is('nl')) { this.next(); return; }
      if (this.isOp('}') || this.is('eof')) return;
      this.fail();
    }
    stmt() {
      const k = this.peek();
      if (k.t === 'op' && k.v === '{') return this.block();
      if (k.t === 'op' && k.v === ';') { this.next(); return { type: 'block', body: [] }; }
      if (k.t === 'kw') {
        switch (k.v) {
          case 'if': {
            this.next(); this.expect('op', '('); const cond = this.expr(); this.expect('op', ')'); this.optNL();
            const then = this.stmt();
            const save = this.i;
            this.terms();
            if (this.is('kw', 'else')) { this.next(); this.optNL(); return { type: 'if', cond, then, els: this.stmt() }; }
            this.i = save;
            return { type: 'if', cond, then, els: null };
          }
          case 'while': {
            this.next(); this.expect('op', '('); const cond = this.expr(); this.expect('op', ')');
            if (this.isOp(';')) { this.next(); return { type: 'while', cond, body: { type: 'block', body: [] } }; }
            this.optNL();
            return { type: 'while', cond, body: this.stmt() };
          }
          case 'do': {
            this.next(); this.optNL(); const body = this.stmt(); this.terms();
            this.expect('kw', 'while'); this.expect('op', '('); const cond = this.expr(); this.expect('op', ')'); this.simpleEnd();
            return { type: 'do', cond, body };
          }
          case 'for': {
            this.next(); this.expect('op', '(');
            if (this.is('name') && this.peek(1).t === 'kw' && this.peek(1).v === 'in' && this.peek(2).t === 'name' && this.peek(3).t === 'op' && this.peek(3).v === ')') {
              const v = this.next().v; this.next(); const arr = this.next().v; this.next(); this.optNL();
              return { type: 'forin', v, arr, body: this.stmt() };
            }
            const init = this.isOp(';') ? null : this.expr(); this.expect('op', ';'); this.optNL();
            const cond = this.isOp(';') ? null : this.expr(); this.expect('op', ';'); this.optNL();
            const step = this.isOp(')') ? null : this.expr(); this.expect('op', ')');
            if (this.isOp(';')) { this.next(); return { type: 'for', init, cond, step, body: { type: 'block', body: [] } }; }
            this.optNL();
            return { type: 'for', init, cond, step, body: this.stmt() };
          }
          case 'break': case 'continue': case 'next': case 'nextfile':
            this.next(); this.simpleEnd(); return { type: k.v };
          case 'exit': case 'return': {
            this.next(); const e = this.atEnd() ? null : this.expr(); this.simpleEnd();
            return { type: k.v, e };
          }
          case 'delete': {
            this.next(); const name = this.expect('name').v; let idx = null;
            if (this.eat('op', '[')) { idx = this.exprList(); this.expect('op', ']'); }
            this.simpleEnd();
            return { type: 'delete', name, idx };
          }
          case 'print': case 'printf': return this.printStmt();
          case 'getline': throw new AwkError('getline is not supported in this simulator');
        }
      }
      const e = this.expr();
      this.simpleEnd();
      return { type: 'expr', e };
    }
    printStmt() {
      const kind = this.next().v;
      let args = [];
      const redirNext = () => this.isOp('>') || this.isOp('>>') || this.isOp('|');
      if (!this.atEnd() && !redirNext()) {
        if (this.isOp('(')) {
          const save = this.i;
          let ok = false;
          try {
            this.next();
            const list = this.exprList(false);
            this.expect('op', ')');
            if (this.atEnd() || redirNext()) { args = list; ok = true; }
          } catch (e) { if (!(e instanceof AwkError)) throw e; }
          if (!ok) { this.i = save; args = this.exprList(true); }
        } else args = this.exprList(true);
      }
      let redir = null;
      if (redirNext()) { const op = this.next().v; redir = { op, target: this.concat(true) }; }
      this.simpleEnd();
      if (kind === 'printf' && !args.length) throw new AwkError('printf: no format');
      return { type: kind, args, redir };
    }
    exprList(noGt) {
      const list = [this.expr(noGt)];
      while (this.eat('op', ',')) { this.optNL(); list.push(this.expr(noGt)); }
      return list;
    }
    expr(noGt) { return this.ternary(noGt); }
    ternary(noGt) {
      const cond = this.or(noGt);
      if (this.eat('op', '?')) {
        this.optNL(); const a = this.ternary(noGt); this.optNL(); this.expect('op', ':'); this.optNL();
        const b = this.ternary(noGt);
        return { type: 'cond', cond, a, b };
      }
      const k = this.peek();
      if (k.t === 'op' && ASSIGN_OPS.has(k.v) && isLvalue(cond)) {
        this.next(); this.optNL();
        return { type: 'assign', op: k.v, target: cond, rhs: this.ternary(noGt) };
      }
      return cond;
    }
    or(noGt) { let l = this.and(noGt); while (this.isOp('||')) { this.next(); this.optNL(); l = { type: 'or', l, r: this.and(noGt) }; } return l; }
    and(noGt) { let l = this.inExpr(noGt); while (this.isOp('&&')) { this.next(); this.optNL(); l = { type: 'and', l, r: this.inExpr(noGt) }; } return l; }
    inExpr(noGt) {
      let l = this.match(noGt);
      while (this.is('kw', 'in')) { this.next(); l = { type: 'in', key: l, arr: this.expect('name').v }; }
      return l;
    }
    match(noGt) {
      let l = this.compare(noGt);
      while (this.isOp('~') || this.isOp('!~')) { const op = this.next().v; l = { type: 'match', neg: op === '!~', l, r: this.compare(noGt) }; }
      return l;
    }
    compare(noGt) {
      const l = this.concat(noGt);
      const k = this.peek();
      if (k.t === 'op' && ['<', '<=', '==', '!=', '>=', '>'].includes(k.v) && !(noGt && k.v === '>')) {
        this.next();
        return { type: 'cmp', op: k.v, l, r: this.concat(noGt) };
      }
      return l;
    }
    startsConcat() {
      const k = this.peek();
      if (['num', 'str', 'regex', 'name', 'funcname', 'builtin'].includes(k.t)) return true;
      return k.t === 'op' && (k.v === '$' || k.v === '(' || k.v === '!' && !(this.peek(1).t === 'op' && this.peek(1).v === '='));
    }
    concat(noGt) {
      let l = this.additive();
      while (this.startsConcat()) {
        if (this.isOp('!')) break;
        l = { type: 'concat', l, r: this.additive() };
      }
      void noGt;
      return l;
    }
    additive() {
      let l = this.mul();
      while (this.isOp('+') || this.isOp('-')) { const op = this.next().v; l = { type: 'bin', op, l, r: this.mul() }; }
      return l;
    }
    mul() {
      let l = this.unary();
      while (this.isOp('*') || this.isOp('/') || this.isOp('%')) { const op = this.next().v; l = { type: 'bin', op, l, r: this.unary() }; }
      return l;
    }
    unary() {
      if (this.isOp('!')) { this.next(); return { type: 'not', e: this.unary() }; }
      if (this.isOp('-')) { this.next(); return { type: 'neg', e: this.unary() }; }
      if (this.isOp('+')) { this.next(); return { type: 'pos', e: this.unary() }; }
      return this.power();
    }
    power() {
      const base = this.postfix();
      if (this.isOp('^') || this.isOp('**')) { this.next(); return { type: 'bin', op: '^', l: base, r: this.unary() }; }
      return base;
    }
    postfix() {
      if (this.isOp('++') || this.isOp('--')) { const op = this.next().v; return { type: 'preinc', op, target: this.postfix() }; }
      const e = this.primary();
      if (isLvalue(e) && (this.isOp('++') || this.isOp('--'))) { const op = this.next().v; return { type: 'postinc', op, target: e }; }
      return e;
    }
    fieldOperand() {
      if (this.isOp('++') || this.isOp('--')) { const op = this.next().v; return { type: 'preinc', op, target: this.primary() }; }
      if (this.isOp('-')) { this.next(); return { type: 'neg', e: this.fieldOperand() }; }
      return this.primary();
    }
    primary() {
      const k = this.next();
      switch (k.t) {
        case 'num': return { type: 'num', v: parseFloat(k.v) };
        case 'str': return { type: 'str', v: k.v };
        case 'regex': return { type: 'regex', src: k.v };
        case 'name':
          if (this.isOp('[')) { this.next(); const idx = this.exprList(); this.expect('op', ']'); return { type: 'index', name: k.v, idx }; }
          return { type: 'var', name: k.v };
        case 'funcname': {
          this.expect('op', '('); this.optNL();
          const args = this.isOp(')') ? [] : this.exprList();
          this.optNL(); this.expect('op', ')');
          return { type: 'call', name: k.v, args };
        }
        case 'builtin': {
          if (this.isOp('(')) {
            this.next(); this.optNL();
            const args = this.isOp(')') ? [] : this.exprList();
            this.optNL(); this.expect('op', ')');
            return { type: 'builtin', name: k.v, args };
          }
          if (k.v === 'length') return { type: 'builtin', name: 'length', args: [] };
          this.fail(k);
          break;
        }
        case 'op':
          if (k.v === '(') {
            const e = this.expr();
            if (this.isOp(',')) {
              const list = [e];
              while (this.eat('op', ',')) list.push(this.expr());
              this.expect('op', ')'); this.expect('kw', 'in');
              return { type: 'in', key: { type: 'multi', list }, arr: this.expect('name').v };
            }
            this.expect('op', ')');
            return { type: 'group', e };
          }
          if (k.v === '$') return { type: 'field', e: this.fieldOperand() };
          if (k.v === '-') return { type: 'neg', e: this.unary() };
          if (k.v === '!') return { type: 'not', e: this.unary() };
          break;
      }
      this.fail(k);
    }
  }

  class NextSig {}
  class ExitSig { constructor(code) { this.code = code; } }
  class BreakSig {}
  class ContinueSig {}
  class RetSig { constructor(v) { this.v = v; } }

  const NUMRE = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;
  function looksNumeric(v) { return typeof v === 'number' || v === undefined || (typeof v === 'string' && NUMRE.test(v)); }
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v === undefined || v === null) return 0;
    if (v instanceof Map) throw new AwkError("attempt to use array in a scalar context");
    const m = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(String(v));
    return m ? parseFloat(m[0]) : 0;
  }
  function truthy(v) {
    if (typeof v === 'number') return v !== 0;
    if (v === undefined) return false;
    if (typeof v === 'string' && NUMRE.test(v)) return parseFloat(v) !== 0;
    return v !== '';
  }

  class Interp {
    constructor(prog, opts) {
      this.prog = prog;
      this.sh = opts.sh;
      this.io = opts.io;
      this.g = Object.create(null);
      Object.assign(this.g, { FS: ' ', OFS: ' ', ORS: '\n', RS: '\n', NR: 0, FNR: 0, SUBSEP: '\x1c', RSTART: 0, RLENGTH: -1, CONVFMT: '%.6g', OFMT: '%.6g', FILENAME: '' });
      this.frame = null;
      this.rec = '';
      this.flds = null;
      this.reCache = new Map();
      this.outFiles = new Map();
      this.pipes = new Map();
      this.steps = 0;
      this.seed = 1;
      this.depth = 0;
    }
    str(v) {
      if (typeof v === 'number') {
        if (Number.isInteger(v)) return Math.abs(v) < 1e16 ? String(v) : v.toFixed(0);
        return MB.sprintf(this.g.CONVFMT, [v]).text;
      }
      if (v === undefined || v === null) return '';
      if (v instanceof Map) throw new AwkError("attempt to use array in a scalar context");
      return String(v);
    }
    regex(src) {
      let re = this.reCache.get(src);
      if (!re) {
        try { re = new RegExp(MB.ereToJs(src)); } catch (e) { throw new AwkError(`invalid regular expression: /${src}/`); }
        this.reCache.set(src, re);
      }
      return re;
    }
    tick() { if (++this.steps > 2e6) throw new AwkError('program ran too long (possible infinite loop)'); }

    // ----- records and fields -----
    setRecord(s) { this.rec = s; this.flds = null; }
    split() {
      if (this.flds) return;
      this.flds = [this.rec].concat(this.splitBy(this.rec, this.g.FS));
    }
    splitBy(s, fs) {
      fs = this.str(fs);
      if (fs === ' ') { const t = s.trim(); return t === '' ? [] : t.split(/[ \t\n]+/); }
      if (s === '') return [];
      if (fs === '') return s.split('');
      if (fs.length === 1 && fs !== '\\') return s.split(fs);
      return s.split(this.regex(fs));
    }
    getField(i) {
      if (i < 0) throw new AwkError(`trying to access out of range field ${i}`);
      if (i === 0) return this.rec;
      this.split();
      return i < this.flds.length ? this.flds[i] : '';
    }
    setField(i, v) {
      if (i === 0) { this.setRecord(this.str(v)); return; }
      this.split();
      while (this.flds.length <= i) this.flds.push('');
      this.flds[i] = this.str(v);
      this.rec = this.flds.slice(1).join(this.str(this.g.OFS));
    }
    setNF(n) {
      this.split();
      n = Math.max(0, Math.trunc(n));
      while (this.flds.length <= n) this.flds.push('');
      this.flds.length = n + 1;
      this.rec = this.flds.slice(1).join(this.str(this.g.OFS));
    }

    // ----- variables -----
    scope(name) { return this.frame && name in this.frame ? this.frame : this.g; }
    getVar(name) {
      if (name === 'NF') { this.split(); return this.flds.length - 1; }
      const v = this.scope(name)[name];
      if (v instanceof Map) throw new AwkError(`attempt to use array \`${name}' in a scalar context`);
      return v;
    }
    setVar(name, v) {
      if (name === 'NF') { this.setNF(toNum(v)); return; }
      const sc = this.scope(name);
      if (sc[name] instanceof Map) throw new AwkError(`attempt to use array \`${name}' in a scalar context`);
      sc[name] = v;
    }
    arr(name) {
      const sc = this.scope(name);
      let m = sc[name];
      if (m === undefined) { m = new Map(); sc[name] = m; }
      if (!(m instanceof Map)) throw new AwkError(`can't use scalar \`${name}' as array`);
      return m;
    }
    key(idx) { return idx.map(e => this.str(this.ev(e))).join(this.str(this.g.SUBSEP)); }
    store(t, v) {
      if (t.type === 'var') this.setVar(t.name, v);
      else if (t.type === 'index') this.arr(t.name).set(this.key(t.idx), v);
      else if (t.type === 'field') this.setField(Math.trunc(toNum(this.ev(t.e))), v);
      else throw new AwkError('assignment to non-lvalue');
      return v;
    }

    compare(a, b, op) {
      let r;
      if (looksNumeric(a) && looksNumeric(b) && !(typeof a === 'string' && typeof b === 'string' && (a === '' || b === ''))) {
        const x = toNum(a), y = toNum(b); r = x < y ? -1 : x > y ? 1 : 0;
      } else {
        const x = this.str(a), y = this.str(b); r = x < y ? -1 : x > y ? 1 : 0;
      }
      switch (op) { case '<': return r < 0; case '<=': return r <= 0; case '>': return r > 0; case '>=': return r >= 0; case '==': return r === 0; default: return r !== 0; }
    }

    ev(n) {
      switch (n.type) {
        case 'num': return n.v;
        case 'str': return n.v;
        case 'regex': return this.regex(n.src).test(this.rec) ? 1 : 0;
        case 'group': return this.ev(n.e);
        case 'var': return this.getVar(n.name);
        case 'index': {
          const m = this.arr(n.name), k = this.key(n.idx);
          if (!m.has(k)) m.set(k, undefined);
          return m.get(k);
        }
        case 'field': return this.getField(Math.trunc(toNum(this.ev(n.e))));
        case 'assign': {
          if (n.op === '=') return this.store(n.target, this.ev(n.rhs));
          const r = toNum(this.ev(n.rhs)), l = toNum(this.ev(n.target));
          return this.store(n.target, this.arith(n.op.replace('=', ''), l, r));
        }
        case 'cond': return truthy(this.ev(n.cond)) ? this.ev(n.a) : this.ev(n.b);
        case 'or': return truthy(this.ev(n.l)) || truthy(this.ev(n.r)) ? 1 : 0;
        case 'and': return truthy(this.ev(n.l)) && truthy(this.ev(n.r)) ? 1 : 0;
        case 'in': {
          const m = this.arr(n.arr);
          const k = n.key.type === 'multi' ? this.key(n.key.list) : this.str(this.ev(n.key));
          return m.has(k) ? 1 : 0;
        }
        case 'match': {
          const s = this.str(this.ev(n.l));
          const re = n.r.type === 'regex' ? this.regex(n.r.src) : this.regex(this.str(this.ev(n.r)));
          return re.test(s) !== n.neg ? 1 : 0;
        }
        case 'cmp': return this.compare(this.ev(n.l), this.ev(n.r), n.op) ? 1 : 0;
        case 'concat': return this.str(this.ev(n.l)) + this.str(this.ev(n.r));
        case 'bin': return this.arith(n.op, toNum(this.ev(n.l)), toNum(this.ev(n.r)));
        case 'not': return truthy(this.ev(n.e)) ? 0 : 1;
        case 'neg': return -toNum(this.ev(n.e));
        case 'pos': return toNum(this.ev(n.e));
        case 'preinc': return this.store(n.target, toNum(this.ev(n.target)) + (n.op === '++' ? 1 : -1));
        case 'postinc': { const old = toNum(this.ev(n.target)); this.store(n.target, old + (n.op === '++' ? 1 : -1)); return old; }
        case 'call': return this.call(n);
        case 'builtin': return this.builtin(n);
      }
      throw new AwkError('internal: unknown node ' + n.type);
    }
    arith(op, a, b) {
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new AwkError('division by zero'); return a / b;
        case '%': if (b === 0) throw new AwkError('division by zero in %'); return a % b;
        case '^': case '**': return Math.pow(a, b);
      }
      throw new AwkError('bad operator ' + op);
    }
    call(n) {
      const f = this.prog.funcs[n.name];
      if (!f) throw new AwkError(`calling undefined function ${n.name}`);
      if (++this.depth > 500) throw new AwkError('function call nesting too deep');
      const locals = Object.create(null);
      f.params.forEach((p, i) => {
        if (i >= n.args.length) { locals[p] = undefined; return; }
        const a = n.args[i];
        if (a.type === 'var') {
          const v = this.scope(a.name)[a.name];
          if (v instanceof Map) { locals[p] = v; return; }
        }
        locals[p] = this.ev(a);
      });
      const prev = this.frame;
      this.frame = locals;
      try { this.exec(f.body); return undefined; }
      catch (e) { if (e instanceof RetSig) return e.v; throw e; }
      finally { this.frame = prev; this.depth--; }
    }
    subst(n, global) {
      const [reN, replN, targetN] = n.args;
      if (!reN || !replN) throw new AwkError(`${n.name}: requires at least 2 arguments`);
      const src = reN.type === 'regex' ? reN.src : this.str(this.ev(reN));
      const re = new RegExp(this.regex(src).source, 'g');
      const repl = this.str(this.ev(replN));
      const target = targetN || { type: 'field', e: { type: 'num', v: 0 } };
      if (!isLvalue(target)) throw new AwkError(`${n.name}: third argument must be a variable`);
      const s = this.str(this.ev(target));
      let count = 0;
      const out = s.replace(re, (m) => {
        if (!global && count > 0) return m;
        count++;
        let r = '';
        for (let i = 0; i < repl.length; i++) {
          if (repl[i] === '\\' && repl[i + 1] === '&') { r += '&'; i++; }
          else if (repl[i] === '\\' && repl[i + 1] === '\\') { r += '\\'; i++; }
          else if (repl[i] === '&') r += m;
          else r += repl[i];
        }
        return r;
      });
      if (count) this.store(target, out);
      return count;
    }
    builtin(n) {
      const a = n.args;
      const S = i => this.str(this.ev(a[i]));
      const N = i => toNum(this.ev(a[i]));
      switch (n.name) {
        case 'length': {
          if (!a.length) return this.rec.length;
          if (a[0].type === 'var') { const v = this.scope(a[0].name)[a[0].name]; if (v instanceof Map) return v.size; }
          return S(0).length;
        }
        case 'substr': {
          const s = S(0), m = Math.round(N(1));
          let end = a.length > 2 ? m + Math.round(N(2)) : s.length + 1;
          const from = Math.max(m, 1);
          end = Math.min(end, s.length + 1);
          return end > from ? s.slice(from - 1, end - 1) : '';
        }
        case 'index': return S(0).indexOf(S(1)) + 1;
        case 'split': {
          if (!a[1] || a[1].type !== 'var') throw new AwkError('split: second argument is not an array');
          const s = S(0);
          let parts;
          if (a.length > 2) parts = a[2].type === 'regex' ? (s === '' ? [] : s.split(this.regex(a[2].src))) : this.splitBy(s, this.ev(a[2]));
          else parts = this.splitBy(s, this.g.FS);
          const m = this.arr(a[1].name);
          m.clear();
          parts.forEach((p, i) => m.set(String(i + 1), p));
          return parts.length;
        }
        case 'sub': return this.subst(n, false);
        case 'gsub': return this.subst(n, true);
        case 'match': {
          const s = S(0);
          const src = a[1].type === 'regex' ? a[1].src : S(1);
          const m = this.regex(src).exec(s);
          this.g.RSTART = m ? m.index + 1 : 0;
          this.g.RLENGTH = m ? m[0].length : -1;
          return this.g.RSTART;
        }
        case 'sprintf': {
          if (!a.length) throw new AwkError('sprintf: no format');
          const vals = a.slice(1).map(e => this.ev(e));
          return MB.sprintf(S(0), vals, { toNum, toStr: v => this.str(v) }).text;
        }
        case 'tolower': return S(0).toLowerCase();
        case 'toupper': return S(0).toUpperCase();
        case 'int': return Math.trunc(N(0));
        case 'sqrt': return Math.sqrt(N(0));
        case 'exp': return Math.exp(N(0));
        case 'log': return Math.log(N(0));
        case 'sin': return Math.sin(N(0));
        case 'cos': return Math.cos(N(0));
        case 'atan2': return Math.atan2(N(0), N(1));
        case 'rand': { this.seed = (this.seed * 1103515245 + 12345) % 2147483648; return this.seed / 2147483648; }
        case 'srand': { const prev = this.seed; this.seed = a.length ? Math.trunc(N(0)) : 0; return prev; }
        case 'system': {
          this.flushPipes();
          return this.sh ? this.sh.runSubcommand(S(0), this.io) : 0;
        }
        case 'close': {
          const k = S(0);
          if (this.pipes.has(k)) { this.flushPipe(k); }
          this.outFiles.delete(k);
          return 0;
        }
        case 'fflush': return 0;
      }
      throw new AwkError('unknown function ' + n.name);
    }

    output(text, redir) {
      if (!redir) { this.io.out(text); return; }
      const target = this.str(this.ev(redir.target));
      if (redir.op === '|') { this.pipes.set(target, (this.pipes.get(target) || '') + text); return; }
      if (target === '/dev/stdout' || target === '-') { this.io.out(text); return; }
      if (target === '/dev/stderr') { this.io.err(text); return; }
      if (!this.outFiles.has(target)) {
        this.outFiles.set(target, true);
        this.sh.writeFile(target, text, redir.op === '>>');
      } else this.sh.writeFile(target, text, true);
    }
    flushPipe(cmd) {
      const data = this.pipes.get(cmd);
      this.pipes.delete(cmd);
      if (this.sh) this.sh.runSubcommand(cmd, this.io, data);
    }
    flushPipes() { for (const k of [...this.pipes.keys()]) this.flushPipe(k); }

    exec(s) {
      this.tick();
      switch (s.type) {
        case 'block': for (const x of s.body) this.exec(x); return;
        case 'expr': this.ev(s.e); return;
        case 'print': {
          const text = s.args.length ? s.args.map(e => this.outStr(this.ev(e))).join(this.str(this.g.OFS)) : this.rec;
          this.output(text + this.str(this.g.ORS), s.redir);
          return;
        }
        case 'printf': {
          const vals = s.args.map(e => this.ev(e));
          const fmt = this.str(vals.shift());
          this.output(MB.sprintf(fmt, vals, { toNum, toStr: v => this.str(v) }).text, s.redir);
          return;
        }
        case 'if': if (truthy(this.ev(s.cond))) this.exec(s.then); else if (s.els) this.exec(s.els); return;
        case 'while':
          while (truthy(this.ev(s.cond))) { this.tick(); try { this.exec(s.body); } catch (e) { if (e instanceof BreakSig) break; if (!(e instanceof ContinueSig)) throw e; } }
          return;
        case 'do':
          do { this.tick(); try { this.exec(s.body); } catch (e) { if (e instanceof BreakSig) break; if (!(e instanceof ContinueSig)) throw e; } } while (truthy(this.ev(s.cond)));
          return;
        case 'for':
          if (s.init) this.ev(s.init);
          while (!s.cond || truthy(this.ev(s.cond))) {
            this.tick();
            try { this.exec(s.body); } catch (e) { if (e instanceof BreakSig) break; if (!(e instanceof ContinueSig)) throw e; }
            if (s.step) this.ev(s.step);
          }
          return;
        case 'forin': {
          const keys = [...this.arr(s.arr).keys()];
          for (const k of keys) {
            this.tick();
            this.setVar(s.v, k);
            try { this.exec(s.body); } catch (e) { if (e instanceof BreakSig) break; if (!(e instanceof ContinueSig)) throw e; }
          }
          return;
        }
        case 'break': throw new BreakSig();
        case 'continue': throw new ContinueSig();
        case 'next': case 'nextfile': throw new NextSig();
        case 'exit': throw new ExitSig(s.e ? Math.trunc(toNum(this.ev(s.e))) : 0);
        case 'return': throw new RetSig(s.e ? this.ev(s.e) : undefined);
        case 'delete': {
          const m = this.arr(s.name);
          if (s.idx) m.delete(this.key(s.idx)); else m.clear();
          return;
        }
      }
      throw new AwkError('internal: unknown statement ' + s.type);
    }
    outStr(v) {
      if (typeof v === 'number' && !Number.isInteger(v)) return MB.sprintf(this.g.OFMT, [v]).text;
      return this.str(v);
    }
    matches(rule) {
      if (!rule.pattern) return true;
      if (!rule.pattern2) return truthy(this.ev(rule.pattern));
      if (!rule.inRange) {
        if (truthy(this.ev(rule.pattern))) { rule.inRange = !truthy(this.ev(rule.pattern2)); return true; }
        return false;
      }
      if (truthy(this.ev(rule.pattern2))) rule.inRange = false;
      return true;
    }
    run(inputs) {
      let code = 0, exited = false;
      try {
        for (const b of this.prog.begin) this.exec(b);
        if (this.prog.rules.length || this.prog.end.length) {
          for (const inp of inputs) {
            if (inp.assign) { this.g[inp.assign[0]] = inp.assign[1]; continue; }
            this.g.FILENAME = inp.name;
            this.g.FNR = 0;
            const data = inp.content;
            const recs = data === '' ? [] : data.replace(/\n$/, '').split('\n');
            for (const r of recs) {
              this.g.NR = toNum(this.g.NR) + 1;
              this.g.FNR = toNum(this.g.FNR) + 1;
              this.setRecord(r);
              try { for (const rule of this.prog.rules) if (this.matches(rule)) { if (rule.action) this.exec(rule.action); else this.io.out(this.rec + this.str(this.g.ORS)); } }
              catch (e) { if (!(e instanceof NextSig)) throw e; }
            }
          }
        }
      } catch (e) {
        if (!(e instanceof ExitSig)) throw e;
        code = e.code; exited = true;
      }
      try { for (const b of this.prog.end) this.exec(b); }
      catch (e) { if (!(e instanceof ExitSig)) throw e; code = e.code; }
      void exited;
      this.flushPipes();
      return code;
    }
  }

  // Entry point used by the shell: awk [-F fs] [-v var=val] [-f file] 'program' [file ...]
  function awkCommand(args, io, sh) {
    let fs = null, progSrc = null;
    const assigns = [];
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { i++; break; }
      if (a.startsWith('-F')) { fs = a.length > 2 ? a.slice(2) : args[++i]; continue; }
      if (a === '-v') { assigns.push(args[++i]); continue; }
      if (a.startsWith('-v') && a.length > 2) { assigns.push(a.slice(2)); continue; }
      if (a === '-f') { progSrc = sh.readFile(args[++i]); if (progSrc === null) { io.err(`awk: can't open file ${args[i]}\n`); return 2; } continue; }
      break;
    }
    if (progSrc === null) {
      if (i >= args.length) { io.err('usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]\n'); return 2; }
      progSrc = args[i++];
    }
    let prog;
    try { prog = new Parser(lex(progSrc)).program(); }
    catch (e) {
      if (e instanceof AwkError) { io.err(`awk: ${e.message}\n awk: program: ${progSrc.split('\n')[0]}\n`); return 2; }
      throw e;
    }
    const interp = new Interp(prog, { sh, io });
    if (fs !== null) interp.g.FS = fs === 't' ? '\t' : MB.backslashEscapes(fs);
    for (const as of assigns) {
      const eq = as.indexOf('=');
      if (eq < 1) { io.err(`awk: invalid -v argument: ${as}\n`); return 2; }
      interp.g[as.slice(0, eq)] = MB.backslashEscapes(as.slice(eq + 1));
    }
    const inputs = [];
    const rest = args.slice(i);
    let status = 0;
    for (const f of rest) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(f);
      if (m) { inputs.push({ assign: [m[1], MB.backslashEscapes(m[2])] }); continue; }
      if (f === '-') { inputs.push({ name: '', content: io.stdin.readAll() }); continue; }
      const c = sh.readFile(f);
      if (c === null) { io.err(`awk: cannot open "${f}" (${sh.fileError(f)})\n`); status = 2; continue; }
      inputs.push({ name: f, content: c });
    }
    if (!inputs.some(x => !x.assign) && !rest.some(f => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(f))) {
      if (status === 0 && (prog.rules.length || prog.end.length)) inputs.push({ name: '', content: io.stdin.readAll() });
    }
    try {
      const code = interp.run(inputs);
      return status || code;
    } catch (e) {
      if (e instanceof AwkError) {
        interp.flushPipes();
        io.err(`awk: ${e.message}\n` + (interp.g.NR ? ` input record number ${interp.g.NR}\n` : ''));
        return 2;
      }
      throw e;
    }
  }

  MB.awk = awkCommand;
  MB.AwkError = AwkError;
})();
