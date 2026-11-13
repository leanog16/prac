/* textutil.js — regex dialect conversion, glob matching and printf formatting
   shared by the minibash shell, grep, sed and awk. */
(function () {
  'use strict';
  const MB = globalThis.MB || (globalThis.MB = {});

  const CLASSES = {
    alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z',
    space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f',
    word: 'a-zA-Z0-9_', cntrl: '\\x00-\\x1f', print: ' -~', graph: '!-~'
  };

  // Converts a POSIX bracket expression starting at p[i] === '[' into a JS class.
  function convertBracket(p, i, glob) {
    let j = i + 1, out = '[';
    if (p[j] === '^' || p[j] === '!') { out += '^'; j++; }
    if (p[j] === ']') { out += '\\]'; j++; }
    while (j < p.length && p[j] !== ']') {
      if (p[j] === '[' && p[j + 1] === ':') {
        const end = p.indexOf(':]', j + 2);
        if (end > 0) {
          const name = p.slice(j + 2, end);
          if (CLASSES[name] == null) throw new Error('invalid character class');
          out += CLASSES[name];
          j = end + 2;
          continue;
        }
      }
      if (p[j] === '\\') {
        // in a glob, backslash escapes the next character; in POSIX regex it's literal
        if (glob && j + 1 < p.length) { out += p[j + 1].replace(/[\]\\^\-[]/g, '\\$&'); j += 2; continue; }
        out += '\\\\'; j++; continue;
      }
      if (p[j] === '[') { out += '\\['; j++; continue; }
      out += p[j++];
    }
    if (j >= p.length) throw new Error('unterminated [');
    return [out + ']', j + 1];
  }

  // GNU basic regular expressions -> JS source
  function breToJs(p) {
    let out = '', i = 0;
    while (i < p.length) {
      const c = p[i];
      if (c === '\\' && i + 1 < p.length) {
        const d = p[i + 1];
        if ('(){}|+?'.includes(d)) out += d;
        else if (d === '<') out += '\\b(?=\\w)';
        else if (d === '>') out += '\\b(?<=\\w)';
        else if (/[1-9wWsSbB]/.test(d)) out += '\\' + d;
        else if (d === 'n') out += '\\n';
        else if (d === 't') out += '\\t';
        else out += '\\' + d;
        i += 2; continue;
      }
      if ('(){}|+?'.includes(c)) { out += '\\' + c; i++; continue; }
      if (c === '[') { const r = convertBracket(p, i); out += r[0]; i = r[1]; continue; }
      if (c === '*' && (out === '' || out === '^' || out.endsWith('('))) { out += '\\*'; i++; continue; }
      if (c === '^' && out !== '' && !out.endsWith('(')) { out += '\\^'; i++; continue; }
      if (c === '$' && i !== p.length - 1 && !(p[i + 1] === '\\' && p[i + 2] === ')')) { out += '\\$'; i++; continue; }
      out += c; i++;
    }
    return out;
  }

  // POSIX extended regular expressions -> JS source
  function ereToJs(p) {
    let out = '', i = 0;
    while (i < p.length) {
      const c = p[i];
      if (c === '\\' && i + 1 < p.length) {
        const d = p[i + 1];
        if (d === '<') out += '\\b(?=\\w)';
        else if (d === '>') out += '\\b(?<=\\w)';
        else out += '\\' + d;
        i += 2; continue;
      }
      if (c === '[') { const r = convertBracket(p, i); out += r[0]; i = r[1]; continue; }
      if (c === '{' && !/^\{\d*(,\d*)?\}/.test(p.slice(i))) { out += '\\{'; i++; continue; }
      out += c; i++;
    }
    return out;
  }

  function makeRegex(pattern, { ere = false, fixed = false, icase = false, global = false, word = false, line = false } = {}) {
    let src = fixed ? pattern.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') : (ere ? ereToJs(pattern) : breToJs(pattern));
    if (word) src = '(?<![A-Za-z0-9_])(?:' + src + ')(?![A-Za-z0-9_])';
    if (line) src = '^(?:' + src + ')$';
    return new RegExp(src, (global ? 'g' : '') + (icase ? 'i' : ''));
  }

  // ---------- glob patterns ----------
  // Pattern syntax: * ? [...] with backslash escaping a literal character.
  function globToRegexSource(pat) {
    let out = '', i = 0;
    while (i < pat.length) {
      const c = pat[i];
      if (c === '\\' && i + 1 < pat.length) { out += pat[i + 1].replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); i += 2; continue; }
      if (c === '*') { out += '[\\s\\S]*'; i++; continue; }
      if (c === '?') { out += '[\\s\\S]'; i++; continue; }
      if (c === '[') {
        const close = pat.indexOf(']', i + 2);
        if (close > 0) {
          try { const r = convertBracket(pat, i, true); out += r[0]; i = r[1]; continue; } catch (e) { /* literal */ }
        }
        out += '\\['; i++; continue;
      }
      out += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); i++;
    }
    return out;
  }
  const globCache = new Map();
  function globMatch(pat, str, icase) {
    const key = (icase ? 'i:' : 's:') + pat;
    let re = globCache.get(key);
    if (!re) { re = new RegExp('^' + globToRegexSource(pat) + '$', icase ? 'i' : ''); globCache.set(key, re); }
    return re.test(str);
  }
  function hasGlobChars(pat) {
    for (let i = 0; i < pat.length; i++) {
      if (pat[i] === '\\') { i++; continue; }
      if (pat[i] === '*' || pat[i] === '?' || pat[i] === '[') return true;
    }
    return false;
  }
  function unescapeGlob(pat) { return pat.replace(/\\([\s\S])/g, '$1'); }

  // Shortest/longest prefix/suffix removal used by ${var#pat} and friends.
  function trimPattern(value, pat, op) {
    const n = value.length;
    if (op === '#') { for (let i = 0; i <= n; i++) if (globMatch(pat, value.slice(0, i))) return value.slice(i); }
    if (op === '##') { for (let i = n; i >= 0; i--) if (globMatch(pat, value.slice(0, i))) return value.slice(i); }
    if (op === '%') { for (let i = n; i >= 0; i--) if (globMatch(pat, value.slice(i))) return value.slice(0, i); }
    if (op === '%%') { for (let i = 0; i <= n; i++) if (globMatch(pat, value.slice(i))) return value.slice(0, i); }
    return value;
  }
  function replacePattern(value, pat, rep, mode) {
    // mode: '/' first, '//' all, '/#' prefix, '/%' suffix
    const n = value.length;
    if (mode === '/#') { for (let i = n; i >= 0; i--) if (globMatch(pat, value.slice(0, i))) return rep + value.slice(i); return value; }
    if (mode === '/%') { for (let i = 0; i <= n; i++) if (globMatch(pat, value.slice(i))) return value.slice(0, i) + rep; return value; }
    let out = '', i = 0, done = false;
    while (i < n) {
      let matched = -1;
      if (!done) for (let j = n; j > i; j--) if (globMatch(pat, value.slice(i, j))) { matched = j; break; }
      if (matched > 0) { out += rep; i = matched; if (mode === '/') done = true; }
      else out += value[i++];
    }
    return out;
  }

  // ---------- printf ----------
  function fmtG(v, prec, upper, alt) {
    if (!isFinite(v)) return String(v);
    if (prec === 0) prec = 1;
    if (v === 0) return '0';
    const exp = Math.floor(Math.log10(Math.abs(v)));
    let s;
    let e = Number(v.toExponential(prec - 1).split('e')[1]);
    if (e < -4 || e >= prec) {
      s = v.toExponential(prec - 1);
      let [m, ex] = s.split('e');
      if (!alt && m.includes('.')) m = m.replace(/\.?0+$/, '');
      const sign = ex[0] === '-' ? '-' : '+';
      ex = ex.replace(/^[+-]/, '');
      s = m + 'e' + sign + (ex.length < 2 ? '0' + ex : ex);
    } else {
      s = v.toFixed(Math.max(0, prec - 1 - e));
      if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    }
    void exp;
    return upper ? s.toUpperCase() : s;
  }
  function fmtE(v, prec, upper) {
    let s = v.toExponential(prec);
    let [m, ex] = s.split('e');
    const sign = ex[0] === '-' ? '-' : '+';
    ex = ex.replace(/^[+-]/, '');
    s = m + 'e' + sign + (ex.length < 2 ? '0' + ex : ex);
    return upper ? s.toUpperCase() : s;
  }

  // Formats like C printf. getArg(kind) supplies the next argument ('num'|'str').
  // Returns {text, used} where used counts how many arguments were consumed.
  function sprintf(fmt, args, conv) {
    conv = conv || {};
    const toNum = conv.toNum || (x => { const n = parseFloat(x); return isNaN(n) ? 0 : n; });
    const toStr = conv.toStr || (x => x == null ? '' : String(x));
    let out = '', ai = 0, i = 0, consumedSpec = false;
    const next = () => { consumedSpec = true; return ai < args.length ? args[ai++] : undefined; };
    while (i < fmt.length) {
      const c = fmt[i];
      if (c !== '%') { out += c; i++; continue; }
      const m = /^%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d*))?([diouxXeEfFgGcsb%])/.exec(fmt.slice(i));
      if (!m) { out += c; i++; continue; }
      i += m[0].length;
      let [, flags, width, prec, type] = m;
      if (type === '%') { out += '%'; continue; }
      if (width === '*') width = String(Math.trunc(toNum(next())));
      if (prec === '*') prec = String(Math.trunc(toNum(next())));
      let w = width ? parseInt(width, 10) : 0;
      if (w < 0) { flags += '-'; w = -w; }
      const p = prec === undefined ? undefined : (prec === '' ? 0 : parseInt(prec, 10));
      const left = flags.includes('-'), zero = flags.includes('0') && !left;
      const arg = next();
      let s, numeric = false, neg = false;
      switch (type) {
        case 'd': case 'i': {
          let n = Math.trunc(toNum(arg)); if (!isFinite(n)) n = 0;
          neg = n < 0; s = String(Math.abs(n));
          if (p !== undefined) s = s.padStart(p, '0');
          numeric = true; break;
        }
        case 'o': s = Math.trunc(Math.abs(toNum(arg))).toString(8); numeric = true; break;
        case 'u': s = String(Math.trunc(Math.abs(toNum(arg)))); numeric = true; break;
        case 'x': case 'X': s = Math.trunc(Math.abs(toNum(arg))).toString(16); if (type === 'X') s = s.toUpperCase(); if (flags.includes('#') && s !== '0') s = (type === 'X' ? '0X' : '0x') + s; numeric = true; break;
        case 'f': case 'F': { const n = toNum(arg); neg = n < 0 || Object.is(n, -0); s = Math.abs(n).toFixed(p === undefined ? 6 : p); numeric = true; break; }
        case 'e': case 'E': { const n = toNum(arg); neg = n < 0; s = fmtE(Math.abs(n), p === undefined ? 6 : p, type === 'E'); numeric = true; break; }
        case 'g': case 'G': { const n = toNum(arg); neg = n < 0; s = fmtG(Math.abs(n), p === undefined ? 6 : p, type === 'G', flags.includes('#')); numeric = true; break; }
        case 'c': {
          if (typeof arg === 'number') s = String.fromCharCode(arg);
          else s = toStr(arg).charAt(0);
          break;
        }
        case 'b': s = conv.escapes ? conv.escapes(toStr(arg)) : toStr(arg); if (p !== undefined) s = s.slice(0, p); break;
        default: s = toStr(arg); if (p !== undefined) s = s.slice(0, p);
      }
      if (numeric) {
        let sign = neg ? '-' : (flags.includes('+') ? '+' : (flags.includes(' ') ? ' ' : ''));
        if (zero && w > sign.length + s.length) s = sign + s.padStart(w - sign.length, '0');
        else s = sign + s;
      }
      if (s.length < w) s = left ? s.padEnd(w) : s.padStart(w);
      out += s;
    }
    return { text: out, used: ai, consumed: consumedSpec };
  }

  // Interprets backslash escapes (echo -e, printf format, %b).
  function backslashEscapes(s, opts) {
    opts = opts || {};
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== '\\' || i === s.length - 1) { out += c; continue; }
      const d = s[++i];
      switch (d) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'a': out += '\x07'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case 'e': out += '\x1b'; break;
        case '\\': out += '\\'; break;
        case 'c': if (opts.stop) opts.stop(); return out;
        case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
          let j = i, digits = '';
          if (d === '0') { j++; }
          while (digits.length < 3 && /[0-7]/.test(s[j] || '')) digits += s[j++];
          if (d !== '0' && !opts.octalNoZero) { out += '\\' + d; break; }
          out += String.fromCharCode(parseInt(digits || '0', 8));
          i = j - 1; break;
        }
        case 'x': {
          const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1));
          if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; } else out += '\\x';
          break;
        }
        default: out += '\\' + d;
      }
    }
    return out;
  }

  Object.assign(MB, {
    breToJs, ereToJs, makeRegex, convertBracket,
    globToRegexSource, globMatch, hasGlobChars, unescapeGlob, trimPattern, replacePattern,
    sprintf, fmtG, backslashEscapes
  });
})();
