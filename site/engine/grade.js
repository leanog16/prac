/* grade.js — graders for exercises that can't be executed in the browser:
   requirement checklists for source code, and normalized answer matching. */
(function () {
  'use strict';
  const MB = globalThis.MB || (globalThis.MB = {});

  // Removes comments so rules can't be satisfied by commented-out code.
  function stripComments(code, lang) {
    if (lang === 'python') return code.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|#[^\n]*/g, (m, str) => str || '');
    if (lang === 'java' || lang === 'kotlin' || lang === 'js') return code.replace(/("(?:\\.|[^"\\\n])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || '');
    if (lang === 'dockerfile' || lang === 'yaml' || lang === 'properties' || lang === 'bash') return code.replace(/^\s*#[^\n]*$/gm, '').replace(/(\s)#[^\n]*/g, (m, sp) => lang === 'dockerfile' ? m : sp);
    if (lang === 'xml') return code.replace(/<!--[\s\S]*?-->/g, '');
    return code;
  }
  // rules: [{re: 'source', flags?, neg?: bool, msg: 'html'}]
  function gradeCode(code, rules, lang) {
    const clean = stripComments(code.replace(/\r/g, ''), lang);
    const results = rules.map(r => {
      let ok;
      try { ok = new RegExp(r.re, r.flags || 'm').test(clean); } catch (e) { ok = false; }
      if (r.neg) ok = !ok;
      return { ok, msg: r.msg };
    });
    return { ok: results.every(x => x.ok), results, passed: results.filter(x => x.ok).length };
  }
  function normAnswer(s) {
    return String(s).trim().replace(/^`+|`+$/g, '').replace(/\s+/g, ' ').replace(/[.;]$/, '').trim().toLowerCase();
  }
  function tryJson(s) { try { return JSON.parse(s); } catch (e) { return undefined; } }
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  function matchAnswer(given, answers) {
    const g = String(given).trim();
    const gj = tryJson(g);
    for (const a of answers) {
      const aj = tryJson(a.trim());
      if (gj !== undefined && aj !== undefined && typeof aj === 'object' && deepEqual(gj, aj)) return true;
      if (normAnswer(g) === normAnswer(a)) return true;
      // also accept answers that differ only in quote style or spacing around punctuation
      const loose = s => normAnswer(s).replace(/['"]/g, '"').replace(/\s*([,:{}[\]()=])\s*/g, '$1');
      if (loose(g) === loose(a)) return true;
    }
    return false;
  }
  Object.assign(MB, { stripComments, gradeCode, matchAnswer, normAnswer });
})();
