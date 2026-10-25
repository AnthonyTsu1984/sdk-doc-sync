#!/usr/bin/env node
'use strict';

// pod-evidence.js — S2 pod 证据收割（Mac 侧）：把 worker pod PVC 上的战役证据
// 拷回主树规范位，并用指纹 marker 把「拆集群前先留证」从人肉纪律变成机器闸。
//
//   node scripts/harvest/pod-evidence.js harvest [--pod <name>]     # 收割（幂等，随时可跑）
//   node scripts/harvest/pod-evidence.js status [--pod <name>] [--json]
//   node scripts/harvest/pod-evidence.js fingerprint [--pod <name>] # 调试：打印 pod 侧指纹
//
// 设计（2026-10-25 证据生命周期裁定）：
//   * 通道边界按文件几何画——git-tracked 的演化态只有 scan-state.json，经
//     scan-state-merge.js 键归并进主树；其余 tmp/ 工件（含 findings 账本）一律走
//     收割通道，由 teardown-check 硬闸兜底「不收割不放行」。
//   * 硬闸不依赖 campaign_terminal 启发式（supervisor 自认会把死亡误判终态）：
//     marker 记每文件 sha256+size，status 现算 pod 侧指纹比对。append-only 文件
//     允许「尾部新增」（先收割再拆）；已收割前缀被改写=历史被重写，人工排查。
//   * canonical 落点字节守卫（RUN_MANIFEST_EVIDENCE_CONFLICT 同款纪律）：同名
//     不同字节=硬冲突，绝不静默覆盖；pod 私有快照覆盖前留 .pre-<sha8> 备份。
//   * opencode 会话转录不在收割清单（体积大、审计价值中等）；需要时人工 kubectl cp。
//
// 红线：只读 pod、只写本地 tmp/。绝不触碰 scan-state 写路径（只由 close-session/
// finalize 推进）——本脚本落的是「pod 副本快照」，合并进 tracked 文件由
// scan-state-merge.js 显式 --apply、由操作员按准入纪律提交。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const NAMESPACE = 'sdk-doc-sync';
const POD_SELECTOR = 'app.kubernetes.io/part-of=sdk-doc-sync';
const POD_REPO = '/workspace/feishu-markdown-bridge';
const POD_WORKSPACE = '/workspace';
const CANONICAL_ROOT_REL = 'tmp/api-reference-sync';
const HARVEST_ROOT = path.join(REPO_ROOT, CANONICAL_ROOT_REL, 'harvest');
const MARKERS_DIR = path.join(HARVEST_ROOT, 'markers');
const POD_LEDGER_REL = `${CANONICAL_ROOT_REL}/daily-scan/pr-findings.jsonl`;
const POD_SCAN_STATE_REL = '.claude/skills/api-reference-sync/scan-state.json';
const SHA_RE = /^[0-9a-f]{64}$/;

// gate-presentation/latest.html 是每次呈门重渲染的派生视图（且内含 pod 本地绝对
// 路径，拷回无意义）——指纹与收割都跳过；正主是各门 index/digest 文件。
const SKIP_BASENAMES = new Set(['latest.html']);

const ARTIFACT_SPEC = [
  { kind: 'dir', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/campaign-approvals` },
  { kind: 'dir', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/gate-presentation` },
  { kind: 'dir', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/close-entries` },
  { kind: 'dir', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/campaign-plans` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/run-manifest-*.json` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/*.jsonl` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/disposal-journal-*.json` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/repair-journal-*.json` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/repair-plan-*.json` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/corrective-*.json` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/corrective-*.jsonl` },
  { kind: 'glob', pod: `${POD_REPO}/${CANONICAL_ROOT_REL}/daily-scan/backlog-import-*.jsonl` },
  { kind: 'file', pod: `${POD_REPO}/${POD_SCAN_STATE_REL}` },
  { kind: 'file', pod: `${POD_REPO}/${POD_LEDGER_REL}` },
  { kind: 'file', pod: `${POD_WORKSPACE}/logs/events.jsonl` },
  { kind: 'file', pod: `${POD_WORKSPACE}/logs/supervisor.log` },
  { kind: 'glob', pod: `${POD_WORKSPACE}/runs/card-*.json` },
];

// ---------- 纯函数（供单测与 CLI 共用） ----------

function parseFingerprintOutput(text) {
  const artifacts = [];
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '') continue;
    const [podPath, sha256, sizeText] = line.split('\t');
    if (!podPath || !SHA_RE.test(sha256 || '') || !/^\d+$/.test(sizeText || '')) {
      const error = new Error(`fingerprint line malformed: ${JSON.stringify(rawLine)}`);
      error.code = 'FINGERPRINT_OUTPUT_INVALID';
      throw error;
    }
    if (SKIP_BASENAMES.has(path.posix.basename(podPath))) continue;
    artifacts.push({ podPath, sha256, size: Number(sizeText) });
  }
  return artifacts;
}

function computeDelta(markerArtifacts, currentArtifacts) {
  const marker = new Map(markerArtifacts.map((a) => [a.podPath, a]));
  const current = new Map(currentArtifacts.map((a) => [a.podPath, a]));
  const clean = [];
  const neverHarvested = [];
  const tailCandidates = [];
  const rewritten = [];
  for (const art of currentArtifacts) {
    const m = marker.get(art.podPath);
    if (!m) neverHarvested.push(art);
    else if (m.sha256 === art.sha256 && m.size === art.size) clean.push(art);
    else if (art.size > m.size) tailCandidates.push({ current: art, marker: m });
    else rewritten.push({ current: art, marker: m });
  }
  const vanished = markerArtifacts.filter((a) => !current.has(a.podPath));
  return { clean, neverHarvested, tailCandidates, rewritten, vanished };
}

// tailCandidates 的仲裁：marker 记录的字节数作为前缀长度，现算 pod 侧前缀 sha——
// 与 marker 全量 sha 一致=纯追加（tailGrew，收割即解）；不一致=历史被改写。
function resolveTail(tailCandidates, prefixShaByPath) {
  const tailGrew = [];
  const rewritten = [];
  for (const candidate of tailCandidates) {
    const prefixSha = prefixShaByPath.get(candidate.current.podPath);
    if (prefixSha === candidate.marker.sha256) tailGrew.push(candidate.current);
    else rewritten.push(candidate.current);
  }
  return { tailGrew, rewritten };
}

// landingFor：pod 路径 → 主树落点。canonical=直接进规范位（字节守卫）；
// pod-private=harvest/<pod>/ 快照（等合并）。返回 null=不在收割语义内（不该出现）。
function landingFor(podPath, podName) {
  if (podPath.startsWith(`${POD_REPO}/`)) {
    const rel = podPath.slice(POD_REPO.length + 1);
    if (rel === POD_SCAN_STATE_REL) {
      return { kind: 'pod-private', abs: path.join(HARVEST_ROOT, podName, 'scan-state.json') };
    }
    if (rel === POD_LEDGER_REL) {
      return { kind: 'pod-private', abs: path.join(HARVEST_ROOT, podName, 'pr-findings.jsonl') };
    }
    if (rel.startsWith(`${CANONICAL_ROOT_REL}/`)) {
      return { kind: 'canonical', abs: path.join(REPO_ROOT, rel) };
    }
    return null;
  }
  if (podPath.startsWith(`${POD_WORKSPACE}/logs/`) || podPath.startsWith(`${POD_WORKSPACE}/runs/`)) {
    return { kind: 'pod-private', abs: path.join(HARVEST_ROOT, podName, path.basename(podPath)) };
  }
  return null;
}

// ---------- kubectl 薄层 ----------

function kubectlEnv() {
  const env = { ...process.env };
  if (!env.KUBECONFIG) env.KUBECONFIG = path.join(os.homedir(), '.milvus-cell', 'kubeconfig');
  return env;
}

function runKubectl(args, { captureStdout = true } = {}) {
  const result = spawnSync('kubectl', args, {
    encoding: 'utf8',
    env: kubectlEnv(),
    maxBuffer: 16 * 1024 * 1024,
    stdio: captureStdout ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) {
    const error = new Error(`kubectl spawn failed: ${result.error.message}`);
    error.code = 'KUBECTL_SPAWN_FAILED';
    throw error;
  }
  if (result.status !== 0) {
    const detail = captureStdout ? String(result.stderr || result.stdout || '').trim() : '(output above)';
    const error = new Error(`kubectl exited ${result.status}: kubectl ${args.join(' ')}\n  ${detail}`);
    error.code = 'KUBECTL_FAILED';
    throw error;
  }
  return result;
}

function listWorkerPods() {
  const result = runKubectl([
    'get', 'pods', '-n', NAMESPACE, '-l', POD_SELECTOR, '-o', 'json',
  ]);
  const doc = JSON.parse(result.stdout);
  return (doc.items || []).map((item) => ({
    name: item.metadata?.name,
    trackKey: item.metadata?.labels?.['app.kubernetes.io/track'] || null,
    ready: Boolean(item.status?.containerStatuses?.[0]?.ready),
  })).filter((pod) => Boolean(pod.name));
}

// 远端脚本本体是常量；模式全走位置参数（pod-approve 同款注入纪律，无 shell 拼接）。
const FINGERPRINT_SCRIPT = [
  'for p in "$@"; do',
  '  case "$p" in',
  "    @dir@*) find \"${p#@dir@}\" -type f 2>/dev/null ;;",
  '    *) for f in $p; do [ -f "$f" ] && printf \'%s\\n\' "$f"; done ;;',
  '  esac',
  'done | sort -u | while IFS= read -r f; do',
  "  h=\"$(sha256sum \"$f\" | cut -d' ' -f1)\"",
  "  z=\"$(wc -c < \"$f\" | tr -d '[:space:]')\"",
  '  printf \'%s\\t%s\\t%s\\n\' "$f" "$h" "$z"',
  'done',
].join('\n');

const PREFIX_HASH_SCRIPT = [
  'while [ "$#" -gt 0 ]; do',
  '  f="$1"; n="$2"; shift 2',
  "  h=\"$(head -c \"$n\" \"$f\" 2>/dev/null | sha256sum | cut -d' ' -f1)\"",
  '  printf \'%s\\t%s\\n\' "$f" "$h"',
  'done',
].join('\n');

function fingerprintPod(podName) {
  const specArgs = ARTIFACT_SPEC.map((entry) => (entry.kind === 'dir' ? `@dir@${entry.pod}` : entry.pod));
  const result = runKubectl([
    'exec', '-n', NAMESPACE, podName, '--',
    'bash', '-c', FINGERPRINT_SCRIPT, 'pod-evidence', ...specArgs,
  ]);
  return parseFingerprintOutput(result.stdout);
}

function prefixHashes(podName, pairs) {
  if (pairs.length === 0) return new Map();
  const flat = [];
  for (const pair of pairs) flat.push(pair.current.podPath, String(pair.marker.size));
  const result = runKubectl([
    'exec', '-n', NAMESPACE, podName, '--',
    'bash', '-c', PREFIX_HASH_SCRIPT, 'pod-evidence', ...flat,
  ]);
  const map = new Map();
  for (const line of String(result.stdout).split('\n')) {
    if (line.trim() === '') continue;
    const [podPath, sha256] = line.split('\t');
    if (!podPath || !SHA_RE.test(sha256 || '')) {
      const error = new Error(`prefix-hash line malformed: ${JSON.stringify(line)}`);
      error.code = 'FINGERPRINT_OUTPUT_INVALID';
      throw error;
    }
    map.set(podPath, sha256);
  }
  return map;
}

// ---------- marker ----------

function markerPath(podName) { return path.join(MARKERS_DIR, `${podName}.json`); }

function readMarker(podName) {
  const file = markerPath(podName);
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.artifacts)) {
    const error = new Error(`marker malformed (artifacts not an array): ${file}`);
    error.code = 'MARKER_INVALID';
    throw error;
  }
  return doc;
}

function writeMarkerAtomic(podName, trackKey, artifacts) {
  fs.mkdirSync(MARKERS_DIR, { recursive: true });
  const doc = {
    schemaVersion: 1,
    pod: podName,
    trackKey,
    harvestedAt: new Date().toISOString(),
    artifacts,
  };
  const target = markerPath(podName);
  const staging = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(staging, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(staging, target);
}

// ---------- status / harvest ----------

function classifyPod(pod) {
  const current = fingerprintPod(pod.name);
  const marker = readMarker(pod.name);
  if (!marker) {
    return { pod, ok: false, current, reasons: [`从未收割（${current.length} 个待收工件）`] };
  }
  const delta = computeDelta(marker.artifacts, current);
  let tailGrew = [];
  let rewritten = delta.rewritten.map((entry) => entry.current);
  if (delta.tailCandidates.length > 0) {
    const prefixes = prefixHashes(pod.name, delta.tailCandidates);
    const resolved = resolveTail(delta.tailCandidates, prefixes);
    tailGrew = resolved.tailGrew;
    rewritten = [...rewritten, ...resolved.rewritten];
  }
  const reasons = [];
  if (delta.neverHarvested.length > 0) reasons.push(`新证据未收割 ×${delta.neverHarvested.length}`);
  if (tailGrew.length > 0) reasons.push(`append-only 文件有新尾部 ×${tailGrew.length}`);
  if (rewritten.length > 0) reasons.push(`已收割内容被改写（人工排查）×${rewritten.length}`);
  if (delta.vanished.length > 0) reasons.push(`pod 侧文件消失（重跑 harvest 刷新 marker）×${delta.vanished.length}`);
  return { pod, ok: reasons.length === 0, current, reasons, clean: delta.clean.length };
}

function cmdStatus(podFilter, jsonMode) {
  const pods = listWorkerPods().filter((p) => !podFilter || p.name === podFilter);
  if (pods.length === 0) {
    const note = '无 worker pod——无证据可护，闸视为通过';
    if (jsonMode) process.stdout.write(`${JSON.stringify({ ok: true, note, pods: [] })}\n`);
    else process.stdout.write(`${note}\n`);
    return 0;
  }
  const results = [];
  for (const pod of pods) {
    try {
      results.push(classifyPod(pod));
    } catch (error) {
      results.push({
        pod,
        ok: false,
        reasons: [`无法核验（exec 失败——Sleeping？容器未起？）: ${error.message.split('\n')[0]}`],
      });
    }
  }
  const ok = results.every((r) => r.ok);
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({
      ok,
      pods: results.map((r) => ({
        pod: r.pod.name, trackKey: r.pod.trackKey, ok: r.ok, reasons: r.reasons || [],
      })),
    })}\n`);
  } else {
    for (const r of results) {
      const tag = r.ok ? '✔ 已收割' : '✘ 未放行';
      process.stdout.write(`${tag}  ${r.pod.name}${r.pod.trackKey ? ` (${r.pod.trackKey})` : ''}\n`);
      for (const reason of r.reasons || []) process.stdout.write(`    - ${reason}\n`);
    }
    process.stdout.write(ok
      ? '证据闸：全部已收割，teardown 可继续（本脚本绝不代删）\n'
      : '证据闸：存在未收割/异常 delta——先收割：node scripts/harvest/pod-evidence.js harvest\n');
  }
  return ok ? 0 : 1;
}

function tarFromPod(podName, podPaths, tarFile) {
  const relPaths = podPaths.map((p) => p.replace(/^\//, ''));
  const outFd = fs.openSync(tarFile, 'w');
  try {
    const result = spawnSync('kubectl', [
      'exec', '-n', NAMESPACE, podName, '--',
      'bash', '-c', 'exec tar -cf - -C / "$@"', 'pod-evidence', ...relPaths,
    ], { encoding: 'utf8', env: kubectlEnv(), maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', outFd, 'pipe'] });
    if (result.error || result.status !== 0) {
      const detail = result.error ? result.error.message : String(result.stderr || '').trim();
      const error = new Error(`tar from pod failed: ${detail}`);
      error.code = 'POD_TAR_FAILED';
      throw error;
    }
  } finally {
    fs.closeSync(outFd);
  }
}

function walkFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) visit(abs);
      else out.push(abs);
    }
  };
  visit(root);
  return out;
}

function filesEqual(left, right) {
  const bufL = fs.readFileSync(left);
  const bufR = fs.readFileSync(right);
  return bufL.equals(bufR);
}

function distribute(pod, stagingDir) {
  const summary = { copied: 0, identicalSkipped: 0, podPrivate: 0, backups: [], conflicts: [] };
  for (const abs of walkFiles(stagingDir)) {
    const podPath = `/${path.relative(stagingDir, abs).split(path.sep).join('/')}`;
    const landing = landingFor(podPath, pod.name);
    if (!landing) {
      const error = new Error(`harvest 产物落在未定义落点: ${podPath}`);
      error.code = 'LANDING_UNKNOWN';
      throw error;
    }
    fs.mkdirSync(path.dirname(landing.abs), { recursive: true });
    if (fs.existsSync(landing.abs)) {
      if (filesEqual(landing.abs, abs)) { summary.identicalSkipped += 1; continue; }
      if (landing.kind === 'canonical') {
        summary.conflicts.push({ podPath, local: landing.abs });
        continue;
      }
      // pod-private 快照允许覆盖，但先留前字节备份（防「改写」抹掉上一份快照）。
      const prevSha = spawnSync('shasum', ['-a', '256', landing.abs], { encoding: 'utf8' });
      const sha8 = prevSha.status === 0 ? String(prevSha.stdout).slice(0, 8) : 'unknown';
      const backup = `${landing.abs}.pre-${sha8}`;
      fs.copyFileSync(landing.abs, backup);
      summary.backups.push(backup);
    }
    fs.copyFileSync(abs, landing.abs);
    summary.copied += 1;
    if (landing.kind === 'pod-private') summary.podPrivate += 1;
  }
  return summary;
}

function cmdHarvest(podFilter) {
  const pods = listWorkerPods().filter((p) => !podFilter || p.name === podFilter);
  if (pods.length === 0) {
    process.stdout.write('无 worker pod——无可收割\n');
    return 0;
  }
  let exitCode = 0;
  let podPrivateHarvested = false;
  const allConflicts = [];
  for (const pod of pods) {
    process.stdout.write(`== ${pod.name}${pod.trackKey ? ` (${pod.trackKey})` : ''} ==\n`);
    let current;
    try {
      current = fingerprintPod(pod.name);
    } catch (error) {
      process.stdout.write(`  跳过：无法指纹（exec 失败）: ${error.message.split('\n')[0]}\n`);
      exitCode = 1;
      continue;
    }
    const marker = readMarker(pod.name);
    let toCopy;
    if (!marker) {
      toCopy = current;
      process.stdout.write(`  首次收割（${current.length} 个工件）\n`);
    } else {
      const delta = computeDelta(marker.artifacts, current);
      let copySet = [...delta.neverHarvested];
      if (delta.tailCandidates.length > 0) {
        const resolved = resolveTail(delta.tailCandidates, prefixHashes(pod.name, delta.tailCandidates));
        copySet = [...copySet, ...resolved.tailGrew, ...resolved.rewritten];
      }
      copySet = [...copySet, ...delta.rewritten.map((entry) => entry.current)];
      toCopy = copySet;
      process.stdout.write(`  delta：新 ${delta.neverHarvested.length} · 追加 ${delta.tailCandidates.length} · 改写 ${delta.rewritten.length} · 消失 ${delta.vanished.length}\n`);
      if (toCopy.length === 0) { process.stdout.write('  无 delta——marker 不动\n'); continue; }
    }
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-evidence-'));
    try {
      const tarFile = path.join(staging, 'payload.tar');
      tarFromPod(pod.name, toCopy.map((a) => a.podPath), tarFile);
      const extractDir = path.join(staging, 'x');
      fs.mkdirSync(extractDir, { recursive: true });
      const untar = spawnSync('tar', ['-xf', tarFile, '-C', extractDir]);
      if (untar.status !== 0) {
        const error = new Error(`local tar -xf failed: ${String(untar.stderr || '').trim()}`);
        error.code = 'LOCAL_UNTAR_FAILED';
        throw error;
      }
      const summary = distribute(pod, extractDir);
      process.stdout.write(`  落点：新拷 ${summary.copied}（pod-private ${summary.podPrivate}）· 字节相同跳过 ${summary.identicalSkipped}\n`);
      for (const backup of summary.backups) process.stdout.write(`  快照备份：${path.relative(REPO_ROOT, backup)}\n`);
      if (summary.conflicts.length > 0) {
        allConflicts.push({ pod: pod.name, conflicts: summary.conflicts });
        for (const conflict of summary.conflicts) {
          process.stdout.write(`  硬冲突（同名不同字节，绝不覆盖）：${conflict.podPath}\n    → ${path.relative(REPO_ROOT, conflict.local)}\n`);
        }
        process.stdout.write('  marker 未更新——人工裁决后重跑 harvest（相同字节将自动跳过）\n');
        continue; // marker 不写：闸继续拦，直到冲突解决
      }
      if (summary.podPrivate > 0) podPrivateHarvested = true;
      writeMarkerAtomic(pod.name, pod.trackKey, current);
      process.stdout.write(`  marker 更新：${path.relative(REPO_ROOT, markerPath(pod.name))}（${current.length} 工件）\n`);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  if (allConflicts.length > 0) {
    process.stdout.write('收割未完成：存在 canonical 硬冲突——按 RUN_MANIFEST_EVIDENCE_CONFLICT 纪律人工裁决（归档旧件或核对来源）后重跑\n');
    exitCode = 1;
  }
  if (podPrivateHarvested) {
    process.stdout.write([
      '下一步（pod 私有快照已更新，合并进主树）：',
      '  node scripts/harvest/scan-state-merge.js           # dry-run 先看',
      '  node scripts/harvest/scan-state-merge.js --apply   # 写回 tracked 文件（按准入纪律提交）',
      '  node scripts/harvest/findings-ledger-merge.js [--apply]',
      '',
    ].join('\n'));
  }
  return exitCode;
}

// ---------- CLI ----------

function usage(exitCode) {
  process.stdout.write([
    'pod-evidence.js — S2 pod 证据收割与 teardown 硬闸的指纹真相源',
    '',
    'Usage:',
    '  node scripts/harvest/pod-evidence.js harvest [--pod <name>]',
    '  node scripts/harvest/pod-evidence.js status [--pod <name>] [--json]',
    '  node scripts/harvest/pod-evidence.js fingerprint [--pod <name>]',
    '',
    'Markers:  tmp/api-reference-sync/harvest/markers/<pod>.json (sha256+size per artifact)',
    'Landings: canonical 工件→主树规范位（字节守卫）；pod 快照→tmp/api-reference-sync/harvest/<pod>/',
    '',
  ].join('\n'));
  process.exit(exitCode);
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === 'help') usage(argv.includes('--help') ? 0 : 64);
  const podAt = argv.indexOf('--pod');
  const podFilter = podAt !== -1 ? argv[podAt + 1] : null;
  if (argv.includes('--pod') && !podFilter) usage(64);
  switch (command) {
    case 'status': {
      const code = cmdStatus(podFilter, argv.includes('--json'));
      process.exit(code);
      break;
    }
    case 'harvest':
      process.exit(cmdHarvest(podFilter));
      break;
    case 'fingerprint': {
      const pods = listWorkerPods().filter((p) => !podFilter || p.name === podFilter);
      for (const pod of pods) {
        process.stdout.write(`== ${pod.name} ==\n`);
        for (const art of fingerprintPod(pod.name)) {
          process.stdout.write(`${art.sha256}  ${String(art.size).padStart(10)}  ${art.podPath}\n`);
        }
      }
      break;
    }
    default:
      usage(64);
  }
}

if (require.main === module) main();

module.exports = {
  ARTIFACT_SPEC,
  HARVEST_ROOT,
  MARKERS_DIR,
  computeDelta,
  landingFor,
  parseFingerprintOutput,
  resolveTail,
};
