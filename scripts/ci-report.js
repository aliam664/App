#!/usr/bin/env node
/*
 * CI reporter: runs a command, captures its output, and — if it fails —
 * writes the tail of the log both to the GitHub job summary and to a
 * pinned "CI log" issue via the REST API (using the workflow's GITHUB_TOKEN).
 *
 * Why: the raw job logs are only downloadable from a storage host that is
 * not reachable from every network; issue bodies are plain API resources
 * that any client can read. This makes build failures debuggable remotely.
 *
 * Usage: node scripts/ci-report.js "<label>" <cmd> [args...]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');

const [label, cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error('usage: ci-report.js <label> <cmd> [args...]'); process.exit(2); }

const res = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_TERM_COLOR: 'never', RUST_BACKTRACE: '1' } });
const out = (res.stdout || '') + (res.stderr || '');
process.stdout.write(out);
const code = res.status == null ? 1 : res.status;

// Keep the informative part: everything from the first error/failure marker on,
// falling back to the last N lines.
const lines = out.split(/\r?\n/).filter((l) => !/^\s*(Compiling|Checking|Downloaded|Downloading|Updating|Locking|Adding|Blocking|Fresh)\b/.test(l));
let start = lines.findIndex((l) => /^(error(\[|:)|.*panicked at|.*FAILED|failures:)/.test(l));
if (start < 0) start = Math.max(0, lines.length - 120);
const tail = lines.slice(Math.max(0, start - 3)).slice(0, 220).join('\n');

const title = `${code === 0 ? '✅' : '❌'} ${label} — exit ${code}`;
const body = `### ${title}\n\n\`${[cmd, ...args].join(' ')}\`\n\n\`\`\`text\n${tail || '(no output)'}\n\`\`\`\n`;

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');

// GitHub REST helper. Prefers the `gh` CLI (pre-installed on all hosted
// runners, handles auth/proxies/TLS itself); falls back to plain https.
function api(method, path, data) {
  const ghBin = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const ghArgs = ['api', '-X', method, path, '--input', '-'];
  const viaGh = spawnSync(ghBin, data ? ghArgs : ghArgs.slice(0, 4), {
    encoding: 'utf8', input: data ? JSON.stringify(data) : undefined,
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN },
  });
  if (!viaGh.error) {
    try { return Promise.resolve({ status: viaGh.status === 0 ? 200 : 400, json: JSON.parse(viaGh.stdout || 'null') }); }
    catch { return Promise.resolve({ status: 400, json: null }); }
  }
  return new Promise((resolve) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'uhm-ci-report',
        'Accept': 'application/vnd.github+json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { try { resolve({ status: r.statusCode, json: JSON.parse(b || 'null') }); } catch { resolve({ status: r.statusCode, json: null }); } }); });
    req.on('error', (e) => { console.error('ci-report: api error', e.message); resolve({ status: 0, json: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const repo = process.env.GITHUB_REPOSITORY;
  if (code !== 0 && repo && process.env.GITHUB_TOKEN) {
    const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
    const runUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const header = `**Run:** ${runUrl}\n**Commit:** \`${sha}\` on \`${process.env.GITHUB_REF_NAME}\`\n**Job:** ${process.env.GITHUB_JOB} / ${process.env.RUNNER_OS}\n\n`;
    // One issue per failing step: creating an issue needs the least
    // privilege (works even for restricted tokens), and the log lives in the
    // body, so it is readable with a single GET.
    const title = `CI ❌ ${label} — ${sha} (run ${process.env.GITHUB_RUN_ID})`;
    const created = await api('POST', `/repos/${repo}/issues`, { title, body: header + body });
    const number = created.json && created.json.number;
    if (number) {
      console.error(`ci-report: failure log posted to issue #${number}`);
      // Best-effort tidy-up: label it and close older CI issues for the same label.
      await api('POST', `/repos/${repo}/issues/${number}/labels`, { labels: ['ci-log'] });
      const old = await api('GET', `/repos/${repo}/issues?state=open&per_page=50`);
      for (const it of Array.isArray(old.json) ? old.json : []) {
        if (it.number !== number && /^CI ❌ /.test(it.title)) await api('PATCH', `/repos/${repo}/issues/${it.number}`, { state: 'closed' });
      }
    } else {
      console.error('ci-report: could not create issue:', JSON.stringify(created.json && created.json.message));
    }
  }
  process.exit(code);
})();
