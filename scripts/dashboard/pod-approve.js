#!/usr/bin/env node
'use strict';

// pod-approve.js — Mac 侧向 S2 worker pod 注入 APPROVE_* 批准行（deploy/README.md
// 「Mac 侧批准注入」一节的唯一入口）。
//
//   node scripts/dashboard/pod-approve.js --pod python-worker --slot 1 \
//     --line 'APPROVE_WRITES sha256:<batch-digest>'
//   node scripts/dashboard/pod-approve.js --list
//
// 机制：行先过本地正则校验（与 pod 内 supervisor 消费端正则同源，require
// deploy/lib.js），再 `kubectl exec -n sdk-doc-sync <pod> -- sh -c …` 追加进
// /workspace/inbound/approve-<slot>.queue。spawn 全程 argv 数组、无 shell 字符串
// 拼接；行内容在 pod 内以位置参数二次过同一正则后才落盘——注入面只有校验过的
// 一行，杜绝换行/分号注入。
//
// 红线（照抄仓库治理语汇）：本工具只往队列文件追加一行，不直接驱动会话、不代替
// 操作员判断；批准只有落成回执才生效；scan-state 只由 close-session/finalize 推进。
// supervisor 每 20s 轮询队列，首行匹配正则才会以 `opencode run -s <ses>` 续跑该 slot。

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { validateApproveLine, APPROVE_LINE_RE } = require(path.join(__dirname, '..', '..', 'deploy', 'lib.js'));

const NAMESPACE = 'sdk-doc-sync';
const QUEUE_DIR = '/workspace/inbound';
const KNOWN_PODS = ['python-worker', 'java-worker'];
const POD_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const SLOT_RE = /^[1-9][0-9]*$/;

function usage(exitCode = 0) {
  process.stdout.write([
    'pod-approve.js — inject an APPROVE_* line into an S2 worker pod queue',
    '',
    'Usage:',
    '  node scripts/dashboard/pod-approve.js --pod <python-worker|java-worker> --slot <n> --line "<APPROVE_… sha256:…>"',
    '  node scripts/dashboard/pod-approve.js --list [--pod <name>]',
    '',
    'Options:',
    '  --pod <name>    target pod (python-worker / java-worker)',
    '  --slot <n>      slot number (1 = first TRACKS entry, 2 = second)',
    '  --line <text>   the exact gate reply line, e.g. "APPROVE_WRITES sha256:<64-hex>"',
    '  --list          tail the last 20 events.jsonl lines of the worker pod(s)',
    '  --help          this text',
    '',
    `Line form (both ends enforce): ${APPROVE_LINE_RE}`,
    'The line must be copied verbatim from a gate presentation card/index replyLines —',
    'any re-plan or re-scan invalidates old digests; re-walk the gate instead.',
  ].join('\n'));
  process.stdout.write('\n');
  process.exit(exitCode);
}

function fail(message) {
  process.stderr.write(`pod-approve: ${message}\n`);
  process.exit(1);
}

function kubectl(args, { capture = true } = {}) {
  const result = spawnSync('kubectl', args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    // capture=false（--list）时让远端输出直通 stdout/stderr，不吞退出码。
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) fail(`kubectl spawn failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout || '').trim() : '(output streamed above)';
    fail(`kubectl exited ${result.status}: kubectl ${args.join(' ')}\n  ${detail}`);
  }
  return result;
}

function appendLine({ pod, slot, line }) {
  const queueFile = `${QUEUE_DIR}/approve-${slot}.queue`;
  // 注入安全的远端脚本：脚本本体是常量，行/正则/目录/队列文件全走位置参数
  // （$1 行、$2 正则、$3 目录、$4 队列文件）；pod 内二次过同一正则，两次校验
  // 之间没有第二个解释层。
  const remoteScript = [
    'mkdir -p "$3"',
    'printf "%s" "$1" | grep -Eq -- "$2" || { echo "pod-approve: APPROVE_LINE_INVALID (pod-side re-check): $1" >&2; exit 3; }',
    'printf "%s\\n" "$1" >> "$4" && echo "queued: $1"',
  ].join('\n');
  const result = spawnSync('kubectl', [
    'exec', '-n', NAMESPACE, pod, '--',
    'sh', '-c', remoteScript, 'pod-approve', line, APPROVE_LINE_RE.source, QUEUE_DIR, queueFile,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error) fail(`kubectl spawn failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`kubectl exec exited ${result.status}（pod 未就绪 / bootstrap 未完成 / 行二次校验失败）:\n  ${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function listEvents(podFilter) {
  const pods = podFilter ? [podFilter] : KNOWN_PODS;
  for (const pod of pods) {
    process.stdout.write(`===== ${pod} · /workspace/logs/events.jsonl (tail 20) =====\n`);
    kubectl([
      'exec', '-n', NAMESPACE, pod, '--',
      'sh', '-c', 'tail -n 20 "$1" 2>/dev/null || echo "(events.jsonl not present yet — pod still bootstrapping?)"', 'pod-approve', '/workspace/logs/events.jsonl',
    ], { capture: false });
    process.stdout.write('\n');
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) usage(argv.includes('--help') ? 0 : 64);

  if (argv.includes('--list')) {
    const podAt = argv.indexOf('--pod');
    const podFilter = podAt !== -1 ? argv[podAt + 1] : null;
    if (podFilter && !POD_NAME_RE.test(podFilter)) fail(`--pod looks invalid: ${podFilter}`);
    listEvents(podFilter);
    process.stdout.write('事件语义见 deploy/README.md §看门；批准注入用 --pod/--slot/--line。\n');
    return;
  }

  const readValue = (flag) => {
    const at = argv.indexOf(flag);
    if (at === -1 || at + 1 >= argv.length) fail(`${flag} is required（see --help）`);
    return argv[at + 1];
  };
  const pod = readValue('--pod');
  const slot = readValue('--slot');
  const line = readValue('--line');

  if (!POD_NAME_RE.test(pod)) fail(`--pod looks invalid: ${pod}（expected dns-1035 name, e.g. python-worker）`);
  if (!SLOT_RE.test(slot)) fail(`--slot must be a positive integer (got ${JSON.stringify(slot)})`);
  if (!KNOWN_PODS.includes(pod)) {
    process.stderr.write(`pod-approve: WARN: ${pod} 不在已知清单 [${KNOWN_PODS.join(', ')}]——继续尝试（集群里可能有同名 pod）\n`);
  }

  // 本地校验（与 pod 内 supervisor/第二次校验同一正则，deploy/lib.js 单源）。
  const verdict = validateApproveLine(line);
  if (!verdict.ok) {
    fail(`APPROVE_LINE_INVALID: ${JSON.stringify(line)}\n  形态必须匹配 ${APPROVE_LINE_RE}\n  回现行请从呈门卡片/index.json 的 replyLines 逐字复制；重规划/重扫后旧 digest 作废，须重新走门。`);
  }

  const queued = appendLine({ pod, slot, line: verdict.line });
  process.stdout.write([
    '—— pod-approve 回执 ——',
    `pod:    ${pod}`,
    `slot:   ${slot}`,
    `queue:  ${QUEUE_DIR}/approve-${slot}.queue`,
    `line:   ${verdict.line}`,
    queued ? `remote: ${queued}` : null,
    '',
    'supervisor ≤20s 内会出队并以 `opencode run -s <ses>` 续跑该 slot；',
    '批准只有落成回执才生效——回看该 slot 的 run 目录 opencode.jsonl / 门文件确认推进。',
    '看门：node scripts/dashboard/pod-approve.js --list',
  ].filter((value) => value !== null).join('\n'));
  process.stdout.write('\n');
}

main();
