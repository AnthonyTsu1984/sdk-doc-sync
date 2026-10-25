#!/usr/bin/env node
'use strict';

// findings-ledger-merge.js — 多 pod findings 账本确定性归并（2026-10-25 证据生命周期
// 裁定）。
//
//   node scripts/harvest/findings-ledger-merge.js           # dry-run（默认）
//   node scripts/harvest/findings-ledger-merge.js --apply
//
// 各 pod 的账本独立演化（一轨一 pod），seq 各文件自增（nextSeq=max+1）必然撞号；
// 归并三步（确定性、幂等）：
//   1. 按内容去重——键=剥掉 seq 后的稳定序列化（同种子 backlog 在 Mac/pod 两边
//      各记一遍的 discovered 行字节相同，天然折半）；
//   2. 按时间排序——discoveredOn ?? at 为主序，prNumber、类型（discovered 前）与
//      内容键做平局仲裁，全序确定；
//   3. 统一重排 seq 1..N。
// fold 语义天然幂等（discovered=语言并集、disposed/ignored=后写胜出——同 PR 双边
// 各批一次时以时间靠后的一次为准），排序重放结果=各单账本 fold 的一致超集。
// 归并后跑 canonical foldLedger 复核。--apply 原子写回 canonical 账本。

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LEDGER_ABS = path.join(REPO_ROOT, 'tmp', 'api-reference-sync', 'daily-scan', 'pr-findings.jsonl');
const HARVEST_ROOT = path.join(REPO_ROOT, 'tmp', 'api-reference-sync', 'harvest');
const MARKERS_DIR = path.join(HARVEST_ROOT, 'markers');
const { foldLedger } = require(path.join(
  REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'src', 'sdk-doc-sync', 'findings-ledger.js',
));

const ENTRY_TYPES = new Set(['discovered', 'disposed', 'ignored']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) === undefined ? 'null' : JSON.stringify(value);
}

function contentKey(entry) {
  const { seq, ...rest } = entry;
  return stableStringify(rest);
}

function timeKey(entry) {
  return String(entry.discoveredOn ?? entry.at ?? '');
}

function typeRank(entry) {
  return entry.type === 'discovered' ? 0 : 1;
}

function validateEntry(entry, source) {
  if (!isObject(entry) || !ENTRY_TYPES.has(entry.type) || !Number.isInteger(entry.prNumber) || entry.prNumber <= 0) {
    const error = new Error(`账本行非法（${source}）: ${JSON.stringify(entry).slice(0, 200)}`);
    error.code = 'MERGE_ENTRY_INVALID';
    throw error;
  }
}

// 纯函数：ledgerSets = [{source, entries}]。返回 {merged, stats, warnings}。
function mergeFindingsLedgers(ledgerSets) {
  const byContent = new Map();
  let deduped = 0;
  for (const set of ledgerSets) {
    for (const entry of set.entries) {
      validateEntry(entry, set.source);
      const key = contentKey(entry);
      if (byContent.has(key)) { deduped += 1; continue; }
      byContent.set(key, { ...entry });
    }
  }
  const merged = [...byContent.values()].sort((left, right) => (
    timeKey(left) < timeKey(right) ? -1
      : timeKey(left) > timeKey(right) ? 1
        : left.prNumber - right.prNumber || typeRank(left) - typeRank(right) || (contentKey(left) < contentKey(right) ? -1 : 1)
  ));
  merged.forEach((entry, index) => { entry.seq = index + 1; });

  const canonical = ledgerSets[0];
  const canonicalKeys = new Set((canonical ? canonical.entries : []).map(contentKey));
  const warnings = [];
  const discovered = new Set(merged.filter((entry) => entry.type === 'discovered').map((entry) => entry.prNumber));
  for (const entry of merged) {
    if (entry.type !== 'discovered' && !discovered.has(entry.prNumber)) {
      warnings.push(`PR ${entry.prNumber} 有 ${entry.type} 但无 discovered 行（跨账本孤儿处置——fold 会照记状态，请过目）`);
    }
  }
  const stats = {
    inputLines: ledgerSets.reduce((sum, set) => sum + set.entries.length, 0),
    deduped,
    merged: merged.length,
    addedToCanonical: merged.filter((entry) => !canonicalKeys.has(contentKey(entry))).length,
  };
  return { merged, stats, warnings };
}

function parseLedgerFile(file, source) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  if (text === '') return [];
  return text.split('\n').filter(Boolean).map((line, index) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      const wrapped = new Error(`账本行不是 JSON（${source} 第 ${index + 1} 行）: ${error.message}`);
      wrapped.code = 'MERGE_ENTRY_INVALID';
      throw wrapped;
    }
    return entry;
  });
}

function collectLedgerSets() {
  const sets = [{ source: 'canonical', entries: parseLedgerFile(LEDGER_ABS, 'canonical') }];
  if (!fs.existsSync(MARKERS_DIR)) return { sets, pods: [] };
  const pods = [];
  for (const name of fs.readdirSync(MARKERS_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const marker = JSON.parse(fs.readFileSync(path.join(MARKERS_DIR, name), 'utf8'));
    const pod = marker.pod || name.replace(/\.json$/, '');
    const overlay = path.join(HARVEST_ROOT, pod, 'pr-findings.jsonl');
    if (!fs.existsSync(overlay)) continue;
    sets.push({ source: pod, entries: parseLedgerFile(overlay, pod) });
    pods.push(pod);
  }
  return { sets, pods };
}

function writeAtomic(file, lines) {
  const staging = `${file}.merge-tmp-${process.pid}`;
  fs.writeFileSync(staging, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  fs.renameSync(staging, file);
}

function main() {
  const apply = process.argv.includes('--apply');
  const { sets, pods } = collectLedgerSets();
  if (pods.length === 0) {
    process.stdout.write('无 pod 账本快照——无可归并\n');
    return;
  }
  process.stdout.write(`输入：canonical ${sets[0].entries.length} 行 + ${pods.map((pod) => `${pod} ${sets.find((s) => s.source === pod).entries.length} 行`).join(' · ')}\n`);
  const { merged, stats, warnings } = mergeFindingsLedgers(sets);
  process.stdout.write(`去重 ${stats.deduped} · 归并后 ${stats.merged} 行（canonical 净增 ${stats.addedToCanonical}）· seq 已按时间序重排 1..${stats.merged}\n`);
  for (const warning of warnings) process.stdout.write(`  warn: ${warning}\n`);
  foldLedger(merged); // canonical fold 复核：非法组合在此抛错，绝不带病写盘
  if (!apply) {
    process.stdout.write('dry-run——未写盘。确认后加 --apply\n');
    return;
  }
  writeAtomic(LEDGER_ABS, merged);
  process.stdout.write(`已写回 ${path.relative(REPO_ROOT, LEDGER_ABS)}\n`);
}

if (require.main === module) main();

module.exports = { contentKey, mergeFindingsLedgers, stableStringify };
