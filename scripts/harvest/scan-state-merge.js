#!/usr/bin/env node
'use strict';

// scan-state-merge.js — pod 副本 scan-state 键归并（2026-10-25 证据生命周期裁定）。
//
//   node scripts/harvest/scan-state-merge.js           # dry-run（默认）
//   node scripts/harvest/scan-state-merge.js --apply
//
// 纪律：轨键所有权——每个 pod 只拥有自己 trackKey 的那一栏（pod 内 close-session/
// finalize 只写本轨），Mac 是其余键的权威。归并=以主树版为底、逐 pod 只覆盖其
// trackKey 键，绝不走 git 文本合并（单文件 JSON 双写方，line-merge 靠运气）。
// 采纳规则（确定性）：
//   * overlay 该键 lastScanDate 较新 → 采纳（pod 拥有该轨）；
//   * 较旧 → 跳过（Mac 已推进——所有权被破坏的信号，如实报出）；
//   * 同日且内容不同 → 采纳并告警（pod 拥有该轨，但需人看一眼）；
//   * 键相同内容相同 → no-op。
// overlay 里的「本轨以外的键」与主树不同 → 只记录（foreignDrift），绝不采纳。
// --apply 原子写回 tracked 文件（.claude/skills/api-reference-sync/scan-state.json）；
// 写回即工作树变脏——按准入纪律由操作员提交，本脚本绝不代 commit。

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_STATE_ABS = path.join(REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'scan-state.json');
const HARVEST_ROOT = path.join(REPO_ROOT, 'tmp', 'api-reference-sync', 'harvest');
const MARKERS_DIR = path.join(HARVEST_ROOT, 'markers');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entryDate(entry) {
  return String((isPlainObject(entry) && entry.lastScanDate) || '');
}

// 纯函数：base 为主树当前对象；overlays = [{pod, trackKey, state}]（pod 副本对象）。
// 返回 {merged, decisions}——decisions 逐条可审计，merged 仅在 trackKey 键上与 base 不同。
function mergeScanStates(base, overlays) {
  if (!isPlainObject(base)) throw new Error('scan-state base is not a JSON object');
  const merged = { ...base };
  const decisions = [];
  for (const overlay of overlays) {
    if (!isPlainObject(overlay.state)) {
      decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'skipped', note: 'overlay 不是 JSON object——不采纳整份' });
      continue;
    }
    if (!overlay.trackKey || !/^[a-z0-9][a-z0-9-]*$/.test(overlay.trackKey)) {
      decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'skipped', note: 'marker 缺 trackKey 或形态非法——无法断定归属轨' });
      continue;
    }
    const overlayEntry = overlay.state[overlay.trackKey];
    if (overlayEntry === undefined) {
      decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'noop', note: 'pod 副本没有本轨键（该轨尚未收官）' });
    } else {
      const baseEntry = merged[overlay.trackKey];
      if (baseEntry === undefined) {
        merged[overlay.trackKey] = overlayEntry;
        decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'applied', note: '主树缺该轨键——新增' });
      } else {
        const baseDate = entryDate(baseEntry);
        const overlayDate = entryDate(overlayEntry);
        if (overlayDate > baseDate) {
          merged[overlay.trackKey] = overlayEntry;
          decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'applied', note: `lastScanDate ${overlayDate} > ${baseDate}` });
        } else if (overlayDate < baseDate) {
          decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'skipped-stale', note: `pod 副本较旧（${overlayDate} < ${baseDate}）——Mac 已推进？` });
        } else if (JSON.stringify(overlayEntry) === JSON.stringify(baseEntry)) {
          decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'noop', note: '内容一致' });
        } else {
          merged[overlay.trackKey] = overlayEntry;
          decisions.push({ pod: overlay.pod, trackKey: overlay.trackKey, action: 'applied-warn', note: `同日（${overlayDate}）但内容不同——pod 拥有该轨，采纳；请人工过目` });
        }
      }
    }
    for (const key of Object.keys(overlay.state)) {
      if (key === overlay.trackKey) continue;
      if (JSON.stringify(overlay.state[key]) !== JSON.stringify(base[key] ?? null)) {
        decisions.push({ pod: overlay.pod, trackKey: key, action: 'foreign-drift', note: 'pod 副本含本轨以外的键差异——Mac 为权威，不采纳' });
      }
    }
  }
  return { merged, decisions };
}

function formatScanState(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function writeAtomic(file, content) {
  const staging = `${file}.merge-tmp-${process.pid}`;
  fs.writeFileSync(staging, content);
  fs.renameSync(staging, file);
}

function collectOverlays() {
  const overlays = [];
  const notes = [];
  if (!fs.existsSync(MARKERS_DIR)) return { overlays, notes: ['无 harvest/markers——还没有任何收割'] };
  for (const name of fs.readdirSync(MARKERS_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const marker = JSON.parse(fs.readFileSync(path.join(MARKERS_DIR, name), 'utf8'));
    const pod = marker.pod || name.replace(/\.json$/, '');
    const overlayPath = path.join(HARVEST_ROOT, pod, 'scan-state.json');
    if (!fs.existsSync(overlayPath)) {
      notes.push(`${pod}: 无 scan-state 快照（该 pod 尚无 scan-state 可收？）`);
      continue;
    }
    overlays.push({ pod, trackKey: marker.trackKey || null, state: JSON.parse(fs.readFileSync(overlayPath, 'utf8')) });
  }
  return { overlays, notes };
}

function main() {
  const apply = process.argv.includes('--apply');
  const base = JSON.parse(fs.readFileSync(SCAN_STATE_ABS, 'utf8'));
  const { overlays, notes } = collectOverlays();
  for (const note of notes) process.stdout.write(`note: ${note}\n`);
  if (overlays.length === 0) {
    process.stdout.write('无可归并的 pod 快照——结束\n');
    return;
  }
  const { merged, decisions } = mergeScanStates(base, overlays);
  for (const decision of decisions) {
    process.stdout.write(`  [${decision.action}] ${decision.pod} · ${decision.trackKey}: ${decision.note}\n`);
  }
  const changedKeys = Object.keys(merged).filter((key) => JSON.stringify(merged[key]) !== JSON.stringify(base[key]));
  const addedKeys = Object.keys(merged).filter((key) => !(key in base));
  if (changedKeys.length === 0) {
    process.stdout.write('归并结果：无变化（主树已是最新）\n');
    return;
  }
  process.stdout.write(`归并结果：${changedKeys.length} 个键变化（新增 ${addedKeys.length}）：${changedKeys.join(', ')}\n`);
  if (!apply) {
    process.stdout.write('dry-run——未写盘。确认后加 --apply（写回 tracked 文件，随后按准入纪律提交）\n');
    return;
  }
  writeAtomic(SCAN_STATE_ABS, formatScanState(merged));
  process.stdout.write(`已写回 ${path.relative(REPO_ROOT, SCAN_STATE_ABS)}——工作树已变脏，按准入纪律提交（本脚本绝不代 commit）\n`);
}

if (require.main === module) main();

module.exports = { collectOverlays, formatScanState, mergeScanStates };
