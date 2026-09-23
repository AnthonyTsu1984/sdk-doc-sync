'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyPolish } = require('../scripts/apply-polish-context');

function contextsDoc() {
    return {
        contexts: {
            'cpp:Auth:DescribeRole': {
                summary: 'old summary',
                params: [{ name: 'WithRoleName', description: 'old' }],
                exceptions: [{ condition: 'old condition', description: 'old tail' }],
                examples: [{ description: 'old example', code: 'old();' }],
                result: { type: 'Status', description: 'old result' },
            },
        },
    };
}

function polishUnit() {
    return {
        unit: 'cpp:Auth:DescribeRole',
        summary: 'This operation provides the details of the specified role.',
        params: { WithRoleName: 'Sets the name of the role to describe.' },
        exceptions: [{ condition: 'Thrown when request construction fails.', description: 'Inspect the returned Status.' }],
        examples: [{ description: 'Describe a role.', code: 'client->DescribeRole(request, response);' }],
        resultDescription: 'Returns the role description.',
    };
}

test('applyPolish applies a valid unit onto the matching context', () => {
    const doc = contextsDoc();
    const { applied, errors } = applyPolish(doc, polishUnit());
    assert.deepEqual(errors, []);
    assert.deepEqual(applied, ['cpp:Auth:DescribeRole']);
    const ctx = doc.contexts['cpp:Auth:DescribeRole'];
    assert.equal(ctx.summary, 'This operation provides the details of the specified role.');
    assert.equal(ctx.params[0].description, 'Sets the name of the role to describe.');
    assert.equal(ctx.exceptions[0].description, 'Inspect the returned Status.');
    assert.equal(ctx.examples[0].code, 'client->DescribeRole(request, response);');
    assert.equal(ctx.result.description, 'Returns the role description.');
});

test('applyPolish aborts the whole apply on any key mismatch', () => {
    const doc = contextsDoc();
    const units = [
        polishUnit(),
        { unit: 'cpp:Auth:DescribeRole', params: { WithDatabaseName: 'not in this context' } },
        { unit: 'cpp:Auth:Missing', summary: 'x' },
    ];
    const { applied, errors } = applyPolish(doc, units);
    assert.equal(applied.length, 0, 'no unit may be applied when any validation fails');
    assert.equal(errors.length, 2);
    assert.equal(doc.contexts['cpp:Auth:DescribeRole'].summary, 'old summary');
});

test('applyPolish rejects count mismatches and resultDescription without a result', () => {
    const doc = contextsDoc();
    const { errors } = applyPolish(doc, [
        { unit: 'cpp:Auth:DescribeRole', examples: [{ description: 'x' }, { description: 'y' }] },
        { unit: 'cpp:Auth:DescribeRole', resultDescription: 'no result here' },
    ]);
    assert.equal(errors.some((error) => error.includes('examples len 2 != ctx 1')), true);
    const noResult = applyPolish({ contexts: { u: { summary: 's' } } }, [
        { unit: 'u', resultDescription: 'x' },
    ]);
    assert.equal(noResult.errors[0].includes('ctx.result is undefined'), true);
});
