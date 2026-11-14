/* app.js — prac: routing, lessons, graded exercises, quizzes,
   SQL playground and the bash terminal. Content comes from content.js (window.PJ). */
(function () {
  'use strict';
  const PJ = window.PJ;
  const MB = window.MB;

  // ------------------------------------------------------------------ utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  const LEVELS = { 1: 'Warm-up', 2: 'Practice', 3: 'Challenge', 4: 'Boss' };
  // Pixel icons, drawn on an 8x8 grid so they share the progress cells' grain.
  const ART = {
    check: ['........', '.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........'],
    cross: ['........', '.##..##.', '..####..', '...##...', '..####..', '.##..##.', '........', '........'],
    right: ['...##...', '....##..', '.....##.', '#######.', '#######.', '.....##.', '....##..', '...##...'],
    left: ['...##...', '..##....', '.##.....', '.#######', '.#######', '.##.....', '..##....', '...##...'],
    play: ['.##.....', '.###....', '.####...', '.#####..', '.#####..', '.####...', '.###....', '.##.....']
  };
  const ico = n => `<svg class="ico" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">${ART[n].flatMap((row, y) => [...row].map((c, x) => c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : '')).join('')}</svg>`;
  const pips = l => `<span class="pips" aria-hidden="true">${[1, 2, 3, 4].map(i => `<i${i <= l ? ' class="f"' : ''}></i>`).join('')}</span>`;
  const lvlTag = l => `<span class="lvl lvl-${l}">${pips(l)}${LEVELS[l]}</span>`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  let toastTimer;
  function toast(msg, icon) {
    const t = $('#toast');
    t.innerHTML = (icon ? ico(icon) : '') + esc(msg); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) { toast('Copy blocked — select the text manually'); }
  }

  // --------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem(window.pracStoragePrefix + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(window.pracStoragePrefix + k, JSON.stringify(v)); if (window.pracSave && (k === 'progress' || k === 'drafts')) window.pracSave(k, v); } catch (e) { /* storage unavailable */ } }
  };
  const progress = store.get('progress', { solved: {}, quiz: {} });
  progress.solved = progress.solved || {}; progress.quiz = progress.quiz || {};
  const drafts = store.get('drafts', {});
  const saveProgress = () => store.set('progress', progress);
  const saveDrafts = debounce(() => store.set('drafts', drafts), 400);

  // --------------------------------------------------------------- indices
  const TRACKS = {};
  const MODS = {};
  const EXS = {};
  for (const t of PJ.tracks) {
    TRACKS[t.id] = t;
    t.modules.forEach((m, i) => {
      m.index = i; m.trackObj = t; MODS[m.id] = m;
      m.exercises.forEach((ex, j) => { ex.num = j + 1; ex.mod = m; EXS[ex.id] = ex; });
    });
  }
  const trackStats = (t) => {
    const all = t.modules.flatMap(m => m.exercises);
    return { total: all.length, solved: all.filter(e => progress.solved[e.id]).length, quiz: t.modules.reduce((a, m) => a + m.quiz.length, 0) };
  };
  const modStats = (m) => ({ total: m.exercises.length, solved: m.exercises.filter(e => progress.solved[e.id]).length });

  // ------------------------------------------------------------------- SQL
  let SQL = null, baseBytes = null, sqlErr = null;
  const sqlReady = (async () => {
    try {
      if (!window.initSqlJs) throw new Error('The SQL engine (sql.js) could not be loaded. Check your connection and reload.');
      SQL = await window.initSqlJs();
      const db = new SQL.Database();
      db.exec(PJ.dbSql);
      baseBytes = db.export();
      db.close();
    } catch (e) { sqlErr = e; throw e; }
  })();
  sqlReady.catch(() => {});
  const freshDb = () => new SQL.Database(baseBytes);
  // Runs every statement, returning [{columns, values, changes}] even for empty SELECTs.
  function execAll(db, sql) {
    const out = [];
    for (const stmt of db.iterateStatements(sql)) {
      const cols = stmt.getColumnNames();
      const values = [];
      while (stmt.step()) { values.push(stmt.get()); if (values.length > 5000) break; }
      out.push({ columns: cols, values, changes: cols.length ? 0 : db.getRowsModified(), sql: stmt.getSQL() });
      stmt.free();
    }
    return out;
  }
  function runSql(sql, db) {
    const own = !db;
    db = db || freshDb();
    const t0 = performance.now();
    try { return { results: execAll(db, sql), ms: performance.now() - t0, db }; }
    catch (e) { return { error: e.message, ms: performance.now() - t0, db }; }
    finally { if (own) db.close(); }
  }
  const lastTable = results => { for (let i = results.length - 1; i >= 0; i--) if (results[i].columns.length) return results[i]; return null; };
  const isNum = v => typeof v === 'number';
  function fmtCell(v) {
    if (v === null) return '<td class="null">NULL</td>';
    if (v instanceof Uint8Array) return '<td class="null">[blob]</td>';
    if (isNum(v)) return `<td class="num">${Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6}</td>`;
    return `<td>${esc(v)}</td>`;
  }
  function tableHTML(res, opts = {}) {
    const max = opts.max || 200;
    const rows = res.values.slice(0, max);
    const miss = opts.missing || new Set();
    return `<div class="res-wrap"><table class="res"><thead><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r, i) => `<tr${miss.has(i) ? ' class="miss"' : ''}>${r.map(fmtCell).join('')}</tr>`).join('') +
      (res.values.length === 0 ? `<tr><td colspan="${Math.max(1, res.columns.length)}" class="null">(no rows)</td></tr>` : '') +
      `</tbody></table></div>`;
  }
  function resultsHTML(r) {
    if (r.error) return `<div class="err-box">Error: ${esc(r.error)}</div>`;
    if (!r.results.length) return `<div class="ok-box">Done. (No statements produced output.)</div>`;
    return r.results.map(res => {
      if (!res.columns.length) return `<div class="res-meta">${esc(firstWords(res.sql))} — ${res.changes} row${res.changes === 1 ? '' : 's'} affected</div>`;
      return `<div class="res-meta"><span>${res.values.length} row${res.values.length === 1 ? '' : 's'}</span><span>${res.columns.length} column${res.columns.length === 1 ? '' : 's'}</span>${r.results.length > 1 ? `<span>${esc(firstWords(res.sql))}</span>` : ''}</div>` + tableHTML(res);
    }).join('<div style="height:10px"></div>');
  }
  const firstWords = s => (s || '').trim().replace(/\s+/g, ' ').slice(0, 48) + ((s || '').trim().length > 48 ? '…' : '');
  const normCell = v => v === null ? '∅' : isNum(v) ? String(Math.round(v * 1e6) / 1e6) : v instanceof Uint8Array ? '[blob]' : String(v);
  const rowKey = r => r.map(normCell).join('\u0001');
  function permutations(n) {
    const out = [];
    const rec = (arr, rest) => { if (!rest.length) { out.push(arr); return; } rest.forEach((x, i) => rec([...arr, x], rest.filter((_, j) => j !== i))); };
    rec([], [...Array(n).keys()]);
    return out;
  }
  function compareSql(user, exp, ordered) {
    if (!user) return { ok: false, msg: "Your SQL ran but didn't produce a result table.", detail: 'The last statement should be a SELECT that returns the answer.' };
    const uc = user.columns.length, ec = exp.columns.length;
    if (uc !== ec) return { ok: false, msg: `Expected ${ec} column${ec === 1 ? '' : 's'}, your result has ${uc}.`, detail: `Expected columns: ${exp.columns.join(', ')}` };
    const ur = user.values, er = exp.values;
    if (ur.length !== er.length) {
      return {
        ok: false, msg: `Expected ${er.length} row${er.length === 1 ? '' : 's'}, your result has ${ur.length}.`,
        detail: ur.length > er.length ? 'Too many rows. Check your WHERE filter, your join conditions, or whether you need DISTINCT or GROUP BY.' : 'Too few rows. Is a filter too strict, or does this need an outer join to keep unmatched rows?'
      };
    }
    const us = ur.map(rowKey), es = er.map(rowKey);
    const sortedEq = (a, b) => { const x = [...a].sort(), y = [...b].sort(); return x.every((k, i) => k === y[i]); };
    if (sortedEq(us, es)) {
      if (!ordered || us.every((k, i) => k === es[i])) return { ok: true };
      return { ok: false, msg: 'Right rows, wrong order.', detail: 'This exercise asks for a specific order. Check your ORDER BY columns, direction (ASC/DESC) and tie-breakers.' };
    }
    if (uc > 1 && uc <= 6) {
      for (const p of permutations(uc)) {
        const pk = ur.map(r => rowKey(p.map(i => r[i])));
        if (sortedEq(pk, es)) return { ok: false, msg: 'Right data, columns in a different order.', detail: `Expected column order: ${exp.columns.join(', ')}` };
      }
    }
    const counts = new Map();
    us.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
    let missing = null;
    for (const r of er) { const k = rowKey(r); if (counts.get(k)) counts.set(k, counts.get(k) - 1); else { missing = r; break; } }
    return { ok: false, msg: 'Same shape, but some values differ.', detail: missing ? `For example, the expected result has the row (${missing.map(v => v === null ? 'NULL' : normCell(v)).join(', ')}), which yours doesn't.` : '' };
  }
  const expCache = {};
  function sqlExpected(ex) {
    if (expCache[ex.id]) return expCache[ex.id];
    const db = freshDb();
    let res;
    try {
      execAll(db, ex.solution);
      res = ex.check ? lastTable(execAll(db, ex.check)) : null;
      if (!ex.check) { const d2 = freshDb(); res = lastTable(execAll(d2, ex.solution)); d2.close(); }
    } finally { db.close(); }
    return (expCache[ex.id] = res);
  }

  // ------------------------------------------------------------------ bash
  const FIX = {};
  const fixtureFs = name => FIX[name] || (FIX[name] = MB.VFS.fromSpec((PJ.fixtures && PJ.fixtures[name]) || PJ.fs));
  const trackFixture = t => t === 'bash' ? 'base' : 'docker';
  function bashRun(ex, code, test) {
    const sh = new MB.Shell({ fs: fixtureFs(ex.fixture || 'base').clone(), cwd: ex.cwd || '/home/student' });
    if (ex.setup) { sh.run(ex.setup, { tty: false }); sh.cwd = ex.cwd || '/home/student'; }
    let r;
    if (ex.mode === 'script') {
      const file = ex.file || 'script.sh';
      sh.writeFile(file, code.endsWith('\n') ? code : code + '\n', false);
      r = sh.run(`bash ${file} ${test ? test.args : ''}`, { tty: false, stdin: test ? test.stdin : '' });
    } else if (ex.mode === 'file') {
      sh.writeFile(ex.file, code.endsWith('\n') ? code : code + '\n', false);
      r = sh.run(ex.run, { tty: false, stdin: test ? test.stdin : '' });
    } else r = sh.run(code, { tty: false, stdin: test ? test.stdin : '' });
    if (ex.verify) sh.cwd = ex.cwd || '/home/student';
    const v = ex.verify ? sh.run(ex.verify, { tty: false }) : null;
    return { r, v };
  }
  function bashTarget(ex, run) {
    if (ex.compare === 'verify') return run.v.stdout;
    let s = run.r.stdout + (ex.stderr ? run.r.stderr : '');
    if (ex.compare === 'both') s += '\n--- after your commands ---\n' + run.v.stdout;
    if (ex.status) s += `\n[exit status ${run.r.status}]`;
    return s;
  }
  const normLines = (s, unordered) => {
    const lines = s.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return unordered ? lines.sort() : lines;
  };
  function compareText(user, exp, unordered) {
    const u = normLines(user, unordered), e = normLines(exp, unordered);
    if (u.length === e.length && u.every((l, i) => l === e[i])) return { ok: true };
    const squash = a => a.map(l => l.replace(/\s+/g, ' ').trim());
    const us = squash(u), es = squash(e);
    if (us.length === es.length && us.every((l, i) => l === es[i])) return { ok: true, note: 'Correct! (Spacing differs slightly from the reference, which is fine.)' };
    if (!unordered && u.length === e.length && [...us].sort().every((l, i) => l === [...es].sort()[i])) return { ok: false, msg: 'Same lines, different order.', detail: 'Check your sort (numeric vs text, ascending vs descending) or the order you print things.' };
    let i = 0;
    while (i < u.length && i < e.length && us[i] === es[i]) i++;
    let detail;
    if (i >= u.length) detail = `Your output stops after ${u.length} line${u.length === 1 ? '' : 's'}; expected ${e.length}. Next expected line:\n  ${e[i]}`;
    else if (i >= e.length) detail = `Your output has extra lines starting at line ${i + 1}:\n  ${u[i]}`;
    else detail = `First difference at line ${i + 1}:\n  expected: ${e[i]}\n  yours:    ${u[i]}`;
    return { ok: false, msg: u.length === e.length ? 'Output differs.' : `Expected ${e.length} line${e.length === 1 ? '' : 's'} of output, yours has ${u.length}.`, detail, pre: true };
  }
  function chunksHTML(chunks) {
    let s = '';
    for (const c of chunks) {
      if (c.s.includes('\x1b[clear]')) continue;
      s += c.stream === 'err' ? `<span class="err">${esc(c.s)}</span>` : esc(c.s);
    }
    return s.replace(/\n(<\/span>)?$/, '$1');
  }

  // --------------------------------------------------------------- editors
  function wireEditor(ta, { onRun, onCheck, onChange }) {
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 64), 520) + 'px'; };
    ta.addEventListener('input', () => { grow(); onChange && onChange(ta.value); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (e.shiftKey && onCheck) onCheck(); else onRun && onRun(); return; }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.setRangeText('  ', s, en, 'end');
        onChange && onChange(ta.value);
      }
    });
    requestAnimationFrame(grow);
    return grow;
  }

  // ----------------------------------------------------- runnable snippets
  function wireCodeBlocks(root, trackId) {
    for (const blk of $$('.codeblock.runnable', root)) {
      if (blk.dataset.wired) continue;
      blk.dataset.wired = '1';
      const lang = blk.dataset.lang;
      const src = $('textarea.code-src', blk).value;
      const actions = el(`<div class="code-actions"><button type="button" class="btn small edit">Edit</button><button type="button" class="btn small primary run">${ico('play')}Run</button></div>`);
      blk.appendChild(actions);
      let editor = null;
      const out = el('<div class="code-out" hidden></div>');
      blk.appendChild(out);
      const code = () => editor ? editor.value : src;
      const run = async () => {
        out.hidden = false;
        if (lang === 'sql') {
          out.innerHTML = '<div class="res-meta">Running…</div>';
          try { await sqlReady; } catch (e) { out.innerHTML = `<div class="err-box">${esc(sqlErr.message)}</div>`; return; }
          out.innerHTML = resultsHTML(runSql(code()));
        } else {
          const sh = new MB.Shell({ fs: fixtureFs(trackFixture(trackId)).clone() });
          const r = sh.run(code(), { tty: false });
          out.innerHTML = `<pre class="termout">${chunksHTML(r.output)}</pre>`;
        }
      };
      $('.run', actions).addEventListener('click', run);
      $('.edit', actions).addEventListener('click', (e) => {
        if (editor) { editor.focus(); return; }
        editor = el(`<textarea class="editor" spellcheck="false" aria-label="Edit example code"></textarea>`);
        editor.value = src;
        $('pre', blk).replaceWith(editor);
        wireEditor(editor, { onRun: run });
        e.currentTarget.textContent = 'Editing';
        editor.focus();
      });
    }
  }

  // --------------------------------------------------------------- quizzes
  function renderQuiz(q, onAnswer, n) {
    const node = el(`<div class="q">${n ? `<div class="q-n">${n}</div>` : ''}<p class="q-text">${q.q}</p>${q.code ? `<div class="codeblock"><pre><code>${q.code}</code></pre></div>` : ''}<div class="q-opts"></div><div class="why" hidden></div></div>`);
    const opts = $('.q-opts', node);
    const why = $('.why', node);
    const show = (picked) => {
      $$('.q-opt', opts).forEach((b, i) => {
        b.disabled = true;
        if (i === q.answer) b.classList.add('right');
        else if (i === picked) b.classList.add('wrong');
      });
      why.hidden = false;
      why.innerHTML = `<b>${picked === q.answer ? 'Correct.' : 'Not quite.'}</b> ${q.why}`;
    };
    q.options.forEach((o, i) => {
      const b = el(`<button type="button" class="q-opt"><span class="k">${'ABCDEF'[i]}</span><span>${o}</span></button>`);
      b.addEventListener('click', () => {
        progress.quiz[q.id] = { picked: i, correct: i === q.answer };
        saveProgress();
        show(i);
        onAnswer && onAnswer(i === q.answer);
      });
      opts.appendChild(b);
    });
    if (!onAnswer && progress.quiz[q.id]) show(progress.quiz[q.id].picked);
    return node;
  }

  // ------------------------------------------------------------- exercises
  // Exercises graded without running code: requirement checklists and typed answers.
  function renderCheckExercise(ex, opts) {
    const solved = !!progress.solved[ex.id];
    const isCode = ex.kind === 'code';
    const starter = ex.starter || '';
    const code0 = drafts[ex.id] !== undefined ? drafts[ex.id] : starter;
    const node = el(`
      <article class="ex${solved ? ' solved' : ''}" id="ex-${ex.id}" data-level="${ex.level}">
        ${exHead(ex, opts)}
        <div class="ex-body">
          ${ex.project ? '<p class="project-instruction"><strong>Project step</strong> · Complete this task in the editor below. Your answer is saved for this exercise; it does not update a shared project.</p>' : ''}
          <div class="ex-prompt">${ex.prompt}</div>
          <div>
            <div class="editor-label"><span>${isCode ? esc(ex.file || ex.lang) + ` · graded on ${ex.rules.length} requirement${ex.rules.length === 1 ? '' : 's'}` : 'Your answer · case and extra spaces are ignored'}</span>${isCode ? '<button type="button" class="btn quiet small b-reset">Reset</button>' : ''}</div>
            ${isCode ? `<textarea class="editor" spellcheck="false" autocapitalize="off" autocomplete="off" id="ed-${ex.id}" aria-label="Code for ${esc(ex.title)}"></textarea>`
              : `<input class="answer-input" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" id="ed-${ex.id}" aria-label="Answer for ${esc(ex.title)}" placeholder="${esc(ex.placeholder)}">`}
            <div class="actions">
              <div class="btns">
                <button type="button" class="btn primary b-check">${ico('check')}Check</button>
                ${isCode ? '<span class="kbd-hint"><kbd>⌘/Ctrl</kbd> <kbd>Enter</kbd></span>' : '<span class="kbd-hint"><kbd>Enter</kbd></span>'}
              </div>
              <div class="stuck" role="group" aria-label="Help">
                <span class="stuck-label">Stuck?</span>
                <button type="button" class="btn quiet b-hint"${ex.hints.length ? '' : ' hidden'}>Hint</button>
                ${isCode ? '<button type="button" class="btn quiet b-reqs">Requirements</button>' : ''}
                <button type="button" class="btn quiet b-sol">${isCode ? 'Solution' : 'Answer'}</button>
              </div>
            </div>
          </div>
          <div class="hints"></div>
          <div class="feedback-slot"></div>
          <div class="sol-slot"></div>
        </div>
      </article>`);
    const ta = $('#ed-' + ex.id, node);
    ta.value = code0;
    const hintsEl = $('.hints', node), fb = $('.feedback-slot', node), solEl = $('.sol-slot', node);
    let hintN = 0;
    const save = v => { drafts[ex.id] = v; saveDrafts(); };
    let grow = () => {};
    if (isCode) grow = wireEditor(ta, { onRun: () => check(), onCheck: () => check(), onChange: save });
    else {
      ta.addEventListener('input', () => save(ta.value));
      ta.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    }
    const hintBtn = $('.b-hint', node);
    const updateHintBtn = () => { hintBtn.textContent = hintN >= ex.hints.length ? 'No more hints' : `Hint ${hintN + 1}/${ex.hints.length}`; hintBtn.disabled = hintN >= ex.hints.length; };
    if (ex.hints.length) updateHintBtn();
    hintBtn.addEventListener('click', () => {
      if (hintN >= ex.hints.length) return;
      hintsEl.appendChild(el(`<div class="hint"><b>Hint ${hintN + 1}.</b> ${ex.hints[hintN].replace(/^<p>|<\/p>\s*$/g, '')}</div>`));
      hintN++; updateHintBtn();
    });
    const markSolved = () => solvedNow(ex, node);
    const checklist = results => `<ul class="checklist">${results.map(r => `<li class="${r.ok ? 'ok' : 'no'}">${ico(r.ok ? 'check' : 'cross')}<span class="sr">${r.ok ? 'Met:' : 'Not met:'}</span> <span>${r.msg}</span></li>`).join('')}</ul>`;
    function check() {
      const v = ta.value;
      if (!v.trim()) { fb.innerHTML = `<div class="feedback bad">${isCode ? 'Write your code first.' : 'Type an answer first.'}</div>`; return; }
      if (isCode) {
        const g = MB.gradeCode(v, ex.rules, ex.lang);
        if (g.ok) {
          fb.innerHTML = `<div class="feedback ok">${ico('check')}All ${g.results.length} requirements met.</div>` + checklist(g.results) + (ex.explain ? `<div class="explain">${ex.explain}</div>` : '');
          markSolved();
        } else {
          fb.innerHTML = `<div class="feedback bad"><strong>${g.passed} of ${g.results.length} requirements met.</strong><div class="detail">Fix the items marked in red. The checks look at what your code declares, so names and structure matter more than exact spacing.</div></div>` + checklist(g.results);
        }
      } else {
        if (MB.matchAnswer(v, ex.answers)) {
          fb.innerHTML = `<div class="feedback ok">${ico('check')}Correct.</div>` + (ex.explain ? `<div class="explain">${ex.explain}</div>` : '');
          markSolved();
        } else fb.innerHTML = `<div class="feedback bad"><strong>Not quite.</strong><div class="detail">Trace through it once more${ex.hints.length && hintN < ex.hints.length ? ', or take a hint' : ''}. Answers ignore case and extra spaces.</div></div>`;
      }
    }
    $('.b-check', node).addEventListener('click', check);
    const reqBtn = $('.b-reqs', node);
    if (reqBtn) reqBtn.addEventListener('click', () => { fb.innerHTML = `<div class="feedback"><strong>What the grader looks for</strong></div><ul class="checklist">${ex.rules.map(r => `<li class="todo"><span>${r.msg}</span></li>`).join('')}</ul>`; });
    const resetBtn = $('.b-reset', node);
    if (resetBtn) resetBtn.addEventListener('click', () => { ta.value = starter; delete drafts[ex.id]; saveDrafts(); grow(); fb.innerHTML = ''; });
    $('.b-sol', node).addEventListener('click', () => {
      if (solEl.firstChild) { solEl.innerHTML = ''; return; }
      const reveal = () => {
        if (isCode) {
          solEl.innerHTML = `<div class="solution"><div class="editor-label"><span>reference solution</span><span><button type="button" class="btn small s-load">Load into editor</button> <button type="button" class="btn small s-copy">Copy</button></span></div><pre><code>${ex.solutionHtml}</code></pre>${ex.explain ? `<div class="explain">${ex.explain}</div>` : ''}</div>`;
          $('.s-load', solEl).addEventListener('click', () => { ta.value = ex.solution; save(ex.solution); grow(); ta.focus(); });
          $('.s-copy', solEl).addEventListener('click', () => copyText(ex.solution));
        } else solEl.innerHTML = `<div class="solution"><div class="editor-label"><span>answer</span></div><pre><code></code></pre>${ex.explain ? `<div class="explain">${ex.explain}</div>` : ''}</div>`;
        if (!isCode) $('code', solEl).textContent = ex.solution;
      };
      if (progress.solved[ex.id]) { reveal(); return; }
      solEl.innerHTML = `<div class="confirm-row">Reveal the ${isCode ? 'solution' : 'answer'}?${hintN < ex.hints.length ? ' A hint might be enough.' : ''} <button type="button" class="btn small s-yes">Show it</button><button type="button" class="btn small quiet s-no">Keep trying</button></div>`;
      $('.s-yes', solEl).addEventListener('click', reveal);
      $('.s-no', solEl).addEventListener('click', () => { solEl.innerHTML = ''; });
    });
    wireCodeBlocks($('.ex-prompt', node), ex.track);
    return node;
  }

  function renderExercise(ex, opts = {}) {
    if (ex.kind === 'code' || ex.kind === 'answer') return renderCheckExercise(ex, opts);
    const isSql = ex.kind === 'sql' || ex.track === 'sql';
    const solved = !!progress.solved[ex.id];
    const starter = ex.starter || (ex.mode === 'script' ? '#!/bin/bash\n' : '');
    const isFile = ex.mode === 'file';
    const code0 = drafts[ex.id] !== undefined ? drafts[ex.id] : starter;
    const file = ex.file || 'script.sh';
    const testsHTML = ex.mode === 'script' ? `<div class="tests">${ex.tests.map((t, i) => `<div>test ${i + 1}: $ bash ${esc(file)} ${esc(t.args)}${t.stdin ? ' &lt; (input provided)' : ''}</div>`).join('')}</div>`
      : isFile ? `<div class="tests"><div>the grader saves this as ${esc(ex.file)}, then runs:</div>${ex.run.split('\n').map(l => `<div>$ ${esc(l)}</div>`).join('')}</div>` : '';
    const node = el(`
      <article class="ex${solved ? ' solved' : ''}" id="ex-${ex.id}" data-level="${ex.level}">
        ${exHead(ex, opts)}
        <div class="ex-body">
          ${ex.project ? '<p class="project-instruction"><strong>Project step</strong> · Complete this task in the editor below. Each run starts from the exercise’s own practice data; changes do not carry over to other exercises.</p>' : ''}
          <div class="ex-prompt">${ex.prompt}</div>
          ${!isSql && (ex.cwd !== '/home/student' || ex.setup) ? `<div class="ex-meta">${ex.cwd !== '/home/student' ? `<span>starts in ${esc(ex.cwd)}</span>` : ''}${ex.setup ? '<span>some setup runs first</span>' : ''}</div>` : ''}
          <div>
            <div class="editor-label"><span>${isSql ? 'Your query' : ex.mode === 'script' || isFile ? esc(file) : 'Your command(s)'}${ex.compare === 'verify' ? ' · graded on the resulting files' : ''}</span><button type="button" class="btn quiet small b-reset">Reset</button></div>
            <textarea class="editor" spellcheck="false" autocapitalize="off" autocomplete="off" id="ed-${ex.id}" aria-label="Answer for ${esc(ex.title)}" placeholder="${isSql ? 'SELECT …' : ex.mode === 'script' ? '#!/bin/bash' : isFile ? (ex.file === 'Dockerfile' ? 'FROM …' : 'services:') : 'Type a command…'}"></textarea>
            ${testsHTML}
            <div class="actions">
              <div class="btns">
                <button type="button" class="btn primary b-check">${ico('check')}Check</button>
                <button type="button" class="btn b-run">${ico('play')}Run</button>
                <span class="kbd-hint"><kbd>⌘/Ctrl</kbd> <kbd>Enter</kbd> runs, add <kbd>Shift</kbd> to check</span>
              </div>
              <div class="stuck" role="group" aria-label="Help">
                <span class="stuck-label">Stuck?</span>
                <button type="button" class="btn quiet b-hint"${ex.hints.length ? '' : ' hidden'}>Hint</button>
                <button type="button" class="btn quiet b-exp">Expected output</button>
                <button type="button" class="btn quiet b-sol">Solution</button>
              </div>
            </div>
          </div>
          <div class="hints"></div>
          <div class="feedback-slot"></div>
          <div class="out-slot"></div>
          <div class="exp-slot" hidden></div>
          <div class="sol-slot"></div>
        </div>
      </article>`);
    const ta = $('textarea', node);
    ta.value = code0;
    const hintsEl = $('.hints', node), fb = $('.feedback-slot', node), out = $('.out-slot', node), expEl = $('.exp-slot', node), solEl = $('.sol-slot', node);
    let hintN = 0;
    const grow = wireEditor(ta, {
      onRun: () => run(false), onCheck: () => run(true),
      onChange: v => { drafts[ex.id] = v; saveDrafts(); }
    });
    const hintBtn = $('.b-hint', node);
    const updateHintBtn = () => { hintBtn.textContent = hintN >= ex.hints.length ? 'No more hints' : `Hint ${hintN + 1}/${ex.hints.length}`; hintBtn.disabled = hintN >= ex.hints.length; };
    if (ex.hints.length) updateHintBtn();
    hintBtn.addEventListener('click', () => {
      if (hintN >= ex.hints.length) return;
      hintsEl.appendChild(el(`<div class="hint"><b>Hint ${hintN + 1}.</b> ${ex.hints[hintN].replace(/^<p>|<\/p>\s*$/g, '')}</div>`));
      hintN++; updateHintBtn();
    });
    const markSolved = () => solvedNow(ex, node);
    async function run(check) {
      const code = ta.value;
      if (!code.trim() || (ex.mode === 'script' && !code.replace(/^#!.*$/m, '').trim())) { fb.innerHTML = `<div class="feedback bad">Write ${isSql ? 'a query' : ex.mode === 'script' ? 'your script' : isFile ? 'the file' : 'a command'} first.</div>`; return; }
      fb.innerHTML = '';
      if (isSql) {
        out.innerHTML = '<div class="res-meta">Running…</div>';
        try { await sqlReady; } catch (e) { out.innerHTML = `<div class="err-box">${esc(sqlErr.message)}</div>`; return; }
        const db = freshDb();
        const r = runSql(code, db);
        let checkRes = null, checkErr = null;
        if (!r.error && ex.check) { try { checkRes = lastTable(execAll(db, ex.check)); } catch (e) { checkErr = e.message; } }
        db.close();
        out.innerHTML = resultsHTML(r);
        if (!check) return;
        if (r.error) { fb.innerHTML = `<div class="feedback bad">Your SQL has an error, so it can't be graded yet.<div class="detail">Fix the error shown below and check again.</div></div>`; return; }
        if (checkErr) {
          fb.innerHTML = `<div class="feedback bad"><strong>The grader's check query failed after your statements.</strong><div class="detail">${esc(checkErr)}. The grader ran:</div><div class="codeblock"><pre><code>${esc(ex.check)}</code></pre></div></div>`;
          return;
        }
        const exp = sqlExpected(ex);
        const user = ex.check ? checkRes : lastTable(r.results);
        const cmp = compareSql(user, exp, ex.ordered && !ex.check || (ex.check && /order\s+by/i.test(ex.check)));
        if (ex.check && !cmp.ok) cmp.detail = (cmp.detail ? cmp.detail + ' ' : '') + 'Grading ran this query against the database after your statements:';
        showVerdict(cmp, ex.check ? `<div class="codeblock"><pre><code>${esc(ex.check)}</code></pre></div>` + (checkRes ? tableHTML(checkRes) : '') : '');
      } else {
        const tests = ex.mode === 'script' ? ex.tests : [null];
        const results = tests.map(t => ({ t, run: bashRun(ex, code, t) }));
        if (ex.mode === 'script') {
          out.innerHTML = `<div class="test-res">${results.map((x, i) => `<div><h4>$ bash ${esc(file)} ${esc(x.t.args)}<span class="res-tag" data-i="${i}"></span></h4><pre class="termout">${chunksHTML(x.run.r.output)}</pre></div>`).join('')}</div>`;
        } else {
          const x = results[0];
          out.innerHTML = (isFile ? `<div class="res-meta">$ ${esc(ex.run.split('\n').join(' ; '))}</div>` : '') + `<pre class="termout">${chunksHTML(x.run.r.output)}</pre>` + (ex.verify ? `<div class="res-meta" style="margin-top:8px">Then the grader ran <code>${esc(ex.verify)}</code>:</div><pre class="termout">${esc(x.run.v.stdout + x.run.v.stderr).replace(/\n$/, '')}</pre>` : '');
        }
        if (!check) return;
        let allOk = true, firstBad = null, note = null;
        results.forEach((x, i) => {
          const exp = bashRun(ex, ex.solution, x.t);
          const cmp = compareText(bashTarget(ex, x.run), bashTarget(ex, exp), ex.unordered);
          const tag = $(`.res-tag[data-i="${i}"]`, out);
          if (tag) tag.innerHTML = cmp.ok ? ` <span class="pass">${ico('check')} pass</span>` : ` <span class="fail">${ico('cross')} fail</span>`;
          if (cmp.note) note = cmp.note;
          if (!cmp.ok) { allOk = false; if (!firstBad) { firstBad = cmp; if (x.t) firstBad.msg = `Test ${i + 1} (${x.t.args || 'no args'}): ${cmp.msg}`; } }
        });
        showVerdict(allOk ? { ok: true, note } : firstBad);
      }
    }
    function showVerdict(cmp, extra = '') {
      if (cmp.ok) {
        fb.innerHTML = `<div class="feedback ok">${ico('check')}${cmp.note || 'Correct.'}</div>` + (ex.explain ? `<div class="explain">${ex.explain}</div>` : '');
        markSolved();
      } else {
        fb.innerHTML = `<div class="feedback bad"><strong>${esc(cmp.msg)}</strong>${cmp.detail ? `<div class="${cmp.pre ? 'diffline' : 'detail'}">${esc(cmp.detail)}</div>` : ''}${extra ? `<div class="detail">${extra}</div>` : ''}</div>`;
      }
    }
    $('.b-run', node).addEventListener('click', () => run(false));
    $('.b-check', node).addEventListener('click', () => run(true));
    $('.b-reset', node).addEventListener('click', () => { ta.value = starter; delete drafts[ex.id]; saveDrafts(); grow(); fb.innerHTML = ''; out.innerHTML = ''; });
    $('.b-exp', node).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!expEl.hidden) { expEl.hidden = true; b.textContent = 'Expected output'; b.setAttribute('aria-expanded', 'false'); return; }
      expEl.hidden = false;
      b.textContent = 'Hide expected'; b.setAttribute('aria-expanded', 'true');
      if (isSql) {
        expEl.innerHTML = '<div class="res-meta">Computing…</div>';
        try { await sqlReady; } catch (err) { expEl.innerHTML = `<div class="err-box">${esc(sqlErr.message)}</div>`; return; }
        const exp = sqlExpected(ex);
        expEl.innerHTML = `<div class="res-meta"><strong>Expected ${ex.check ? 'state after your statements' : 'result'}</strong><span>${exp.values.length} rows</span>${ex.ordered ? '<span>order matters</span>' : '<span>any row order</span>'}</div>` + (ex.check ? `<div class="codeblock"><pre><code>${esc(ex.check)}</code></pre></div>` : '') + tableHTML(exp);
      } else {
        const tests = ex.mode === 'script' ? ex.tests : [null];
        expEl.innerHTML = tests.map(t => {
          const x = bashRun(ex, ex.solution, t);
          return `<div class="res-meta"><strong>Expected ${ex.compare === 'verify' ? `output of <code>${esc(ex.verify)}</code> afterwards` : 'output'}</strong>${t ? `<span>$ bash ${esc(file)} ${esc(t.args)}</span>` : ''}${ex.unordered ? '<span>any line order</span>' : ''}</div><pre class="termout">${esc(bashTarget(ex, x).replace(/\n$/, ''))}</pre>`;
        }).join('<div style="height:8px"></div>');
      }
    });
    $('.b-sol', node).addEventListener('click', () => {
      if (solEl.firstChild) { solEl.innerHTML = ''; return; }
      const reveal = () => {
        solEl.innerHTML = `<div class="solution"><div class="editor-label"><span>reference solution</span><span><button type="button" class="btn small s-load">Load into editor</button> <button type="button" class="btn small s-copy">Copy</button></span></div><pre><code></code></pre>${ex.explain ? `<div class="explain">${ex.explain}</div>` : ''}</div>`;
        $('code', solEl).textContent = ex.solution;
        $('.s-load', solEl).addEventListener('click', () => { ta.value = ex.solution; drafts[ex.id] = ex.solution; saveDrafts(); grow(); ta.focus(); });
        $('.s-copy', solEl).addEventListener('click', () => copyText(ex.solution));
      };
      if (progress.solved[ex.id]) { reveal(); return; }
      solEl.innerHTML = `<div class="confirm-row">Reveal the solution?${hintN < ex.hints.length ? ' A hint might be enough.' : ''} <button type="button" class="btn small s-yes">Show it</button><button type="button" class="btn small quiet s-no">Keep trying</button></div>`;
      $('.s-yes', solEl).addEventListener('click', reveal);
      $('.s-no', solEl).addEventListener('click', () => { solEl.innerHTML = ''; });
    });
    wireCodeBlocks($('.ex-prompt', node), ex.track);
    return node;
  }

  // ---------------------------------------------------------------- chrome
  const TRACK_META = {
    sql: { blurb: 'From SELECT to window functions: filtering, NULL logic, aggregation, every kind of join, subqueries, CTEs, data changes and schema design.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['playground', 'SQL playground'], ['schema', 'Database schema'], ['cheatsheet', 'Cheat sheet']] },
    bash: { blurb: 'From moving around the filesystem to real scripts: quoting, redirection, pipelines, grep, sed, awk, find, variables, loops and functions.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['terminal', 'Terminal'], ['fs', 'Practice files'], ['cheatsheet', 'Cheat sheet']] },
    docker: { blurb: 'Images, containers, Dockerfiles and layer caching, multi-stage builds, volumes, networks and Compose, against a simulated Docker engine.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['terminal', 'Docker terminal'], ['fs', 'Practice files'], ['cheatsheet', 'Cheat sheet']] },
    fastapi: { blurb: 'HTTP and REST, path and query parameters, Pydantic models, validation, errors, dependency injection, databases, auth and testing.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['cheatsheet', 'Cheat sheet']] },
    spring: { blurb: 'Dependency injection, REST controllers, validation and error handling, Spring Data JPA, configuration and profiles, layering, testing.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['terminal', 'Maven terminal'], ['cheatsheet', 'Cheat sheet']] },
    cicd: { blurb: 'Continuous integration and delivery with GitHub Actions: triggers, jobs and matrices, caching, secrets and OIDC, building and publishing images, deployment strategies, reusable workflows.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['cheatsheet', 'Cheat sheet']] },
    aws: { blurb: 'The AWS core for developers: IAM and policies, EC2, VPC networking, S3, RDS and DynamoDB, ECR and ECS, Lambda and messaging, CloudWatch, infrastructure as code and cost.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['cheatsheet', 'Cheat sheet']] },
    java: { blurb: 'Object-oriented programming in Java from the ground up: classes and objects, encapsulation, inheritance, interfaces, polymorphism, collections, generics, exceptions, SOLID and design patterns.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['cheatsheet', 'Cheat sheet']] },
    design: { blurb: 'System design and architecture: requirements and estimation, APIs, databases and scaling, caching, queues, consistency, reliability, architectural styles and full case studies.',
      pages: [['practice', 'All exercises'], ['review', 'Review quiz'], ['cheatsheet', 'Cheat sheet']] }
  };
  const TRACK_IDS = PJ.tracks.map(t => t.id);
  let currentTrack = store.get('track', 'sql');
  if (!TRACKS[currentTrack]) currentTrack = 'sql';
  const pad = n => String(n).padStart(2, '0');

  // One pixel per exercise. Boss exercises take a double-width cell.
  const strip = (exs, label) => `<span class="strip"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}>${exs.map(e => `<i class="px${e.level === 4 ? ' boss' : ''}${progress.solved[e.id] ? ' on' : ''}" data-ex="${e.id}"></i>`).join('')}</span>`;
  const bar = (solved, total) => { const n = 24, on = total ? Math.round(solved / total * n) : 0; return `<div class="bar" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</div>`; };

  function exHead(ex) {
    return `<header class="ex-head">
      <span class="ex-num" aria-hidden="true">${pad(ex.num)}</span>
      <h3 class="ex-title">${esc(ex.title)}</h3>
      ${lvlTag(ex.level)}${ex.project ? '<span class="proj">Project</span>' : ''}
      <span class="solved-tag">${ico('check')}Solved</span>
    </header>`;
  }
  function solvedNow(ex, node) {
    const first = !progress.solved[ex.id];
    if (first) { progress.solved[ex.id] = Date.now(); saveProgress(); toast('Solved', 'check'); }
    node.classList.add('solved');
    refreshRail();
    if (first) $$(`[data-ex="${ex.id}"]`).forEach(c => c.classList.add('on', 'lit'));
  }

  $('#tracks').innerHTML = TRACK_IDS.map(id => `<a href="#${id}" id="sw-${id}" style="--c: var(--${id})"><i class="sw" aria-hidden="true"></i>${esc(TRACKS[id].title)}</a>`).join('');
  $('#brand-mark').innerHTML = TRACK_IDS.concat(Array(9).fill('')).slice(0, 9).map(id => `<i style="background: ${id ? `var(--${id})` : 'var(--band-line)'}"></i>`).join('');
  function setTrack(t, highlight) {
    currentTrack = t;
    store.set('track', t);
    for (const id of TRACK_IDS) {
      document.body.classList.toggle('t-' + id, t === id);
      $('#sw-' + id).setAttribute('aria-current', String(highlight && t === id));
    }
  }
  function showRail(on) {
    $('#shell').classList.toggle('no-rail', !on);
    document.body.classList.toggle('home-route', !on);
  }

  // Where "SQL" (or any track) should take you: the last place you were, else the first unfinished module.
  const lastByTrack = store.get('lastByTrack', {});
  function remember(hash, tid) {
    lastByTrack[tid] = hash;
    store.set('lastByTrack', lastByTrack);
    store.set('last', hash);
  }
  function resumeHash(tid) {
    const h = lastByTrack[tid];
    if (h && MODS[h.split('/')[0]]) return h;
    const t = TRACKS[tid];
    return (t.modules.find(m => modStats(m).solved < modStats(m).total) || t.modules[0]).id;
  }

  let activeTok = 'home';
  function refreshRail() {
    const t = TRACKS[currentTrack];
    const st = trackStats(t);
    const pct = st.total ? Math.round(st.solved / st.total * 100) : 0;
    const activeMod = activeTok.split('/')[0];
    $('#rail').innerHTML = `
      <div class="rail-head">
        <p class="rail-title">${esc(t.title)}</p>
        ${bar(st.solved, st.total)}
        <div class="rail-stat"><span><b>${st.solved}</b> of ${st.total} solved</span><span>${pct}%</span></div>
      </div>
      <nav class="rail-group" aria-label="${esc(t.title)} modules">
        <div class="rail-label">Modules</div>
        <ol class="mods">${t.modules.map((m, i) => { const s = modStats(m); return `<li><a href="#${m.id}"${activeMod === m.id ? ' aria-current="page"' : ''}><span class="num">${pad(i + 1)}</span><span class="mt">${esc(m.title)}</span>${strip(m.exercises, `${s.solved} of ${s.total} solved`)}</a></li>`; }).join('')}</ol>
      </nav>
      <nav class="rail-group" aria-label="${esc(t.title)} practice and reference">
        <div class="rail-label">Practice and reference</div>
        <ul class="tools">${TRACK_META[currentTrack].pages.map(([k, label]) => `<li><a href="#${currentTrack}-${k}"${activeTok === `${currentTrack}-${k}` ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}</ul>
      </nav>`;
  }
  function setRailOpen(open) {
    document.body.classList.toggle('rail-open', open);
    $('#menu-btn').setAttribute('aria-expanded', String(open));
    if (open) { const a = $('#rail a[aria-current]') || $('#rail a'); if (a) a.focus({ preventScroll: true }); }
  }
  const closeRail = () => setRailOpen(false);
  $('#menu-btn').addEventListener('click', () => setRailOpen(!document.body.classList.contains('rail-open')));
  $('#scrim').addEventListener('click', closeRail);
  $('#rail').addEventListener('click', e => { if (e.target.closest('a')) closeRail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('rail-open')) { closeRail(); $('#menu-btn').focus(); } });

  // ----------------------------------------------------------------- pages
  const main = $('#main');
  function page(html, wide) { main.innerHTML = `<div class="page${wide ? ' wide' : ''}">${html}</div>`; return main.firstElementChild; }

  function renderHome() {
    const last = store.get('last', null);
    const lastMod = last && MODS[last.split('/')[0]];
    let resume;
    if (lastMod) {
      const [, stepKey, n] = last.split('/');
      const s = modStats(lastMod);
      const where = stepKey === 'exercises' ? (n && lastMod.exercises[n - 1] ? `Exercise ${n}: ${lastMod.exercises[n - 1].title}` : 'Exercises') : stepKey === 'quiz' ? 'Quick check' : 'Lesson';
      resume = `<section class="resume t-${lastMod.track}" aria-labelledby="resume-h">
        <div>
          <h2 id="resume-h">Continue ${esc(lastMod.title)}</h2>
          <p>${esc(lastMod.trackObj.title)}, module ${lastMod.index + 1} · ${esc(where)} · ${s.solved} of ${s.total} solved</p>
          ${strip(lastMod.exercises)}
        </div>
        <a class="btn primary" href="#${last}">Continue ${ico('right')}</a>
      </section>`;
    } else {
      const m = PJ.tracks[0].modules[0];
      resume = `<section class="resume t-${m.track}" aria-labelledby="resume-h">
        <div>
          <h2 id="resume-h">Start with ${esc(m.trackObj.title)}: ${esc(m.title)}</h2>
          <p>Every track starts with a short lesson. Or pick any track below; progress saves in this browser as you go.</p>
        </div>
        <a class="btn primary" href="#${m.id}">Start the first lesson ${ico('right')}</a>
      </section>`;
    }
    const panel = (t) => {
      const st = trackStats(t);
      return `<section class="tpanel t-${t.id}" aria-labelledby="tp-${t.id}">
        <div class="tpanel-top"><h2 id="tp-${t.id}"><a href="#${t.id}">${esc(t.title)}</a></h2><span class="count"><b>${st.solved}</b> / ${st.total} solved</span></div>
        <p>${TRACK_META[t.id].blurb}</p>
        <div class="map">${t.modules.map((m, i) => { const s = modStats(m); return `<a href="#${m.id}"><span class="mn">${pad(i + 1)}</span>${strip(m.exercises)}<span class="mt">${esc(m.title)}<span class="sr">, ${s.solved} of ${s.total} solved</span></span></a>`; }).join('')}</div>
        <div class="btns"><a class="btn primary" href="#${t.id}">${st.solved ? 'Continue' : 'Start'} ${ico('right')}</a><a class="btn quiet" href="#${t.id}-practice">All exercises</a><a class="btn quiet" href="#${t.id}-review">Review quiz</a></div>
      </section>`;
    };
    const total = PJ.tracks.reduce((a, t) => a + trackStats(t).total, 0);
    main.innerHTML = `<div class="home">
      <section class="intro">
        <h1>Learn it by doing it.</h1>
        <p class="lede">${PJ.tracks.length} tracks, ${total} graded exercises. Read a short lesson, check yourself, then solve problems from warm-up to boss level while building one project per track. Queries run on a real SQLite database, shell and Docker commands in simulators, and code, workflows and designs are checked against requirements, all in your browser.</p>
      </section>
      ${resume}
      <div class="grid">${PJ.tracks.map(panel).join('')}</div>
      <section class="section" aria-labelledby="how-h">
        <div class="section-head"><h2 class="h2" id="how-h">How exercises work</h2><span class="aside">Each square on a map is one exercise. It fills when you solve it.</span></div>
        <p class="howto"><b>Run</b> executes your answer and shows the real output, starting each time from a fresh database, filesystem or Docker engine. <b>Check</b> compares it with the reference solution, or a list of requirements, and says specifically what's off. If you're <b>stuck</b>, hints reveal one at a time, with expected output and the full solution behind them. Progress, quiz answers and drafts are <b>saved</b> in this browser, so you can stop anywhere.</p>
        <div class="legend">${[1, 2, 3, 4].map(l => lvlTag(l)).join('')}<span><i class="px boss" style="display:inline-block;vertical-align:middle"></i> Boss problems are exam- and interview-grade and take a double square.</span></div>
      </section>
    </div>`;
  }

  function renderModule(m, stepKey, exN) {
    const t = m.trackObj;
    const s = modStats(m);
    const prev = t.modules[m.index - 1], next = t.modules[m.index + 1];
    const hasQuiz = m.quiz.length > 0;
    if (stepKey === 'quiz' && !hasQuiz) stepKey = 'exercises';
    if (stepKey !== 'quiz' && stepKey !== 'exercises') stepKey = 'lesson';
    const steps = [['lesson', 'Lesson', '', `#${m.id}`]];
    if (hasQuiz) steps.push(['quiz', 'Quick check', `${m.quiz.length} questions`, `#${m.id}/quiz`]);
    steps.push(['exercises', 'Exercises', `${s.solved}/${s.total}`, `#${m.id}/exercises`]);
    const nextLink = (label, href, text) => `<div class="next-step"><p>${text}</p><a class="btn primary" href="${href}">${label} ${ico('right')}</a></div>`;
    const p = page(`
      <div class="mod-head">
        <h1 class="page-title">${esc(m.title)}</h1>
        <p class="lede">${esc(m.summary)}</p>
        <div class="meta"><span>${esc(t.title)}, module <b>${m.index + 1}</b> of ${t.modules.length}</span><span>About ${m.minutes} min</span><span><b>${s.solved}</b> of ${s.total} exercises solved</span></div>
      </div>
      <div class="mod-strip" role="group" aria-label="Exercises: ${s.solved} of ${s.total} solved">${m.exercises.map((e, i) => `<a href="#${m.id}/exercises/${i + 1}" aria-label="Exercise ${i + 1}: ${esc(e.title)}${progress.solved[e.id] ? ', solved' : ''}"><i class="px${e.level === 4 ? ' boss' : ''}${progress.solved[e.id] ? ' on' : ''}" data-ex="${e.id}"></i></a>`).join('')}</div>
      <nav class="steps" aria-label="Module steps">${steps.map(([k, label, c, href], i) => `<a href="${href}"${k === stepKey ? ' aria-current="page"' : ''}><span class="n">${i + 1}</span>${label}${c ? `<span class="c">${c}</span>` : ''}</a>`).join('')}</nav>
      <div id="step"></div>
    `);
    p.classList.add('mod');
    const box = $('#step', p);
    if (stepKey === 'lesson') {
      const practice = ['sql', 'bash', 'docker', 'spring'].includes(t.id)
        ? 'Examples with a Run button run here against fresh practice data. Other code blocks are examples to read or try in your own environment.'
        : 'Code and commands in the lesson are examples to read or try in your own environment; they do not run on this site.';
      box.innerHTML = `<aside class="callout lesson-guide"><div class="callout-title">How to practice</div><p>${practice} In Exercises, look for <strong>Project</strong> steps to apply the lesson to the track project. Exercises are independent; the site saves your answers, not a shared project.</p></aside><article class="prose lesson">${m.lesson}</article>` +
        (hasQuiz ? nextLink('Quick check', `#${m.id}/quiz`, `Done reading? ${m.quiz.length} quick questions to check the ideas stuck.`)
          : nextLink('Exercises', `#${m.id}/exercises`, `Done reading? Try the ${m.exercises.length} exercises.`));
      wireCodeBlocks($('.lesson', box), t.id);
    } else if (stepKey === 'quiz') {
      const quiz = el('<div class="quiz"></div>');
      m.quiz.forEach((q, i) => quiz.appendChild(renderQuiz(q, null, `${i + 1} of ${m.quiz.length}`)));
      box.appendChild(quiz);
      box.appendChild(el(nextLink('Exercises', `#${m.id}/exercises`, `Next: ${m.exercises.length} exercises, from ${LEVELS[Math.min(...m.exercises.map(e => e.level))].toLowerCase()} to ${LEVELS[Math.max(...m.exercises.map(e => e.level))].toLowerCase()}.`)));
    } else {
      const firstOpen = m.exercises.findIndex(e => !progress.solved[e.id]);
      let cur = exN >= 1 && exN <= m.exercises.length ? exN - 1 : Math.max(firstOpen, 0);
      box.innerHTML = `
        <div class="stepper" role="group" aria-label="Exercises in this module">${m.exercises.map((e, i) => `<button type="button" data-i="${i}" data-ex="${e.id}" class="${e.level === 4 ? 'boss' : ''}${progress.solved[e.id] ? ' on' : ''}" aria-label="Exercise ${i + 1}: ${esc(e.title)}, ${LEVELS[e.level]}${e.project ? ', project' : ''}${progress.solved[e.id] ? ', solved' : ''}">${i + 1}${e.project ? '<span class="step-project" aria-hidden="true">P</span>' : ''}</button>`).join('')}</div>
        <div class="stepper-key" aria-hidden="true"><span><i class="px on"></i>Solved</span><span><i class="px"></i>Open</span><span><i class="px boss"></i>Boss</span><span>P = Project</span></div>
        <div class="ex-slot"></div>
        <div class="ex-nav"><button type="button" class="btn ex-prev">${ico('left')}Previous exercise</button><button type="button" class="btn ex-next">Next exercise ${ico('right')}</button></div>
        <nav class="pager" aria-label="Modules">${prev ? `<a href="#${prev.id}"><small>Previous module</small><b>${esc(prev.title)}</b></a>` : '<span></span>'}${next ? `<a class="next" href="#${next.id}"><small>Next module</small><b>${esc(next.title)}</b></a>` : `<a class="next" href="#${t.id}-practice"><small>Finished the track?</small><b>Mixed practice</b></a>`}</nav>`;
      const slot = $('.ex-slot', box);
      const nodes = m.exercises.map(ex => { const n = renderExercise(ex); n.hidden = true; slot.appendChild(n); return n; });
      const btns = $$('.stepper button', box);
      const prevB = $('.ex-prev', box), nextB = $('.ex-next', box);
      const show = (i, focus) => {
        cur = i;
        nodes.forEach((n, j) => { n.hidden = j !== i; });
        btns.forEach((b, j) => { if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
        prevB.disabled = i === 0;
        nextB.disabled = i === nodes.length - 1;
        const h = `${m.id}/exercises/${i + 1}`;
        history.replaceState(null, '', '#' + h);
        remember(h, t.id);
        if (focus) { const ed = $('textarea, input', nodes[i]); nodes[i].scrollIntoView({ block: 'nearest' }); if (ed) ed.focus({ preventScroll: true }); }
      };
      btns.forEach((b, i) => b.addEventListener('click', () => show(i, true)));
      prevB.addEventListener('click', () => show(cur - 1, true));
      nextB.addEventListener('click', () => show(cur + 1, true));
      show(cur, false);
    }
    if (stepKey !== 'exercises') remember(stepKey === 'quiz' ? `${m.id}/quiz` : m.id, t.id);
  }

  function renderPractice(tid) {
    const t = TRACKS[tid];
    const p = page(`
      <h1 class="page-title">All ${t.title} exercises</h1>
      <p class="lede">Every exercise from every module in one place. Filter to what you need, or pull a random unsolved one for spaced review.</p>
      <div class="toolbar">
        <select id="pf-mod" aria-label="Module"><option value="">All modules</option>${t.modules.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select>
        <select id="pf-lvl" aria-label="Level"><option value="">All levels</option>${[1, 2, 3, 4].map(l => `<option value="${l}">${LEVELS[l]}</option>`).join('')}</select>
        <select id="pf-st" aria-label="Status"><option value="">Solved and unsolved</option><option value="open">Unsolved only</option><option value="done">Solved only</option></select>
        <input type="search" id="pf-q" placeholder="Search titles…" aria-label="Search">
        <button type="button" class="btn primary" id="pf-rand">Random unsolved</button>
      </div>
      <div id="pf-focus"></div>
      <div class="res-meta" id="pf-count"></div>
      <div class="ex-index" id="pf-list"></div>
    `, true);
    const all = t.modules.flatMap(m => m.exercises);
    const focus = $('#pf-focus', p);
    const open = (ex) => {
      focus.innerHTML = '';
      focus.appendChild(renderExercise(ex, { showModule: true }));
      focus.appendChild(el(`<div class="btns" style="margin:12px 0 32px"><a class="btn small" href="#${ex.mod.id}">Open the ${esc(ex.mod.title)} lesson</a><button type="button" class="btn small quiet pf-close">Close</button></div>`));
      $('.pf-close', focus).addEventListener('click', () => { focus.innerHTML = ''; draw(); });
      focus.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const draw = () => {
      const mod = $('#pf-mod', p).value, lvl = $('#pf-lvl', p).value, st = $('#pf-st', p).value, q = $('#pf-q', p).value.trim().toLowerCase();
      const list = all.filter(e => (!mod || e.mod.id === mod) && (!lvl || String(e.level) === lvl) && (!st || (st === 'done') === !!progress.solved[e.id]) && (!q || e.title.toLowerCase().includes(q)));
      $('#pf-count', p).textContent = `${list.length} exercise${list.length === 1 ? '' : 's'} · ${list.filter(e => progress.solved[e.id]).length} solved`;
      const box = $('#pf-list', p);
      box.innerHTML = list.length ? '' : '<div class="empty">Nothing matches these filters.</div>';
      for (const e of list) {
        const row = el(`<button type="button" class="ex-row"><i class="px${progress.solved[e.id] ? ' on' : ''}" aria-hidden="true"></i><span>${esc(e.title)}${progress.solved[e.id] ? '<span class="sr">, solved</span>' : ''}</span><span class="mod">${esc(e.mod.title)}</span>${lvlTag(e.level)}</button>`);
        row.addEventListener('click', () => open(e));
        box.appendChild(row);
      }
    };
    ['#pf-mod', '#pf-lvl', '#pf-st'].forEach(s => $(s, p).addEventListener('change', draw));
    $('#pf-q', p).addEventListener('input', draw);
    $('#pf-rand', p).addEventListener('click', () => {
      const mod = $('#pf-mod', p).value, lvl = $('#pf-lvl', p).value;
      const pool = all.filter(e => !progress.solved[e.id] && (!mod || e.mod.id === mod) && (!lvl || String(e.level) === lvl));
      if (!pool.length) { toast('Everything here is solved!'); return; }
      open(pool[Math.floor(Math.random() * pool.length)]);
    });
    draw();
  }

  function renderReview(tid) {
    const t = TRACKS[tid];
    const all = t.modules.flatMap(m => m.quiz.map(q => Object.assign({ mod: m }, q)));
    const p = page(`
      <h1 class="page-title">${t.title} concept review</h1>
      <p class="lede">All ${all.length} quick-check questions from the ${t.title} modules, shuffled. Good for a final pass before an exam.</p>
      <div class="toolbar">
        <select id="rv-mod" aria-label="Module"><option value="">All modules</option>${t.modules.filter(m => m.quiz.length).map(m => `<option value="${m.id}">${esc(m.title)} (${m.quiz.length})</option>`).join('')}</select>
        <button type="button" class="btn primary" id="rv-start">Start a new round</button>
      </div>
      <div id="rv-box"></div>
    `);
    const box = $('#rv-box', p);
    let deck = [], idx = 0, right = 0, missed = [];
    const start = (pool) => {
      deck = pool.slice().sort(() => Math.random() - 0.5);
      idx = 0; right = 0; missed = [];
      show();
    };
    const show = () => {
      if (idx >= deck.length) {
        box.innerHTML = `<div class="review-card"><div class="score">${right} / ${deck.length} correct</div><p>${right === deck.length ? 'Perfect round.' : `You missed ${missed.length}. Their modules are the best places to re-read.`}</p>${missed.length ? `<ul>${missed.map(q => `<li><a href="#${q.mod.id}">${esc(q.mod.title)}</a>: ${q.q}</li>`).join('')}</ul>` : ''}<div class="btns">${missed.length ? '<button type="button" class="btn primary rv-missed">Retry the missed ones</button>' : ''}<button type="button" class="btn rv-again">New round</button></div></div>`;
        const m = $('.rv-missed', box); if (m) m.addEventListener('click', () => start(missed));
        $('.rv-again', box).addEventListener('click', () => start(pool()));
        return;
      }
      const q = deck[idx];
      box.innerHTML = `<div class="res-meta"><span>Question ${idx + 1} of ${deck.length}</span><span>${right} correct so far</span><span>from <a href="#${q.mod.id}">${esc(q.mod.title)}</a></span></div>`;
      const card = renderQuiz(q, ok => {
        if (ok) right++; else missed.push(q);
        const nb = el(`<div class="btns"><button type="button" class="btn primary">${idx + 1 < deck.length ? 'Next question ' + ico('right') : 'See results'}</button></div>`);
        $('button', nb).addEventListener('click', () => { idx++; show(); });
        card.appendChild(nb);
        $('button', nb).focus();
      });
      box.appendChild(card);
    };
    const pool = () => { const mod = $('#rv-mod', p).value; return all.filter(q => !mod || q.mod.id === mod); };
    $('#rv-start', p).addEventListener('click', () => start(pool()));
    $('#rv-mod', p).addEventListener('change', () => start(pool()));
    start(pool());
  }

  async function renderPlayground() {
    const sample = '-- Try anything. Statements run against a persistent copy of the practice DB.\nSELECT d.name AS department, COUNT(e.emp_id) AS headcount, ROUND(AVG(e.salary)) AS avg_salary\nFROM departments d\nLEFT JOIN employees e ON e.dept_id = d.dept_id\nGROUP BY d.dept_id\nORDER BY headcount DESC;';
    const p = page(`
      <h1 class="page-title">SQL playground</h1>
      <p class="lede">A scratch database that keeps your changes until you reset it. Create tables, insert rows, break things.</p>
      <div class="pg">
        <div>
          <div class="editor-label"><span>query</span><span>several statements are fine; each result is shown</span></div>
          <textarea class="editor" id="pg-ed" spellcheck="false" aria-label="SQL editor" style="min-height:160px"></textarea>
          <div class="btns"><button type="button" class="btn primary" id="pg-run">${ico('play')}Run</button><button type="button" class="btn" id="pg-reset">Reset database</button><select id="pg-ex" aria-label="Example queries"><option value="">Load an example…</option></select><span class="kbd-hint"><kbd>⌘/Ctrl</kbd> <kbd>Enter</kbd> runs</span></div>
          <div id="pg-out" style="margin-top:16px"></div>
        </div>
        <aside><div class="editor-label"><span>tables</span><span>click a column (or double-click a table) to insert it</span></div><div class="schema-list" id="pg-schema">Loading…</div></aside>
      </div>
    `, true);
    const ed = $('#pg-ed', p);
    ed.value = store.get('playground', sample);
    const outEl = $('#pg-out', p);
    let db = null;
    try { await sqlReady; } catch (e) { outEl.innerHTML = `<div class="err-box">${esc(sqlErr.message)}</div>`; return; }
    if (!$('#pg-ed')) return;
    db = window.__pgdb || (window.__pgdb = freshDb());
    const run = () => {
      const r = runSql(ed.value, db);
      outEl.innerHTML = `<div class="res-meta"><span>${r.ms.toFixed(1)} ms</span></div>` + resultsHTML(r);
      drawSchema();
    };
    const drawSchema = () => {
      const tables = execAll(db, "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")[0].values.map(r => r[0]);
      $('#pg-schema', p).innerHTML = tables.map(tn => {
        const cols = execAll(db, `PRAGMA table_info("${tn.replace(/"/g, '""')}")`)[0].values;
        const n = execAll(db, `SELECT COUNT(*) FROM "${tn.replace(/"/g, '""')}"`)[0].values[0][0];
        return `<details><summary data-ins="${esc(tn)}">${esc(tn)}<span>${n} rows</span></summary><ul>${cols.map(c => `<li data-ins="${esc(c[1])}"><span>${c[5] ? '<span class="pk">' + esc(c[1]) + '</span>' : esc(c[1])}</span><em>${esc(c[2] || '')}</em></li>`).join('')}</ul></details>`;
      }).join('');
    };
    $('#pg-schema', p).addEventListener('click', e => {
      const t = e.target.closest('li[data-ins]');
      if (!t) return;
      ed.setRangeText(t.dataset.ins, ed.selectionStart, ed.selectionEnd, 'end');
      ed.focus();
    });
    $('#pg-schema', p).addEventListener('dblclick', e => {
      const t = e.target.closest('summary[data-ins]');
      if (!t) return;
      ed.setRangeText(t.dataset.ins, ed.selectionStart, ed.selectionEnd, 'end');
    });
    const examples = [
      ['Headcount by department', sample],
      ['Top 3 earners per department (window)', 'SELECT * FROM (\n  SELECT d.name AS dept, e.first_name, e.salary,\n         RANK() OVER (PARTITION BY e.dept_id ORDER BY e.salary DESC) AS rnk\n  FROM employees e JOIN departments d USING (dept_id)\n) WHERE rnk <= 3;'],
      ['Org chart (recursive CTE)', "WITH RECURSIVE chain(emp_id, name, depth) AS (\n  SELECT emp_id, first_name, 0 FROM employees WHERE manager_id IS NULL\n  UNION ALL\n  SELECT e.emp_id, e.first_name, c.depth + 1\n  FROM employees e JOIN chain c ON e.manager_id = c.emp_id\n)\nSELECT substr('            ', 1, depth * 2) || name AS org_chart FROM chain;"],
      ['Create your own table', "CREATE TABLE pets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, species TEXT, age INTEGER);\nINSERT INTO pets (name, species, age) VALUES ('Biscuit', 'dog', 4), ('Mochi', 'cat', 2);\nSELECT * FROM pets;"],
      ['Revenue by month', "SELECT strftime('%Y-%m', o.order_date) AS month,\n       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue\nFROM orders o JOIN order_items oi USING (order_id)\nWHERE o.status <> 'cancelled'\nGROUP BY month ORDER BY month;"],
      ['Inspect the schema', "SELECT name, sql FROM sqlite_master WHERE type = 'table';"]
    ];
    const sel = $('#pg-ex', p);
    examples.forEach(([n], i) => sel.appendChild(el(`<option value="${i}">${esc(n)}</option>`)));
    sel.addEventListener('change', () => { if (sel.value === '') return; ed.value = examples[+sel.value][1]; store.set('playground', ed.value); sel.value = ''; grow(); run(); });
    const grow = wireEditor(ed, { onRun: run, onChange: debounce(v => store.set('playground', v), 300) });
    $('#pg-run', p).addEventListener('click', run);
    $('#pg-reset', p).addEventListener('click', () => { db.close(); db = window.__pgdb = freshDb(); outEl.innerHTML = '<div class="ok-box">Database reset to the original practice data.</div>'; drawSchema(); });
    drawSchema();
    run();
  }

  const TABLE_INFO = {
    departments: ['Company', 'One row per department. Research has no employees; useful for outer-join practice.'],
    employees: ['Company', 'Staff with salaries and a self-referencing manager_id. The CEO has no manager; two people have no department; some emails and cities are NULL.'],
    instructors: ['University', 'Faculty who teach courses.'],
    courses: ['University', 'Course catalog. CSC 492 has no instructor yet and no enrollments.'],
    students: ['University', 'Students with major, class year and GPA. Some GPAs, majors and emails are NULL.'],
    enrollments: ['University', 'Which student took which course in which term. Fall 2026 is in progress, so grade and score are NULL. Two students have no enrollments.'],
    customers: ['Store', 'Store customers. Two customers have never ordered.'],
    products: ['Store', 'Product catalog with price and stock. Two products have never been ordered; two are out of stock.'],
    orders: ['Store', 'One row per order with a status: pending, shipped, delivered or cancelled.'],
    order_items: ['Store', 'Line items: which products, how many, at what unit price (sometimes discounted from list price).']
  };
  async function renderSchema() {
    const p = page(`
      <h1 class="page-title">The practice database</h1>
      <p class="lede">Ten tables in three little worlds. Keys are marked; arrows show foreign keys. The quirks noted under each table are deliberate: they're what the trickier exercises test.</p>
      <div class="schema-cards" id="sc">Loading…</div>`);
    try { await sqlReady; } catch (e) { $('#sc', p).innerHTML = `<div class="err-box">${esc(sqlErr.message)}</div>`; return; }
    const db = freshDb();
    const names = Object.keys(TABLE_INFO);
    $('#sc', p).innerHTML = names.map(tn => {
      const cols = execAll(db, `PRAGMA table_info(${tn})`)[0].values;
      const fks = execAll(db, `PRAGMA foreign_key_list(${tn})`)[0].values;
      const fkMap = {}; fks.forEach(f => { fkMap[f[3]] = `${f[2]}.${f[4]}`; });
      const n = execAll(db, `SELECT COUNT(*) FROM ${tn}`)[0].values[0][0];
      const sample = execAll(db, `SELECT * FROM ${tn} LIMIT 3`)[0];
      return `<div class="schema-card"><h3>${tn} <small>${TABLE_INFO[tn][0]} · ${n} rows</small></h3><p class="desc">${TABLE_INFO[tn][1]}</p>
        <div class="table-wrap"><table class="md-table"><thead><tr><th>column</th><th>type</th><th>key</th></tr></thead><tbody>${cols.map(c => `<tr><td><code>${c[1]}</code></td><td>${c[2]}${c[3] ? ' NOT NULL' : ''}</td><td>${c[5] ? 'PK' : ''}${fkMap[c[1]] ? `<span class="fk">references ${fkMap[c[1]]}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="res-meta">first 3 rows</div>${tableHTML(sample)}</div>`;
    }).join('');
    db.close();
  }

  // ------------------------------------------------------------- terminal
  class Terminal {
    constructor(root, fixture, greeting) {
      this.fixture = fixture || 'base';
      this.root = root;
      this.history = store.get('termhist', []);
      this.hi = this.history.length;
      this.buf = '';
      this.sh = new MB.Shell({ fs: fixtureFs(this.fixture).clone() });
      root.innerHTML = '<div class="term-out"></div><div class="term-input-row"><span class="ps"></span><input type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Terminal input"></div>';
      this.out = $('.term-out', root);
      this.input = $('input', root);
      this.ps = $('.term-input-row .ps', root);
      this.updatePrompt();
      this.print(`<span class="dim">${greeting || 'minibash — a bash simulator. Your home folder has practice files. Try: <b>ls</b>, <b>tree</b>, <b>cat notes.txt</b>, <b>help</b>'}</span>`);
      root.addEventListener('click', () => { if (!window.getSelection().toString()) this.input.focus(); });
      this.input.addEventListener('keydown', e => this.key(e));
    }
    promptHTML(cont) {
      if (cont) return '<span class="ps">&gt; </span>';
      const p = this.sh.prompt();
      return `<span class="ps">${esc(p.user)}@${esc(p.host)}:<span class="dir">${esc(p.dir)}</span>$ </span>`;
    }
    updatePrompt() { this.ps.outerHTML = this.promptHTML(!!this.buf); this.ps = $('.term-input-row .ps', this.root); }
    print(html) { const d = document.createElement('div'); d.className = 'line'; d.innerHTML = html; this.out.appendChild(d); this.root.scrollTop = this.root.scrollHeight; }
    reset() { this.sh = new MB.Shell({ fs: fixtureFs(this.fixture).clone() }); this.out.innerHTML = ''; this.buf = ''; this.updatePrompt(); this.print('<span class="dim">Filesystem and shell reset.</span>'); }
    exec(line) {
      this.print(this.promptHTML(!!this.buf) + esc(line));
      this.buf = this.buf ? this.buf + '\n' + line : line;
      if (MB.needsMore(this.buf)) { this.updatePrompt(); return; }
      const src = this.buf;
      this.buf = '';
      if (src.trim()) {
        this.history.push(src);
        if (this.history.length > 200) this.history.shift();
        store.set('termhist', this.history);
        this.sh.history.push(src);
      }
      this.hi = this.history.length;
      const r = this.sh.run(src, { tty: true });
      if (r.output.some(c => c.s.includes('\x1b[clear]'))) this.out.innerHTML = '';
      const html = chunksHTML(r.output);
      if (html) this.print(html);
      this.updatePrompt();
    }
    key(e) {
      const inp = this.input;
      if (e.key === 'Enter') { e.preventDefault(); const v = inp.value; inp.value = ''; this.exec(v); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (this.hi > 0) { this.hi--; inp.value = this.history[this.hi]; } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (this.hi < this.history.length) { this.hi++; inp.value = this.history[this.hi] || ''; } return; }
      if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.out.innerHTML = ''; return; }
      if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) { e.preventDefault(); this.print(this.promptHTML(!!this.buf) + esc(inp.value) + '^C'); inp.value = ''; this.buf = ''; this.updatePrompt(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const before = inp.value.slice(0, inp.selectionStart), after = inp.value.slice(inp.selectionStart);
        const c = this.sh.complete(before);
        if (!c.names.length) return;
        let common = c.names[0];
        for (const n of c.names) { let i = 0; while (i < common.length && common[i] === n[i]) i++; common = common.slice(0, i); }
        if (c.names.length === 1) {
          const add = c.dirPart + common + (common.endsWith('/') ? '' : ' ');
          inp.value = before.slice(0, before.length - c.word.length) + add + after;
        } else if (common.length > c.base.length) {
          inp.value = before.slice(0, before.length - c.word.length) + c.dirPart + common + after;
        } else {
          this.print(this.promptHTML(!!this.buf) + esc(inp.value));
          this.print(esc(c.names.join('  ')));
        }
      }
    }
  }
  const TERMINALS = {
    bash: { title: 'Practice terminal', lede: 'A free-play shell over your practice home folder. Changes last until you reset or leave this page. History persists, with ↑ ↓, and Tab completes names.', cmds: ['ls -la', 'tree', 'cat data/employees.csv', 'grep ERROR logs/app.log', "awk -F, 'NR>1 {print $2, $4}' data/employees.csv", 'help'] },
    docker: { title: 'Docker terminal', lede: 'A shell with a simulated Docker engine. Pull images, build from the Dockerfiles you write, run containers, publish ports and curl them, create networks and volumes, run Compose. State lasts until you reset or leave the page.', greeting: 'Docker simulator ready. Try: <b>docker run hello-world</b>, <b>docker run -d -p 8080:80 nginx</b> then <b>curl localhost:8080</b>, or <b>cd fastapi-app</b> and write a Dockerfile.', cmds: ['docker run hello-world', 'docker run -d --name web -p 8080:80 nginx', 'curl -s localhost:8080', 'docker ps', 'docker images', 'tree -L 2'] },
    spring: { title: 'Maven terminal', lede: 'The spring-app project with a simulated Maven and JVM: compile, test and package it, run the jar, and curl its endpoints. Edit files with heredocs (cat > file <<\'EOF\').', greeting: 'Try: <b>cd spring-app</b>, <b>./mvnw package</b>, <b>java -jar target/demo-0.0.1-SNAPSHOT.jar</b>, then <b>curl localhost:8080/hello</b>.', cmds: ['cd spring-app', 'tree src', './mvnw -q package', 'java -jar target/demo-0.0.1-SNAPSHOT.jar', 'curl -s "localhost:8080/hello?name=Ada"', 'curl -s localhost:8080/actuator/health'] }
  };
  function renderTerminal(tid) {
    const T = TERMINALS[tid] || TERMINALS.bash;
    const p = page(`
      <h1 class="page-title">${T.title}</h1>
      <p class="lede">${T.lede}</p>
      <div class="term-bar">
        <button type="button" class="btn" id="t-reset">Reset</button>
        ${T.cmds.map(c => `<button type="button" class="btn small quiet t-cmd" data-c="${esc(c)}"><code>${esc(c)}</code></button>`).join('')}
      </div>
      <div class="term" id="term"></div>
    `, true);
    const term = new Terminal($('#term', p), trackFixture(tid), T.greeting);
    $('#t-reset', p).addEventListener('click', () => term.reset());
    $$('.t-cmd', p).forEach(b => b.addEventListener('click', () => { term.exec(b.dataset.c); term.input.focus(); }));
    term.input.focus();
  }

  function renderFiles(tid) {
    const fx = trackFixture(tid);
    const spec = (PJ.fixtures && PJ.fixtures[fx]) || PJ.fs;
    const sh = new MB.Shell({ fs: fixtureFs(fx).clone() });
    const tree = sh.run('tree -a', { tty: false }).stdout;
    const files = Object.keys(spec).filter(k => !spec[k].dir);
    const p = page(`
      <h1 class="page-title">Practice files</h1>
      <p class="lede">Every ${esc(TRACKS[tid].title)} exercise starts in <code>/home/student</code> with this exact set of files. Pick one to see its contents.</p>
      <div class="pg">
        <div><div class="toolbar"><select id="fv-sel" aria-label="File">${files.map(f => `<option value="${esc(f)}">${esc(f.replace('/home/student/', '~/'))}</option>`).join('')}</select><span class="res-meta" id="fv-meta"></span></div><pre class="termout" id="fv-out" style="max-height:70vh"></pre></div>
        <aside><div class="editor-label"><span>tree -a</span></div><pre class="file-tree">${esc(tree)}</pre></aside>
      </div>`, true);
    const sel = $('#fv-sel', p);
    const show = () => {
      const f = spec[sel.value];
      const c = f.content;
      $('#fv-out', p).textContent = c || '(empty file)';
      $('#fv-meta', p).textContent = `${c.split('\n').length - (c.endsWith('\n') ? 1 : 0)} lines · ${c.length} bytes${f.mode & 0o100 ? ' · executable' : ''}`;
    };
    sel.value = files.includes('/home/student/data/employees.csv') ? '/home/student/data/employees.csv' : files.find(f => /main\.py$/.test(f)) || files[0];
    sel.addEventListener('change', show);
    show();
  }

  function renderCheatsheet(tid) {
    const html = PJ.extra['cheatsheet-' + tid] || '<p>Coming soon.</p>';
    const p = page(`<h1 class="page-title">${esc(TRACKS[tid].title)} cheat sheet</h1><p class="lede">A quick reference for this track.</p><article class="prose">${html}</article>`);
    wireCodeBlocks(p, tid);
  }

  // ---------------------------------------------------------------- router
  function route() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, '')) || 'home';
    let [tok, stepKey, n] = raw.split('/');
    if (TRACKS[tok]) { location.replace('#' + resumeHash(tok)); return; }
    if (tok.startsWith('ex-') && EXS[tok.slice(3)]) { const ex = EXS[tok.slice(3)]; tok = ex.mod.id; stepKey = 'exercises'; n = ex.num; }
    const m = MODS[tok];
    let pageKey = null, trackOf = currentTrack;
    if (m) trackOf = m.track;
    else {
      const dash = tok.indexOf('-');
      const tid = tok.slice(0, dash), key = tok.slice(dash + 1);
      if (TRACKS[tid] && TRACK_META[tid].pages.some(p => p[0] === key)) { trackOf = tid; pageKey = key; }
    }
    closeRail();
    if (!m && !pageKey) {
      activeTok = 'home';
      setTrack(currentTrack, false);
      showRail(false);
      renderHome();
      window.scrollTo(0, 0);
      return;
    }
    activeTok = tok;
    setTrack(trackOf, true);
    showRail(true);
    refreshRail();
    if (m) renderModule(m, stepKey, +n);
    else if (pageKey === 'practice') renderPractice(trackOf);
    else if (pageKey === 'review') renderReview(trackOf);
    else if (pageKey === 'playground') renderPlayground();
    else if (pageKey === 'schema') renderSchema();
    else if (pageKey === 'terminal') renderTerminal(trackOf);
    else if (pageKey === 'fs') renderFiles(trackOf);
    else if (pageKey === 'cheatsheet') renderCheatsheet(trackOf);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
