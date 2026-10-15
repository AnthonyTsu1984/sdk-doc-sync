'use strict';

// Shared reader for config/intake-recipes.json (campaign-control batch 15
// §8.2): the diagnostic-recipe table collected out of the per-campaign
// .dwf.ts ERROR_RECIPES copies. Matching semantics are the dwf ones —
// substring containment, table order, first match wins — so the workflow
// copies can converge onto this data file without behavior change. Wrapper
// CLIs attach the returned lines to stderr on failure; the composer consumes
// the same table for its typed-exception presentation.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RECIPES_PATH = path.join(__dirname, '..', '..', 'config', 'intake-recipes.json');

class IntakeRecipesError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'IntakeRecipesError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Fail closed: a malformed recipe table is a config defect, never silently
// "no recipes".
function validateRecipes(document, filePath) {
    if (!document || typeof document !== 'object' || document.schemaVersion !== 1) {
        throw new IntakeRecipesError('INTAKE_RECIPES_MALFORMED', `intake recipes at ${filePath} must carry schemaVersion 1`, { filePath });
    }
    if (!Array.isArray(document.recipes) || document.recipes.length === 0) {
        throw new IntakeRecipesError('INTAKE_RECIPES_MALFORMED', `intake recipes at ${filePath} must carry a non-empty recipes array`, { filePath });
    }
    document.recipes.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object'
            || typeof entry.match !== 'string' || entry.match.length === 0
            || typeof entry.recipe !== 'string' || entry.recipe.length === 0) {
            throw new IntakeRecipesError(
                'INTAKE_RECIPES_MALFORMED',
                `intake recipes at ${filePath} entry [${index}] must carry non-empty match and recipe strings`,
                { filePath, index },
            );
        }
    });
    return document.recipes;
}

function loadIntakeRecipes(filePath = DEFAULT_RECIPES_PATH) {
    let document;
    try {
        document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new IntakeRecipesError('INTAKE_RECIPES_MALFORMED', `intake recipes at ${filePath} are unreadable: ${error.message}`, { filePath });
    }
    return validateRecipes(document, filePath);
}

// The dwf recipeFor face: `<CODE> → <recipe>` or null.
function recipeFor(text, recipes = loadIntakeRecipes()) {
    const haystack = String(text || '');
    for (const entry of recipes) {
        if (haystack.includes(entry.match)) return `${entry.match} → ${entry.recipe}`;
    }
    return null;
}

// Distinct recipe lines for a batch of texts (e.g. one per planning-error
// code), in table order — the stderr face wrappers attach on failure.
function recipeLines(texts, recipes = loadIntakeRecipes()) {
    const lines = [];
    const seen = new Set();
    for (const entry of recipes) {
        if (seen.has(entry.match)) continue;
        if ((texts || []).some((text) => String(text || '').includes(entry.match))) {
            seen.add(entry.match);
            lines.push(`recipe: ${entry.match} → ${entry.recipe}`);
        }
    }
    return lines;
}

module.exports = {
    DEFAULT_RECIPES_PATH,
    IntakeRecipesError,
    loadIntakeRecipes,
    recipeFor,
    recipeLines,
    validateRecipes,
};
