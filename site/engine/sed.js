/* sed.js — a GNU sed subset: s///, d, p, q, =, a, i, c, y, addresses, ranges,
   negation, { } blocks, -n, -E, -i, -e. */
(function () {
  'use strict';
  const MB = globalThis.MB || (globalThis.MB = {});

  class SedError extends Error {}

  function parseScript(src, ere) {
    let i = 0;
    const n = src.length;
    const cmds = [];
    const stack = [];
    let cur = cmds;
    const ws = () => { while (i < n && (src[i] === ' ' || src[i] === '\t')) i++; };
    const readDelimited = (delim) => {
      let s = '';
      while (i < n && src[i] !== delim) {
        if (src[i] === '\\' && i + 1 < n) {
          if (src[i + 1] === delim) { s += delim; i += 2; continue; }
          if (src[i + 1] === 'n') { s += '\\n'; i += 2; continue; }
          s += src[i] + src[i + 1]; i += 2; continue;
        }
        if (src[i] === '\n') throw new SedError(`unterminated \`s' command`);
        s += src[i++];
      }
      if (i >= n) throw new SedError(`unterminated \`s' command`);
      i++;
      return s;
    };
    const mkre = (p, flags) => {
      try { return new RegExp(ere ? MB.ereToJs(p) : MB.breToJs(p), flags); }
      catch (e) { throw new SedError(`-e expression #1: invalid regular expression: ${p}`); }
    };
    const readAddr = () => {
      if (/\d/.test(src[i])) {
        const m = /^\d+/.exec(src.slice(i)); i += m[0].length;
        if (src[i] === '~') { i++; const s = /^\d+/.exec(src.slice(i)); i += s[0].length; return { type: 'step', first: +m[0], step: +s[0] }; }
        return { type: 'line', n: +m[0] };
      }
      if (src[i] === '$') { i++; return { type: 'last' }; }
      if (src[i] === '/' || src[i] === '\\') {
        let d = '/';
        if (src[i] === '\\') { d = src[i + 1]; i++; }
        i++;
        const p = readDelimited(d);
        let flags = '';
        if (src[i] === 'I') { flags = 'i'; i++; }
        return { type: 're', re: mkre(p, flags) };
      }
      return null;
    };
    const readText = () => {
      // GNU one-liner `a text` or classic `a\` + newline + text
      ws();
      if (src[i] === '\\') { i++; if (src[i] === '\n') i++; }
      ws();
      let s = '';
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) { s += src[i + 1] === 'n' ? '\n' : src[i + 1] === 't' ? '\t' : src[i + 1]; i += 2; continue; }
        s += src[i++];
      }
      return s;
    };
    while (i < n) {
      while (i < n && /[\s;]/.test(src[i])) i++;
      if (i >= n) break;
      if (src[i] === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      const cmd = { a1: null, a2: null, neg: false, range: false };
      cmd.a1 = readAddr();
      if (cmd.a1 && src[i] === ',') {
        i++;
        if (src[i] === '+') { i++; const m = /^\d+/.exec(src.slice(i)); i += m[0].length; cmd.a2 = { type: 'rel', n: +m[0] }; }
        else cmd.a2 = readAddr();
        if (!cmd.a2) throw new SedError('unexpected `,\'');
      }
      ws();
      if (src[i] === '!') { cmd.neg = true; i++; ws(); }
      const c = src[i++];
      if (c === undefined) throw new SedError('missing command');
      cmd.c = c;
      switch (c) {
        case '{': { cmd.body = []; cur.push(cmd); stack.push(cur); cur = cmd.body; continue; }
        case '}': { if (!stack.length) throw new SedError('unexpected `}\''); cur = stack.pop(); continue; }
        case 's': {
          const d = src[i++];
          const pat = readDelimited(d);
          const rep = readDelimited(d);
          let flags = '', nth = 1, g = false, p = false;
          while (i < n && /[gpiI0-9]/.test(src[i])) {
            const f = src[i++];
            if (f === 'g') g = true; else if (f === 'p') p = true; else if (f === 'i' || f === 'I') flags += 'i';
            else { let num = f; while (/\d/.test(src[i] || '')) num += src[i++]; nth = +num; }
          }
          if (src[i] === 'w') throw new SedError('the w flag is not supported in this simulator');
          cmd.re = pat === '' ? null : mkre(pat, 'g' + flags);
          cmd.rep = rep; cmd.g = g; cmd.p = p; cmd.nth = nth;
          break;
        }
        case 'y': {
          const d = src[i++];
          const a = readDelimited(d).replace(/\\n/g, '\n'), b = readDelimited(d).replace(/\\n/g, '\n');
          if (a.length !== b.length) throw new SedError('strings for `y\' command are different lengths');
          cmd.from = a; cmd.to = b;
          break;
        }
        case 'a': case 'i': case 'c': cmd.text = readText(); break;
        case 'd': case 'D': case 'p': case 'P': case '=': case 'n': case 'N': case 'h': case 'H': case 'g': case 'G': case 'x': case 'l': break;
        case 'q': case 'Q': { ws(); const m = /^\d+/.exec(src.slice(i)); if (m) { cmd.code = +m[0]; i += m[0].length; } break; }
        default: throw new SedError(`-e expression #1, char ${i}: unknown command: \`${c}'`);
      }
      cur.push(cmd);
    }
    if (stack.length) throw new SedError('unmatched `{\'');
    return cmds;
  }

  function expandReplacement(rep, m) {
    let out = '';
    let caseMode = null, nextCase = null;
    const add = (s) => {
      for (const ch of s) {
        let c = ch;
        if (nextCase) { c = nextCase === 'u' ? c.toUpperCase() : c.toLowerCase(); nextCase = null; }
        else if (caseMode) c = caseMode === 'U' ? c.toUpperCase() : c.toLowerCase();
        out += c;
      }
    };
    for (let i = 0; i < rep.length; i++) {
      const c = rep[i];
      if (c === '\\' && i + 1 < rep.length) {
        const d = rep[++i];
        if (/\d/.test(d)) add(m[+d] || '');
        else if (d === 'n') add('\n');
        else if (d === 't') add('\t');
        else if (d === 'U' || d === 'L') caseMode = d;
        else if (d === 'E') caseMode = null;
        else if (d === 'u' || d === 'l') nextCase = d;
        else add(d);
        continue;
      }
      if (c === '&') { add(m[0]); continue; }
      add(c);
    }
    return out;
  }

  function runSed(cmds, lines, opts) {
    const out = [];
    const total = lines.length;
    let quit = false, exitCode = 0;
    let hold = '';
    let lastRe = null;
    const matchAddr = (a, ps, ln) => {
      if (a.type === 'line') return ln === a.n;
      if (a.type === 'last') return ln === total;
      if (a.type === 'step') return a.step <= 0 ? ln === a.first : ln >= a.first && (ln - a.first) % a.step === 0;
      if (a.type === 're') { a.re.lastIndex = 0; lastRe = a.re; return a.re.test(ps); }
      return false;
    };
    const selected = (cmd, ps, ln) => {
      let r;
      if (!cmd.a1) r = true;
      else if (!cmd.a2) r = matchAddr(cmd.a1, ps, ln);
      else if (cmd.active) {
        if (cmd.a2.type === 'rel') { if (ln >= cmd.endLine) cmd.active = false; }
        else if (cmd.a2.type === 'line') { if (ln >= cmd.a2.n) cmd.active = false; }
        else if (matchAddr(cmd.a2, ps, ln)) cmd.active = false;
        r = true;
      } else if (matchAddr(cmd.a1, ps, ln)) {
        r = true;
        if (cmd.a2.type === 'rel') { cmd.endLine = ln + cmd.a2.n; cmd.active = cmd.a2.n > 0; }
        else if (cmd.a2.type === 'line') cmd.active = cmd.a2.n > ln;
        else cmd.active = true;
      } else r = false;
      return cmd.neg ? !r : r;
    };
    let li = 0;
    const st = { ps: '', append: [], deleted: false, steps: 0 };
    const execList = (list, ln) => {
      for (const cmd of list) {
        if (++st.steps > 1e6) throw new SedError('script ran too long');
        if (!selected(cmd, st.ps, ln)) continue;
        switch (cmd.c) {
          case '{': if (execList(cmd.body, ln) === 'end') return 'end'; break;
          case 's': {
            const re = cmd.re || lastRe;
            if (!re) throw new SedError('no previous regular expression');
            let count = 0, did = false;
            re.lastIndex = 0;
            st.ps = st.ps.replace(re, (...m) => {
              const groups = m.slice(0, -2).filter(x => typeof x === 'string' || x === undefined);
              count++;
              if ((cmd.g && count >= cmd.nth) || count === cmd.nth) { did = true; return expandReplacement(cmd.rep, groups); }
              return m[0];
            });
            if (did && cmd.p) out.push(st.ps);
            if (did) st.subst = true;
            break;
          }
          case 'y': {
            let r = '';
            for (const ch of st.ps) { const k = cmd.from.indexOf(ch); r += k >= 0 ? cmd.to[k] : ch; }
            st.ps = r; break;
          }
          case 'p': out.push(st.ps); break;
          case 'P': out.push(st.ps.split('\n')[0]); break;
          case 'd': st.deleted = true; return 'end';
          case 'D': { const k = st.ps.indexOf('\n'); if (k < 0) { st.deleted = true; return 'end'; } st.ps = st.ps.slice(k + 1); st.deleted = true; return 'end'; }
          case '=': out.push(String(ln)); break;
          case 'a': st.append.push(cmd.text); break;
          case 'i': out.push(cmd.text); break;
          case 'c': if (!cmd.a2 || !cmd.active) out.push(cmd.text); st.deleted = true; return 'end';
          case 'q': quit = true; exitCode = cmd.code || 0; return 'end';
          case 'Q': quit = true; exitCode = cmd.code || 0; st.deleted = true; return 'end';
          case 'h': hold = st.ps; break;
          case 'H': hold = hold + '\n' + st.ps; break;
          case 'g': st.ps = hold; break;
          case 'G': st.ps = st.ps + '\n' + hold; break;
          case 'x': { const t = st.ps; st.ps = hold; hold = t; break; }
          case 'l': out.push(JSON.stringify(st.ps).slice(1, -1) + '$'); break;
          case 'n': {
            if (!opts.quiet) out.push(st.ps);
            if (li >= total) { quit = true; st.deleted = true; return 'end'; }
            st.ps = lines[li++]; ln = li; st.ln = ln;
            break;
          }
          case 'N': {
            if (li >= total) { quit = true; return 'end'; }
            st.ps += '\n' + lines[li++]; ln = li; st.ln = ln;
            break;
          }
        }
      }
      return 'ok';
    };
    while (li < total && !quit) {
      st.ps = lines[li++];
      st.ln = li;
      st.append = [];
      st.deleted = false;
      execList(cmds, li);
      if (!st.deleted && !opts.quiet) out.push(st.ps);
      for (const a of st.append) out.push(a);
    }
    return { lines: out, code: exitCode };
  }

  function sedCommand(args, io, sh) {
    const scripts = [];
    const files = [];
    let quiet = false, ere = false, inPlace = false, sep = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-n' || a === '--quiet' || a === '--silent') quiet = true;
      else if (a === '-E' || a === '-r' || a === '--regexp-extended') ere = true;
      else if (a === '-i' || a.startsWith('-i') && a.length > 2 && !a.startsWith('-i-')) inPlace = true;
      else if (a === '-s') sep = true;
      else if (a === '-e') scripts.push(args[++i]);
      else if (a === '-f') { const s = sh.readFile(args[++i]); if (s === null) { io.err(`sed: couldn't open file ${args[i]}: No such file or directory\n`); return 1; } scripts.push(s); }
      else if (/^-[nErs]+$/.test(a)) { if (a.includes('n')) quiet = true; if (a.includes('E') || a.includes('r')) ere = true; if (a.includes('s')) sep = true; }
      else if (a.startsWith('-') && a !== '-') { io.err(`sed: invalid option -- '${a.slice(1)}'\n`); return 1; }
      else if (!scripts.length && !files.length) scripts.push(a);
      else files.push(a);
    }
    if (!scripts.length) { io.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n'); return 1; }
    let cmds;
    try { cmds = parseScript(scripts.join('\n'), ere); }
    catch (e) { if (e instanceof SedError) { io.err(`sed: ${e.message}\n`); return 1; } throw e; }
    const toLines = s => s === '' ? [] : s.replace(/\n$/, '').split('\n');
    let status = 0;
    try {
      if (inPlace) {
        if (!files.length) { io.err('sed: no input files\n'); return 1; }
        for (const f of files) {
          const c = sh.readFile(f);
          if (c === null) { io.err(`sed: can't read ${f}: ${sh.fileError(f)}\n`); status = 2; continue; }
          const fresh = parseScript(scripts.join('\n'), ere);
          const r = runSed(fresh, toLines(c), { quiet });
          sh.writeFile(f, r.lines.length ? r.lines.join('\n') + '\n' : '', false);
        }
        return status;
      }
      const inputs = [];
      if (!files.length) inputs.push(io.stdin.readAll());
      for (const f of files) {
        if (f === '-') { inputs.push(io.stdin.readAll()); continue; }
        const c = sh.readFile(f);
        if (c === null) { io.err(`sed: can't read ${f}: ${sh.fileError(f)}\n`); status = 2; continue; }
        inputs.push(c);
      }
      if (sep) {
        for (const c of inputs) { const r = runSed(parseScript(scripts.join('\n'), ere), toLines(c), { quiet }); if (r.lines.length) io.out(r.lines.join('\n') + '\n'); }
      } else {
        const all = [].concat(...inputs.map(toLines));
        const r = runSed(cmds, all, { quiet });
        if (r.lines.length) io.out(r.lines.join('\n') + '\n');
        if (r.code) return r.code;
      }
    } catch (e) {
      if (e instanceof SedError) { io.err(`sed: ${e.message}\n`); return 1; }
      throw e;
    }
    return status;
  }

  MB.sed = sedCommand;
})();
