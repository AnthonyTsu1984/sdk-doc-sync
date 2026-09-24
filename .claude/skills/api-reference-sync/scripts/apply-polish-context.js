#!/usr/bin/env node
'use strict';

// Apply polish-subagent outputs onto a reviewed-contexts document — the
// language-agnostic productization of the campaign's apply-polish pipeline.
// A polish unit targets one context by its stableId and may carry:
//   { unit, summary?, resultDescription?, params?: {builderName: description},
//     exceptions?: [{condition?, description?}], examples?: [{description?, code?}] }
// Validation runs for EVERY unit before anything mutates; any unknown
// stableId, unknown builder name, or count mismatch aborts the whole apply
// with exit 1 (the campaign rule: abort the whole apply on any key mismatch).
//
// Usage: node scripts/apply-polish-context.js --contexts <file> --polish <file-or-dir>

const fs = require('node:fs');
const path = require('node:path');

function strip(value) {
    return typeof value === 'string' ? value.trim() : value;
}

// Pure: validates and applies polish units onto the contexts document.
// Returns { applied, errors } — `applied` lists unit ids; on any error the
// input document is returned untouched.
function applyPolish(contextsDoc, polishUnits) {
    const errors = [];
    const applied = [];
    const contexts = contextsDoc?.contexts;
    if (!contexts || typeof contexts !== 'object') {
        return { applied, errors: ['contexts document carries no contexts map'] };
    }
    const units = Array.isArray(polishUnits) ? polishUnits : [polishUnits];

    // Validation pass — no mutation until every unit validates.
    const plans = [];
    for (const unit of units) {
        const unitId = unit?.unit;
        const ctx = contexts[unitId];
        if (!unitId || !ctx) {
            errors.push(`${unitId || '(missing unit id)'}: no context entry`);
            continue;
        }
        const plan = { unitId, ctx, params: new Map() };
        // Presence-based: a polish unit may CLEAR a field to '' — the
        // mutation must run and store the empty string, not silently skip
        // while still reporting the unit as applied.
        plan.hasSummary = unit.summary !== undefined && unit.summary !== null;
        if (plan.hasSummary) plan.summary = strip(unit.summary);
        const ctxParams = new Map((ctx.params || []).map((param) => [param.name, param]));
        for (const [name, description] of Object.entries(unit.params || {})) {
            if (!ctxParams.has(name)) {
                errors.push(`${unitId}: param ${name} not in context`);
                continue;
            }
            plan.params.set(name, { param: ctxParams.get(name), description: strip(description) });
        }
        const ctxExceptions = ctx.exceptions || [];
        const unitExceptions = unit.exceptions || [];
        // Absent fields are opt-out; a provided array must align exactly.
        if (unit.exceptions !== undefined && unitExceptions.length !== ctxExceptions.length) {
            errors.push(`${unitId}: exceptions len ${unitExceptions.length} != ctx ${ctxExceptions.length}`);
        } else {
            plan.exceptions = unitExceptions.map((exception, index) => ({
                target: ctxExceptions[index],
                condition: strip(exception.condition),
                description: strip(exception.description),
            }));
        }
        const ctxExamples = ctx.examples || [];
        const unitExamples = unit.examples || [];
        if (unit.examples !== undefined && unitExamples.length !== ctxExamples.length) {
            errors.push(`${unitId}: examples len ${unitExamples.length} != ctx ${ctxExamples.length}`);
        } else {
            plan.examples = unitExamples.map((example, index) => ({
                target: ctxExamples[index],
                description: strip(example.description),
                code: strip(example.code),
            }));
        }
        if (unit.resultDescription !== undefined && unit.resultDescription !== null) {
            if (!ctx.result || typeof ctx.result !== 'object') {
                errors.push(`${unitId}: resultDescription but ctx.result is ${ctx.result === null ? 'null' : typeof ctx.result}`);
            } else {
                plan.resultDescription = strip(unit.resultDescription);
            }
        }
        plans.push(plan);
    }
    if (errors.length > 0) return { applied, errors };

    // Mutation pass — only after every unit validated.
    for (const plan of plans) {
        if (plan.hasSummary) plan.ctx.summary = plan.summary;
        if (plan.resultDescription !== undefined) plan.ctx.result.description = plan.resultDescription;
        for (const { param, description } of plan.params.values()) {
            param.description = description;
        }
        for (const { target, condition, description } of plan.exceptions) {
            if (condition) target.condition = condition;
            if (description) target.description = description;
        }
        for (const { target, description, code } of plan.examples) {
            if (description) target.description = description;
            if (code) target.code = code;
        }
        applied.push(plan.unitId);
    }
    return { applied, errors };
}

function parseArgs(argv) {
    const options = {};
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--contexts') options.contexts = path.resolve(argv[++index]);
        else if (arg === '--polish') options.polish = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.contexts || !options.polish) {
        throw new Error('--contexts and --polish are required');
    }
    return options;
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const contextsDoc = JSON.parse(fs.readFileSync(options.contexts, 'utf8'));
    const polishPath = options.polish;
    const polishUnits = fs.statSync(polishPath).isDirectory()
        ? fs.readdirSync(polishPath).filter((name) => name.endsWith('.json')).sort()
            .map((name) => JSON.parse(fs.readFileSync(path.join(polishPath, name), 'utf8')))
        : [JSON.parse(fs.readFileSync(polishPath, 'utf8'))];

    const { applied, errors } = applyPolish(contextsDoc, polishUnits);
    if (errors.length > 0) {
        for (const error of errors) process.stderr.write(`${error}\n`);
        process.exit(1);
    }
    fs.writeFileSync(options.contexts, `${JSON.stringify(contextsDoc, null, 2)}\n`);
    process.stdout.write(`applied ${applied.length} polish unit(s): ${applied.join(', ')}\n`);
}

if (require.main === module) {
    main(process.argv).catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { applyPolish };
