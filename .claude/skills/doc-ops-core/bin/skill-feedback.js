#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify } = require('../src/canonical-json');
const { DecisionLedger } = require('../src/decision-ledger');
const {
  buildRuleCandidate,
  selectCandidateNotifications,
  transitionRuleCandidate,
} = require('../src/rule-candidate');
const {
  buildRulePromotion,
  scoreRuleCandidate,
} = require('../src/rule-promotion');

function parseArgs(argv) {
  const args = { command: argv[2] || null, json: false };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') args.json = true;
    else if (argument.startsWith('--') && argv[index + 1]) {
      const name = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[name] = argv[++index];
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return args;
}

function requireValue(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

// Candidate ids carry colons (rule-candidate:skill:slug); output artifact
// names must not.
function safeFileStem(candidateId) {
  return String(candidateId).replace(/[^A-Za-z0-9._-]+/g, '-');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, canonicalStringify(value), { flag: 'wx' });
  fs.renameSync(temporary, resolved);
  return resolved;
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  let result;

  if (args.command === 'append-decision') {
    requireValue(args, 'ledger');
    requireValue(args, 'input');
    result = new DecisionLedger({ filePath: path.resolve(args.ledger) }).append(readJson(args.input));
  } else if (args.command === 'propose-rule') {
    requireValue(args, 'input');
    requireValue(args, 'output');
    result = buildRuleCandidate(readJson(args.input));
    writeJsonAtomic(args.output, result);
  } else if (args.command === 'score-rule') {
    requireValue(args, 'candidate');
    requireValue(args, 'heldOut');
    requireValue(args, 'target');
    result = scoreRuleCandidate(readJson(args.candidate), {
      target: args.target,
      heldOutResults: readJson(args.heldOut),
    });
    if (args.output) writeJsonAtomic(args.output, result);
  } else if (args.command === 'build-promotion') {
    requireValue(args, 'candidate');
    requireValue(args, 'heldOut');
    requireValue(args, 'target');
    requireValue(args, 'output');
    result = buildRulePromotion(readJson(args.candidate), {
      target: args.target,
      heldOutResults: readJson(args.heldOut),
    });
    writeJsonAtomic(args.output, result);
  } else if (args.command === 'promote-rule') {
    // The promotion consumer (py-v30 close, 2026-10-08): drives one candidate
    // through the full reviewed state machine — candidate→shadow→proposed,
    // scored against a target plus held-out cases, promoted to active with the
    // binding promotionDigest. Fails loud (exit 1, RULE_PROMOTION_BLOCKED) on
    // any scoring refusal and persists the score for triage when --output is
    // given; the candidate file is only rewritten when promotion succeeds.
    requireValue(args, 'candidate');
    requireValue(args, 'heldOut');
    requireValue(args, 'target');
    const candidate = readJson(args.candidate);
    if (candidate?.state !== 'candidate') {
      throw new Error(`promote-rule requires a candidate in state candidate (got ${candidate?.state || '(missing)'})`);
    }
    const proposed = transitionRuleCandidate(transitionRuleCandidate(candidate, 'shadow'), 'proposed');
    const heldOutResults = readJson(args.heldOut);
    const score = scoreRuleCandidate(proposed, { target: args.target, heldOutResults });
    if (!score.promotionReady) {
      if (args.output) {
        writeJsonAtomic(path.join(args.output, `score.${safeFileStem(candidate.candidateId)}.json`), { candidateId: candidate.candidateId, promoted: false, score });
      }
      throw new Error(`RULE_PROMOTION_BLOCKED: ${score.reasons.join(', ')}`);
    }
    const promotion = buildRulePromotion(proposed, { target: args.target, heldOutResults });
    const active = transitionRuleCandidate(proposed, 'active', {
      reviewedPromotionDigest: promotion.promotionDigest,
    });
    writeJsonAtomic(args.candidate, active);
    if (args.output) {
      const stem = safeFileStem(candidate.candidateId);
      writeJsonAtomic(path.join(args.output, `promotion.${stem}.json`), promotion);
      writeJsonAtomic(path.join(args.output, `score.${stem}.json`), score);
      writeJsonAtomic(path.join(args.output, `held-out.${stem}.json`), heldOutResults);
    }
    result = {
      candidateId: candidate.candidateId,
      state: active.state,
      target: args.target,
      heldOutCases: heldOutResults.length,
      promotionDigest: promotion.promotionDigest,
      artifactsDir: args.output || null,
    };
  } else if (args.command === 'status') {
    requireValue(args, 'input');
    const input = readJson(args.input);
    result = selectCandidateNotifications(Array.isArray(input) ? input : [input], {
      threshold: args.threshold ? Number(args.threshold) : 5,
      now: args.now || new Date().toISOString(),
    });
    if (args.output) writeJsonAtomic(args.output, result);
  } else {
    throw new Error(`Unsupported command: ${args.command || '(missing)'}`);
  }

  if (args.json) out(JSON.stringify(result, null, 2));
  else out(result.promotionDigest || result.decisionDigest || JSON.stringify(result));
  return result;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, readJson, runCli, writeJsonAtomic };
