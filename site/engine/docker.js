/* docker.js — a simulated Docker engine for minibash.
   Images (pull, build with real layer caching, tag, rmi, history), containers
   (run, ps, logs, exec, stop/start/rm, inspect with Go-template formatting),
   ports, bind mounts and named volumes, user-defined networks with DNS,
   Compose (compose.yaml), plus curl, mvn, java and uvicorn so apps can be
   built, started and requested. Everything is deterministic for grading. */
(function () {
  'use strict';
  const MB = globalThis.MB;
  const { Shell, VFS, Stream } = MB;

  // ------------------------------------------------------------------ utils
  function h32(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 2654435761); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0).toString(16).padStart(8, '0');
  }
  const digest = str => { let s = ''; for (let i = 0; i < 8; i++) s += h32(str, 0x9e3779b9 + i * 7919); return s; };
  const short = id => id.slice(0, 12);
  function hsize(b) {
    const f = v => v < 10 ? String(Math.round(v * 100) / 100) : v < 100 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
    if (b < 1000) return Math.round(b) + 'B';
    if (b < 1e6) return f(b / 1e3) + 'kB';
    if (b < 1e9) return f(b / 1e6) + 'MB';
    return f(b / 1e9) + 'GB';
  }
  const TS = '2026/10/22 12:00:00';
  const NAMES = ['eager_turing', 'quirky_hopper', 'brave_lovelace', 'happy_knuth', 'jolly_ritchie', 'sharp_torvalds', 'calm_liskov', 'clever_dijkstra', 'gifted_hamilton', 'nifty_shannon', 'vibrant_babbage', 'zealous_kay', 'wizardly_wozniak', 'bold_thompson', 'keen_perlman', 'loving_engelbart'];
  class DockerError extends Error {}
  const fsSize = (node) => {
    if (!node) return 0;
    if (node.type === 'file') return node.vsize || node.content.length;
    let s = 0;
    for (const k of Object.keys(node.children)) s += fsSize(node.children[k]);
    return s;
  };
  function mkdirp(fs, abs) { return fs.mkdirp(abs, MB.BASE_TIME); }
  function writeFile(fs, abs, content, vsize) {
    mkdirp(fs, abs.replace(/\/[^/]*$/, '') || '/');
    const dir = fs.parentDir(abs);
    const n = MB.mkFile(content, Date.now());
    if (vsize) n.vsize = vsize;
    dir.children[abs.split('/').pop()] = n;
    return n;
  }
  function copyNode(n) {
    if (n.type === 'file') { const c = { type: 'file', content: n.content, mode: n.mode, mtime: n.mtime }; if (n.vsize) c.vsize = n.vsize; return c; }
    const d = { type: 'dir', children: Object.create(null), mode: n.mode, mtime: n.mtime };
    for (const k of Object.keys(n.children)) d.children[k] = copyNode(n.children[k]);
    return d;
  }
  // shell-like word splitting used for CMD shell form, compose command strings, etc.
  function shellWords(s) {
    return MB.lex(s).filter(t => t.t === 'word').map(t => t.v.replace(/^(['"])([\s\S]*)\1$/, '$2'));
  }

  // ------------------------------------------------------------------ YAML
  // A YAML subset that covers compose files: block maps and sequences,
  // flow [lists] and {maps}, quoted and plain scalars, | and > blocks, comments.
  function parseYAML(src) {
    const raw = src.replace(/\r/g, '').split('\n');
    const lines = [];
    raw.forEach((l, no) => {
      if (/^\s*(#.*)?$/.test(l) || /^---\s*$/.test(l)) return;
      if (/^\t/.test(l)) throw new DockerError(`yaml: line ${no + 1}: found character that cannot start any token (tabs aren't allowed for indentation)`);
      const indent = l.match(/^ */)[0].length;
      lines.push({ indent, text: stripComment(l.slice(indent)), no: no + 1, raw: l });
    });
    let i = 0;
    function stripComment(t) {
      let q = null;
      for (let k = 0; k < t.length; k++) {
        const c = t[k];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { if (k === 0 || /[\s:\-[{,]/.test(t[k - 1])) q = c; continue; }
        if (c === '#' && (k === 0 || /\s/.test(t[k - 1]))) return t.slice(0, k).replace(/\s+$/, '');
      }
      return t.replace(/\s+$/, '');
    }
    function scalar(t) {
      t = t.trim();
      if (t === '' || t === '~' || t === 'null') return null;
      if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
      if (t === 'true' || t === 'True') return true;
      if (t === 'false' || t === 'False') return false;
      if (/^-?\d+$/.test(t)) return parseInt(t, 10);
      if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
      if (t[0] === '[' || t[0] === '{') return flow(t);
      return t;
    }
    function flow(t) {
      let k = 0;
      const ws = () => { while (/\s/.test(t[k] || '')) k++; };
      const val = () => {
        ws();
        if (t[k] === '[') {
          k++; const arr = []; ws();
          if (t[k] === ']') { k++; return arr; }
          for (;;) { arr.push(val()); ws(); if (t[k] === ',') { k++; continue; } if (t[k] === ']') { k++; return arr; } throw new DockerError('yaml: did not find expected , or ]'); }
        }
        if (t[k] === '{') {
          k++; const obj = {}; ws();
          if (t[k] === '}') { k++; return obj; }
          for (;;) {
            ws(); let key = '';
            if (t[k] === '"' || t[k] === "'") { const q = t[k++]; while (k < t.length && t[k] !== q) key += t[k++]; k++; }
            else while (k < t.length && t[k] !== ':') key += t[k++];
            k++; obj[key.trim()] = val(); ws();
            if (t[k] === ',') { k++; continue; }
            if (t[k] === '}') { k++; return obj; }
            throw new DockerError('yaml: did not find expected , or }');
          }
        }
        if (t[k] === '"' || t[k] === "'") { const q = t[k++]; let s = ''; while (k < t.length && t[k] !== q) s += t[k++]; k++; return s; }
        let s = '';
        while (k < t.length && !/[,\]}]/.test(t[k])) s += t[k++];
        return scalar(s);
      };
      return val();
    }
    function keyVal(text) {
      // returns [key, rest] or null; key may be quoted
      let m = /^("([^"]*)"|'([^']*)'|[^\s:#][^:#]*?)\s*:(\s+|$)(.*)$/.exec(text);
      if (!m) return null;
      const key = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[1].trim();
      return [key, m[5]];
    }
    function blockScalar(indicator, parentIndent) {
      const out = [];
      let ind = null;
      while (i < lines.length && lines[i].indent > parentIndent) {
        if (ind === null) ind = lines[i].indent;
        out.push(lines[i].raw.slice(ind));
        i++;
      }
      return indicator[0] === '|' ? out.join('\n') + '\n' : out.join(' ') + '\n';
    }
    function parseNode(indent) {
      if (i >= lines.length) return null;
      const first = lines[i];
      if (first.indent < indent) return null;
      if (/^-(\s|$)/.test(first.text)) return parseSeq(first.indent);
      return parseMap(first.indent);
    }
    function parseSeq(indent) {
      const arr = [];
      while (i < lines.length && lines[i].indent === indent && /^-(\s|$)/.test(lines[i].text)) {
        const line = lines[i];
        const rest = line.text.replace(/^-\s*/, '');
        i++;
        if (rest === '') { arr.push(parseNode(indent + 1)); continue; }
        const kv = keyVal(rest);
        if (kv && !/^["'[{]/.test(rest)) {
          // "- key: value" starts a map whose other keys are indented under it
          const childIndent = indent + (line.text.length - rest.length);
          lines.splice(i, 0, { indent: childIndent, text: rest, no: line.no, raw: ' '.repeat(childIndent) + rest });
          arr.push(parseMap(childIndent));
          continue;
        }
        arr.push(scalar(rest));
      }
      return arr;
    }
    function parseMap(indent) {
      const obj = {};
      while (i < lines.length && lines[i].indent === indent) {
        const line = lines[i];
        if (/^-(\s|$)/.test(line.text)) break;
        const kv = keyVal(line.text);
        if (!kv) throw new DockerError(`yaml: line ${line.no}: could not find expected ':'`);
        i++;
        const [key, rest] = kv;
        if (rest === '' || rest === undefined) {
          if (i < lines.length && lines[i].indent > indent) obj[key] = parseNode(lines[i].indent);
          else if (i < lines.length && lines[i].indent === indent && /^-(\s|$)/.test(lines[i].text)) obj[key] = parseSeq(indent);
          else obj[key] = null;
        } else if (/^[|>][-+]?$/.test(rest)) obj[key] = blockScalar(rest, indent);
        else obj[key] = scalar(rest);
      }
      if (i < lines.length && lines[i].indent > indent) throw new DockerError(`yaml: line ${lines[i].no}: mapping values are not allowed in this context (check indentation)`);
      return obj;
    }
    const v = parseNode(0);
    if (i < lines.length) throw new DockerError(`yaml: line ${lines[i].no}: did not find expected key (check indentation)`);
    return v;
  }

  // -------------------------------------------------------- base image catalog
  const OS = {
    alpine: { pretty: 'Alpine Linux v3.20', id: 'alpine', files: { '/sbin/apk': 'ELF', '/bin/busybox': 'ELF', '/usr/bin/wget': 'ELF' } },
    debian: { pretty: 'Debian GNU/Linux 12 (bookworm)', id: 'debian', files: { '/usr/bin/apt-get': 'ELF', '/bin/bash': 'ELF' } },
    ubuntu: { pretty: 'Ubuntu 24.04.1 LTS', id: 'ubuntu', files: { '/usr/bin/apt-get': 'ELF', '/bin/bash': 'ELF' } }
  };
  const PY = { '/usr/local/bin/python3': 'ELF', '/usr/local/bin/python': 'ELF', '/usr/local/bin/pip': 'ELF', '/usr/local/lib/python3.12/site-packages/pip/__init__.py': '' };
  const JAVA = { '/opt/java/openjdk/bin/java': 'ELF' };
  const JDK = { '/opt/java/openjdk/bin/java': 'ELF', '/opt/java/openjdk/bin/javac': 'ELF' };
  const NODE = { '/usr/local/bin/node': 'ELF', '/usr/local/bin/npm': 'ELF' };
  const CURL = { '/usr/bin/curl': 'ELF' };
  const NGINX_HTML = '<!DOCTYPE html>\n<html>\n<head><title>Welcome to nginx!</title></head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and working.</p>\n</body>\n</html>\n';
  const NGINX = { '/usr/sbin/nginx': 'ELF', '/usr/share/nginx/html/index.html': NGINX_HTML, '/usr/share/nginx/html/50x.html': '<h1>An error occurred.</h1>\n', '/etc/nginx/conf.d/default.conf': 'server {\n    listen       80;\n    location / {\n        root   /usr/share/nginx/html;\n        index  index.html;\n    }\n}\n', '/docker-entrypoint.sh': '#!/bin/sh\nexec "$@"\n' };
  const PG = { '/usr/local/bin/postgres': 'ELF', '/usr/local/bin/docker-entrypoint.sh': '#!/bin/sh\nexec "$@"\n', '/usr/bin/psql': 'ELF', '/var/lib/postgresql/data': null };
  const REDIS = { '/usr/local/bin/redis-server': 'ELF', '/usr/local/bin/redis-cli': 'ELF', '/data': null };
  const PATHS = { def: 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
  function img(os, size, extra, cfg) { return Object.assign({ os, size, files: Object.assign({}, OS[os].files, extra || {}) }, cfg || {}); }
  const CATALOG = {
    'hello-world': { latest: { os: 'none', size: 13256, files: { '/hello': 'ELF' }, cmd: ['/hello'] } },
    alpine: { latest: img('alpine', 7.8e6, {}, { cmd: ['/bin/sh'] }), '3.20': 'latest', '3.19': img('alpine', 7.4e6, {}, { cmd: ['/bin/sh'] }) },
    busybox: { latest: img('alpine', 4.3e6, {}, { cmd: ['sh'] }) },
    ubuntu: { latest: img('ubuntu', 78.1e6, {}, { cmd: ['/bin/bash'] }), '24.04': 'latest', '22.04': img('ubuntu', 77.9e6, {}, { cmd: ['/bin/bash'] }) },
    debian: { latest: img('debian', 117e6, CURL, { cmd: ['bash'] }), bookworm: 'latest', 'bookworm-slim': img('debian', 74.8e6, {}, { cmd: ['bash'] }) },
    nginx: {
      latest: img('debian', 192e6, Object.assign({}, NGINX, CURL), { entrypoint: ['/docker-entrypoint.sh'], cmd: ['nginx', '-g', 'daemon off;'], expose: ['80/tcp'], env: ['NGINX_VERSION=1.27.2'], stop: 'SIGQUIT' }),
      '1.27': 'latest', alpine: img('alpine', 47.9e6, NGINX, { entrypoint: ['/docker-entrypoint.sh'], cmd: ['nginx', '-g', 'daemon off;'], expose: ['80/tcp'], env: ['NGINX_VERSION=1.27.2'] }), '1.27-alpine': 'alpine'
    },
    python: {
      '3.12': img('debian', 1.02e9, Object.assign({}, PY, CURL), { cmd: ['python3'], env: ['PYTHON_VERSION=3.12.7', 'LANG=C.UTF-8'] }), latest: '3.12',
      '3.12-slim': img('debian', 151e6, PY, { cmd: ['python3'], env: ['PYTHON_VERSION=3.12.7', 'LANG=C.UTF-8'] }),
      '3.12-alpine': img('alpine', 57.6e6, PY, { cmd: ['python3'], env: ['PYTHON_VERSION=3.12.7', 'LANG=C.UTF-8'] }),
      '3.11-slim': img('debian', 149e6, PY, { cmd: ['python3'], env: ['PYTHON_VERSION=3.11.10', 'LANG=C.UTF-8'] })
    },
    node: {
      '20': img('debian', 1.1e9, Object.assign({}, NODE, CURL), { cmd: ['node'], env: ['NODE_VERSION=20.18.0'] }), latest: '20',
      '20-slim': img('debian', 200e6, NODE, { cmd: ['node'], env: ['NODE_VERSION=20.18.0'] }),
      '20-alpine': img('alpine', 135e6, NODE, { cmd: ['node'], env: ['NODE_VERSION=20.18.0'] })
    },
    'eclipse-temurin': {
      '21-jdk': img('ubuntu', 453e6, Object.assign({}, JDK, CURL), { cmd: ['jshell'], env: ['JAVA_HOME=/opt/java/openjdk', 'JAVA_VERSION=jdk-21.0.5+11'] }), '21': '21-jdk', latest: '21-jdk',
      '21-jre': img('ubuntu', 264e6, JAVA, { cmd: ['bash'], env: ['JAVA_HOME=/opt/java/openjdk', 'JAVA_VERSION=jdk-21.0.5+11'] }),
      '21-jre-alpine': img('alpine', 190e6, JAVA, { cmd: ['/bin/sh'], env: ['JAVA_HOME=/opt/java/openjdk', 'JAVA_VERSION=jdk-21.0.5+11'] }),
      '17-jdk': img('ubuntu', 407e6, JDK, { cmd: ['jshell'], env: ['JAVA_HOME=/opt/java/openjdk', 'JAVA_VERSION=jdk-17.0.13+11'] }),
      '17-jre': img('ubuntu', 268e6, JAVA, { cmd: ['bash'], env: ['JAVA_HOME=/opt/java/openjdk', 'JAVA_VERSION=jdk-17.0.13+11'] })
    },
    maven: {
      '3.9-eclipse-temurin-21': img('ubuntu', 513e6, Object.assign({ '/usr/share/maven/bin/mvn': 'ELF' }, JDK, CURL), { cmd: ['mvn'], env: ['JAVA_HOME=/opt/java/openjdk', 'MAVEN_HOME=/usr/share/maven'] }), latest: '3.9-eclipse-temurin-21',
      '3.9-eclipse-temurin-17': img('ubuntu', 470e6, Object.assign({ '/usr/share/maven/bin/mvn': 'ELF' }, JDK, CURL), { cmd: ['mvn'], env: ['JAVA_HOME=/opt/java/openjdk', 'MAVEN_HOME=/usr/share/maven'] })
    },
    postgres: {
      '16': img('debian', 435e6, PG, { entrypoint: ['docker-entrypoint.sh'], cmd: ['postgres'], expose: ['5432/tcp'], env: ['PG_MAJOR=16', 'PGDATA=/var/lib/postgresql/data'], volumes: ['/var/lib/postgresql/data'] }), latest: '16',
      '16-alpine': img('alpine', 274e6, PG, { entrypoint: ['docker-entrypoint.sh'], cmd: ['postgres'], expose: ['5432/tcp'], env: ['PG_MAJOR=16', 'PGDATA=/var/lib/postgresql/data'], volumes: ['/var/lib/postgresql/data'] })
    },
    redis: {
      '7': img('debian', 117e6, REDIS, { cmd: ['redis-server'], expose: ['6379/tcp'], volumes: ['/data'], workdir: '/data' }), latest: '7',
      '7-alpine': img('alpine', 41e6, REDIS, { cmd: ['redis-server'], expose: ['6379/tcp'], volumes: ['/data'], workdir: '/data' })
    }
  };
  function catalogLookup(repo, tag) {
    const r = CATALOG[repo];
    if (!r) return null;
    let d = r[tag];
    let guard = 0;
    while (typeof d === 'string' && guard++ < 5) d = r[d];
    return d || undefined;
  }
  function baseFs(def) {
    const fs = new VFS();
    for (const d of ['/bin', '/etc', '/home', '/root', '/tmp', '/usr/bin', '/usr/local/bin', '/usr/lib', '/var/lib', '/var/log', '/proc', '/dev', '/opt']) mkdirp(fs, d);
    fs.get('/tmp').mode = 0o777;
    if (def.os !== 'none') {
      writeFile(fs, '/bin/sh', 'ELF');
      writeFile(fs, '/etc/os-release', `PRETTY_NAME="${OS[def.os].pretty}"\nID=${OS[def.os].id}\n`);
      writeFile(fs, '/etc/passwd', 'root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n');
      writeFile(fs, '/etc/group', 'root:x:0:\n');
      writeFile(fs, '/etc/hostname', '');
    }
    for (const [p, c] of Object.entries(def.files || {})) {
      if (c === null) mkdirp(fs, p);
      else writeFile(fs, p, c);
    }
    const base = writeFile(fs, '/.base-layers', '', Math.max(0, def.size - fsSize(fs.root)));
    base.mode = 0o600;
    return fs;
  }

  // ------------------------------------------------------- reference parsing
  function parseRef(ref) {
    let r = ref.replace(/^docker\.io\//, '').replace(/^library\//, '');
    let tag = 'latest', explicit = false;
    const at = r.indexOf('@');
    if (at > 0) r = r.slice(0, at);
    const lastColon = r.lastIndexOf(':');
    if (lastColon > r.lastIndexOf('/')) { tag = r.slice(lastColon + 1); r = r.slice(0, lastColon); explicit = true; }
    return { repo: r, tag, explicit, full: `${r}:${tag}` };
  }

  // --------------------------------------------------------- go templates
  function goTemplate(tpl, data) {
    tpl = tpl.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    let i = 0;
    const toks = [];
    while (i < tpl.length) {
      const k = tpl.indexOf('{{', i);
      if (k < 0) { toks.push({ text: tpl.slice(i) }); break; }
      if (k > i) toks.push({ text: tpl.slice(i, k) });
      const e = tpl.indexOf('}}', k);
      if (e < 0) throw new DockerError(`template: unclosed action`);
      toks.push({ act: tpl.slice(k + 2, e).trim().replace(/^-\s*|\s*-$/g, '') });
      i = e + 2;
    }
    const lookup = (path, ctx) => {
      if (path === '.') return ctx;
      let v = ctx;
      for (const p of path.replace(/^\./, '').split('.')) {
        if (v === null || v === undefined) return undefined;
        v = v[p];
      }
      return v;
    };
    const show = v => v === undefined ? '<no value>' : v === null ? '<nil>' : typeof v === 'object' ? (Array.isArray(v) ? '[' + v.map(show).join(' ') + ']' : 'map[' + Object.keys(v).sort().map(k => k + ':' + show(v[k])).join(' ') + ']') : String(v);
    const evalAct = (act, ctx) => {
      let m;
      if ((m = /^json\s+(\S+)$/.exec(act))) return JSON.stringify(lookup(m[1], ctx) ?? null);
      if ((m = /^index\s+(\S+)\s+"([^"]*)"$/.exec(act))) { const o = lookup(m[1], ctx); return show(o ? o[m[2]] : undefined); }
      if ((m = /^(upper|lower)\s+(\S+)$/.exec(act))) { const s = show(lookup(m[2], ctx)); return m[1] === 'upper' ? s.toUpperCase() : s.toLowerCase(); }
      if ((m = /^join\s+(\S+)\s+"([^"]*)"$/.exec(act))) { const a = lookup(m[1], ctx) || []; return a.join(m[2]); }
      if (act.startsWith('.')) return show(lookup(act, ctx));
      if (/^"[^"]*"$/.test(act)) return act.slice(1, -1);
      throw new DockerError(`template: function "${act.split(/\s/)[0]}" not defined`);
    };
    const run = (from, to, ctx) => {
      let out = '';
      for (let j = from; j < to; j++) {
        const t = toks[j];
        if (t.text !== undefined) { out += t.text; continue; }
        const m = /^range\s+(\S+)$/.exec(t.act);
        if (m) {
          let depth = 1, end = j + 1;
          for (; end < toks.length; end++) {
            if (toks[end].act && /^range\s/.test(toks[end].act)) depth++;
            if (toks[end].act === 'end') { depth--; if (!depth) break; }
          }
          const coll = lookup(m[1], ctx);
          const items = Array.isArray(coll) ? coll : coll && typeof coll === 'object' ? Object.values(coll) : [];
          for (const it of items) out += run(j + 1, end, it);
          j = end;
          continue;
        }
        if (t.act === 'end') continue;
        out += evalAct(t.act, ctx);
      }
      return out;
    };
    return run(0, toks.length, data);
  }
  function table(rows, cols) {
    const w = cols.map((c, i) => Math.max(c.length, ...rows.map(r => String(r[i]).length)));
    const line = r => r.map((v, i) => i === r.length - 1 ? String(v) : String(v).padEnd(w[i] + 3)).join('').replace(/\s+$/, '');
    return [line(cols), ...rows.map(line)].join('\n') + '\n';
  }

  // -------------------------------------------------- app source analysis
  // FastAPI: decorators like @app.get("/items/{item_id}") followed by def name(params)
  function parsePyRoutes(src) {
    const routes = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*@(\w+)\.(get|post|put|delete|patch)\(\s*["']([^"']*)["']/.exec(lines[i]);
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && /^\s*@/.test(lines[j])) j++;
      const defm = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/.exec(lines[j] || '');
      if (!defm) continue;
      const params = {};
      for (const p of defm[3].split(',').map(x => x.trim()).filter(Boolean)) {
        const pm = /^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(p);
        if (pm) params[pm[1]] = { type: (pm[2] || '').trim(), def: pm[3] };
      }
      let ret = null;
      const ind = defm[1].length;
      for (let k = j + 1; k < lines.length; k++) {
        if (lines[k].trim() && (lines[k].match(/^\s*/)[0].length <= ind)) break;
        const rm = /^\s*return\s+(.+)$/.exec(lines[k]);
        if (rm) { ret = rm[1].trim(); break; }
      }
      routes.push({ method: m[2].toUpperCase(), path: m[3], params, ret, prefix: m[1] });
    }
    return routes;
  }
  function pyLiteralToJson(expr, vars) {
    // dict/list/str/number literals with names replaced by known variable values
    let s = '';
    let i = 0;
    while (i < expr.length) {
      const c = expr[i];
      if (c === '"' || c === "'") {
        let j = i + 1, str = '';
        while (j < expr.length && expr[j] !== c) { if (expr[j] === '\\') { str += expr[j + 1]; j += 2; continue; } str += expr[j++]; }
        s += JSON.stringify(str); i = j + 1; continue;
      }
      const w = /^[A-Za-z_]\w*/.exec(expr.slice(i));
      if (w) {
        const name = w[0];
        if (name === 'True') s += 'true'; else if (name === 'False') s += 'false'; else if (name === 'None') s += 'null';
        else if (Object.prototype.hasOwnProperty.call(vars, name)) s += JSON.stringify(vars[name]);
        else throw new Error('unknown name ' + name);
        i += name.length; continue;
      }
      s += c; i++;
    }
    return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
  }
  // Spring: @RestController classes with @RequestMapping prefix and @GetMapping methods
  function parseJavaRoutes(files) {
    const routes = [];
    for (const src of files) {
      if (!/@RestController|@Controller/.test(src)) continue;
      const cls = /@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"\s*\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+)?class/.exec(src);
      const prefix = cls ? cls[1] : '';
      const re = /@(Get|Post|Put|Delete|Patch)Mapping(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"[^)]*\))?\s*(?:@\w+(?:\([^)]*\))?\s*)*public\s+[\w<>?,\s]+?\s+(\w+)\s*\(((?:[^()]|\([^)]*\))*)\)\s*\{([\s\S]*?)\n\s*\}/g;
      let m;
      while ((m = re.exec(src))) {
        const params = [];
        for (const pm of m[4].matchAll(/@PathVariable(?:\([^)]*\))?\s+\w+\s+(\w+)/g)) params.push({ name: pm[1], kind: 'path' });
        for (const pm of m[4].matchAll(/@RequestParam(?:\(([^)]*)\))?\s+\w+\s+(\w+)/g)) {
          const dv = /defaultValue\s*=\s*"([^"]*)"/.exec(pm[1] || '');
          params.push({ name: pm[2], kind: 'query', def: dv ? dv[1] : undefined });
        }
        const rm = /return\s+([^;]+);/.exec(m[5]);
        routes.push({ method: m[1].toUpperCase(), path: (prefix + (m[2] || '')) || '/', ret: rm ? rm[1].trim() : null, params });
      }
    }
    return routes;
  }
  function javaReturn(expr, vars) {
    const mapm = /^Map\.of\(([\s\S]*)\)$/.exec(expr);
    if (mapm) {
      const parts = splitArgs(mapm[1]).map(a => javaReturn(a, vars));
      const o = {};
      for (let i = 0; i + 1 < parts.length; i += 2) o[String(parts[i])] = parts[i + 1];
      return o;
    }
    if (/^-?\d+$/.test(expr)) return parseInt(expr, 10);
    if (expr === 'true' || expr === 'false') return expr === 'true';
    const pieces = splitConcat(expr);
    let out = '';
    for (const p of pieces) {
      if (/^".*"$/.test(p)) out += p.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
      else if (Object.prototype.hasOwnProperty.call(vars, p)) out += vars[p];
      else throw new Error('cannot evaluate ' + p);
    }
    return out;
  }
  function splitArgs(s) { const out = []; let depth = 0, cur = '', q = false; for (const c of s) { if (c === '"' && cur.slice(-1) !== '\\') q = !q; if (!q && c === '(') depth++; if (!q && c === ')') depth--; if (!q && depth === 0 && c === ',') { out.push(cur.trim()); cur = ''; continue; } cur += c; } if (cur.trim()) out.push(cur.trim()); return out; }
  function splitConcat(s) { const out = []; let cur = '', q = false; for (const c of s) { if (c === '"' && cur.slice(-1) !== '\\') q = !q; if (!q && c === '+') { out.push(cur.trim()); cur = ''; continue; } cur += c; } out.push(cur.trim()); return out; }
  function matchPath(tpl, path) {
    const names = [];
    const re = new RegExp('^' + tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (m, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
    const m = re.exec(path);
    if (!m) return null;
    const out = {};
    names.forEach((n, i) => { out[n] = decodeURIComponent(m[i + 1]); });
    return out;
  }
  function propsOf(text) {
    const o = {};
    for (const l of (text || '').split('\n')) { const m = /^\s*([\w.\-]+)\s*[=:]\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) o[m[1]] = m[2]; }
    return o;
  }

  // -------------------------------------------------------------- HTTP
  function resp(status, body, type, extra) {
    const reason = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 422: 'Unprocessable Entity', 500: 'Internal Server Error' }[status] || '';
    return { status, reason, body, headers: Object.assign({ 'content-type': type || 'text/plain', 'content-length': String(new TextEncoder().encode(body).length) }, extra || {}) };
  }
  function serveFile(fs, root, path, srvName) {
    let p = decodeURIComponent(path.split('?')[0]);
    let abs = VFS.norm(root + '/' + p, '/');
    let n = fs.get(abs);
    if (n && n.type === 'dir') { const idx = fs.get(abs + '/index.html'); if (idx) { n = idx; abs += '/index.html'; } else if (srvName === 'SimpleHTTP/0.6 Python/3.12.7') { const list = Object.keys(n.children).sort().map(k => `<li><a href="${k}">${k}</a></li>`).join('\n'); return resp(200, `<!DOCTYPE HTML>\n<html>\n<body>\n<h1>Directory listing for ${p}</h1>\n<ul>\n${list}\n</ul>\n</body>\n</html>\n`, 'text/html', { server: srvName }); } else n = null; }
    if (!n || n.type !== 'file') {
      if (srvName.startsWith('nginx')) return resp(404, '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.27.2</center>\r\n</body>\r\n</html>\r\n', 'text/html', { server: srvName });
      return resp(404, 'File not found\n', 'text/html', { server: srvName });
    }
    const type = /\.html?$/.test(abs) ? 'text/html' : /\.css$/.test(abs) ? 'text/css' : /\.js$/.test(abs) ? 'application/javascript' : /\.json$/.test(abs) ? 'application/json' : 'text/plain';
    return resp(200, n.content, type, { server: srvName });
  }
  function handle(server, fs, method, rawPath) {
    const [path, qs] = rawPath.split('?');
    const query = {};
    for (const kv of (qs || '').split('&').filter(Boolean)) { const [k, v] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
    switch (server.kind) {
      case 'nginx': return serveFile(fs(), server.root || '/usr/share/nginx/html', path, 'nginx/1.27.2');
      case 'static': return serveFile(fs(), server.root, path, 'SimpleHTTP/0.6 Python/3.12.7');
      case 'fastapi': {
        if (path === '/docs') return resp(200, '<!DOCTYPE html>\n<html><head><title>FastAPI - Swagger UI</title></head><body><div id="swagger-ui"></div></body></html>\n', 'text/html', { server: 'uvicorn' });
        if (path === '/openapi.json') return resp(200, JSON.stringify({ openapi: '3.1.0', info: { title: 'FastAPI', version: '0.1.0' }, paths: Object.fromEntries(server.routes.map(r => [r.path, { [r.method.toLowerCase()]: {} }])) }), 'application/json', { server: 'uvicorn' });
        const json = (st, o) => resp(st, JSON.stringify(o), 'application/json', { server: 'uvicorn' });
        let pathMatched = false;
        for (const r of server.routes) {
          const pm = matchPath(r.path, path);
          if (!pm) continue;
          pathMatched = true;
          if (r.method !== method) continue;
          const vars = {};
          const errors = [];
          for (const [name, p] of Object.entries(r.params)) {
            let raw, loc;
            if (name in pm) { raw = pm[name]; loc = 'path'; }
            else if (name in query) { raw = query[name]; loc = 'query'; }
            else if (p.def !== undefined) { try { vars[name] = pyLiteralToJson(p.def, {}); } catch (e) { vars[name] = null; } continue; }
            else { errors.push({ type: 'missing', loc: ['query', name], msg: 'Field required', input: null }); continue; }
            if (/^int\b/.test(p.type)) {
              if (!/^-?\d+$/.test(raw)) { errors.push({ type: 'int_parsing', loc: [loc, name], msg: 'Input should be a valid integer, unable to parse string as an integer', input: raw }); continue; }
              vars[name] = parseInt(raw, 10);
            } else if (/^float\b/.test(p.type)) {
              if (isNaN(Number(raw))) { errors.push({ type: 'float_parsing', loc: [loc, name], msg: 'Input should be a valid number, unable to parse string as a number', input: raw }); continue; }
              vars[name] = Number(raw);
            } else if (/^bool\b/.test(p.type)) vars[name] = ['true', '1', 'yes', 'on'].includes(raw.toLowerCase());
            else vars[name] = raw;
          }
          if (errors.length) return json(422, { detail: errors });
          if (!r.ret) return json(200, null);
          try { return json(200, pyLiteralToJson(r.ret, vars)); }
          catch (e) { return json(200, { detail: '(simulator) this endpoint ran, but its return value is too dynamic to simulate', endpoint: `${r.method} ${r.path}` }); }
        }
        return pathMatched ? json(405, { detail: 'Method Not Allowed' }) : json(404, { detail: 'Not Found' });
      }
      case 'spring': {
        const err = (st, e) => resp(st, JSON.stringify({ timestamp: '2026-10-22T12:00:00.000+00:00', status: st, error: e, path }), 'application/json');
        if (path === '/actuator/health' && server.actuator) return resp(200, '{"status":"UP"}', 'application/vnd.spring-boot.actuator.v3+json');
        let pathMatched = false;
        for (const r of server.routes) {
          const pm = matchPath(r.path, path);
          if (!pm) continue;
          pathMatched = true;
          if (r.method !== method) continue;
          const vars = Object.assign({}, pm);
          for (const p of r.params) if (p.kind === 'query') { if (p.name in query) vars[p.name] = query[p.name]; else if (p.def !== undefined) vars[p.name] = p.def; else return err(400, 'Bad Request'); }
          try {
            const v = javaReturn(r.ret || '""', vars);
            return typeof v === 'object' ? resp(200, JSON.stringify(v), 'application/json') : resp(200, String(v), 'text/plain;charset=UTF-8');
          } catch (e) { return resp(200, '(simulator) this endpoint ran, but its return value is too dynamic to simulate', 'text/plain'); }
        }
        return pathMatched ? err(405, 'Method Not Allowed') : err(404, 'Not Found');
      }
      case 'node': return resp(200, 'Hello from Node.js!\n', 'text/plain');
      default: return null;
    }
  }
  function serverLogLine(server, method, path, status, client) {
    if (server.kind === 'nginx') return `${client} - - [22/Oct/2026:12:00:00 +0000] "${method} ${path} HTTP/1.1" ${status} 615 "-" "curl/8.5.0" "-"\n`;
    if (server.kind === 'fastapi') return `INFO:     ${client}:51234 - "${method} ${path} HTTP/1.1" ${status} ${status === 200 ? 'OK' : status === 404 ? 'Not Found' : status === 422 ? 'Unprocessable Entity' : ''}\n`;
    if (server.kind === 'static') return `${client} - - [22/Oct/2026 12:00:00] "${method} ${path} HTTP/1.1" ${status} -\n`;
    return '';
  }

  // -------------------------------------------------------------- daemon
  class Daemon {
    constructor() {
      this.images = [];
      this.containers = [];
      this.networks = [
        { id: digest('net-bridge'), name: 'bridge', driver: 'bridge', subnet: '172.17.0', n: 1, builtin: true },
        { id: digest('net-host'), name: 'host', driver: 'host', subnet: '', n: 0, builtin: true },
        { id: digest('net-none'), name: 'none', driver: 'null', subnet: '', n: 0, builtin: true }
      ];
      this.volumes = new Map();
      this.cache = new Map();
      this.counter = 0;
      this.hostServers = [];
      this.registry = new Map();
      this.netCount = 18;
    }
    nextId(kind) { return digest(`${kind}-${++this.counter}`); }
    image(ref) {
      if (!ref) return null;
      const byId = ref.replace(/^sha256:/, '');
      if (/^[0-9a-f]{4,64}$/.test(byId)) { const m = this.images.find(i => i.id.startsWith(byId)); if (m) return m; }
      const r = parseRef(ref);
      return this.images.find(i => i.tags.includes(r.full)) || null;
    }
    container(ref) {
      if (!ref) return null;
      return this.containers.find(c => c.name === ref || c.name === ref.replace(/^\//, '')) || (/^[0-9a-f]{3,}$/.test(ref) ? this.containers.find(c => c.id.startsWith(ref)) : null) || null;
    }
    network(name) { return this.networks.find(n => n.name === name || n.id.startsWith(name)) || null; }
    tagImage(image, full) {
      for (const other of this.images) if (other !== image) other.tags = other.tags.filter(t => t !== full);
      if (!image.tags.includes(full)) image.tags.push(full);
    }
    pull(ref, out, quiet) {
      const r = parseRef(ref);
      if (!r.explicit && !quiet) out('Using default tag: latest\n');
      const pushed = this.registry.get(r.full);
      const def = pushed ? null : catalogLookup(r.repo, r.tag);
      if (!pushed && def === null) throw new DockerError(`pull access denied for ${r.repo}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied`);
      if (!pushed && def === undefined) throw new DockerError(`manifest for ${r.full} not found: manifest unknown: manifest unknown`);
      const existing = this.image(r.full);
      if (existing) { out(`${r.tag}: Pulling from ${r.repo.includes('/') ? r.repo : 'library/' + r.repo}\nDigest: sha256:${digest('dg' + r.full)}\nStatus: Image is up to date for ${r.full}\ndocker.io/${r.repo.includes('/') ? '' : 'library/'}${r.full}\n`); return existing; }
      let image;
      if (pushed) {
        image = Object.assign({}, pushed, { tags: [r.full], fs: pushed.fs.clone() });
      } else {
        const fs = baseFs(def);
        image = {
          id: digest('img-' + r.repo + ':' + (Object.entries(CATALOG[r.repo]).find(([, v]) => v === def) || [r.tag])[0]),
          tags: [r.full], created: 'base', size: def.size, fs, os: def.os,
          layers: [{ id: digest('layer-' + r.full), createdBy: `/bin/sh -c #(nop) ADD file:${digest('f' + r.repo).slice(0, 16)} in / `, size: def.size }],
          config: { Env: [PATHS.def].concat(def.env || []), Cmd: def.cmd || null, Entrypoint: def.entrypoint || null, WorkingDir: def.workdir || '', ExposedPorts: (def.expose || []).slice(), User: '', Labels: {}, Volumes: (def.volumes || []).slice(), Healthcheck: null }
        };
        const same = this.images.find(i => i.id === image.id);
        if (same) { this.tagImage(same, r.full); image = same; }
      }
      if (!this.images.includes(image)) this.images.push(image);
      const lines = [0, 1, 2].map(k => `${digest('l' + r.full + k).slice(0, 12)}: Pull complete`).join('\n');
      out(`${r.tag}: Pulling from ${r.repo.includes('/') ? r.repo : 'library/' + r.repo}\n${lines}\nDigest: sha256:${digest('dg' + r.full)}\nStatus: Downloaded newer image for ${r.full}\ndocker.io/${r.repo.includes('/') ? '' : 'library/'}${r.full}\n`);
      return image;
    }
    ensureImage(ref, out) {
      const have = this.image(ref);
      if (have) return have;
      const r = parseRef(ref);
      out(`Unable to find image '${r.full}' locally\n`);
      return this.pull(ref, out, true);
    }
    imageSize(img) { return img.layers.reduce((a, l) => a + l.size, 0); }
    inUse(img) { return this.containers.find(c => c.imageId === img.id); }
  }
  function daemonOf(sh) { if (!sh.daemon) sh.daemon = new Daemon(); return sh.daemon; }

  // ------------------------------------------------------- container shells
  function containerShell(daemon, c, extraEnv) {
    const env = {};
    for (const e of c.env.concat(extraEnv || [])) { const k = e.indexOf('='); if (k > 0) env[e.slice(0, k)] = e.slice(k + 1); }
    env.HOSTNAME = short(c.id);
    const user = c.user || 'root';
    const home = user === 'root' ? '/root' : '/home/' + user;
    const sh = new Shell({ fs: c.fs, cwd: c.workdir || '/', home, user, host: short(c.id), env });
    if (!c.fs.get(sh.cwd)) mkdirp(c.fs, sh.cwd);
    sh.daemon = daemon;
    sh.container = c;
    sh.extraCommands = CONTAINER_CMDS;
    sh.hiddenCommands = HOST_ONLY;
    return sh;
  }
  const has = (sh, p) => !!sh.fs.get(p);
  const missing = (io, name) => { io.err(`/bin/sh: ${name}: not found\n`); return 127; };

  // -------------------------------------------------- simulated toolchains
  const PIP_VERSIONS = { fastapi: '0.115.2', uvicorn: '0.32.0', pydantic: '2.9.2', 'pydantic-core': '2.23.4', starlette: '0.40.0', requests: '2.32.3', flask: '3.0.3', sqlalchemy: '2.0.36', pytest: '8.3.3', httpx: '0.27.2', gunicorn: '23.0.0', 'python-dotenv': '1.0.1', psycopg2: '2.9.10', 'psycopg2-binary': '2.9.10', redis: '5.2.0', sqlmodel: '0.0.22', numpy: '2.1.2', pandas: '2.2.3' };
  const PIP_DEPS = { fastapi: ['pydantic', 'pydantic-core', 'starlette', 'typing-extensions', 'annotated-types', 'anyio'], uvicorn: ['click', 'h11'], requests: ['urllib3', 'idna', 'certifi', 'charset-normalizer'], flask: ['werkzeug', 'jinja2', 'itsdangerous', 'click', 'blinker'] };
  const PIP_BINS = { uvicorn: 'uvicorn', fastapi: 'fastapi', gunicorn: 'gunicorn', pytest: 'pytest', flask: 'flask' };
  function sitePackages(sh) { return '/usr/local/lib/python3.12/site-packages'; }
  function pipCmd(args, io, sh) {
    if (!has(sh, '/usr/local/bin/python3')) return missing(io, 'pip');
    if (args[0] === '--version' || args[0] === '-V') { io.out('pip 24.2 from /usr/local/lib/python3.12/site-packages/pip (python 3.12)\n'); return 0; }
    if (args[0] === 'list' || args[0] === 'freeze') {
      const sp = sh.fs.get(sitePackages(sh));
      const names = sp ? Object.keys(sp.children).filter(n => n !== 'pip').sort() : [];
      if (args[0] === 'freeze') io.out(names.map(n => `${n}==${PIP_VERSIONS[n] || '1.0.0'}`).join('\n') + (names.length ? '\n' : ''));
      else io.out('Package    Version\n---------- -------\npip        24.2\n' + names.map(n => `${n.padEnd(10)} ${PIP_VERSIONS[n] || '1.0.0'}`).join('\n') + (names.length ? '\n' : ''));
      return 0;
    }
    if (args[0] !== 'install') { io.err(`ERROR: unknown command "${args[0] || ''}"\n`); return 1; }
    const pkgs = [];
    const quiet = args.includes('-q') || args.includes('--quiet');
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === '-r' || a === '--requirement') {
        const f = args[++i];
        const c = sh.readFile(f || '');
        if (c === null) { io.err(`ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${f}'\n`); return 1; }
        for (const l of c.split('\n')) { const t = l.replace(/#.*/, '').trim(); if (t) pkgs.push(t); }
        continue;
      }
      if (a.startsWith('-')) continue;
      pkgs.push(a);
    }
    if (!pkgs.length) { io.err('ERROR: You must give at least one requirement to install (see "pip help install")\n'); return 1; }
    const installed = [];
    const add = (name, ver) => {
      const dir = `${sitePackages(sh)}/${name}`;
      if (sh.fs.get(dir)) return;
      writeFile(sh.fs, dir + '/__init__.py', '', 4.2e6);
      if (PIP_BINS[name]) writeFile(sh.fs, '/usr/local/bin/' + PIP_BINS[name], '#!/usr/local/bin/python3\n');
      installed.push(`${name}-${ver}`);
    };
    for (const p of pkgs) {
      const m = /^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(?:[=<>!~]=?\s*([\w.]+))?/.exec(p);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (!quiet) io.out(`Collecting ${p}\n  Downloading ${name}-${m[2] || PIP_VERSIONS[name] || '1.0.0'}-py3-none-any.whl\n`);
      add(name, m[2] || PIP_VERSIONS[name] || '1.0.0');
      for (const d of PIP_DEPS[name] || []) add(d, PIP_VERSIONS[d] || '1.0.0');
    }
    if (!sh.fs.get('/root/.cache/pip') && !args.includes('--no-cache-dir')) writeFile(sh.fs, '/root/.cache/pip/http-v2/cache', '', 18e6);
    if (!quiet) io.out(`Installing collected packages: ${installed.map(x => x.replace(/-[\d.]+$/, '')).join(', ')}\nSuccessfully installed ${installed.join(' ')}\n`);
    return 0;
  }
  function aptCmd(args, io, sh) {
    if (!has(sh, '/usr/bin/apt-get')) return missing(io, 'apt-get');
    const sub = args.find(a => !a.startsWith('-'));
    if (sub === 'update') {
      io.out('Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]\nGet:2 http://deb.debian.org/debian bookworm/main amd64 Packages [8792 kB]\nFetched 8943 kB in 1s (8943 kB/s)\nReading package lists... Done\n');
      writeFile(sh.fs, '/var/lib/apt/lists/deb.debian.org_debian_dists_bookworm_main_binary-amd64_Packages', '', 21e6);
      return 0;
    }
    if (sub === 'install') {
      const pkgs = args.slice(args.indexOf('install') + 1).filter(a => !a.startsWith('-'));
      const lists = sh.fs.get('/var/lib/apt/lists');
      io.out('Reading package lists... Done\nBuilding dependency tree... Done\n');
      if (!lists || !Object.keys(lists.children).length) { io.err(`E: Unable to locate package ${pkgs[0]}\n`); return 100; }
      if (!args.includes('-y') && !args.includes('--yes') && !args.includes('-qy') && !args.includes('-yq')) { io.out('Do you want to continue? [Y/n] Abort.\n'); return 1; }
      for (const p of pkgs) writeFile(sh.fs, `/usr/bin/${p.replace(/[=:].*/, '')}`, 'ELF', 9e6);
      writeFile(sh.fs, '/var/cache/apt/archives/pkgcache.bin', '', 12e6);
      io.out(`The following NEW packages will be installed:\n  ${pkgs.join(' ')}\nSetting up ${pkgs.join(', ')} ...\n`);
      return 0;
    }
    if (sub === 'clean') { const d = sh.fs.get('/var/cache/apt'); if (d) d.children = Object.create(null); return 0; }
    io.err(`E: Invalid operation ${sub || ''}\n`); return 100;
  }
  function apkCmd(args, io, sh) {
    if (!has(sh, '/sbin/apk')) return missing(io, 'apk');
    if (args[0] === 'add') {
      const pkgs = args.slice(1).filter(a => !a.startsWith('-'));
      io.out(`fetch https://dl-cdn.alpinelinux.org/alpine/v3.20/main/x86_64/APKINDEX.tar.gz\n${pkgs.map((p, i) => `(${i + 1}/${pkgs.length}) Installing ${p}`).join('\n')}\nOK: ${pkgs.length * 3} MiB in ${pkgs.length + 14} packages\n`);
      for (const p of pkgs) writeFile(sh.fs, `/usr/bin/${p}`, 'ELF', 3e6);
      if (!args.includes('--no-cache')) writeFile(sh.fs, '/var/cache/apk/APKINDEX.tar.gz', '', 2.5e6);
      return 0;
    }
    if (args[0] === 'update') { io.out('OK: 24180 distinct packages available\n'); return 0; }
    io.err('apk: unknown command\n'); return 1;
  }
  function npmCmd(args, io, sh) {
    if (!has(sh, '/usr/local/bin/node')) return missing(io, 'npm');
    if (args[0] === 'install' || args[0] === 'ci' || args[0] === 'i') {
      const pj = sh.readFile('package.json');
      if (pj === null) { io.err("npm error code ENOENT\nnpm error path " + sh.cwd + "/package.json\nnpm error enoent Could not read package.json\n"); return 254; }
      let deps = {};
      try { const j = JSON.parse(pj); deps = Object.assign({}, j.dependencies, args.includes('--omit=dev') || args.includes('--production') ? {} : j.devDependencies); } catch (e) { /* ignore */ }
      for (const d of Object.keys(deps)) writeFile(sh.fs, sh.abs(`node_modules/${d}/package.json`), '{}', 6e6);
      io.out(`\nadded ${Object.keys(deps).length * 7 + 3} packages, and audited ${Object.keys(deps).length * 7 + 4} packages in 2s\n\nfound 0 vulnerabilities\n`);
      return 0;
    }
    if (args[0] === 'start') return runNode(['node', 'server.js'], io, sh);
    if (args[0] === '-v' || args[0] === '--version') { io.out('10.8.2\n'); return 0; }
    io.err(`npm error Unknown command: "${args[0]}"\n`); return 1;
  }
  function runNode(argv, io) { io.out('Server listening on port 3000\n'); return 0; }

  // Maven: compile/test/package a Spring Boot project into a runnable (simulated) jar
  function javaSources(sh, dir) {
    const out = [];
    const walk = (n, p) => { if (!n) return; if (n.type === 'file') { if (p.endsWith('.java')) out.push({ path: p, src: n.content }); return; } for (const k of Object.keys(n.children).sort()) walk(n.children[k], p + '/' + k); };
    walk(sh.fs.get(sh.abs(dir)), sh.abs(dir));
    return out;
  }
  function mvnCmd(args, io, sh, viaWrapper) {
    if (sh.container && !viaWrapper && !has(sh, '/usr/share/maven/bin/mvn')) return missing(io, 'mvn');
    if (sh.container && !has(sh, '/opt/java/openjdk/bin/java')) { io.err('The JAVA_HOME environment variable is not defined correctly\n'); return 1; }
    if (args.includes('-v') || args.includes('--version')) { io.out('Apache Maven 3.9.9\nJava version: 21.0.5, vendor: Eclipse Adoptium\n'); return 0; }
    const quiet = args.includes('-q');
    const skipTests = args.some(a => /^-DskipTests|^-Dmaven\.test\.skip/.test(a));
    const goals = args.filter(a => !a.startsWith('-'));
    const pom = sh.readFile('pom.xml');
    const log = s => { if (!quiet) io.out(s); };
    if (pom === null) {
      io.out('[INFO] Scanning for projects...\n');
      io.err(`[ERROR] The goal you specified requires a project to execute but there is no POM in this directory (${sh.cwd}). Please verify you invoked Maven from the correct directory. -> [Help 1]\n`);
      return 1;
    }
    const tag = t => { const m = new RegExp(`<${t}>([^<]+)</${t}>`).exec(pom.replace(/<parent>[\s\S]*?<\/parent>/, '')); return m ? m[1].trim() : null; };
    const artifact = tag('artifactId') || 'app', version = tag('version') || '0.0.1-SNAPSHOT', name = tag('name') || artifact;
    const actuator = /spring-boot-starter-actuator/.test(pom);
    const web = /spring-boot-starter-web/.test(pom);
    if (!goals.length) { io.err('[ERROR] No goals have been specified for this build.\n'); return 1; }
    log(`[INFO] Scanning for projects...\n[INFO] \n[INFO] --------------------< com.example:${artifact} >---------------------\n[INFO] Building ${name} ${version}\n[INFO]   from pom.xml\n[INFO] --------------------------------[ jar ]---------------------------------\n`);
    const main = javaSources(sh, 'src/main/java');
    const tests = javaSources(sh, 'src/test/java');
    if (sh.container) writeFile(sh.fs, '/root/.m2/repository/.cache', '', 86e6);
    for (const g of goals) {
      if (g === 'clean') { const t = sh.abs('target'); const p = sh.fs.parentDir(t); if (p && p.children.target) delete p.children.target; log(`[INFO] --- clean:3.4.0:clean (default-clean) @ ${artifact} ---\n[INFO] Deleting ${t}\n`); continue; }
      if (['compile', 'test', 'package', 'install', 'verify', 'spring-boot:run'].includes(g)) {
        if (!main.length) { io.err('[ERROR] No sources to compile\n'); return 1; }
        for (const f of main) {
          const opens = (f.src.match(/\{/g) || []).length, closes = (f.src.match(/\}/g) || []).length;
          if (opens !== closes) { io.out(`[INFO] --- compiler:3.13.0:compile (default-compile) @ ${artifact} ---\n`); io.err(`[ERROR] COMPILATION ERROR : \n[ERROR] ${f.path}: reached end of file while parsing\n[INFO] BUILD FAILURE\n`); return 1; }
        }
        log(`[INFO] --- compiler:3.13.0:compile (default-compile) @ ${artifact} ---\n[INFO] Compiling ${main.length} source file${main.length === 1 ? '' : 's'} with javac [debug parameters release 21] to target/classes\n`);
        mkdirp(sh.fs, sh.abs('target/classes'));
        if (g === 'compile') continue;
        if (g === 'spring-boot:run') { startSpringOnHost(sh, io, { artifact, routes: parseJavaRoutes(main.map(f => f.src)), props: propsOf(sh.readFile('src/main/resources/application.properties')), actuator, web }); continue; }
        if (!skipTests) {
          const n = tests.reduce((a, f) => a + (f.src.match(/@Test\b/g) || []).length, 0);
          const failing = tests.reduce((a, f) => a + (f.src.match(/fail\(|assertEquals\(\s*1\s*,\s*2\s*\)/g) || []).length, 0);
          log(`[INFO] --- surefire:3.5.1:test (default-test) @ ${artifact} ---\n[INFO] \n[INFO] -------------------------------------------------------\n[INFO]  T E S T S\n[INFO] -------------------------------------------------------\n[INFO] Results:\n[INFO] \n`);
          if (failing) { io.out(`[ERROR] Tests run: ${n}, Failures: ${failing}, Errors: 0, Skipped: 0\n`); io.err('[INFO] BUILD FAILURE\n'); return 1; }
          log(`[INFO] Tests run: ${n}, Failures: 0, Errors: 0, Skipped: 0\n`);
        } else log('[INFO] Tests are skipped.\n');
        if (g === 'test') continue;
        const jarName = `target/${artifact}-${version}.jar`;
        const props = propsOf(sh.readFile('src/main/resources/application.properties'));
        const manifest = { jar: 'spring-boot', artifact, version, routes: parseJavaRoutes(main.map(f => f.src)), props, actuator, web };
        writeFile(sh.fs, sh.abs(jarName), JSON.stringify(manifest), 21.4e6);
        log(`[INFO] --- jar:3.4.2:jar (default-jar) @ ${artifact} ---\n[INFO] Building jar: ${sh.abs(jarName)}\n[INFO] --- spring-boot:3.3.5:repackage (repackage) @ ${artifact} ---\n[INFO] Replacing main artifact ${sh.abs(jarName)} with repackaged archive\n`);
        continue;
      }
      io.err(`[ERROR] Unknown lifecycle phase "${g}".\n`); return 1;
    }
    log('[INFO] ------------------------------------------------------------------------\n[INFO] BUILD SUCCESS\n[INFO] ------------------------------------------------------------------------\n');
    return 0;
  }
  const SPRING_BANNER = '\n  .   ____          _            __ _ _\n /\\\\ / ___\'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | \'_ | \'_| | \'_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  \'  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\n :: Spring Boot ::                (v3.3.5)\n\n';
  function springStartLog(port, artifact, profile) {
    return SPRING_BANNER +
      `2026-10-22T12:00:00.000Z  INFO 1 --- [${artifact}] [           main] c.e.demo.DemoApplication                 : Starting DemoApplication using Java 21.0.5\n` +
      (profile ? `2026-10-22T12:00:00.100Z  INFO 1 --- [${artifact}] [           main] c.e.demo.DemoApplication                 : The following 1 profile is active: "${profile}"\n` : `2026-10-22T12:00:00.100Z  INFO 1 --- [${artifact}] [           main] c.e.demo.DemoApplication                 : No active profile set, falling back to 1 default profile: "default"\n`) +
      `2026-10-22T12:00:01.200Z  INFO 1 --- [${artifact}] [           main] o.s.b.w.embedded.tomcat.TomcatWebServer  : Tomcat started on port ${port} (http) with context path '/'\n` +
      `2026-10-22T12:00:01.250Z  INFO 1 --- [${artifact}] [           main] c.e.demo.DemoApplication                 : Started DemoApplication in 1.9 seconds (process running for 2.3)\n`;
  }
  function springServerFrom(manifest, args, env) {
    let port = parseInt(manifest.props['server.port'] || '8080', 10);
    let profile = manifest.props['spring.profiles.active'] || '';
    if (env.SERVER_PORT) port = parseInt(env.SERVER_PORT, 10);
    if (env.SPRING_PROFILES_ACTIVE) profile = env.SPRING_PROFILES_ACTIVE;
    for (const a of args) {
      let m;
      if ((m = /^--server\.port=(\d+)$/.exec(a)) || (m = /^-Dserver\.port=(\d+)$/.exec(a))) port = parseInt(m[1], 10);
      if ((m = /^--spring\.profiles\.active=(\S+)$/.exec(a)) || (m = /^-Dspring\.profiles\.active=(\S+)$/.exec(a))) profile = m[1];
    }
    return { kind: 'spring', host: '0.0.0.0', port, routes: manifest.routes, actuator: manifest.actuator, profile, artifact: manifest.artifact };
  }
  function startSpringOnHost(sh, io, manifest, args, env) {
    const d = daemonOf(sh);
    const srv = springServerFrom(manifest, args || [], env || {});
    if (d.hostServers.find(s => s.port === srv.port)) { io.out(SPRING_BANNER); io.err(`***************************\nAPPLICATION FAILED TO START\n***************************\n\nDescription:\n\nWeb server failed to start. Port ${srv.port} was already in use.\n`); return 1; }
    d.hostServers.push({ port: srv.port, server: srv, fs: () => sh.fs, logs: '' });
    io.out(springStartLog(srv.port, manifest.artifact, srv.profile));
    io.err(`(simulator: the app keeps running in the background on port ${srv.port}. Try: curl localhost:${srv.port}/...)\n`);
    return 0;
  }
  function javaCmd(args, io, sh) {
    if (sh.container && !has(sh, '/opt/java/openjdk/bin/java')) return missing(io, 'java');
    if (args[0] === '-version' || args[0] === '--version') { io.err('openjdk version "21.0.5" 2024-10-15 LTS\nOpenJDK Runtime Environment Temurin-21.0.5+11 (build 21.0.5+11-LTS)\n'); return 0; }
    const j = args.indexOf('-jar');
    if (j < 0) { io.err('Usage: java [options] -jar <jarfile> [args...]\n'); return 1; }
    const jar = args[j + 1];
    const c = sh.readFile(jar || '');
    if (c === null) { io.err(`Error: Unable to access jarfile ${jar}\n`); return 1; }
    let manifest;
    try { manifest = JSON.parse(c); } catch (e) { io.err(`Error: Invalid or corrupt jarfile ${jar}\n`); return 1; }
    const sysProps = args.slice(0, j).filter(a => a.startsWith('-D'));
    const appArgs = args.slice(j + 2);
    if (sh.container) return { server: springServerFrom(manifest, sysProps.concat(appArgs), envObj(sh)), manifest };
    const env = {};
    for (const k of ['SERVER_PORT', 'SPRING_PROFILES_ACTIVE']) { const v = sh.getVar(k); if (v) env[k] = v; }
    return startSpringOnHost(sh, io, manifest, sysProps.concat(appArgs), env);
  }
  function envObj(sh) { const o = {}; for (const m of sh.scopes) for (const [k, e] of m) if (typeof e.v === 'string') o[k] = e.v; return o; }
  // uvicorn main:app --host 0.0.0.0 --port 8000
  function uvicornServer(args, sh, defHost) {
    let target = null, host = defHost || '127.0.0.1', port = 8000;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--host') host = args[++i];
      else if (a.startsWith('--host=')) host = a.slice(7);
      else if (a === '--port') port = parseInt(args[++i], 10);
      else if (a.startsWith('--port=')) port = parseInt(a.slice(7), 10);
      else if (a === '--reload' || a === '--workers' || a === '--proxy-headers') { if (a === '--workers') i++; }
      else if (!a.startsWith('-') && !target) target = a;
    }
    return { target, host, port };
  }
  function fastapiFromTarget(sh, target) {
    if (!target) return { error: 'Error: Missing argument \'APP\'.' };
    let file, appName = 'app';
    if (target.endsWith('.py')) file = target;
    else { const [mod, app] = target.split(':'); file = mod.replace(/\./g, '/') + '.py'; appName = app || 'app'; }
    const src = sh.readFile(file);
    if (src === null) return { error: `ERROR:    Error loading ASGI app. Could not import module "${file.replace(/\.py$/, '').replace(/\//g, '.')}".` };
    if (!new RegExp(`^${appName}\\s*=\\s*FastAPI\\(`, 'm').test(src)) return { error: `ERROR:    Error loading ASGI app. Attribute "${appName}" not found in module "${file.replace(/\.py$/, '')}".` };
    return { routes: parsePyRoutes(src).filter(r => r.prefix === appName) };
  }
  function uvicornLog(host, port) { return `INFO:     Started server process [1]\nINFO:     Waiting for application startup.\nINFO:     Application startup complete.\nINFO:     Uvicorn running on http://${host}:${port} (Press CTRL+C to quit)\n`; }
  function uvicornCmd(args, io, sh, viaFastapiCli) {
    if (sh.container && !has(sh, '/usr/local/bin/' + (viaFastapiCli ? 'fastapi' : 'uvicorn'))) return missing(io, viaFastapiCli ? 'fastapi' : 'uvicorn');
    let a = args;
    let defHost = '127.0.0.1';
    if (viaFastapiCli) { if (a[0] === 'run') defHost = '0.0.0.0'; a = a.slice(1); }
    const u = uvicornServer(a, sh, defHost);
    const app = fastapiFromTarget(sh, u.target);
    if (app.error) { io.err(app.error + '\n'); return 1; }
    const srv = { kind: 'fastapi', host: u.host, port: u.port, routes: app.routes };
    if (sh.container) return { server: srv };
    const d = daemonOf(sh);
    if (d.hostServers.find(s => s.port === u.port)) { io.err(`ERROR:    [Errno 98] error while attempting to bind on address ('${u.host}', ${u.port}): address already in use\n`); return 1; }
    d.hostServers.push({ port: u.port, server: srv, fs: () => sh.fs, logs: '' });
    io.out(uvicornLog(u.host, u.port));
    io.err(`(simulator: the server keeps running in the background on port ${u.port}. Try: curl localhost:${u.port}/)\n`);
    return 0;
  }
  function pythonCmd(args, io, sh) {
    if (sh.container && !has(sh, '/usr/local/bin/python3')) return missing(io, 'python3');
    if (args[0] === '--version' || args[0] === '-V') { io.out('Python 3.12.7\n'); return 0; }
    if (args[0] === '-m' && (args[1] === 'pip')) return pipCmd(args.slice(2), io, sh);
    if (args[0] === '-m' && args[1] === 'uvicorn') return uvicornCmd(args.slice(2), io, sh);
    if (args[0] === '-m' && args[1] === 'http.server') {
      const port = parseInt(args[2] || '8000', 10);
      const srv = { kind: 'static', host: '0.0.0.0', port, root: sh.cwd };
      if (sh.container) return { server: srv, log: `Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ...\n` };
      daemonOf(sh).hostServers.push({ port, server: srv, fs: () => sh.fs, logs: '' });
      io.out(`Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ...\n`);
      io.err(`(simulator: the server keeps running in the background. Try: curl localhost:${port}/)\n`);
      return 0;
    }
    let src;
    if (args[0] === '-c') src = args[1] || '';
    else if (args[0]) { src = sh.readFile(args[0]); if (src === null) { io.err(`python3: can't open file '${sh.abs(args[0])}': [Errno 2] No such file or directory\n`); return 2; } }
    else { io.err('(simulator: the interactive Python REPL is not available)\n'); return 0; }
    const run = /uvicorn\.run\(\s*["']?(\w+:?\w*)["']?\s*(?:,\s*host\s*=\s*["']([^"']+)["'])?(?:\s*,\s*port\s*=\s*(\d+))?/.exec(src);
    if (run && sh.container) {
      const routes = parsePyRoutes(src);
      return { server: { kind: 'fastapi', host: run[2] || '127.0.0.1', port: parseInt(run[3] || '8000', 10), routes } };
    }
    // tiny interpreter for print() of string literals / simple f-strings with os.environ
    let out = '';
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || /^(import|from)\s/.test(t)) continue;
      const m = /^print\(\s*(f?)(["'])(.*)\2\s*\)$/.exec(t);
      if (m) {
        let s = m[3];
        if (m[1]) s = s.replace(/\{os\.environ(?:\.get)?\(?\[?["'](\w+)["']\]?(?:\s*,\s*["']([^"']*)["'])?\)?\}/g, (x, k, d) => { const v = sh.getVar(k); return v !== undefined && v !== '' ? v : (d !== undefined ? d : ''); });
        out += s.replace(/\\n/g, '\n') + '\n';
        continue;
      }
      out += '';
      if (!/^print\(/.test(t)) { io.out(out); io.err(`(simulator: only simple print() programs can actually run here; "${t.slice(0, 40)}" was skipped)\n`); return 0; }
    }
    io.out(out);
    return 0;
  }
  function redisCli(args, io, sh) {
    if (!has(sh, '/usr/local/bin/redis-cli')) return missing(io, 'redis-cli');
    const store = sh.container ? (sh.container.redis = sh.container.redis || {}) : {};
    const a = args.filter((x, i) => !(x === '-h' || x === '-p' || args[i - 1] === '-h' || args[i - 1] === '-p'));
    const cmd = (a[0] || '').toUpperCase();
    switch (cmd) {
      case 'PING': io.out('PONG\n'); return 0;
      case 'SET': store[a[1]] = a[2]; io.out('OK\n'); return 0;
      case 'GET': io.out(store[a[1]] === undefined ? '(nil)\n' : `"${store[a[1]]}"\n`); return 0;
      case 'INCR': store[a[1]] = String((parseInt(store[a[1]] || '0', 10)) + 1); io.out(`(integer) ${store[a[1]]}\n`); return 0;
      case 'DEL': { const had = a[1] in store; delete store[a[1]]; io.out(`(integer) ${had ? 1 : 0}\n`); return 0; }
      case 'KEYS': { const k = Object.keys(store); io.out(k.length ? k.map((x, i) => `${i + 1}) "${x}"`).join('\n') + '\n' : '(empty array)\n'); return 0; }
      default: io.err(`(error) ERR unknown command '${a[0] || ''}'\n`); return 1;
    }
  }
  function psqlCmd(args, io, sh) {
    if (!has(sh, '/usr/bin/psql')) return missing(io, 'psql');
    const c = args.indexOf('-c');
    const sql = c >= 0 ? args[c + 1] || '' : '';
    if (!sql) { io.err('(simulator: interactive psql is not available; use psql -U postgres -c "SQL")\n'); return 0; }
    const t = sql.trim().replace(/;$/, '');
    if (/^select\s+1$/i.test(t)) { io.out(' ?column? \n----------\n        1\n(1 row)\n\n'); return 0; }
    if (/^select\s+version\(\)$/i.test(t)) { io.out('                       version\n-----------------------------------------------------\n PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by gcc\n(1 row)\n\n'); return 0; }
    if (/^\\l$/.test(t)) { io.out('   Name    |  Owner\n-----------+----------\n postgres  | postgres\n template0 | postgres\n template1 | postgres\n' + (sh.container && sh.container.env.find(e => e.startsWith('POSTGRES_DB=')) ? ` ${sh.container.env.find(e => e.startsWith('POSTGRES_DB=')).slice(12).padEnd(9)} | postgres\n` : '') + '\n'); return 0; }
    io.out(t.split(/\s+/).slice(0, t.split(/\s+/)[0].toUpperCase() === 'CREATE' ? 2 : 1).join(' ').toUpperCase() + '\n');
    return 0;
  }
  function userAdd(args, io, sh) {
    const name = args.filter(a => !a.startsWith('-')).pop();
    if (!name) { io.err('useradd: missing user name\n'); return 2; }
    const pw = sh.readFile('/etc/passwd') || '';
    if (new RegExp('^' + name + ':', 'm').test(pw)) { io.err(`useradd: user '${name}' already exists\n`); return 9; }
    writeFile(sh.fs, '/etc/passwd', pw + `${name}:x:1000:1000::/home/${name}:/bin/sh\n`);
    mkdirp(sh.fs, '/home/' + name);
    return 0;
  }

  // ------------------------------------------------------------------ curl
  function resolveTarget(sh, host, port) {
    const d = daemonOf(sh);
    const local = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
    if (sh.container) {
      const me = sh.container;
      if (local) {
        if (me.server && me.server.port === port) return { container: me, server: me.server, client: '127.0.0.1' };
        return { error: 7 };
      }
      // DNS: container names and compose aliases on shared user-defined networks
      const sharedNets = me.networks.filter(n => n !== 'bridge' && n !== 'host' && n !== 'none');
      const target = d.containers.find(c => c.status === 'running' && c.networks.some(n => sharedNets.includes(n)) && (c.name === host || (c.aliases || []).includes(host) || short(c.id) === host));
      if (!target) return { error: 6 };
      if (!target.server || target.server.port !== port) return { error: 7 };
      if (target.server.host === '127.0.0.1') return { error: 7 };
      return { container: target, server: target.server, client: ipOf(me, target) };
    }
    if (!local) return { error: 6 };
    const c = d.containers.find(x => x.status === 'running' && x.ports.some(p => p.host === port));
    if (c) {
      const map = c.ports.find(p => p.host === port);
      if (!c.server || c.server.port !== map.container || c.server.host === '127.0.0.1' || c.server.host === 'localhost') return { error: 56 };
      return { container: c, server: c.server, client: '172.17.0.1' };
    }
    const hs = d.hostServers.find(s => s.port === port);
    if (hs) return { host: hs, server: hs.server, client: '127.0.0.1' };
    return { error: 7 };
  }
  function ipOf(c, other) { const n = c.networks.find(x => !other || other.networks.includes(x)) || c.networks[0]; return (c.ips && c.ips[n]) || '172.17.0.2'; }
  function curlCmd(args, io, sh) {
    if (sh.container && !has(sh, '/usr/bin/curl')) return missing(io, 'curl');
    let url = null, method = null, include = false, head = false, silent = false, showErr = false, fail = false, outFile = null, wfmt = null, data = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-X' || a === '--request') method = args[++i];
      else if (a === '-d' || a === '--data' || a === '--json') { data = args[++i]; if (!method) method = 'POST'; }
      else if (a === '-H' || a === '--header') i++;
      else if (a === '-o' || a === '--output') outFile = args[++i];
      else if (a === '-w' || a === '--write-out') wfmt = args[++i];
      else if (a === '--max-time' || a === '-m' || a === '--retry') i++;
      else if (/^-[a-zA-Z]+$/.test(a)) {
        for (const f of a.slice(1)) {
          if (f === 'i') include = true; else if (f === 'I') head = true; else if (f === 's') silent = true; else if (f === 'S') showErr = true; else if (f === 'f') fail = true;
        }
      } else if (a === '--include') include = true; else if (a === '--head') head = true; else if (a === '--silent') silent = true; else if (a === '--fail') fail = true;
      else if (!a.startsWith('-')) url = a;
    }
    if (!url) { io.err('curl: try \'curl --help\' for more information\n'); return 2; }
    const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/[^\s]*)?$/.exec(url);
    if (!m) { io.err(`curl: (3) URL rejected: Malformed input to a URL function\n`); return 3; }
    const host = m[2], port = parseInt(m[3] || (m[1] === 'https' ? '443' : '80'), 10), path = m[4] || '/';
    method = (method || (head ? 'HEAD' : 'GET')).toUpperCase();
    const errOut = (code, msg) => { if (!silent || showErr) io.err(`curl: (${code}) ${msg}\n`); return code; };
    const t = resolveTarget(sh, host, port);
    if (t.error === 6) return errOut(6, `Could not resolve host: ${host}`);
    if (t.error === 7) return errOut(7, `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`);
    if (t.error === 56) return errOut(56, 'Recv failure: Connection reset by peer');
    const fsFn = t.container ? () => t.container.fs : t.host.fs;
    const r = handle(t.server, fsFn, method === 'HEAD' ? 'GET' : method, path);
    void data;
    if (!r) return errOut(52, 'Empty reply from server');
    const logLine = serverLogLine(t.server, method, path, r.status, t.client);
    if (t.container) t.container.logs += logLine; else t.host.logs += logLine;
    if (fail && r.status >= 400) return errOut(22, `The requested URL returned error: ${r.status}`);
    let out = '';
    const hdrs = `HTTP/1.1 ${r.status} ${r.reason}\r\n` + Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
    if (head) out = hdrs;
    else out = (include ? hdrs : '') + r.body;
    if (outFile) sh.writeFile(outFile, out, false); else io.out(out.replace(/\r\n/g, '\n'));
    if (wfmt) io.out(wfmt.replace(/%\{http_code\}/g, String(r.status)).replace(/%\{content_type\}/g, r.headers['content-type']).replace(/\\n/g, '\n'));
    return 0;
  }

  // ----------------------------------------------------- running programs
  // Decides what a container's main process does: serve, run and exit, or fail.
  function startProcess(d, c, io) {
    const argv = (c.entrypoint || []).concat(c.cmd || []);
    let a = argv.slice();
    // entrypoint wrappers that exec "$@"
    while (a.length > 1 && /docker-entrypoint\.sh$/.test(a[0])) a = a.slice(1);
    if (!a.length) return { exit: 0, error: 'no command specified' };
    const sh = containerShell(d, c);
    // users must exist
    if (c.user && c.user !== 'root' && !/^\d+(:\d+)?$/.test(c.user)) {
      const pw = c.fs.get('/etc/passwd');
      if (!pw || !new RegExp('^' + c.user + ':', 'm').test(pw.content)) return { createError: `unable to find user ${c.user}: no matching entries in passwd file` };
    }
    let name = a[0].split('/').pop();
    // shell form: /bin/sh -c "script"
    if ((name === 'sh' || name === 'bash') && a[1] === '-c') {
      const script = a.slice(2).join(' ');
      const words = shellWords(script);
      const first = (words[0] || '').split('/').pop();
      if (['nginx', 'uvicorn', 'java', 'python', 'python3', 'fastapi', 'gunicorn', 'redis-server', 'postgres', 'node', 'npm', 'exec'].includes(first)) {
        a = words[0] === 'exec' ? words.slice(1) : words;
        name = a[0].split('/').pop();
      } else {
        return runShellScript(sh, c, script);
      }
    }
    switch (name) {
      case 'hello':
        return { exit: 0, log: '\nHello from Docker!\nThis message shows that your installation appears to be working correctly.\n\nTo generate this message, Docker took the following steps:\n 1. The Docker client contacted the Docker daemon.\n 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.\n 3. The Docker daemon created a new container from that image which runs the\n    executable that produces the output you are currently reading.\n 4. The Docker daemon streamed that output to the Docker client, which sent it\n    to your terminal.\n\nTo try something more ambitious, you can run an Ubuntu container with:\n $ docker run -it ubuntu bash\n' };
      case 'nginx':
        if (!has(sh, '/usr/sbin/nginx')) return { createError: notFoundMsg('nginx') };
        return { server: { kind: 'nginx', host: '0.0.0.0', port: 80 }, log: `/docker-entrypoint.sh: Configuration complete; ready for start up\n${TS} [notice] 1#1: using the "epoll" event method\n${TS} [notice] 1#1: nginx/1.27.2\n${TS} [notice] 1#1: start worker processes\n` };
      case 'postgres': {
        if (!has(sh, '/usr/local/bin/postgres')) return { createError: notFoundMsg('postgres') };
        const env = envObj(sh);
        if (!env.POSTGRES_PASSWORD && env.POSTGRES_HOST_AUTH_METHOD !== 'trust') return { exit: 1, log: 'Error: Database is uninitialized and superuser password is not specified.\n       You must specify POSTGRES_PASSWORD to a non-empty value for the\n       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".\n' };
        const pgdata = env.PGDATA || '/var/lib/postgresql/data';
        const init = !c.fs.get(pgdata + '/PG_VERSION');
        if (init) { writeFile(c.fs, pgdata + '/PG_VERSION', '16\n', 38e6); if (env.POSTGRES_DB) mkdirp(c.fs, pgdata + '/base/' + env.POSTGRES_DB); }
        return { server: { kind: 'postgres', host: '0.0.0.0', port: 5432 }, log: (init ? 'The files belonging to this database system will be owned by user "postgres".\n' + (env.POSTGRES_DB ? `CREATE DATABASE\n` : '') + '\nPostgreSQL init process complete; ready for start up.\n\n' : '\nPostgreSQL Database directory appears to contain a database; Skipping initialization\n\n') + `2026-10-22 12:00:00.000 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432\n2026-10-22 12:00:00.010 UTC [1] LOG:  database system is ready to accept connections\n` };
      }
      case 'redis-server':
        if (!has(sh, '/usr/local/bin/redis-server')) return { createError: notFoundMsg('redis-server') };
        return { server: { kind: 'redis', host: '0.0.0.0', port: 6379 }, log: '1:C 22 Oct 2026 12:00:00.000 * Redis version=7.4.1, bits=64, commit=00000000, modified=0, pid=1, just started\n1:M 22 Oct 2026 12:00:00.001 * Ready to accept connections tcp\n' };
      case 'uvicorn': case 'fastapi': case 'gunicorn': {
        if (!has(sh, '/usr/local/bin/' + name)) return { createError: notFoundMsg(name) };
        const io2 = cap();
        const r = uvicornCmd(name === 'gunicorn' ? a.slice(1).map(x => x === '-b' ? '--host' : x) : a.slice(1), io2, sh, name === 'fastapi');
        if (typeof r === 'number') return { exit: r, log: io2.text };
        return { server: r.server, log: uvicornLog(r.server.host, r.server.port) };
      }
      case 'python': case 'python3': {
        if (!has(sh, '/usr/local/bin/python3')) return { createError: notFoundMsg(name) };
        const io2 = cap();
        const r = pythonCmd(a.slice(1), io2, sh);
        if (typeof r === 'number') return { exit: r, log: io2.text };
        return { server: r.server, log: r.log || uvicornLog(r.server.host, r.server.port) };
      }
      case 'java': {
        if (!has(sh, '/opt/java/openjdk/bin/java')) return { createError: notFoundMsg('java') };
        const io2 = cap();
        const r = javaCmd(a.slice(1), io2, sh);
        if (typeof r === 'number') return { exit: r, log: io2.text };
        return { server: r.server, log: springStartLog(r.server.port, r.manifest.artifact, r.server.profile) };
      }
      case 'node': case 'npm': {
        if (!has(sh, '/usr/local/bin/node')) return { createError: notFoundMsg(name) };
        return { server: { kind: 'node', host: '0.0.0.0', port: 3000 }, log: 'Server listening on port 3000\n' };
      }
      case 'sleep': if (a[1] === 'infinity' || parseInt(a[1], 10) > 60) return { keepalive: true, log: '' }; return { exit: 0, log: '' };
      case 'tail': if (a.includes('-f')) return { keepalive: true, log: '' }; break;
      case 'sh': case 'bash': case 'ash':
        if (a.length === 1) {
          if (c.tty && c.interactive) return { keepalive: true, log: '', note: `(simulator: interactive shells aren't available here. The container keeps running; use "docker exec ${c.name} COMMAND" to run commands in it.)\n` };
          return { exit: 0, log: '' };
        }
        break;
      case 'jshell': if (c.tty && c.interactive) return { keepalive: true, log: '' }; return { exit: 0, log: '' };
    }
    if (!sh.commandExists(a[0])) return { createError: notFoundMsg(a[0]) };
    const io2 = cap();
    const st = sh.invoke(a.map(String), io2);
    return { exit: typeof st === 'number' ? st : 0, log: io2.text };
  }
  function runShellScript(sh, c, script) {
    const r = sh.run(script, { tty: false });
    if (r.status === 124 && /execution limit/.test(r.stderr)) return { keepalive: true, log: r.stdout.split('\n').slice(0, 20).join('\n') + '\n' };
    return { exit: r.status, log: r.output.map(x => x.s).join('') };
  }
  const notFoundMsg = name => `failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: exec: "${name}": executable file not found in $PATH: unknown`;
  function cap() { const io = { text: '', stdin: new Stream(''), tty: false }; io.out = s => { io.text += s; }; io.err = s => { io.text += s; }; return io; }

  function runHealthcheck(d, c) {
    const hc = c.healthcheck;
    if (!hc || c.status !== 'running') { c.health = null; return; }
    const test = Array.isArray(hc) ? hc : hc.Test;
    if (!test || test[0] === 'NONE') { c.health = null; return; }
    const sh = containerShell(d, c);
    const script = test[0] === 'CMD-SHELL' ? test.slice(1).join(' ') : test[0] === 'CMD' ? test.slice(1).map(MB.shQuote).join(' ') : test.join(' ');
    const r = sh.run(script, { tty: false });
    c.health = r.status === 0 ? 'healthy' : 'unhealthy';
  }

  // ------------------------------------------------------------ containers
  function createContainer(d, opts, io) {
    const image = opts.image;
    if (opts.name && d.containers.find(c => c.name === opts.name)) {
      const other = d.containers.find(c => c.name === opts.name);
      throw new DockerError(`Conflict. The container name "/${opts.name}" is already in use by container "${other.id}". You have to remove (or rename) that container to be able to reuse that name.`);
    }
    const id = d.nextId('ctr');
    const name = opts.name || NAMES[(d.counter * 7) % NAMES.length] + (d.counter > NAMES.length ? d.counter : '');
    const cfg = image.config;
    const c = {
      id, name, image: opts.imageRef, imageId: image.id, created: 'now',
      entrypoint: opts.entrypoint !== undefined ? opts.entrypoint : cfg.Entrypoint,
      cmd: opts.cmd && opts.cmd.length ? opts.cmd : (opts.entrypoint !== undefined ? [] : cfg.Cmd),
      env: mergeEnv(cfg.Env || [], opts.env || []),
      workdir: opts.workdir || cfg.WorkingDir || '/',
      user: opts.user !== undefined ? opts.user : cfg.User,
      ports: opts.ports || [], exposed: cfg.ExposedPorts || [],
      mounts: [], networks: [], ips: {}, aliases: opts.aliases || [],
      status: 'created', exitCode: 0, logs: '', server: null,
      restart: opts.restart || 'no', autoRemove: !!opts.rm, labels: Object.assign({}, cfg.Labels, opts.labels || {}),
      tty: !!opts.tty, interactive: !!opts.interactive, healthcheck: cfg.Healthcheck, health: null,
      fs: image.fs.clone(), compose: opts.compose || null
    };
    // port conflicts
    for (const p of c.ports) {
      const clash = d.containers.find(o => o.status === 'running' && o.ports.some(q => q.host === p.host));
      if (clash) { c.portClash = p.host; }
    }
    // mounts
    for (const m of opts.mounts || []) attachMount(d, c, m, opts.hostSh);
    // anonymous volumes declared by the image
    for (const v of cfg.Volumes || []) if (!c.mounts.find(m => m.destination === v)) attachMount(d, c, { type: 'volume', source: digest('anon' + id + v), destination: v, anonymous: true }, opts.hostSh);
    // networks
    const nets = opts.networks && opts.networks.length ? opts.networks : ['bridge'];
    for (const n of nets) {
      const net = d.network(n);
      if (!net) throw new DockerError(`network ${n} not found`);
      joinNetwork(c, net);
    }
    d.containers.push(c);
    return c;
  }
  function mergeEnv(base, extra) {
    const out = base.slice();
    for (const e of extra) {
      const k = e.split('=')[0];
      const i = out.findIndex(x => x.split('=')[0] === k);
      if (i >= 0) out[i] = e; else out.push(e);
    }
    return out;
  }
  function joinNetwork(c, net) {
    if (c.networks.includes(net.name)) return;
    c.networks.push(net.name);
    if (net.subnet) c.ips[net.name] = `${net.subnet}.${++net.n + 0}`;
  }
  function attachMount(d, c, m, hostSh) {
    let node;
    if (m.type === 'bind') {
      node = hostSh.fs.get(m.source);
      if (!node) { hostSh.fs.mkdirp(m.source, Date.now()); node = hostSh.fs.get(m.source); }
    } else {
      let vol = d.volumes.get(m.source);
      if (!vol) { vol = { name: m.source, node: MB.mkDir(Date.now()), anonymous: !!m.anonymous, labels: m.labels || {} }; d.volumes.set(m.source, vol); }
      // first mount of an empty volume copies the image's content at that path
      const existing = c.fs.get(m.destination);
      if (existing && existing.type === 'dir' && !Object.keys(vol.node.children).length) for (const k of Object.keys(existing.children)) vol.node.children[k] = copyNode(existing.children[k]);
      node = vol.node;
    }
    c.fs.mkdirp(m.destination.replace(/\/[^/]*$/, '') || '/', Date.now());
    const parent = c.fs.parentDir(m.destination);
    if (node.type === 'file') parent.children[m.destination.split('/').pop()] = node;
    else parent.children[m.destination.split('/').pop()] = node;
    c.mounts.push({ type: m.type, source: m.source, destination: m.destination, rw: !m.readonly, name: m.type === 'volume' ? m.source : undefined });
  }
  function startContainer(d, c, io) {
    if (c.portClash) {
      const p = c.portClash;
      const clash = d.containers.find(o => o !== c && o.status === 'running' && o.ports.some(q => q.host === p));
      if (clash) throw new DockerError(`driver failed programming external connectivity on endpoint ${c.name} (${digest('ep' + c.id)}): Bind for 0.0.0.0:${p} failed: port is already allocated`);
      c.portClash = null;
    }
    const r = startProcess(d, c, io);
    if (r.createError) { c.status = 'created'; c.exitCode = 127; throw new DockerError(r.createError); }
    c.logs += r.log || '';
    if (r.server || r.keepalive) { c.status = 'running'; c.server = r.server || null; c.exitCode = 0; }
    else { c.status = 'exited'; c.exitCode = r.exit || 0; c.server = null; }
    runHealthcheck(d, c);
    return r;
  }
  function removeContainer(d, c) {
    d.containers = d.containers.filter(x => x !== c);
    for (const m of c.mounts) if (m.type === 'volume') { const v = d.volumes.get(m.source); if (v && v.anonymous && c.autoRemove) d.volumes.delete(m.source); }
  }
  function statusText(c) {
    if (c.status === 'running') return 'Up 5 seconds' + (c.health ? ` (${c.health})` : '');
    if (c.status === 'exited') return `Exited (${c.exitCode}) 5 seconds ago`;
    return 'Created';
  }
  function portsText(c) {
    const pub = c.ports.map(p => `${p.hostIp || '0.0.0.0'}:${p.host}->${p.container}/${p.proto || 'tcp'}`);
    const exposedOnly = (c.exposed || []).filter(e => !c.ports.some(p => `${p.container}/${p.proto || 'tcp'}` === e));
    return c.status === 'running' ? pub.concat(exposedOnly).join(', ') : '';
  }
  function commandText(c) {
    const s = (c.entrypoint || []).concat(c.cmd || []).join(' ');
    return '"' + (s.length > 20 ? s.slice(0, 20) + '…' : s) + '"';
  }

  // -------------------------------------------------------------- building
  function parseDockerfile(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const instrs = [];
    let buf = '', startLine = 0;
    lines.forEach((l, i) => {
      if (!buf && /^\s*#/.test(l)) return;
      if (!buf && !l.trim()) return;
      if (!buf) startLine = i + 1;
      if (/\\\s*$/.test(l)) { buf += l.replace(/\\\s*$/, ' '); return; }
      buf += l;
      const m = /^\s*(\w+)\s*(.*)$/.exec(buf);
      if (m) instrs.push({ op: m[1].toUpperCase(), rawOp: m[1], args: m[2].trim(), line: startLine, text: buf.trim().replace(/\s+/g, ' ') });
      buf = '';
    });
    if (buf.trim()) { const m = /^\s*(\w+)\s*(.*)$/.exec(buf); if (m) instrs.push({ op: m[1].toUpperCase(), rawOp: m[1], args: m[2].trim(), line: startLine, text: buf.trim() }); }
    const KNOWN = ['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL', 'MAINTAINER'];
    for (const ins of instrs) if (!KNOWN.includes(ins.op)) throw new DockerError(`dockerfile parse error on line ${ins.line}: unknown instruction: ${ins.rawOp}`);
    if (!instrs.length) throw new DockerError('the Dockerfile cannot be empty');
    const firstReal = instrs.find(i => i.op !== 'ARG');
    if (firstReal.op !== 'FROM') throw new DockerError(`dockerfile parse error on line ${firstReal.line}: no build stage in current context (the first instruction must be FROM)`);
    return instrs;
  }
  const jsonForm = s => { if (!/^\[/.test(s.trim())) return null; try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : null; } catch (e) { return null; } };
  function substVars(s, vars) {
    return s.replace(/\$\{(\w+)(?::?-([^}]*))?\}|\$(\w+)/g, (m, a, def, b) => { const k = a || b; return vars[k] !== undefined && vars[k] !== '' ? vars[k] : (def !== undefined ? def : (vars[k] !== undefined ? vars[k] : '')); });
  }
  function parseKV(args) {
    const out = [];
    if (/^\s*[\w.\-]+=/.test(args)) {
      for (const w of shellWords(args)) { const k = w.indexOf('='); out.push([w.slice(0, k), w.slice(k + 1)]); }
    } else { const m = /^(\S+)\s+([\s\S]*)$/.exec(args); if (m) out.push([m[1], m[2].replace(/^(["'])([\s\S]*)\1$/, '$2')]); }
    return out;
  }
  function ignoreMatcher(text) {
    const pats = (text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const rx = pats.map(p => {
      const neg = p.startsWith('!');
      let body = (neg ? p.slice(1) : p).replace(/^\/+|\/+$/g, '').replace(/^\.\//, '');
      let src = '';
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '*' && body[i + 1] === '*') { src += '.*'; i++; if (body[i + 1] === '/') i++; continue; }
        if (c === '*') { src += '[^/]*'; continue; }
        if (c === '?') { src += '[^/]'; continue; }
        src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
      return { neg, re: new RegExp('^' + src + '(/.*)?$') };
    });
    return rel => { let ex = false; for (const r of rx) if (r.re.test(rel)) ex = !r.neg; return ex; };
  }
  function contentHash(node) {
    if (!node) return 'none';
    if (node.type === 'file') return h32(node.content + '|' + (node.vsize || 0), 7);
    return h32(Object.keys(node.children).sort().map(k => k + ':' + contentHash(node.children[k])).join(','), 11);
  }
  function buildImage(d, hostSh, opts, out) {
    const ctxAbs = hostSh.abs(opts.context || '.');
    const ctxNode = hostSh.fs.get(ctxAbs);
    if (!ctxNode || ctxNode.type !== 'dir') throw new DockerError(`unable to prepare context: path "${opts.context}" not found`);
    const dfPath = opts.file ? hostSh.abs(opts.file) : ctxAbs + '/Dockerfile';
    const dfNode = hostSh.fs.get(dfPath);
    if (!dfNode || dfNode.type !== 'file') throw new DockerError(`failed to read dockerfile: open ${dfPath.replace(hostSh.home, '~')}: no such file or directory`);
    const instrs = parseDockerfile(dfNode.content);
    const ignore = ignoreMatcher((hostSh.fs.get(ctxAbs + '/.dockerignore') || {}).content);
    const ctxFs = new VFS();
    ctxFs.root = copyNode(ctxNode);
    const prune = (node, rel) => {
      for (const k of Object.keys(node.children)) {
        const r = rel ? rel + '/' + k : k;
        if (ignore(r)) { delete node.children[k]; continue; }
        if (node.children[k].type === 'dir') prune(node.children[k], r);
      }
    };
    prune(ctxFs.root, '');
    // stages
    const stages = [];
    let cur = null;
    const globalArgs = {};
    for (const [k, v] of Object.entries(opts.buildArgs || {})) globalArgs[k] = v;
    const steps = [];
    let stageIndex = -1;
    for (const ins of instrs) {
      if (ins.op === 'ARG' && !cur) { const [k, v] = ins.args.split('='); if (globalArgs[k] === undefined) globalArgs[k] = v; continue; }
      if (ins.op === 'FROM') {
        const words = ins.args.replace(/--platform=\S+\s*/, '').trim().split(/\s+/);
        if (!(words.length === 1 || (words.length === 3 && /^as$/i.test(words[1])))) throw new DockerError(`dockerfile parse error on line ${ins.line}: FROM requires either one or three arguments`);
      }
      if (ins.op === 'FROM') { stageIndex++; cur = { index: stageIndex, instrs: [ins] }; stages.push(cur); const m = /\s+AS\s+(\S+)\s*$/i.exec(ins.args); cur.name = m ? m[1] : null; continue; }
      cur.instrs.push(ins);
    }
    let last = stages.length - 1;
    if (opts.target) { last = stages.findIndex(s => s.name === opts.target); if (last < 0) throw new DockerError(`target stage "${opts.target}" could not be found`); }
    // which stages are needed (final + those referenced by COPY --from / FROM)
    const needed = new Set([last]);
    for (let i = last; i >= 0; i--) {
      if (!needed.has(i)) continue;
      for (const ins of stages[i].instrs) {
        let m = /--from=(\S+)/.exec(ins.args);
        if (ins.op === 'COPY' && m) { const j = stages.findIndex(s => s.name === m[1] || String(s.index) === m[1]); if (j >= 0) needed.add(j); }
        if (ins.op === 'FROM') { const base = ins.args.replace(/\s+AS\s+\S+\s*$/i, '').trim(); const j = stages.findIndex(s => s.name === base); if (j >= 0 && j < i) needed.add(j); }
      }
    }
    const total = [...needed].reduce((a, i) => a + stages[i].instrs.length, 0);
    let done = 0;
    const lines = [];
    const results = [];
    let builtSteps = 0;
    for (let si = 0; si <= last; si++) {
      if (!needed.has(si)) continue;
      const st = stages[si];
      const label = st.name ? st.name : (stages.length > 1 ? `stage-${si}` : '');
      const stepTag = (k) => `[${label ? label + ' ' : ''}${k}/${st.instrs.length}]`;
      const argVars = Object.assign({}, globalArgs);
      let state;
      let chain;
      st.instrs.forEach((ins, k) => {
        done++;
        if (ins.op === 'FROM') {
          let base = substVars(ins.args.replace(/--platform=\S+\s*/, '').replace(/\s+AS\s+\S+\s*$/i, '').trim(), argVars);
          const prior = stages.findIndex(s => s.name === base);
          if (prior >= 0 && prior < si && results[prior]) {
            state = { fs: results[prior].fs.clone(), config: JSON.parse(JSON.stringify(results[prior].config)), layers: results[prior].layers.slice(), baseRef: base };
            chain = results[prior].chain;
            lines.push(` => ${stepTag(k + 1)} FROM ${base}`);
            return;
          }
          let image = d.image(base);
          if (!image) {
            const r = parseRef(base);
            const def = catalogLookup(r.repo, r.tag);
            if (def === null && !d.registry.has(r.full)) throw new DockerError(`failed to solve: ${base}: failed to resolve source metadata for docker.io/library/${r.full}: pull access denied, repository does not exist or may require authorization`);
            if (def === undefined && !d.registry.has(r.full)) throw new DockerError(`failed to solve: ${base}: failed to resolve source metadata for docker.io/library/${r.full}: docker.io/library/${r.full}: not found`);
            image = d.pull(base, () => {}, true);
          }
          state = { fs: image.fs.clone(), config: JSON.parse(JSON.stringify(image.config)), layers: image.layers.slice(), baseRef: base };
          chain = image.id;
          lines.push(` => ${stepTag(k + 1)} FROM docker.io/library/${parseRef(base).full}`);
          return;
        }
        const envVars = {};
        for (const e of state.config.Env) { const i = e.indexOf('='); envVars[e.slice(0, i)] = e.slice(i + 1); }
        const vars = Object.assign({}, argVars, envVars);
        let args = ins.args;
        if (!['RUN', 'CMD', 'ENTRYPOINT', 'HEALTHCHECK'].includes(ins.op)) args = substVars(args, vars);
        let cacheExtra = '';
        let copySrc = null;
        if (ins.op === 'COPY' || ins.op === 'ADD') {
          copySrc = resolveCopy(args, ctxFs, stages, results, d);
          cacheExtra = copySrc.hash;
        }
        if (ins.op === 'RUN') cacheExtra = JSON.stringify(argVars);
        const key = chain + '|' + ins.op + ' ' + args + '|' + cacheExtra;
        const nextChain = digest(key);
        const hit = !opts.noCache && d.cache.get(nextChain);
        const isMeta = ['ENV', 'ARG', 'EXPOSE', 'CMD', 'ENTRYPOINT', 'LABEL', 'USER', 'VOLUME', 'HEALTHCHECK', 'STOPSIGNAL', 'SHELL', 'MAINTAINER', 'ONBUILD'].includes(ins.op);
        if (hit) {
          state = { fs: hit.fs.clone(), config: JSON.parse(JSON.stringify(hit.config)), layers: hit.layers.slice(), baseRef: state.baseRef };
          if (ins.op === 'ARG') { const kv = args.split('='); if (argVars[kv[0]] === undefined) argVars[kv[0]] = kv[1]; }
          chain = nextChain;
          if (!isMeta) lines.push(` => CACHED ${stepTag(k + 1)} ${ins.op} ${args}`);
          return;
        }
        const before = fsSize(state.fs.root);
        switch (ins.op) {
          case 'WORKDIR': {
            const wd = VFS.norm(args, state.config.WorkingDir || '/');
            mkdirp(state.fs, wd);
            state.config.WorkingDir = wd;
            break;
          }
          case 'ENV': for (const [k2, v] of parseKV(args)) state.config.Env = mergeEnv(state.config.Env, [`${k2}=${substVars(v, vars)}`]); break;
          case 'ARG': { const kv = args.split('='); if (argVars[kv[0]] === undefined) argVars[kv[0]] = kv[1] !== undefined ? kv[1] : ''; break; }
          case 'EXPOSE': for (const p of args.split(/\s+/)) state.config.ExposedPorts.push(p.includes('/') ? p : p + '/tcp'); break;
          case 'CMD': state.config.Cmd = jsonForm(args) || ['/bin/sh', '-c', args]; break;
          case 'ENTRYPOINT': state.config.Entrypoint = jsonForm(args) || ['/bin/sh', '-c', args]; if (!state.cmdSetInStage) state.config.Cmd = null; break;
          case 'USER': state.config.User = args.trim(); break;
          case 'LABEL': for (const [k2, v] of parseKV(args)) state.config.Labels[k2] = v; break;
          case 'VOLUME': for (const v of (jsonForm(args) || args.split(/\s+/))) state.config.Volumes.push(v); break;
          case 'HEALTHCHECK': {
            if (/^NONE$/i.test(args)) { state.config.Healthcheck = { Test: ['NONE'] }; break; }
            const m = /^((?:--\S+\s+)*)CMD\s+([\s\S]+)$/i.exec(args);
            if (!m) throw new DockerError(`dockerfile parse error on line ${ins.line}: HEALTHCHECK requires CMD`);
            const jf = jsonForm(m[2]);
            state.config.Healthcheck = { Test: jf ? ['CMD'].concat(jf) : ['CMD-SHELL', m[2]], Options: m[1].trim() };
            break;
          }
          case 'STOPSIGNAL': case 'SHELL': case 'MAINTAINER': case 'ONBUILD': break;
          case 'COPY': case 'ADD': applyCopy(state, copySrc, args, ins); break;
          case 'RUN': {
            const script = (jsonForm(args) || ['/bin/sh', '-c', args]);
            const scriptText = script[0] === '/bin/sh' && script[1] === '-c' ? script.slice(2).join(' ') : script.map(MB.shQuote).join(' ');
            const fake = { id: digest('build' + nextChain), env: state.config.Env.concat(Object.entries(argVars).map(([k2, v]) => `${k2}=${v}`)), workdir: state.config.WorkingDir || '/', user: state.config.User && state.config.User !== 'root' ? state.config.User : 'root', fs: state.fs, networks: ['bridge'], ips: {} };
            const sh = containerShell(d, fake);
            const r = sh.run(scriptText, { tty: false });
            if (r.status !== 0) {
              const output = r.output.map(x => x.s).join('').trim().split('\n').slice(-8).map(l => `#${done + 3} ${l}`).join('\n');
              lines.push(` => ERROR ${stepTag(k + 1)} RUN ${args}`);
              out(lines.join('\n') + '\n' + (output ? output + '\n' : '') + '------\n');
              throw new DockerError(`failed to solve: process "/bin/sh -c ${args}" did not complete successfully: exit code: ${r.status}`);
            }
            break;
          }
        }
        if (ins.op === 'CMD') state.cmdSetInStage = true;
        const after = fsSize(state.fs.root);
        if (!isMeta) {
          const layerSize = Math.max(0, after - before) + (ins.op === 'WORKDIR' ? 0 : 0);
          state.layers.push({ id: nextChain, createdBy: ins.op === 'RUN' ? `RUN /bin/sh -c ${args} # buildkit` : `${ins.op} ${args} # buildkit`, size: layerSize });
          lines.push(` => ${stepTag(k + 1)} ${ins.op} ${args}`);
          builtSteps++;
        } else state.layers.push({ id: nextChain, createdBy: `${ins.op} ${args}`, size: 0 });
        chain = nextChain;
        d.cache.set(nextChain, { fs: state.fs.clone(), config: JSON.parse(JSON.stringify(state.config)), layers: state.layers.slice() });
      });
      results[si] = { fs: state.fs, config: state.config, layers: state.layers, chain };
    }
    const final = results[last];
    const imageId = digest('image|' + final.chain);
    let image = d.images.find(i => i.id === imageId);
    if (!image) {
      image = { id: imageId, tags: [], created: 'built', fs: final.fs, layers: final.layers, config: final.config, os: 'linux' };
      d.images.push(image);
    }
    for (const t of opts.tags) d.tagImage(image, parseRef(t).full);
    const secs = (0.3 + builtSteps * 0.4).toFixed(1);
    const head = `[+] Building ${secs}s (${total + 2}/${total + 2}) FINISHED`;
    const pre = [' => [internal] load build definition from ' + (opts.file ? opts.file.split('/').pop() : 'Dockerfile'), ' => [internal] load .dockerignore', ' => [internal] load build context'];
    const post = [' => exporting to image', ' => => writing image sha256:' + imageId].concat(opts.tags.map(t => ` => => naming to docker.io/library/${parseRef(t).full}`));
    if (opts.quiet) out('sha256:' + imageId + '\n');
    else out([head].concat(pre, lines, post).join('\n') + '\n');
    return image;
  }
  function resolveCopy(args, ctxFs, stages, results, d) {
    let words = jsonForm(args) || shellWords(args);
    let from = null;
    words = words.filter(w => { const m = /^--from=(\S+)$/.exec(w); if (m) { from = m[1]; return false; } return !/^--(chown|chmod|link|parents)/.test(w); });
    if (words.length < 2) throw new DockerError(`dockerfile parse error: COPY requires at least two arguments, but only one was provided. Destination could not be determined`);
    const dest = words.pop();
    let srcFs = ctxFs, base = '/';
    if (from !== null) {
      const j = stages.findIndex(s => s.name === from || String(s.index) === from);
      if (j >= 0) { if (!results[j]) throw new DockerError(`failed to solve: stage ${from} must be built before it is copied from`); srcFs = results[j].fs; }
      else { const img = d.image(from) || d.pull(from, () => {}, true); srcFs = img.fs; }
      base = '/';
    }
    const items = [];
    for (const s of words) {
      if (/^https?:\/\//.test(s)) { items.push({ name: s.split('/').pop() || 'index.html', node: Object.assign(MB.mkFile('downloaded from ' + s + '\n'), {}) }); continue; }
      const abs = from !== null ? VFS.norm(s, base) : VFS.norm(s, '/');
      if (/[*?[]/.test(s)) {
        const dir = abs.replace(/\/[^/]*$/, '') || '/';
        const pat = abs.split('/').pop();
        const dn = srcFs.get(dir);
        const matches = dn && dn.type === 'dir' ? Object.keys(dn.children).filter(k => MB.globMatch(pat, k)).sort() : [];
        if (!matches.length) throw new DockerError(`failed to solve: failed to compute cache key: failed to calculate checksum of ref: "${s}": not found`);
        for (const k of matches) items.push({ name: k, node: dn.children[k] });
        continue;
      }
      const n = srcFs.get(abs);
      if (!n) throw new DockerError(`failed to solve: failed to compute cache key: failed to calculate checksum of ref: "${abs === '/' ? '.' : abs}": not found`);
      items.push({ name: abs === '/' ? '' : abs.split('/').pop(), node: n, isRootDir: n.type === 'dir' });
    }
    return { items, dest, hash: items.map(i => i.name + ':' + contentHash(i.node)).join(',') + '->' + dest, multi: words.length > 1 || items.length > 1 };
  }
  function applyCopy(state, src, args, ins) {
    const wd = state.config.WorkingDir || '/';
    const destAbs = VFS.norm(src.dest, wd);
    const destIsDir = src.dest.endsWith('/') || src.dest === '.' || src.multi || (state.fs.get(destAbs) && state.fs.get(destAbs).type === 'dir');
    for (const it of src.items) {
      if (it.node.type === 'dir') {
        // copying a directory copies its contents
        mkdirp(state.fs, destAbs);
        const target = state.fs.get(destAbs);
        for (const k of Object.keys(it.node.children)) target.children[k] = copyNode(it.node.children[k]);
      } else {
        const target = destIsDir ? destAbs + '/' + it.name : destAbs;
        mkdirp(state.fs, target.replace(/\/[^/]*$/, '') || '/');
        state.fs.parentDir(target).children[target.split('/').pop()] = copyNode(it.node);
      }
    }
    void args; void ins;
  }

  // ------------------------------------------------------------ inspect data
  function inspectContainer(c) {
    return {
      Id: c.id, Created: '2026-10-22T12:00:00.000000000Z', Path: ((c.entrypoint || []).concat(c.cmd || []))[0] || '', Args: ((c.entrypoint || []).concat(c.cmd || [])).slice(1),
      State: { Status: c.status, Running: c.status === 'running', ExitCode: c.exitCode, Health: c.health ? { Status: c.health } : undefined },
      Image: 'sha256:' + c.imageId, Name: '/' + c.name, RestartCount: 0,
      HostConfig: { PortBindings: Object.fromEntries(c.ports.map(p => [`${p.container}/${p.proto || 'tcp'}`, [{ HostIp: '', HostPort: String(p.host) }]])), RestartPolicy: { Name: c.restart }, AutoRemove: c.autoRemove, Binds: c.mounts.filter(m => m.type === 'bind').map(m => `${m.source}:${m.destination}`), NetworkMode: c.networks[0] },
      Mounts: c.mounts.map(m => ({ Type: m.type, Name: m.name, Source: m.type === 'bind' ? m.source : `/var/lib/docker/volumes/${m.source}/_data`, Destination: m.destination, RW: m.rw })),
      Config: { Hostname: short(c.id), User: c.user || '', Env: c.env, Cmd: c.cmd, Image: c.image, WorkingDir: c.workdir === '/' ? '' : c.workdir, Entrypoint: c.entrypoint, Labels: c.labels, ExposedPorts: Object.fromEntries((c.exposed || []).map(p => [p, {}])) },
      NetworkSettings: { IPAddress: c.ips.bridge || '', Ports: Object.fromEntries(c.ports.map(p => [`${p.container}/${p.proto || 'tcp'}`, [{ HostIp: '0.0.0.0', HostPort: String(p.host) }]])), Networks: Object.fromEntries(c.networks.map(n => [n, { IPAddress: c.ips[n] || '', Aliases: c.aliases }])) }
    };
  }
  function inspectImage(d, i) {
    return { Id: 'sha256:' + i.id, RepoTags: i.tags, Created: '2026-10-22T12:00:00Z', Size: d.imageSize(i), Os: 'linux', Architecture: 'amd64', Config: { Env: i.config.Env, Cmd: i.config.Cmd, Entrypoint: i.config.Entrypoint, WorkingDir: i.config.WorkingDir, ExposedPorts: Object.fromEntries((i.config.ExposedPorts || []).map(p => [p, {}])), User: i.config.User, Labels: i.config.Labels, Volumes: Object.fromEntries((i.config.Volumes || []).map(v => [v, {}])), Healthcheck: i.config.Healthcheck }, RootFS: { Type: 'layers', Layers: i.layers.filter(l => l.size > 0 || /^(COPY|ADD|RUN|WORKDIR|\/bin)/.test(l.createdBy)).map(l => 'sha256:' + l.id) } };
  }

  // --------------------------------------------------------------- the CLI
  function parseOpts(args, spec) {
    // spec: { bool: {flag: key}, val: {flag: key}, multi: Set(keys), stopAtPositional }
    const o = {}, pos = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (spec.stop && pos.length) { pos.push(a); continue; }
      if (a === '--') { pos.push(...args.slice(i + 1)); break; }
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        const name = eq > 0 ? a.slice(0, eq) : a;
        if (spec.val[name]) { const v = eq > 0 ? a.slice(eq + 1) : args[++i]; if (v === undefined) throw new DockerError(`flag needs an argument: ${name}`); setOpt(o, spec, spec.val[name], v); continue; }
        if (spec.bool[name]) { o[spec.bool[name]] = eq > 0 ? a.slice(eq + 1) !== 'false' : true; continue; }
        throw new DockerError(`unknown flag: ${name}`);
      }
      if (a.startsWith('-') && a.length > 1) {
        for (let j = 1; j < a.length; j++) {
          const f = '-' + a[j];
          if (spec.val[f]) { const v = j + 1 < a.length ? a.slice(j + 1) : args[++i]; if (v === undefined) throw new DockerError(`flag needs an argument: '${a[j]}' in ${f}`); setOpt(o, spec, spec.val[f], v.replace(/^=/, '')); break; }
          if (spec.bool[f]) { o[spec.bool[f]] = true; continue; }
          throw new DockerError(`unknown shorthand flag: '${a[j]}' in ${a}`);
        }
        continue;
      }
      pos.push(a);
    }
    return { o, pos };
  }
  function setOpt(o, spec, key, v) { if (spec.multi && spec.multi.has(key)) (o[key] = o[key] || []).push(v); else o[key] = v; }
  function parsePort(s) {
    let m = /^(?:(\d+\.\d+\.\d+\.\d+):)?(\d+):(\d+)(?:\/(tcp|udp))?$/.exec(s);
    if (m) return { hostIp: m[1] || '0.0.0.0', host: parseInt(m[2], 10), container: parseInt(m[3], 10), proto: m[4] || 'tcp' };
    m = /^(\d+)(?:\/(tcp|udp))?$/.exec(s);
    if (m) return { hostIp: '0.0.0.0', host: 32768 + parseInt(m[1], 10) % 1000, container: parseInt(m[1], 10), proto: m[2] || 'tcp' };
    throw new DockerError(`invalid containerPort: ${s}`);
  }
  function parseMount(spec, hostSh) {
    const parts = spec.split(':');
    if (parts.length < 2) return { type: 'volume', source: digest('anon' + spec), destination: parts[0], anonymous: true };
    const [src, dst, mode] = parts;
    const isPath = /^[./~]/.test(src);
    return { type: isPath ? 'bind' : 'volume', source: isPath ? hostSh.abs(src) : src, destination: dst, readonly: mode === 'ro' };
  }
  const RUN_SPEC = {
    bool: { '-d': 'detach', '--detach': 'detach', '-i': 'interactive', '--interactive': 'interactive', '-t': 'tty', '--tty': 'tty', '--rm': 'rm', '-P': 'publishAll', '--publish-all': 'publishAll', '--init': 'init', '--privileged': 'priv' },
    val: { '--name': 'name', '-p': 'publish', '--publish': 'publish', '-e': 'env', '--env': 'env', '--env-file': 'envFile', '-v': 'volume', '--volume': 'volume', '--mount': 'mount', '-w': 'workdir', '--workdir': 'workdir', '--network': 'network', '--net': 'network', '--entrypoint': 'entrypoint', '-u': 'user', '--user': 'user', '--restart': 'restart', '-h': 'hostname', '--hostname': 'hostname', '-l': 'label', '--label': 'label', '-m': 'memory', '--memory': 'memory', '--cpus': 'cpus', '--health-cmd': 'healthCmd', '--platform': 'platform', '--network-alias': 'alias' },
    multi: new Set(['publish', 'env', 'volume', 'label', 'mount', 'alias']),
    stop: true
  };
  function runOptsToCreate(d, o, pos, sh, io) {
    const imageRef = pos[0];
    if (!imageRef) throw new DockerError('"docker run" requires at least 1 argument.\nSee \'docker run --help\'.');
    const env = [];
    for (const e of o.env || []) env.push(e.includes('=') ? e : `${e}=${sh.getVar(e) || ''}`);
    if (o.envFile) {
      const c = sh.readFile(o.envFile);
      if (c === null) throw new DockerError(`open ${o.envFile}: no such file or directory`);
      for (const l of c.split('\n')) { const t = l.trim(); if (t && !t.startsWith('#')) env.push(t); }
    }
    const image = d.ensureImage(imageRef, io.err);
    const ports = (o.publish || []).map(parsePort);
    if (o.publishAll) for (const e of image.config.ExposedPorts || []) { const p = parseInt(e, 10); ports.push({ hostIp: '0.0.0.0', host: 32768 + (d.counter % 50), container: p, proto: 'tcp' }); }
    const mounts = (o.volume || []).map(v => parseMount(v, sh));
    for (const m of o.mount || []) {
      const kv = Object.fromEntries(m.split(',').map(x => x.split('=')));
      mounts.push({ type: kv.type === 'bind' ? 'bind' : 'volume', source: kv.type === 'bind' ? sh.abs(kv.source || kv.src) : (kv.source || kv.src), destination: kv.target || kv.destination || kv.dst, readonly: 'readonly' in kv });
    }
    const labels = {};
    for (const l of o.label || []) { const k = l.indexOf('='); labels[k > 0 ? l.slice(0, k) : l] = k > 0 ? l.slice(k + 1) : ''; }
    return {
      image, imageRef: parseRef(imageRef).explicit || /^[0-9a-f]{12,}$/.test(imageRef) ? imageRef : imageRef, name: o.name, cmd: pos.slice(1), env, ports, mounts,
      workdir: o.workdir, user: o.user, networks: o.network ? [o.network] : null, entrypoint: o.entrypoint !== undefined ? (o.entrypoint ? [o.entrypoint] : []) : undefined,
      restart: o.restart, rm: o.rm, labels, tty: o.tty, interactive: o.interactive, hostSh: sh, aliases: o.alias
    };
  }
  function dockerRun(d, args, io, sh) {
    const { o, pos } = parseOpts(args, RUN_SPEC);
    const create = runOptsToCreate(d, o, pos, sh, io);
    let c;
    try { c = createContainer(d, create, io); }
    catch (e) { if (e instanceof DockerError) { io.err(`docker: Error response from daemon: ${e.message}\nSee 'docker run --help'.\n`); return 125; } throw e; }
    let r;
    try { r = startContainer(d, c, io); }
    catch (e) {
      if (e instanceof DockerError) { io.err(`docker: Error response from daemon: ${e.message}.\n`); if (c.autoRemove) removeContainer(d, c); return c.exitCode === 127 ? 127 : 125; }
      throw e;
    }
    if (o.detach) {
      io.out(c.id + '\n');
      if (c.status === 'exited' && c.autoRemove) removeContainer(d, c);
      return 0;
    }
    if (r.note) io.err(r.note);
    io.out(c.logs);
    if (c.status === 'running' && c.server) io.err(`(simulator: in real Docker this container would keep streaming logs in your terminal until you press Ctrl+C. Here it keeps running in the background — next time use -d. Stop it with: docker stop ${c.name})\n`);
    const code = c.status === 'exited' ? c.exitCode : 0;
    if (c.status === 'exited' && c.autoRemove) removeContainer(d, c);
    return code;
  }
  function psCmd(d, args, io) {
    const { o } = parseOpts(args, { bool: { '-a': 'all', '--all': 'all', '-q': 'quiet', '--quiet': 'quiet', '--no-trunc': 'notrunc', '-l': 'latest', '--latest': 'latest', '-s': 'size' }, val: { '--format': 'format', '-f': 'filter', '--filter': 'filter', '-n': 'last' }, multi: new Set(['filter']) });
    let list = d.containers.filter(c => o.all || c.status === 'running');
    for (const f of o.filter || []) {
      const [k, v] = f.split('=');
      if (k === 'status') list = d.containers.filter(c => c.status === v).filter(c => o.all || v !== 'running' || c.status === 'running');
      else if (k === 'name') list = list.filter(c => c.name.includes(v));
      else if (k === 'ancestor') list = list.filter(c => c.image === v || parseRef(c.image).full === parseRef(v).full);
      else if (k === 'label') list = list.filter(c => v.includes('=') ? c.labels[v.split('=')[0]] === v.split('=')[1] : v in c.labels);
      else if (k === 'exited') list = d.containers.filter(c => c.status === 'exited' && String(c.exitCode) === v);
    }
    if (o.latest) list = list.slice(-1);
    list = list.slice().reverse();
    if (o.quiet) { io.out(list.map(c => short(c.id)).join('\n') + (list.length ? '\n' : '')); return 0; }
    const row = c => ({ ID: o.notrunc ? c.id : short(c.id), Image: c.image, Command: commandText(c), CreatedAt: '2026-10-22 12:00:00 +0000 UTC', RunningFor: '5 seconds ago', Status: statusText(c), State: c.status, Ports: portsText(c), Names: c.name, Networks: c.networks.join(','), Mounts: c.mounts.map(m => m.name || m.source).join(','), Labels: Object.entries(c.labels).map(([k, v]) => `${k}=${v}`).join(',') });
    if (o.format) {
      let f = o.format;
      const isTable = /^table\s/.test(f);
      if (isTable) f = f.replace(/^table\s+/, '');
      const body = list.map(c => goTemplate(f, row(c)));
      if (isTable) {
        const hdr = goTemplate(f, { ID: 'CONTAINER ID', Image: 'IMAGE', Command: 'COMMAND', CreatedAt: 'CREATED AT', RunningFor: 'CREATED', Status: 'STATUS', State: 'STATE', Ports: 'PORTS', Names: 'NAMES', Networks: 'NETWORKS', Mounts: 'MOUNTS', Labels: 'LABELS' });
        const rows = [hdr].concat(body).map(l => l.split('\t'));
        const w = rows[0].map((_, i) => Math.max(...rows.map(r => (r[i] || '').length)));
        io.out(rows.map(r => r.map((v, i) => i === r.length - 1 ? v : v.padEnd(w[i] + 3)).join('').replace(/\s+$/, '')).join('\n') + '\n');
      } else io.out(body.join('\n') + (body.length ? '\n' : ''));
      return 0;
    }
    io.out(table(list.map(c => { const r = row(c); return [r.ID, r.Image, r.Command, r.RunningFor, r.Status, r.Ports, r.Names]; }), ['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES']));
    return 0;
  }
  function imagesCmd(d, args, io) {
    const { o, pos } = parseOpts(args, { bool: { '-a': 'all', '--all': 'all', '-q': 'quiet', '--quiet': 'quiet', '--no-trunc': 'notrunc', '--digests': 'digests' }, val: { '--format': 'format', '-f': 'filter', '--filter': 'filter' }, multi: new Set(['filter']) });
    let rows = [];
    for (const i of d.images.slice().reverse()) {
      const tags = i.tags.length ? i.tags : ['<none>:<none>'];
      for (const t of tags) { const k = t.lastIndexOf(':'); rows.push({ Repository: t.slice(0, k), Tag: t.slice(k + 1), ID: o.notrunc ? 'sha256:' + i.id : short(i.id), CreatedSince: i.created === 'base' ? '2 weeks ago' : '5 seconds ago', Size: hsize(d.imageSize(i)), img: i }); }
    }
    if (pos[0]) { const r = parseRef(pos[0]); rows = rows.filter(x => x.Repository === r.repo && (!r.explicit || x.Tag === r.tag)); }
    for (const f of o.filter || []) { if (f === 'dangling=true') rows = rows.filter(x => x.Repository === '<none>'); if (f === 'dangling=false') rows = rows.filter(x => x.Repository !== '<none>'); if (f.startsWith('reference=')) { const pat = f.slice(10); rows = rows.filter(x => MB.globMatch(pat, x.Repository) || MB.globMatch(pat, x.Repository + ':' + x.Tag)); } }
    if (o.quiet) { io.out([...new Set(rows.map(r => r.ID))].join('\n') + (rows.length ? '\n' : '')); return 0; }
    if (o.format) { const f = o.format.replace(/^table\s+/, ''); io.out(rows.map(r => goTemplate(f, r)).join('\n') + (rows.length ? '\n' : '')); return 0; }
    io.out(table(rows.map(r => [r.Repository, r.Tag, r.ID, r.CreatedSince, r.Size]), ['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']));
    return 0;
  }
  function rmiCmd(d, args, io) {
    const { o, pos } = parseOpts(args, { bool: { '-f': 'force', '--force': 'force' }, val: {} });
    if (!pos.length) throw new DockerError('"docker rmi" requires at least 1 argument.');
    let st = 0;
    for (const ref of pos) {
      const i = d.image(ref);
      if (!i) { io.err(`Error response from daemon: No such image: ${ref}\n`); st = 1; continue; }
      const full = /^[0-9a-f]+$/.test(ref) ? null : parseRef(ref).full;
      const user = d.inUse(i);
      if (user && !o.force && (!full || i.tags.length <= 1)) { io.err(`Error response from daemon: conflict: unable to ${full ? `remove repository reference "${ref}"` : `delete ${short(i.id)}`} (must force) - container ${short(user.id)} is using its referenced image ${short(i.id)}\n`); st = 1; continue; }
      if (full && i.tags.length > 1) { i.tags = i.tags.filter(t => t !== full); io.out(`Untagged: ${full}\n`); continue; }
      for (const t of i.tags) io.out(`Untagged: ${t}\n`);
      io.out(`Deleted: sha256:${i.id}\n`);
      d.images = d.images.filter(x => x !== i);
    }
    return st;
  }
  function needContainer(d, ref) { const c = d.container(ref); if (!c) throw new DockerError(`No such container: ${ref}`); return c; }
  function logsCmd(d, args, io) {
    const { o, pos } = parseOpts(args, { bool: { '-f': 'follow', '--follow': 'follow', '-t': 'ts', '--timestamps': 'ts' }, val: { '-n': 'tail', '--tail': 'tail', '--since': 'since' } });
    const c = needContainer(d, pos[0]);
    let text = c.logs;
    if (o.tail !== undefined && o.tail !== 'all') { const ls = text.replace(/\n$/, '').split('\n'); text = ls.slice(-parseInt(o.tail, 10)).join('\n') + (ls.length ? '\n' : ''); if (parseInt(o.tail, 10) === 0) text = ''; }
    io.out(text);
    return 0;
  }
  function execCmd(d, args, io, sh) {
    const { o, pos } = parseOpts(args, { bool: { '-i': 'i', '-t': 't', '-d': 'd', '--interactive': 'i', '--tty': 't', '--detach': 'd' }, val: { '-e': 'env', '--env': 'env', '-w': 'workdir', '--workdir': 'workdir', '-u': 'user', '--user': 'user' }, multi: new Set(['env']), stop: true });
    if (pos.length < 2) throw new DockerError('"docker exec" requires at least 2 arguments.');
    const c = needContainer(d, pos[0]);
    if (c.status !== 'running') throw new DockerError(`container ${c.id} is not running`);
    const save = { workdir: c.workdir, user: c.user };
    if (o.workdir) c.workdir = o.workdir;
    if (o.user) c.user = o.user;
    const csh = containerShell(d, c, o.env);
    c.workdir = save.workdir; c.user = save.user;
    const argv = pos.slice(1);
    const name = argv[0].split('/').pop();
    if ((name === 'sh' || name === 'bash' || name === 'ash') && argv.length === 1) {
      io.err(`(simulator: interactive shells aren't available. Run a single command instead, e.g. docker exec ${c.name} ls /)\n`);
      return 0;
    }
    if ((name === 'sh' || name === 'bash') && argv[1] === '-c') {
      const r = csh.run(argv.slice(2).join(' '), { tty: false });
      for (const ch of r.output) (ch.stream === 'err' ? io.err : io.out)(ch.s);
      return r.status;
    }
    if (!csh.commandExists(argv[0])) { io.err(`OCI runtime exec failed: exec failed: unable to start container process: exec: "${argv[0]}": executable file not found in $PATH: unknown\n`); return 127; }
    const r = csh.invoke(argv, Object.assign({}, io, { stdin: io.stdin }));
    void sh;
    return typeof r === 'number' ? r : 0;
  }
  function stopCmd(d, args, io, verb) {
    const { pos } = parseOpts(args, { bool: {}, val: { '-t': 'time', '--time': 'time', '-s': 'signal', '--signal': 'signal' } });
    if (!pos.length) throw new DockerError(`"docker ${verb}" requires at least 1 argument.`);
    let st = 0;
    for (const ref of pos) {
      const c = d.container(ref);
      if (!c) { io.err(`Error response from daemon: No such container: ${ref}\n`); st = 1; continue; }
      if (verb === 'kill' && c.status !== 'running') { io.err(`Error response from daemon: cannot kill container: ${ref}: container ${c.id} is not running\n`); st = 1; continue; }
      if (c.status === 'running') { c.status = 'exited'; c.exitCode = verb === 'kill' ? 137 : (c.server && c.server.kind === 'spring' ? 143 : 0); c.server = null; c.health = null; }
      io.out(ref + '\n');
      if (c.autoRemove) removeContainer(d, c);
    }
    return st;
  }
  function startCmd(d, args, io) {
    const { o, pos } = parseOpts(args, { bool: { '-a': 'attach', '--attach': 'attach', '-i': 'interactive' }, val: {} });
    let st = 0;
    for (const ref of pos) {
      const c = d.container(ref);
      if (!c) { io.err(`Error response from daemon: No such container: ${ref}\n`); st = 1; continue; }
      if (c.status !== 'running') {
        try { startContainer(d, c, io); }
        catch (e) { if (e instanceof DockerError) { io.err(`Error response from daemon: ${e.message}\nError: failed to start containers: ${ref}\n`); st = 1; continue; } throw e; }
      }
      if (o.attach) io.out(c.logs); else io.out(ref + '\n');
    }
    return st;
  }
  function rmCmd(d, args, io) {
    const { o, pos } = parseOpts(args, { bool: { '-f': 'force', '--force': 'force', '-v': 'volumes', '--volumes': 'volumes' }, val: {} });
    if (!pos.length) throw new DockerError('"docker rm" requires at least 1 argument.');
    let st = 0;
    for (const ref of pos) {
      const c = d.container(ref);
      if (!c) { io.err(`Error response from daemon: No such container: ${ref}\n`); st = 1; continue; }
      if (c.status === 'running' && !o.force) { io.err(`Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove\n`); st = 1; continue; }
      removeContainer(d, c);
      if (o.volumes) for (const m of c.mounts) if (m.type === 'volume') { const v = d.volumes.get(m.source); if (v && v.anonymous) d.volumes.delete(m.source); }
      io.out(ref + '\n');
    }
    return st;
  }
  function inspectCmd(d, args, io, forceKind) {
    const { o, pos } = parseOpts(args, { bool: { '-s': 'size' }, val: { '-f': 'format', '--format': 'format', '--type': 'type' } });
    if (!pos.length) throw new DockerError('"docker inspect" requires at least 1 argument.');
    const objs = [];
    let st = 0;
    for (const ref of pos) {
      let obj = null;
      const kind = forceKind || o.type;
      if (kind !== 'image') { const c = d.container(ref); if (c) obj = inspectContainer(c); }
      if (!obj && kind !== 'container' && kind !== 'volume' && kind !== 'network') { const i = d.image(ref); if (i) obj = inspectImage(d, i); }
      if (!obj && (kind === 'volume' || !kind)) { const v = d.volumes.get(ref); if (v) obj = { Name: v.name, Driver: 'local', Mountpoint: `/var/lib/docker/volumes/${v.name}/_data`, Labels: v.labels || {}, Scope: 'local' }; }
      if (!obj && (kind === 'network' || !kind)) { const n = d.network(ref); if (n) obj = { Name: n.name, Id: n.id, Driver: n.driver, Scope: 'local', IPAM: { Config: n.subnet ? [{ Subnet: n.subnet + '.0/16', Gateway: n.subnet + '.1' }] : [] }, Containers: Object.fromEntries(d.containers.filter(c => c.networks.includes(n.name)).map(c => [c.id, { Name: c.name, IPv4Address: (c.ips[n.name] || '') + '/16' }])) }; }
      if (!obj) { io.err(`Error: No such object: ${ref}\n`); st = 1; continue; }
      objs.push(obj);
    }
    if (o.format) for (const obj of objs) io.out(goTemplate(o.format, obj) + '\n');
    else if (objs.length) io.out(JSON.stringify(objs, null, 4) + '\n');
    return st;
  }
  function volumeCmd(d, args, io) {
    const sub = args[0], rest = args.slice(1);
    switch (sub) {
      case 'create': { const { pos, o } = parseOpts(rest, { bool: {}, val: { '--label': 'label', '-d': 'driver', '--driver': 'driver' }, multi: new Set(['label']) }); const name = pos[0] || digest('vol' + (++d.counter)); if (!d.volumes.has(name)) d.volumes.set(name, { name, node: MB.mkDir(Date.now()), labels: Object.fromEntries((o.label || []).map(l => l.split('='))) }); io.out(name + '\n'); return 0; }
      case 'ls': case 'list': {
        const { o } = parseOpts(rest, { bool: { '-q': 'quiet', '--quiet': 'quiet' }, val: { '--format': 'format', '-f': 'filter', '--filter': 'filter' } });
        let vols = [...d.volumes.values()];
        if (o.filter === 'dangling=true') vols = vols.filter(v => !d.containers.some(c => c.mounts.some(m => m.source === v.name)));
        if (o.quiet) { io.out(vols.map(v => v.name).join('\n') + (vols.length ? '\n' : '')); return 0; }
        if (o.format) { io.out(vols.map(v => goTemplate(o.format, { Name: v.name, Driver: 'local' })).join('\n') + (vols.length ? '\n' : '')); return 0; }
        io.out(table(vols.map(v => ['local', v.name]), ['DRIVER', 'VOLUME NAME']));
        return 0;
      }
      case 'rm': case 'remove': {
        let st = 0;
        for (const n of rest.filter(x => !x.startsWith('-'))) {
          if (!d.volumes.has(n)) { io.err(`Error response from daemon: get ${n}: no such volume\n`); st = 1; continue; }
          const user = d.containers.find(c => c.mounts.some(m => m.source === n));
          if (user && !rest.includes('-f')) { io.err(`Error response from daemon: remove ${n}: volume is in use - [${user.id}]\n`); st = 1; continue; }
          d.volumes.delete(n); io.out(n + '\n');
        }
        return st;
      }
      case 'inspect': return inspectCmd(d, rest, io, 'volume');
      case 'prune': {
        const all = rest.includes('-a') || rest.includes('--all');
        const gone = [...d.volumes.values()].filter(v => (all || v.anonymous) && !d.containers.some(c => c.mounts.some(m => m.source === v.name)));
        for (const v of gone) d.volumes.delete(v.name);
        io.out((gone.length ? 'Deleted Volumes:\n' + gone.map(v => v.name).join('\n') + '\n\n' : '') + `Total reclaimed space: ${hsize(gone.reduce((a, v) => a + fsSize(v.node), 0))}\n`);
        return 0;
      }
    }
    io.err(`docker: '${sub}' is not a docker volume command.\nUsage:  docker volume COMMAND\n\nCommands:\n  create, inspect, ls, prune, rm\n`);
    return 1;
  }
  function networkCmd(d, args, io) {
    const sub = args[0], rest = args.slice(1);
    switch (sub) {
      case 'create': {
        const { pos } = parseOpts(rest, { bool: { '--internal': 'internal', '--attachable': 'att' }, val: { '-d': 'driver', '--driver': 'driver', '--subnet': 'subnet' } });
        const name = pos[0];
        if (!name) throw new DockerError('"docker network create" requires exactly 1 argument.');
        if (d.network(name) && d.network(name).name === name) throw new DockerError(`network with name ${name} already exists`);
        const n = { id: d.nextId('net'), name, driver: 'bridge', subnet: `172.${d.netCount++}.0`, n: 1 };
        d.networks.push(n);
        io.out(n.id + '\n');
        return 0;
      }
      case 'ls': case 'list': {
        const { o } = parseOpts(rest, { bool: { '-q': 'quiet', '--quiet': 'quiet' }, val: { '--format': 'format', '-f': 'filter', '--filter': 'filter' } });
        if (o.quiet) { io.out(d.networks.map(n => short(n.id)).join('\n') + '\n'); return 0; }
        if (o.format) { io.out(d.networks.map(n => goTemplate(o.format, { ID: short(n.id), Name: n.name, Driver: n.driver, Scope: 'local' })).join('\n') + '\n'); return 0; }
        io.out(table(d.networks.map(n => [short(n.id), n.name, n.driver, 'local']), ['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE']));
        return 0;
      }
      case 'rm': case 'remove': {
        let st = 0;
        for (const name of rest) {
          const n = d.network(name);
          if (!n) { io.err(`Error response from daemon: network ${name} not found\n`); st = 1; continue; }
          if (n.builtin) { io.err(`Error response from daemon: ${n.name} is a pre-defined network and cannot be removed\n`); st = 1; continue; }
          const user = d.containers.find(c => c.networks.includes(n.name));
          if (user) { io.err(`Error response from daemon: error while removing network: network ${n.name} id ${n.id} has active endpoints\n`); st = 1; continue; }
          d.networks = d.networks.filter(x => x !== n); io.out(name + '\n');
        }
        return st;
      }
      case 'connect': case 'disconnect': {
        const pos = rest.filter(x => !x.startsWith('-'));
        const n = d.network(pos[0]); const c = d.container(pos[1]);
        if (!n) throw new DockerError(`network ${pos[0]} not found`);
        if (!c) throw new DockerError(`No such container: ${pos[1]}`);
        if (sub === 'connect') joinNetwork(c, n); else c.networks = c.networks.filter(x => x !== n.name);
        return 0;
      }
      case 'inspect': return inspectCmd(d, rest, io, 'network');
      case 'prune': { const gone = d.networks.filter(n => !n.builtin && !d.containers.some(c => c.networks.includes(n.name))); d.networks = d.networks.filter(n => !gone.includes(n)); io.out(gone.length ? 'Deleted Networks:\n' + gone.map(n => n.name).join('\n') + '\n' : ''); return 0; }
    }
    io.err(`docker: '${sub}' is not a docker network command.\n`);
    return 1;
  }
  function buildCmd(d, args, io, sh) {
    const { o, pos } = parseOpts(args, { bool: { '--no-cache': 'noCache', '-q': 'quiet', '--quiet': 'quiet', '--pull': 'pull', '--load': 'load', '--push': 'push' }, val: { '-t': 'tag', '--tag': 'tag', '-f': 'file', '--file': 'file', '--build-arg': 'buildArg', '--target': 'target', '--platform': 'platform', '--progress': 'progress', '--label': 'label' }, multi: new Set(['tag', 'buildArg', 'label']) });
    if (!pos.length) throw new DockerError('"docker buildx build" requires exactly 1 argument.\nSee \'docker build --help\'.\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -');
    const buildArgs = {};
    for (const b of o.buildArg || []) { const k = b.indexOf('='); if (k > 0) buildArgs[b.slice(0, k)] = b.slice(k + 1); else buildArgs[b] = sh.getVar(b) || ''; }
    for (const t of o.tag || []) if (/[A-Z]/.test(parseRef(t).repo)) throw new DockerError(`invalid tag "${t}": repository name must be lowercase`);
    try {
      buildImage(d, sh, { context: pos[0], file: o.file, tags: o.tag || [], buildArgs, target: o.target, noCache: o.noCache, quiet: o.quiet }, io.out);
    } catch (e) {
      if (e instanceof DockerError) { io.err(`ERROR: ${e.message.replace(/^ERROR: /, '')}\n`); return 1; }
      throw e;
    }
    return 0;
  }
  function historyCmd(d, args, io) {
    const { o, pos } = parseOpts(args, { bool: { '-q': 'quiet', '--no-trunc': 'notrunc', '-H': 'human' }, val: { '--format': 'format' } });
    const i = d.image(pos[0]);
    if (!i) throw new DockerError(`No such image: ${pos[0]}`);
    const rows = i.layers.slice().reverse().map((l, k) => ({ ID: k === 0 ? short(i.id) : '<missing>', CreatedSince: i.created === 'base' || k >= i.layers.length - 1 ? '2 weeks ago' : '5 seconds ago', CreatedBy: o.notrunc ? l.createdBy : (l.createdBy.length > 45 ? l.createdBy.slice(0, 44) + '…' : l.createdBy), Size: hsize(l.size), Comment: l.createdBy.includes('buildkit') ? 'buildkit.dockerfile.v0' : '' }));
    if (o.format) { io.out(rows.map(r => goTemplate(o.format, r)).join('\n') + '\n'); return 0; }
    io.out(table(rows.map(r => [r.ID, r.CreatedSince, r.CreatedBy, r.Size, r.Comment]), ['IMAGE', 'CREATED', 'CREATED BY', 'SIZE', 'COMMENT']));
    return 0;
  }
  function pruneCmd(d, kind, args, io) {
    const all = args.includes('-a') || args.includes('--all');
    let reclaimed = 0;
    const out = [];
    if (kind === 'container' || kind === 'system') {
      const gone = d.containers.filter(c => c.status !== 'running');
      for (const c of gone) removeContainer(d, c);
      if (gone.length) out.push('Deleted Containers:\n' + gone.map(c => c.id).join('\n') + '\n');
    }
    if (kind === 'image' || kind === 'system') {
      const gone = d.images.filter(i => (all ? true : !i.tags.length) && !d.inUse(i));
      for (const i of gone) reclaimed += d.imageSize(i);
      d.images = d.images.filter(i => !gone.includes(i));
      if (gone.length) out.push('Deleted Images:\n' + gone.map(i => (i.tags.length ? i.tags.map(t => 'untagged: ' + t + '\n').join('') : '') + 'deleted: sha256:' + i.id).join('\n') + '\n');
    }
    if (kind === 'system') { const gone = d.networks.filter(n => !n.builtin && !d.containers.some(c => c.networks.includes(n.name))); d.networks = d.networks.filter(n => !gone.includes(n)); if (gone.length) out.push('Deleted Networks:\n' + gone.map(n => n.name).join('\n') + '\n'); }
    if (kind === 'system' && all) d.cache.clear();
    io.out(out.join('\n') + `Total reclaimed space: ${hsize(reclaimed)}\n`);
    return 0;
  }
  function cpCmd(d, args, io, sh) {
    const pos = args.filter(a => !a.startsWith('-'));
    if (pos.length !== 2) throw new DockerError('"docker cp" requires exactly 2 arguments.');
    const [a, b] = pos;
    const split = s => { const m = /^([\w.-]+):(.*)$/.exec(s); return m && d.container(m[1]) ? { c: d.container(m[1]), p: m[2] } : null; };
    const sa = split(a), sb = split(b);
    if (sa && !sb) {
      const n = sa.c.fs.get(VFS.norm(sa.p, sa.c.workdir || '/'));
      if (!n) throw new DockerError(`Could not find the file ${sa.p} in container ${sa.c.name}`);
      const dest = sh.abs(b);
      const dn = sh.fs.get(dest);
      const target = dn && dn.type === 'dir' ? dest + '/' + sa.p.split('/').pop() : dest;
      sh.fs.mkdirp(target.replace(/\/[^/]*$/, '') || '/', Date.now());
      sh.fs.parentDir(target).children[target.split('/').pop()] = copyNode(n);
      io.out(`Successfully copied ${hsize(fsSize(n))} to ${b}\n`);
      return 0;
    }
    if (sb && !sa) {
      const n = sh.fs.get(sh.abs(a));
      if (!n) throw new DockerError(`stat ${sh.abs(a)}: no such file or directory`);
      const destAbs = VFS.norm(sb.p, sb.c.workdir || '/');
      const dn = sb.c.fs.get(destAbs);
      const target = dn && dn.type === 'dir' ? destAbs + '/' + sh.abs(a).split('/').pop() : destAbs;
      mkdirp(sb.c.fs, target.replace(/\/[^/]*$/, '') || '/');
      sb.c.fs.parentDir(target).children[target.split('/').pop()] = copyNode(n);
      io.out(`Successfully copied ${hsize(fsSize(n))} to ${sb.c.name}:${sb.p}\n`);
      return 0;
    }
    throw new DockerError('copying between containers is not supported');
  }
  function portCmd(d, args, io) {
    const c = needContainer(d, args[0]);
    for (const p of c.ports) if (!args[1] || String(p.container) === args[1].split('/')[0]) io.out(`${p.container}/${p.proto || 'tcp'} -> ${p.hostIp || '0.0.0.0'}:${p.host}\n`);
    return 0;
  }
  function tagCmd(d, args, io) {
    if (args.length !== 2) throw new DockerError('"docker tag" requires exactly 2 arguments.');
    const i = d.image(args[0]);
    if (!i) throw new DockerError(`No such image: ${args[0]}`);
    d.tagImage(i, parseRef(args[1]).full);
    void io;
    return 0;
  }
  function pushCmd(d, args, io) {
    const ref = args.filter(a => !a.startsWith('-'))[0];
    const i = d.image(ref);
    if (!i) throw new DockerError(`An image does not exist locally with the tag: ${ref}`);
    const r = parseRef(ref);
    if (!r.repo.includes('/')) { io.out(`The push refers to repository [docker.io/library/${r.repo}]\n`); io.err('denied: requested access to the resource is denied\n'); return 1; }
    if (!d.loggedIn) { io.out(`The push refers to repository [docker.io/${r.repo}]\n`); io.err('denied: requested access to the resource is denied (hint: docker login first)\n'); return 1; }
    d.registry.set(r.full, Object.assign({}, i, { fs: i.fs.clone(), tags: [] }));
    io.out(`The push refers to repository [docker.io/${r.repo}]\n` + i.layers.filter(l => l.size > 0).slice(-3).map(l => `${short(l.id)}: Pushed`).join('\n') + `\n${r.tag}: digest: sha256:${digest('push' + i.id)} size: 1784\n`);
    return 0;
  }
  function topCmd(d, args, io) {
    const c = needContainer(d, args[0]);
    if (c.status !== 'running') throw new DockerError(`container ${c.id} is not running`);
    io.out(`UID      PID    PPID   C   STIME   TTY   TIME       CMD\nroot     4242   4221   0   12:00   ?     00:00:00   ${(c.entrypoint || []).concat(c.cmd || []).join(' ')}\n`);
    return 0;
  }
  function statsCmd(d, args, io) {
    const list = d.containers.filter(c => c.status === 'running');
    io.out(table(list.map((c, i) => [short(c.id), c.name, (0.1 * (i + 1)).toFixed(2) + '%', `${(12 + i * 7.5).toFixed(1)}MiB / 7.66GiB`, ((12 + i * 7.5) / 78.4).toFixed(2) + '%', '1.2kB / 0B', '0B / 0B', '3']), ['CONTAINER ID', 'NAME', 'CPU %', 'MEM USAGE / LIMIT', 'MEM %', 'NET I/O', 'BLOCK I/O', 'PIDS']));
    void args;
    return 0;
  }

  // ------------------------------------------------------------- compose
  function composeFile(sh, file) {
    const names = file ? [file] : ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];
    for (const n of names) { const c = sh.readFile(n); if (c !== null) return { name: n, text: c }; }
    return null;
  }
  function interpolate(text, vars) {
    return text.replace(/\$\{(\w+)(?::?-([^}]*))?\}|\$(\w+)/g, (m, a, def, b) => { const k = a || b; const v = vars[k]; return v !== undefined && v !== '' ? v : (def !== undefined ? def : ''); });
  }
  function loadProject(sh, o) {
    const f = composeFile(sh, o.file);
    if (!f) throw new DockerError('no configuration file provided: not found');
    const dotenv = {};
    const envText = sh.readFile('.env');
    if (envText) for (const l of envText.split('\n')) { const m = /^\s*([\w.]+)\s*=\s*(.*)$/.exec(l); if (m && !l.trim().startsWith('#')) dotenv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); }
    const vars = Object.assign({}, dotenv, envObj(sh));
    let doc;
    try { doc = parseYAML(interpolate(f.text, vars)); }
    catch (e) { throw new DockerError(`${f.name}: ${e.message}`); }
    if (!doc || typeof doc !== 'object' || !doc.services || typeof doc.services !== 'object') throw new DockerError(`${f.name}: services must be a mapping (did you forget the top-level "services:" key?)`);
    const project = (o.project || doc.name || sh.cwd.split('/').pop() || 'project').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    for (const [name, s] of Object.entries(doc.services)) {
      if (!s || typeof s !== 'object') throw new DockerError(`service "${name}" has neither an image nor a build context specified: invalid compose project`);
      const allowed = ['image', 'build', 'ports', 'environment', 'env_file', 'depends_on', 'volumes', 'networks', 'command', 'entrypoint', 'restart', 'healthcheck', 'container_name', 'working_dir', 'user', 'expose', 'labels', 'deploy', 'profiles', 'stdin_open', 'tty', 'platform', 'hostname'];
      for (const k of Object.keys(s)) if (!allowed.includes(k)) throw new DockerError(`validating ${f.name}: services.${name} additional properties '${k}' not allowed`);
      if (!s.image && !s.build) throw new DockerError(`service "${name}" has neither an image nor a build context specified: invalid compose project`);
      if (s.ports && !Array.isArray(s.ports)) throw new DockerError(`services.${name}.ports must be a list`);
      const deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on || {});
      for (const dep of deps) if (!doc.services[dep]) throw new DockerError(`service "${name}" depends on undefined service "${dep}": invalid compose project`);
    }
    return { doc, project, vars };
  }
  function topo(services) {
    const order = [], seen = new Set(), visiting = new Set();
    const visit = (n) => {
      if (seen.has(n)) return;
      if (visiting.has(n)) throw new DockerError(`dependency cycle detected: ${n}`);
      visiting.add(n);
      const s = services[n];
      const deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on || {});
      for (const d of deps) visit(d);
      visiting.delete(n); seen.add(n); order.push(n);
    };
    Object.keys(services).forEach(visit);
    return order;
  }
  function composeCmd(d, args, io, sh) {
    const { o, pos } = parseOpts(args, { bool: {}, val: { '-f': 'file', '--file': 'file', '-p': 'project', '--project-name': 'project' }, stop: true });
    const sub = pos[0];
    const rest = pos.slice(1);
    if (!sub) { io.out('Usage:  docker compose [OPTIONS] COMMAND\n\nCommands:\n  build, config, down, exec, logs, ps, restart, start, stop, up\n'); return 0; }
    const { doc, project } = loadProject(sh, o);
    const services = doc.services;
    const netName = `${project}_default`;
    const cname = (svc) => services[svc].container_name || `${project}-${svc}-1`;
    const mine = () => d.containers.filter(c => c.compose && c.compose.project === project);
    const status = (verb, name, what) => `${what === 'Network' || what === 'Volume' ? ' ✔ ' + what + ' ' + name : ' ✔ Container ' + name}  ${verb}`;
    const imageFor = (svc) => services[svc].image || `${project}-${svc}`;
    const buildSvc = (svc, out) => {
      const b = services[svc].build;
      const ctx = typeof b === 'string' ? b : (b.context || '.');
      const dockerfile = typeof b === 'object' && b.dockerfile ? VFS.norm(b.dockerfile, sh.abs(ctx)) : undefined;
      const argsB = typeof b === 'object' && b.args ? (Array.isArray(b.args) ? Object.fromEntries(b.args.map(x => x.split('='))) : b.args) : {};
      buildImage(d, sh, { context: ctx, file: dockerfile, tags: [imageFor(svc)], buildArgs: argsB, target: typeof b === 'object' ? b.target : undefined }, out);
    };
    switch (sub) {
      case 'config': {
        io.out(`name: ${project}\nservices:\n` + Object.entries(services).map(([n, s]) => `  ${n}:\n` + Object.entries(s).map(([k, v]) => `    ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')).join('\n') + '\n');
        return 0;
      }
      case 'build': {
        for (const svc of Object.keys(services)) if (services[svc].build) buildSvc(svc, io.out);
        return 0;
      }
      case 'up': {
        const { o: uo, pos: only } = parseOpts(rest, { bool: { '-d': 'detach', '--detach': 'detach', '--build': 'build', '--force-recreate': 'recreate', '--remove-orphans': 'orph', '--wait': 'wait', '--no-build': 'nobuild' }, val: {} });
        const lines = [];
        const progress = [];
        let net = d.network(netName);
        if (!net || net.name !== netName) {
          net = { id: d.nextId('net'), name: netName, driver: 'bridge', subnet: `172.${d.netCount++}.0`, n: 1, compose: project };
          d.networks.push(net);
          progress.push(status('Created', netName, 'Network'));
        }
        for (const [vname] of Object.entries(doc.volumes || {})) {
          const full = `${project}_${vname}`;
          if (!d.volumes.has(full)) { d.volumes.set(full, { name: full, node: MB.mkDir(Date.now()), labels: { 'com.docker.compose.project': project } }); progress.push(status('Created', full, 'Volume')); }
        }
        const order = topo(services).filter(s => !only.length || only.includes(s) || only.some(x => { const deps = Array.isArray(services[x].depends_on) ? services[x].depends_on : Object.keys(services[x].depends_on || {}); return deps.includes(s); }));
        for (const svc of order) {
          const s = services[svc];
          const name = cname(svc);
          let c = d.container(name);
          if (c && (uo.recreate || uo.build)) { removeContainer(d, c); c = null; }
          if (c) {
            if (c.status !== 'running') { try { startContainer(d, c, io); progress.push(status('Started', name)); } catch (e) { if (e instanceof DockerError) { io.err(`Error response from daemon: ${e.message}\n`); return 1; } throw e; } }
            else progress.push(status('Running', name));
            continue;
          }
          let image;
          if (s.build && (uo.build || !d.image(imageFor(svc)))) {
            const out = t => lines.push(t);
            try { buildSvc(svc, out); } catch (e) { if (e instanceof DockerError) { io.out(lines.join('')); io.err(`failed to solve: ${e.message.replace(/^failed to solve: /, '')}\n`); return 1; } throw e; }
          }
          try {
            if (!s.build && !d.image(s.image)) { d.pull(s.image, () => {}, true); progress.unshift(` ✔ ${svc} Pulled`); }
            image = s.build ? d.image(imageFor(svc)) : d.image(s.image);
          }
          catch (e) { if (e instanceof DockerError) { io.err(`Error response from daemon: ${e.message}\n`); return 1; } throw e; }
          let env = [];
          if (s.env_file) for (const ef of [].concat(s.env_file)) { const c2 = sh.readFile(ef); if (c2 === null) { io.err(`env file ${sh.abs(ef)} not found: stat ${sh.abs(ef)}: no such file or directory\n`); return 1; } for (const l of c2.split('\n')) { const t = l.trim(); if (t && !t.startsWith('#')) env.push(t); } }
          if (Array.isArray(s.environment)) env = env.concat(s.environment.map(String));
          else if (s.environment) env = env.concat(Object.entries(s.environment).map(([k, v]) => `${k}=${v === null ? '' : v}`));
          const mounts = (s.volumes || []).map(v => {
            const m = typeof v === 'string' ? parseMount(v, sh) : { type: v.type || 'volume', source: v.type === 'bind' ? sh.abs(v.source) : v.source, destination: v.target, readonly: !!v.read_only };
            if (m.type === 'volume' && !m.anonymous) {
              if (!doc.volumes || !Object.prototype.hasOwnProperty.call(doc.volumes, m.source)) throw new DockerError(`service "${svc}" refers to undefined volume ${m.source}: invalid compose project`);
              m.source = `${project}_${m.source}`;
            }
            return m;
          });
          const extraNets = (Array.isArray(s.networks) ? s.networks : Object.keys(s.networks || {})).map(n => `${project}_${n}`);
          for (const n of extraNets) if (!d.network(n) || d.network(n).name !== n) { d.networks.push({ id: d.nextId('net'), name: n, driver: 'bridge', subnet: `172.${d.netCount++}.0`, n: 1, compose: project }); progress.push(status('Created', n, 'Network')); }
          const cmd = s.command === undefined ? undefined : (Array.isArray(s.command) ? s.command.map(String) : shellWords(String(s.command)));
          const entry = s.entrypoint === undefined ? undefined : (Array.isArray(s.entrypoint) ? s.entrypoint.map(String) : shellWords(String(s.entrypoint)));
          try {
            c = createContainer(d, {
              image, imageRef: s.image || imageFor(svc), name, cmd, env, ports: (s.ports || []).map(p => parsePort(String(p))), mounts, workdir: s.working_dir, user: s.user,
              networks: extraNets.length ? extraNets : [netName], entrypoint: entry, restart: s.restart, labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': svc }, hostSh: sh, aliases: [svc], compose: { project, service: svc }, tty: s.tty, interactive: s.stdin_open
            }, io);
            if (s.healthcheck && s.healthcheck.test) c.healthcheck = { Test: Array.isArray(s.healthcheck.test) ? s.healthcheck.test.map(String) : ['CMD-SHELL', String(s.healthcheck.test)] };
            progress.push(status('Created', name));
            startContainer(d, c, io);
            progress.push(status('Started', name));
          } catch (e) {
            if (e instanceof DockerError) { io.out(`[+] Running ${progress.length}/${progress.length + 1}\n${progress.join('\n')}\n`); io.err(`Error response from daemon: ${e.message}\n`); return 1; }
            throw e;
          }
        }
        // collapse Created+Started into the final state per container
        const finalLines = [];
        for (const l of progress) {
          const key = l.replace(/\s+(Created|Started|Running)$/, '');
          const idx = finalLines.findIndex(x => x.replace(/\s+(Created|Started|Running)$/, '') === key);
          if (idx >= 0) finalLines[idx] = l; else finalLines.push(l);
        }
        io.out(lines.join('') + `[+] Running ${finalLines.length}/${finalLines.length}\n` + finalLines.join('\n') + '\n');
        if (!uo.detach) {
          for (const svc of order) { const c = d.container(cname(svc)); if (c) io.out(c.logs.replace(/\n$/, '').split('\n').filter(Boolean).map(l => `${svc}-1  | ${l}`).join('\n') + (c.logs.trim() ? '\n' : '')); }
          if (order.some(svc => { const c = d.container(cname(svc)); return c && c.status === 'running'; })) io.err('(simulator: compose would keep streaming logs here until Ctrl+C; the services keep running in the background. Use -d next time.)\n');
        }
        return 0;
      }
      case 'down': {
        const vflag = rest.includes('-v') || rest.includes('--volumes');
        const rmi = rest.includes('--rmi');
        const out = [];
        for (const c of mine().slice().reverse()) {
          if (c.status === 'running') { c.status = 'exited'; c.exitCode = 0; c.server = null; }
          if (vflag) for (const m of c.mounts) { const v = d.volumes.get(m.source); if (v && v.anonymous) d.volumes.delete(m.source); }
          removeContainer(d, c);
          out.push(`${status('Removed', c.name)}`);
        }
        for (const n of d.networks.filter(n => n.compose === project)) { d.networks = d.networks.filter(x => x !== n); out.push(status('Removed', n.name, 'Network')); }
        if (vflag) for (const [k, v] of [...d.volumes]) if (k.startsWith(project + '_') || (v.labels && v.labels['com.docker.compose.project'] === project)) { d.volumes.delete(k); out.push(status('Removed', k, 'Volume')); }
        if (rmi) for (const svc of Object.keys(services)) if (services[svc].build) { const i = d.image(imageFor(svc)); if (i) d.images = d.images.filter(x => x !== i); }
        io.out(`[+] Running ${out.length}/${out.length}\n` + out.join('\n') + (out.length ? '\n' : ''));
        return 0;
      }
      case 'ps': {
        const { o: po } = parseOpts(rest, { bool: { '-a': 'all', '--all': 'all', '-q': 'quiet', '--services': 'services' }, val: { '--format': 'format' } });
        let list = mine().filter(c => po.all || c.status === 'running');
        list = list.sort((a, b) => a.compose.service.localeCompare(b.compose.service));
        if (po.services) { io.out(list.map(c => c.compose.service).join('\n') + (list.length ? '\n' : '')); return 0; }
        if (po.quiet) { io.out(list.map(c => short(c.id)).join('\n') + (list.length ? '\n' : '')); return 0; }
        const row = c => ({ Name: c.name, Image: c.image, Command: commandText(c), Service: c.compose.service, RunningFor: '5 seconds ago', Status: statusText(c), State: c.status, Ports: portsText(c) });
        if (po.format) { io.out(list.map(c => goTemplate(po.format.replace(/^table\s+/, ''), row(c))).join('\n') + (list.length ? '\n' : '')); return 0; }
        io.out(table(list.map(c => { const r = row(c); return [r.Name, r.Image, r.Command, r.Service, r.RunningFor, r.Status, r.Ports]; }), ['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS']));
        return 0;
      }
      case 'logs': {
        const svcs = rest.filter(x => !x.startsWith('-'));
        const list = mine().filter(c => !svcs.length || svcs.includes(c.compose.service)).sort((a, b) => a.compose.service.localeCompare(b.compose.service));
        const w = Math.max(0, ...list.map(c => c.name.length));
        for (const c of list) io.out(c.logs.replace(/\n$/, '').split('\n').filter(Boolean).map(l => `${c.name.padEnd(w)}  | ${l}`).join('\n') + (c.logs.trim() ? '\n' : ''));
        return 0;
      }
      case 'exec': {
        const ex = parseOpts(rest, { bool: { '-T': 'T', '-i': 'i', '-t': 't', '-d': 'd' }, val: { '-e': 'env', '-w': 'workdir', '-u': 'user' }, multi: new Set(['env']), stop: true });
        const svc = ex.pos[0];
        if (!services[svc]) throw new DockerError(`service "${svc}" is not running`);
        const c = d.container(cname(svc));
        if (!c || c.status !== 'running') throw new DockerError(`service "${svc}" is not running`);
        return execCmd(d, [c.name].concat(ex.pos.slice(1)), io, sh);
      }
      case 'stop': case 'start': case 'restart': {
        for (const c of mine()) {
          if (rest.length && !rest.includes(c.compose.service)) continue;
          if (sub !== 'start' && c.status === 'running') { c.status = 'exited'; c.exitCode = 0; c.server = null; }
          if (sub !== 'stop') startContainer(d, c, io);
          io.out(status(sub === 'stop' ? 'Stopped' : 'Started', c.name) + '\n');
        }
        return 0;
      }
    }
    io.err(`unknown docker command: "compose ${sub}"\n`);
    return 1;
  }

  function dockerCli(args, io, sh) {
    if (sh.container) { io.err('/bin/sh: docker: not found\n'); return 127; }
    const d = daemonOf(sh);
    let a = args.slice();
    // management-command aliases
    if (a[0] === 'container' && a[1]) { const map = { ls: 'ps', list: 'ps', prune: 'container-prune' }; a = [map[a[1]] || a[1]].concat(a.slice(2)); }
    else if (a[0] === 'image' && a[1]) { const map = { ls: 'images', list: 'images', rm: 'rmi', prune: 'image-prune', inspect: 'image-inspect', build: 'build', pull: 'pull', push: 'push', history: 'history', tag: 'tag' }; a = [map[a[1]] || a[1]].concat(a.slice(2)); }
    else if (a[0] === 'buildx' && a[1] === 'build') a = ['build'].concat(a.slice(2));
    else if (a[0] === 'system' && a[1] === 'prune') a = ['system-prune'].concat(a.slice(2));
    else if (a[0] === 'system' && a[1] === 'df') a = ['system-df'];
    const sub = a[0];
    const rest = a.slice(1);
    try {
      switch (sub) {
        case undefined: case '--help': case 'help':
          io.out('Usage:  docker [OPTIONS] COMMAND\n\nCommon Commands:\n  run         Create and run a new container from an image\n  exec        Execute a command in a running container\n  ps          List containers\n  build       Build an image from a Dockerfile\n  pull        Download an image from a registry\n  push        Upload an image to a registry\n  images      List images\n  login       Log in to a registry\n  version     Show the Docker version information\n\nManagement Commands:\n  compose     Docker Compose\n  container   Manage containers\n  image       Manage images\n  network     Manage networks\n  volume      Manage volumes\n  system      Manage Docker\n\nOther: logs, stop, start, restart, rm, rmi, inspect, cp, port, tag, history, top, stats, kill\n');
          return 0;
        case '--version': io.out('Docker version 27.3.1, build ce12230\n'); return 0;
        case 'version': io.out('Client:\n Version:           27.3.1\n API version:       1.47\n OS/Arch:           linux/amd64\n\nServer: Docker Engine - Community (simulated)\n Engine:\n  Version:          27.3.1\n  API version:      1.47 (minimum version 1.24)\n'); return 0;
        case 'info': io.out(`Client: Docker Engine - Community\n Version:    27.3.1\n\nServer:\n Containers: ${d.containers.length}\n  Running: ${d.containers.filter(c => c.status === 'running').length}\n  Stopped: ${d.containers.filter(c => c.status !== 'running').length}\n Images: ${d.images.length}\n Server Version: 27.3.1\n Storage Driver: overlay2\n Default Runtime: runc\n Operating System: minibash simulated engine\n`); return 0;
        case 'run': return dockerRun(d, rest, io, sh);
        case 'create': {
          const { o, pos } = parseOpts(rest, RUN_SPEC);
          const c = createContainer(d, runOptsToCreate(d, o, pos, sh, io), io);
          io.out(c.id + '\n');
          return 0;
        }
        case 'ps': return psCmd(d, rest, io);
        case 'images': return imagesCmd(d, rest, io);
        case 'pull': {
          const { pos } = parseOpts(rest, { bool: { '-q': 'quiet', '-a': 'all' }, val: { '--platform': 'platform' } });
          if (!pos[0]) throw new DockerError('"docker pull" requires exactly 1 argument.');
          d.pull(pos[0], io.out);
          return 0;
        }
        case 'build': return buildCmd(d, rest, io, sh);
        case 'rmi': return rmiCmd(d, rest, io);
        case 'tag': return tagCmd(d, rest, io);
        case 'history': return historyCmd(d, rest, io);
        case 'logs': return logsCmd(d, rest, io);
        case 'exec': return execCmd(d, rest, io, sh);
        case 'stop': return stopCmd(d, rest, io, 'stop');
        case 'kill': return stopCmd(d, rest, io, 'kill');
        case 'start': return startCmd(d, rest, io);
        case 'restart': { stopCmd(d, rest, cap(), 'stop'); return startCmd(d, rest, io); }
        case 'rm': return rmCmd(d, rest, io);
        case 'inspect': return inspectCmd(d, rest, io);
        case 'image-inspect': return inspectCmd(d, rest, io, 'image');
        case 'volume': return volumeCmd(d, rest, io);
        case 'network': return networkCmd(d, rest, io);
        case 'compose': return composeCmd(d, rest, io, sh);
        case 'cp': return cpCmd(d, rest, io, sh);
        case 'port': return portCmd(d, rest, io);
        case 'top': return topCmd(d, rest, io);
        case 'stats': return statsCmd(d, rest, io);
        case 'push': return pushCmd(d, rest, io);
        case 'login': d.loggedIn = true; io.out('Login Succeeded\n'); return 0;
        case 'logout': d.loggedIn = false; io.out('Removing login credentials for https://index.docker.io/v1/\n'); return 0;
        case 'search': { const q = rest[0] || ''; const hits = Object.keys(CATALOG).filter(k => k.includes(q)); io.out(table(hits.map(h => [h, `Official image for ${h}`, '10000', '[OK]']), ['NAME', 'DESCRIPTION', 'STARS', 'OFFICIAL'])); return 0; }
        case 'container-prune': return pruneCmd(d, 'container', rest, io);
        case 'image-prune': return pruneCmd(d, 'image', rest, io);
        case 'system-prune': return pruneCmd(d, 'system', rest, io);
        case 'system-df': {
          const imgSize = d.images.reduce((x, i) => x + d.imageSize(i), 0);
          io.out(table([['Images', d.images.length, d.images.filter(i => d.inUse(i)).length, hsize(imgSize), hsize(imgSize * 0.3)], ['Containers', d.containers.length, d.containers.filter(c => c.status === 'running').length, '0B', '0B'], ['Local Volumes', d.volumes.size, [...d.volumes.keys()].filter(k => d.containers.some(c => c.mounts.some(m => m.source === k))).length, hsize([...d.volumes.values()].reduce((x, v) => x + fsSize(v.node), 0)), '0B'], ['Build Cache', d.cache.size, 0, '0B', '0B']], ['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE']));
          return 0;
        }
        case 'rename': { const c = needContainer(d, rest[0]); if (d.container(rest[1])) throw new DockerError(`Conflict. The container name "/${rest[1]}" is already in use`); c.name = rest[1]; return 0; }
      }
      io.err(`docker: '${sub}' is not a docker command.\nSee 'docker --help'\n`);
      return 1;
    } catch (e) {
      if (e instanceof DockerError) { io.err(/^("docker|unknown|flag|no configuration|yaml|service "|validating|dependency|compose\.|docker-compose|[\w.-]+\.ya?ml:)/.test(e.message) ? e.message + '\n' : `Error response from daemon: ${e.message}\n`); return 1; }
      throw e;
    }
  }

  // ------------------------------------------------------- command tables
  const CONTAINER_CMDS = {
    'apt-get': aptCmd, apt: aptCmd, apk: apkCmd, pip: pipCmd, pip3: pipCmd, npm: npmCmd,
    python: (a, io, sh) => { const r = pythonCmd(a, io, sh); return typeof r === 'number' ? r : (io.out(r.log || uvicornLog(r.server.host, r.server.port)), 0); },
    python3: (a, io, sh) => { const r = pythonCmd(a, io, sh); return typeof r === 'number' ? r : (io.out(r.log || uvicornLog(r.server.host, r.server.port)), 0); },
    java: (a, io, sh) => { const r = javaCmd(a, io, sh); return typeof r === 'number' ? r : (io.out(springStartLog(r.server.port, r.manifest.artifact, r.server.profile)), 0); },
    mvn: mvnCmd, curl: curlCmd,
    './mvnw': (a, io, sh) => { if (!sh.fs.get(sh.abs('mvnw'))) { io.err('/bin/sh: ./mvnw: not found\n'); return 127; } if (!has(sh, '/opt/java/openjdk/bin/java')) { io.err('Error: JAVA_HOME is not defined correctly.\n  We cannot execute java\n'); return 1; } return mvnCmd(a, io, sh, true); },
    fastapi: (a, io, sh) => { const r = uvicornCmd(a, io, sh, true); return typeof r === 'number' ? r : (io.out(uvicornLog(r.server.host, r.server.port)), 0); }, 'redis-cli': redisCli, psql: psqlCmd,
    uvicorn: (a, io, sh) => { const r = uvicornCmd(a, io, sh); return typeof r === 'number' ? r : (io.out(uvicornLog(r.server.host, r.server.port)), 0); },
    useradd: userAdd, adduser: (a, io, sh) => userAdd(a.filter(x => !/^-[DSh]$/.test(x)), io, sh), addgroup: () => 0, groupadd: () => 0, chown: () => 0,
    nginx: (a, io, sh) => { if (!has(sh, '/usr/sbin/nginx')) return missing(io, 'nginx'); if (a[0] === '-v') { io.err('nginx version: nginx/1.27.2\n'); return 0; } if (a[0] === '-t') { io.err('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n'); return 0; } return 0; },
    node: (a, io, sh) => { if (!has(sh, '/usr/local/bin/node')) return missing(io, 'node'); if (a[0] === '-v' || a[0] === '--version') { io.out('v20.18.0\n'); return 0; } return runNode(a, io, sh); },
    wget: (a, io, sh) => { if (!has(sh, '/usr/bin/wget')) return missing(io, 'wget'); const url = a.filter(x => !x.startsWith('-')).pop(); const q = a.includes('-q') || a.includes('-qO-') || a.includes('-O-'); const r = curlCmd(['-s', url], q ? io : io, sh); return r === 0 ? 0 : 1; },
    ping: (a, io, sh) => {
      const host = a.filter((x, i) => !x.startsWith('-') && a[i - 1] !== '-c' && a[i - 1] !== '-W').pop();
      const ci = a.indexOf('-c');
      const n = ci >= 0 ? parseInt(a[ci + 1], 10) || 1 : 3;
      if (!host) { io.err('ping: usage error: Destination address required\n'); return 1; }
      const d = sh.daemon, me = sh.container;
      let ip = null;
      if (['localhost', '127.0.0.1'].includes(host)) ip = '127.0.0.1';
      else {
        const nets = me.networks.filter(x => x !== 'bridge');
        const t = d.containers.find(c => c.status === 'running' && c.networks.some(x => nets.includes(x)) && (c.name === host || (c.aliases || []).includes(host)));
        if (t) ip = ipOf(t, me);
        else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) ip = d.containers.some(c => c.status === 'running' && Object.values(c.ips).includes(host)) ? host : null;
      }
      if (!ip) { io.err(`ping: bad address '${host}'\n`); return 1; }
      let out = `PING ${host} (${ip}): 56 data bytes\n`;
      for (let k = 0; k < n; k++) out += `64 bytes from ${ip}: seq=${k} ttl=64 time=0.0${80 + k} ms\n`;
      io.out(out + `\n--- ${host} ping statistics ---\n${n} packets transmitted, ${n} packets received, 0% packet loss\n`);
      return 0;
    },
    ps: (a, io, sh) => { const c = sh.container; io.out(`PID   USER     COMMAND\n    1 ${(c.user || 'root').padEnd(8)} ${((c.entrypoint || []).concat(c.cmd || [])).join(' ')}\n`); return 0; },
    hostname: (a, io, sh) => { io.out(short(sh.container.id) + '\n'); return 0; },
    whoami: (a, io, sh) => { io.out((sh.container.user || 'root').split(':')[0] + '\n'); return 0; },
    env: (a, io, sh) => { const o = envObj(sh); io.out(Object.entries(o).filter(([k]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && !['IFS', 'TERM', 'LANG', 'LOGNAME', 'SHELL', 'USER'].includes(k) || k === 'LANG').sort().map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); return 0; }
  };
  const HOST_ONLY = new Set(['docker', 'tree', 'man', 'sudo']);

  Object.assign(MB.COMMANDS, {
    docker: dockerCli,
    'docker-compose': (args, io, sh) => dockerCli(['compose'].concat(args), io, sh),
    curl: curlCmd,
    mvn: mvnCmd,
    './mvnw': mvnCmd,
    java: javaCmd,
    uvicorn: (a, io, sh) => uvicornCmd(a, io, sh),
    fastapi: (a, io, sh) => uvicornCmd(a, io, sh, true),
    python: pythonCmd,
    python3: pythonCmd,
    pip: (a, io) => { io.err('(simulator: use pip inside a container, e.g. in a Dockerfile RUN step)\n'); return 1; }
  });
  Object.assign(MB, { parseYAML, goTemplate, Daemon, DockerError, parsePyRoutes, parseJavaRoutes });
})();
