const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REJECTION_CODES,
  extractH1,
  flattenDescription,
  isAllCapsAcronym,
  normalizeSummary,
  parsePage,
  splitOrderedFences,
  typedError,
} = require('../src/sdk-doc-sync/pr-page-parser');
const profiles = require('../config/pr-page-profiles.json');

// Fixtures mirror the 2026-10-15 intake page grammars (go/node/python pages
// simplified from the harvest, java synthesized from the profile) so the
// kernel contract is locked offline. Any upstream template drift that breaks
// these shapes must surface as a typed rejection at compose time, not as a
// silent field drop (design §4.5).

const GO_METHOD_PAGE = `# AddPrivilegesToGroup()

This operation adds one or more privileges to an existing privilege group.

\`\`\`go
func (c *Client) AddPrivilegesToGroup(ctx context.Context, option AddPrivilegeToGroupOption, callOptions ...grpc.CallOption) error
\`\`\`

## Request Syntax

\`\`\`go
option := milvusclient.NewAddPrivilegesToGroupOption(groupName, privilegeNames...)

err := client.AddPrivilegesToGroup(ctx, option)
\`\`\`

**PARAMETERS:**

- **groupName** (*string*)

    The name of the privilege group.

- **privilegeNames** (*...string*)

    The names of the privileges to add to the group.

**BUILDER METHODS:**

- \`NewAddPrivilegesToGroupOption(groupName string, privileges ...string)\`

    Creates a new option to add privileges to a privilege group.

**RETURN TYPE:**

*error*

**RETURNS:**

Returns nil on success, or an error describing what went wrong.

**ERROR HANDLING:**

- **error**

    Check \`err != nil\` for failure details.

## Example

\`\`\`go
err := client.AddPrivilegesToGroup(ctx, option)
\`\`\`

## Related operations

- [CreateRole](Authentication/CreateRole.md)
- [DropRole](Authentication/DropRole.md)
`;

const GO_TYPE_PAGE = `# CollectionSchema

Represents the schema of a collection.

\`\`\`go
type CollectionSchema struct { /* ... */ }
\`\`\`

**PARAMETERS:**

- **fields** (*[]*FieldSchema*)

    The fields of the schema.

## Example

\`\`\`go
schema := entity.NewSchema().WithField(...)
\`\`\`

## Notes

Bare notes section must be qualified by the composer, not parsed away.
`;

const NODE_METHOD_PAGE = `# addPrivilegesToGroup()

This operation adds privileges to a specific privilege group in Milvus.

\`\`\`javascript
await milvusClient.addPrivilegesToGroup(data)
\`\`\`

## Request Syntax

\`\`\`javascript
await milvusClient.addPrivilegesToGroup({
   group_name: string,
   privileges: string[]
 })
\`\`\`

**PARAMETERS:**

- **group_name** (*string*) -

    **[REQUIRED]**

    The name of a privilege group.

- **timeout** (*number*) -

    The timeout duration for this operation.

    Default: \`30000\`

**RETURNS:**

*Promise\\<ResStatus\\>*

This method returns a promise that resolves to a **ResStatus** object.

\`\`\`javascript
// res = { error_code: 0, reason: '' }
\`\`\`

**EXCEPTIONS:**

- **MilvusException**

    Raised when the RPC fails.

## Example

\`\`\`javascript
await milvusClient.addPrivilegesToGroup({ group_name: "g", privileges: ["p"] });
\`\`\`
`;

const PYTHON_METHOD_PAGE = `# alter_collection_properties()

This operation alters the specified collection properties.

<div class="alert note">

This does not apply to external collections.

</div>

## Request Syntax

\`\`\`python
alter_collection_properties(
    self, 
    collection_name: str, 
    properties: dict, 
    timeout: Optional[float] = None
)
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -

    The name of the target collection.

- **properties** (*dict*) -

    The properties and their new values in a dictionary.

    - **collection.ttl.seconds** (*int*) -

        The time-to-live (TTL) of a collection in seconds.

**RETURN TYPE:**

*None*

**RETURNS:**

**EXCEPTIONS:**

- \`MilvusException\` - Raised when the RPC fails.

## Examples

\`\`\`python
milvus_client.alter_collection_properties(
    collection_name="test",
    properties={"collection.ttl.seconds": 60}
)
\`\`\`
`;

const JAVA_METHOD_PAGE = `# createCollection()

This method creates a collection in Milvus.

## Request Syntax

\`\`\`java
// include-start milvus
CreateCollectionReq createCollectionReq = CreateCollectionReq.builder()
    .collectionName("test")
    .build();
client.createCollection(createCollectionReq);
// include-end
// include-start zilliz
CreateCollectionReq createCollectionReq = CreateCollectionReq.builder()
    .collectionName("quick_setup")
    .build();
client.createCollection(createCollectionReq);
// include-end
\`\`\`

**BUILDER METHODS:**

- \`CreateCollectionReq(String collectionName)\` (*CreateCollectionReq*) - builds the request wrapper.

    Detailed builder prose stays on its own lines.

**PARAMETERS:**

- **collectionName** (*String*)

    The name of the collection.

**RETURN TYPE:**

*Void*

**RETURNS:**

*CreateCollectionRes*

- \`getCollectionName()\` (*String*) - the name echoed back by the server.
- \`getFieldName()\` (*String*) - the target field name.

    A getter's block description rides its own lines.

**EXCEPTIONS:**

- **MilvusClientException**

    Raised when the RPC fails.

## Example

\`\`\`java
client.createCollection(createCollectionReq);
\`\`\`
`;

test('go method page parses the full verbatim-route contract', () => {
  const parsed = parsePage(GO_METHOD_PAGE, { ...profiles.go, route: 'verbatim' }, 'go-method.md');
  assert.equal(parsed.title, 'AddPrivilegesToGroup()');
  assert.equal(parsed.titleBase, 'AddPrivilegesToGroup');
  assert.equal(parsed.summary, 'This operation adds one or more privileges to an existing privilege group.');
  assert.equal(parsed.summaryRegisterNormalized, false);
  assert.match(parsed.signature, /func \(c \*Client\) AddPrivilegesToGroup/);
  assert.match(parsed.requestDisplay, /^option := milvusclient\.NewAddPrivilegesToGroupOption/);
  assert.equal(parsed.requestIntro, ''); // go pages carry no prose intro inside Request Syntax
  assert.equal(parsed.params.length, 3);
  assert.deepEqual(
    parsed.params.map((entry) => [entry.name, entry.type, entry.builderArgType || null]),
    [
      ['groupName', 'string', null],
      ['privilegeNames', '...string', null],
      // builder form: builderArgType is the first word of the builder argument
      // list ("groupName string, privileges ...string").
      ['NewAddPrivilegesToGroupOption', null, 'groupName'],
    ],
  );
  assert.equal(parsed.returnType, 'error');
  assert.match(parsed.returnsDescription, /Returns nil on success/);
  assert.deepEqual(parsed.exceptions.map((entry) => entry.name), ['error']);
  assert.match(parsed.exceptions[0].description, /Check `err != nil` for failure details/);
  assert.equal(parsed.exampleFences.length, 1);
  assert.match(parsed.exampleFences[0], /err := client\.AddPrivilegesToGroup/);
  assert.deepEqual(parsed.related, [
    { text: 'CreateRole', target: 'Authentication/CreateRole.md' },
    { text: 'DropRole', target: 'Authentication/DropRole.md' },
  ]);
  assert.equal(parsed.stats.bulletForms.param, 2);
  assert.equal(parsed.stats.bulletForms.builder, 1);
});

test('go type page derives the instance register and skips the method suffix', () => {
  const parsed = parsePage(GO_TYPE_PAGE, { ...profiles.go, route: 'verbatim' }, 'go-type.md');
  assert.equal(parsed.titleBase, 'CollectionSchema');
  assert.match(parsed.summary, /^A CollectionSchema instance represents the schema/);
  assert.equal(parsed.summaryRegisterNormalized, true);
  // No ## Example section heading match would fail; here one exists.
  assert.equal(parsed.exampleFences.length, 1);
});

test('node page carries REQUIRED/default tail modifiers and inline returns type', () => {
  const parsed = parsePage(NODE_METHOD_PAGE, { ...profiles.node, route: 'structured' }, 'node-method.md');
  const required = parsed.params.find((entry) => entry.name === 'group_name');
  assert.equal(required.required, true);
  const timeout = parsed.params.find((entry) => entry.name === 'timeout');
  assert.equal(timeout.required, false);
  assert.equal(timeout.defaultValue, '30000');
  assert.equal(parsed.returnsTypeLine, 'Promise<ResStatus>');
  // Parser keeps raw markdown emphasis; plain-text shaping is composer-side.
  assert.match(parsed.returnsDescription, /promise that resolves to a \*\*ResStatus\*\* object/);
  assert.match(parsed.returnsSchemaFence, /error_code: 0/);
  assert.equal(parsed.stats.tailModifiers.required, 1);
  assert.equal(parsed.stats.tailModifiers.default, 1);
});

test('python page collects summary callouts, nested parameter children, and single-line exceptions', () => {
  const parsed = parsePage(PYTHON_METHOD_PAGE, { ...profiles.python, route: 'structured' }, 'python-method.md');
  assert.deepEqual(parsed.summaryCallouts, [{ kind: 'note', text: 'This does not apply to external collections.' }]);
  const properties = parsed.params.find((entry) => entry.name === 'properties');
  assert.equal(properties.children.length, 1);
  assert.equal(properties.children[0].name, 'collection.ttl.seconds');
  assert.equal(properties.children[0].type, 'int');
  assert.equal(parsed.returnType, 'None');
  assert.deepEqual(parsed.exceptions.map((entry) => entry.name), ['MilvusException']);
  assert.match(parsed.exceptions[0].description, /Raised when the RPC fails/);
  assert.equal(parsed.stats.bulletForms.pythonException, 1);
});

test('java page keeps include markers in the raw request fence for variant splitting', () => {
  const parsed = parsePage(JAVA_METHOD_PAGE, { ...profiles.java, route: 'structured' }, 'java-method.md');
  assert.equal(parsed.summary, 'This operation creates a collection in Milvus.');
  assert.equal(parsed.summaryRegisterNormalized, true);
  assert.match(parsed.signature, /CreateCollectionReq createCollectionReq = CreateCollectionReq\.builder\(\)/);
  assert.match(parsed.requestFenceText, /include-start milvus/);
  assert.match(parsed.requestFenceText, /include-start zilliz/);
  assert.equal(parsed.returnType, 'Void');
  assert.deepEqual(parsed.exceptions.map((entry) => entry.name), ['MilvusClientException']);
});

test('getter bullets win over the builder form and both capture inline descriptions (review P1-1)', () => {
  // Review P1-1: the getter branch was dead code — the builder regex accepted
  // empty parens and ran first, so every real getter bullet was counted (and
  // shaped) as a zero-arg builder, silently dropping its type and inline
  // description. The getter form must judge first and win.
  const parsed = parsePage(JAVA_METHOD_PAGE, { ...profiles.java, route: 'structured' }, 'java-method.md');
  // getters: empty-paren `getX()` (*Type*) bullets from the RETURNS section
  assert.deepEqual(parsed.getters.map((getter) => [getter.name, getter.type]), [
    ['getCollectionName', 'String'],
    ['getFieldName', 'String'],
  ]);
  assert.equal(parsed.stats.bulletForms.getter, 2);
  assert.equal(parsed.stats.bulletForms.builder, 1);
  // inline descriptions survive: "- the name echoed back by the server." rides
  // the bullet line, the block description on its own lines joins it.
  assert.equal(parsed.getters[0].descriptionLines.join(' '), 'the name echoed back by the server.');
  assert.match(parsed.getters[1].descriptionLines.join(' ').replace(/\s+/g, ' '), /the target field name\. A getter's block description/);
  // builder: non-empty parameter list required, inline description captured.
  const builder = parsed.params.find((entry) => entry.name === 'CreateCollectionReq');
  assert.equal(builder.builderArgType, 'String');
  // (The trailing section-heading noise in descriptionLines is pre-existing
  // section scoping — the java profile's BUILDER METHODS section stops at
  // RETURN TYPE, so the PARAMETERS heading line rides along; outside P1-1.)
  assert.match(
    builder.descriptionLines.join(' ').replace(/\s+/g, ' '),
    /^builds the request wrapper\. Detailed builder prose stays on its own lines\./,
  );
});

test('summary register normalization follows the three-branch contract', () => {
  const profile = { verbStarts: ['represents', 'defines'] };
  // Branch 1: already in register.
  assert.deepEqual(
    normalizeSummary('This operation adds privileges.', { title: 'Add', isTypePage: false, profile }),
    { summary: 'This operation adds privileges.', normalized: false },
  );
  assert.deepEqual(
    normalizeSummary('A Collection instance represents a collection.', { title: 'Collection', isTypePage: true, profile }),
    { summary: 'A Collection instance represents a collection.', normalized: false },
  );
  // Branch 2: This function/method/getter/setter prefix swap.
  assert.deepEqual(
    normalizeSummary('This method creates a collection.', { title: 'CreateCollection', isTypePage: false, profile }),
    { summary: 'This operation creates a collection.', normalized: true },
  );
  // Branch 3: verb-first type page wraps into the instance register.
  assert.deepEqual(
    normalizeSummary('Defines the fields of a collection.', { title: 'CollectionSchema', isTypePage: true, profile }),
    { summary: 'A CollectionSchema instance defines the fields of a collection.', normalized: true },
  );
  // Branch 3: verb-first type page (go verbStarts) wraps without "is".
  assert.deepEqual(
    normalizeSummary('Holds collection data.', { title: 'Data', isTypePage: true, profile: profiles.go }),
    { summary: 'A Data instance holds collection data.', normalized: true },
  );
  // Non-verb type page gets the literal "is" wrap.
  assert.deepEqual(
    normalizeSummary('Tracks collection data.', { title: 'Data', isTypePage: true, profile }),
    { summary: 'A Data instance is tracks collection data.', normalized: true },
  );
  // Acronym protection: an all-caps first word is never lower-cased (java
  // precedent) — "This operation rBAC controls..." is the bug this prevents.
  const acronym = normalizeSummary('RBAC controls permissions.', { title: 'RBAC', isTypePage: false, profile });
  assert.equal(acronym.summary, 'This operation RBAC controls permissions.');
  // Non-type, non-this: This operation <lowerFirst>.
  assert.deepEqual(
    normalizeSummary('Drops a partition.', { title: 'DropPartition', isTypePage: false, profile }),
    { summary: 'This operation drops a partition.', normalized: true },
  );
});

test('acronym and case helpers behave per the java precedent', () => {
  assert.equal(isAllCapsAcronym('RBAC'), true);
  assert.equal(isAllCapsAcronym('Role'), false);
  assert.equal(isAllCapsAcronym('A'), false);
  assert.equal(require('../src/sdk-doc-sync/pr-page-parser').lowerFirst('Drops'), 'drops');
});

test('typed rejections cover the fail-loud contract (design §4.5-1)', () => {
  assert.throws(() => parsePage('no heading here', { ...profiles.go }, 'x.md'), (error) => {
    assert.equal(error.code, REJECTION_CODES.PAGE_H1_MISSING);
    return true;
  });
  assert.throws(() => parsePage('# Title()\n\n```go\nunclosed\n', { ...profiles.go }, 'x.md'), (error) => {
    assert.equal(error.code, REJECTION_CODES.SIGNATURE_FENCE_MISSING);
    return true;
  });
  assert.throws(() => parsePage('# Title()\n\n## Request Syntax\n\n```go\nx\n```\n', { ...profiles.java, returnTypeRequired: true }, 'x.md'), (error) => {
    assert.equal(error.code, REJECTION_CODES.PAGE_SUMMARY_MISSING);
    return true;
  });
  const badBullet = GO_METHOD_PAGE.replace('- **groupName** (*string*)', '- {groupName: string}');
  assert.throws(() => parsePage(badBullet, { ...profiles.go }, 'go-method.md'), (error) => {
    assert.equal(error.code, REJECTION_CODES.BULLET_FORM_UNRECOGNIZED);
    assert.match(error.message, /rule-candidate/);
    return true;
  });
  // batch15 review P1': a top-level plain-prose bullet is template drift, not a
  // parameter — it must fail loud instead of folding the sentence in as a name.
  const topProse = NODE_METHOD_PAGE.replace('- **group_name** (*string*)', '- This whole sentence is a top-level prose bullet with no markup at all');
  assert.throws(() => parsePage(topProse, { ...profiles.node }, 'node-prose.md'), (error) => {
    assert.equal(error.code, REJECTION_CODES.BULLET_FORM_UNRECOGNIZED);
    assert.match(error.message, /top-level prose bullet/);
    return true;
  });
  assert.throws(
    () => parsePage(GO_METHOD_PAGE, { ...profiles.go, returnTypeRequired: true, returnTypeHeading: '^\\*\\*MISSING TYPE:\\*\\*\\s*$', requireSignature: false }, 'go-method.md'),
    (error) => {
      assert.equal(error.code, REJECTION_CODES.RETURN_TYPE_MISSING);
      return true;
    },
  );
  const digestCode = typedError(REJECTION_CODES.PAGE_DUMP_DIGEST_MISMATCH, 'sha mismatch');
  assert.equal(digestCode.code, 'PAGE_DUMP_DIGEST_MISMATCH');
});

test('fence-aware sectioning ignores heading markers inside code fences', () => {
  const parts = splitOrderedFences('# T()\n\n```go\n// **RETURN TYPE:** inside fence\n```\n\n**RETURN TYPE:**\n\n*error*\n');
  const fenced = parts.find((part) => part.fence);
  assert.equal(fenced.text.includes('**RETURN TYPE:**'), true);
  const parsed = parsePage('# T()\n\nThis operation does the thing.\n\n## Request Syntax\n\n```go\nclient.T(ctx)\n```\n\n**PARAMETERS:**\n\n- **a** (*string*)\n\n    The a parameter.\n\n**RETURN TYPE:**\n\n```go\n// **RETURN TYPE:** decoy\n```\n\n*error*\n', { ...profiles.go, route: 'verbatim' }, 'fence.md');
  assert.equal(parsed.returnType, 'error');
  assert.equal(parsed.params.length, 1);
});

test('unified fence semantics: indent, non-word info strings, orphan closers, fence-aware H1 (review P2-5)', () => {
  // Openers: up to 3 spaces indent, non-word info strings; the language is
  // the info string's first word.
  const indented = splitOrderedFences('# T()\n\n   ```go\nx := 1\n   ```\n');
  assert.equal(indented.filter((part) => part.fence).length, 1);
  assert.equal(indented.find((part) => part.fence).lang, 'go');
  const tagged = splitOrderedFences('```js showLineNumbers\nlet x = 1;\n```\n');
  assert.equal(tagged.find((part) => part.fence).lang, 'js');
  const cpp = splitOrderedFences('```c++\nint x;\n```\n');
  assert.equal(cpp.find((part) => part.fence).lang, 'c++');

  // Orphan closer: a bare ``` line with no open fence stays prose instead of
  // opening a phantom fence that swallows the following heading.
  const orphan = splitOrderedFences('prose before\n```\n\n**PARAMETERS:**\n\n- **a** (*string*)\n');
  assert.equal(orphan.some((part) => part.fence), false);
  const orphanParsed = parsePage('# T()\n\nThis operation does it.\n\nstray closer below\n```\n\n**PARAMETERS:**\n\n- **a** (*string*)\n', { ...profiles.go, route: 'verbatim' }, 'orphan.md');
  assert.equal(orphanParsed.params.length, 1);

  // H1 extraction is fence-aware: a `# comment` inside a fence is not a title.
  assert.equal(extractH1('```python\n# this is a comment\n```\n\n# RealTitle()\n'), 'RealTitle()');
  assert.throws(() => parsePage('```python\n# fake title comment\n```\n', { ...profiles.python, route: 'structured', requireSignature: false }, 'nofence.md'), (error) => {
    assert.equal(error.code, REJECTION_CODES.PAGE_H1_MISSING);
    return true;
  });
});

// 2026-10-20 fixes (shadow campaign #1 round-6 freeze):
// ① indented example fences under list items are real fences (create_collection
//    had 6 examples, the 0-3 space cap saw only 1 → writer reconstructed and
//    mis-attributed lead-ins);
// ② each example fence carries its own preceding lead-in (heading/bullet label),
//    never the whole Examples section dumped into example 1;
// ③ RETURN TYPE section accepts a short plain token ("None") as type, not just
//    the bold `*None*` form (verify pages write plain None; prose sentences are
//    excluded by the length/punctuation guard).
test('indented fences under list items are detected with per-example lead-ins', () => {
  const text = `# create_collection()

This operation creates a collection.

## Request Syntax

\`\`\`python
client.create_collection(collection_name: str)
\`\`\`

## Examples

### Set up a Milvus client

\`\`\`python
from pymilvus import MilvusClient
client = MilvusClient(uri="http://localhost:19530")
\`\`\`

- **Quick setup**

    \`\`\`python
    client.create_collection(
        collection_name="test_collection",
        dimension=5
    )
    \`\`\`

- **Customized setup with index parameters**

    \`\`\`python
    client.create_collection(
        collection_name="quick_setup",
        dimension=5,
        index_params=index_params
    )
    \`\`\`
`;
  const parsed = parsePage(text, { ...profiles.python, route: 'verbatim' }, 'create_collection.md');
  assert.equal(parsed.exampleFences.length, 3);
  assert.equal(parsed.exampleLeadIns.length, 3);
  assert.match(parsed.exampleLeadIns[0], /Set up a Milvus client/);
  assert.match(parsed.exampleLeadIns[1], /Quick setup/);
  assert.match(parsed.exampleLeadIns[2], /Customized setup with index parameters/);
  // The indented fence's code is preserved verbatim (no mis-attribution).
  assert.match(parsed.exampleFences[1], /collection_name="test_collection"/);
});

test('plain RETURN TYPE token is captured, prose is not', () => {
  const plainNone = `# verify()

This operation validates a function.

## Request Syntax

\`\`\`python
verify(schema: CollectionSchema)
\`\`\`

**RETURN TYPE:**

None

**RETURNS:**

None
`;
  const parsedPlain = parsePage(plainNone, { ...profiles.python, route: 'structured', requireSignature: false }, 'verify.md');
  assert.equal(parsedPlain.returnType, 'None');

  // Bold form still works (create_role).
  const boldNone = plainNone.replace('**RETURN TYPE:**\n\nNone', '**RETURN TYPE:**\n\n*None*');
  const parsedBold = parsePage(boldNone, { ...profiles.python, route: 'structured', requireSignature: false }, 'create_role.md');
  assert.equal(parsedBold.returnType, 'None');

  // Prose (sentence with terminal period) is NOT a type token.
  const prose = plainNone.replace('**RETURN TYPE:**\n\nNone', '**RETURN TYPE:**\n\nInstance of \\`Function\\` that encapsulates the behavior for converting data.');
  const parsedProse = parsePage(prose, { ...profiles.python, route: 'structured', requireSignature: false }, 'function.md');
  assert.equal(parsedProse.returnType, null);
});

test('flattenDescription collapses multi-line bullet prose', () => {
  assert.equal(flattenDescription(['Check `err != nil`', 'for failure details.']), 'Check `err != nil` for failure details.');
});

// 2026-10-20 fixes (shadow campaign #1 round-8 freeze):
// ① summaryRaw is exposed so UPDATE units keep the PR first paragraph verbatim
//    (the N7 register-wrap must not turn "Adds ..." into "This operation adds ...");
// ② RETURN TYPE/RETURNS headings with the colon OUTSIDE the bold
//    ("**RETURN TYPE**:") are matched, not just colon-inside ("**RETURN TYPE:**");
// ③ a prose sentence in the RETURN TYPE section is captured as returnTypeProse
//    (not lost) so the composer can fold it into the result description.
test('summaryRaw stays PR-verbatim while summary carries the register wrap', () => {
  const text = `# with_query()

Adds a query-term definition to a \`LexicalHighlighter\` configuration for highlighting text.

## Request Syntax

\`\`\`python
with_query(highlight_query: list)
\`\`\`
`;
  const parsed = parsePage(text, { ...profiles.python, route: 'structured', requireSignature: false }, 'with_query.md');
  assert.match(parsed.summaryRaw, /^Adds a query-term definition/);
  assert.match(parsed.summary, /^This operation adds a query-term definition/);
});

test('colon-outside RETURN headings are matched and prose is captured', () => {
  const text = `# LexicalHighlighter()

The **LexicalHighlighter** configures highlighting.

## Constructor

\`\`\`python
LexicalHighlighter()
\`\`\`

**RETURN TYPE**:

*LexicalHighlighter*

**RETURNS**:

A **LexicalHighlighter** object.
`;
  const parsed = parsePage(text, { ...profiles.python, route: 'structured', requireSignature: false }, 'LexicalHighlighter.md');
  assert.equal(parsed.returnType, 'LexicalHighlighter');
  assert.match(parsed.returnsDescription, /A \*\*LexicalHighlighter\*\* object/);

  // Prose RETURN TYPE section (no bold token) is captured as returnTypeProse.
  const proseType = `# Function()

A \`Function\` instance for embeddings.

## Request Syntax

\`\`\`python
Function(name: str)
\`\`\`

**RETURN TYPE**:

Instance of \`Function\` that encapsulates the specific processing behavior for converting raw data to vector embeddings.

**RETURNS**:

A \`Function\` object.
`;
  const parsedProse = parsePage(proseType, { ...profiles.python, route: 'structured', requireSignature: false }, 'Function.md');
  assert.equal(parsedProse.returnType, null);
  assert.match(parsedProse.returnTypeProse, /^Instance of \`Function\` that encapsulates/);
});

// 2026-10-21 fixes (shadow campaign #1 round-11 freeze): a class-method note
// placed AFTER the Request Syntax fence must still surface as a summary
// callout (create_schema / construct_from_dict), not be silently dropped by
// the pre-first-fence scan.
test('summary callouts after the first fence are captured (round-11 freeze)', () => {
  const text = `# create_schema()

This operation creates a collection schema.

## Request syntax

\`\`\`python
MilvusClient.create_schema(**kwargs) -> CollectionSchema
\`\`\`

<div class="alert note">

This is a class method. You should call this method like this: \`MilvusClient.create_schema()\`.

</div>

**PARAMETERS:**

- **kwargs** -
`;
  const parsed = parsePage(text, { ...profiles.python, route: 'structured', requireSignature: false }, 'create_schema.md');
  assert.equal(parsed.summaryCallouts.length, 1);
  assert.equal(parsed.summaryCallouts[0].kind, 'note');
  assert.match(parsed.summaryCallouts[0].text, /class method/);
});

// ---- four-language real-page replay (review P1-2) ---------------------------
//
// The full 2026-10-15 intake page dumps (643 pages, sha-pinned by the intake
// campaigns) replay with ZERO typed rejections of the three drift codes. Any
// new upstream shape lands here as a typed rejection and is fixed with
// profile data (config/pr-page-profiles.json formEvidence keys name the
// harvest page of every accepted form), never by loosening the kernel.

const REPLAY_DIR = path.join(__dirname, 'fixtures', 'pr-page-replay');
const REPLAY_TRACKS = [
  ['go', 'go-v26', 101], ['go', 'go-v30', 118],
  ['java', 'java-v26', 64], ['java', 'java-v30', 26],
  ['node', 'node-v26', 140], ['node', 'node-v30', 159],
  ['python', 'python-v26', 15], ['python', 'python-v30', 25],
];
const DRIFT_CODES = new Set([
  REJECTION_CODES.BULLET_FORM_UNRECOGNIZED,
  REJECTION_CODES.SIGNATURE_FENCE_MISSING,
  REJECTION_CODES.PAGE_SUMMARY_MISSING,
]);

for (const [language, dir, expected] of REPLAY_TRACKS) {
  test(`replay ${language} ${dir}: ${expected} real pages parse with zero drift rejections`, () => {
    const full = path.join(REPLAY_DIR, dir);
    const pages = fs.readdirSync(full).filter((name) => name.endsWith('.md')).sort();
    assert.equal(pages.length, expected, 'fixture corpus must stay complete');
    const failures = [];
    const stats = { getter: 0, proseBullet: 0, bareParam: 0, emphasisParam: 0, describedChoice: 0, enumEquality: 0, callbackChoice: 0, untypedDescribed: 0 };
    for (const name of pages) {
      const text = fs.readFileSync(path.join(full, name), 'utf8');
      try {
        const parsed = parsePage(text, { ...profiles[language], route: profiles[language].route }, `${dir}/${name}`);
        stats.getter += parsed.stats.bulletForms.getter;
        stats.proseBullet += parsed.stats.bulletForms.proseBullet;
        stats.bareParam += parsed.stats.bulletForms.bareParam;
        stats.emphasisParam += parsed.stats.bulletForms.emphasisParam;
        stats.describedChoice += parsed.stats.bulletForms.describedChoice;
        stats.enumEquality += parsed.stats.bulletForms.enumEquality;
        stats.callbackChoice += parsed.stats.bulletForms.callbackChoice;
        stats.untypedDescribed += parsed.stats.bulletForms.untypedDescribed;
      } catch (error) {
        if (DRIFT_CODES.has(error.code)) failures.push(`${name}: [${error.code}] ${error.message.slice(0, 140)}`);
        else throw error; // non-drift rejections fail the test directly
      }
    }
    assert.deepEqual(failures, [], `${dir}: upstream template drift detected`);
    if (language === 'java' && dir === 'java-v26') assert.equal(stats.getter, 249, 'java getter bullets must count as the getter form (review P1-1: was 0)');
    if (language === 'node') {
      assert.ok(stats.bareParam > 0, 'node bareParam form exercised');
      assert.ok(stats.enumEquality > 0, 'node enumEquality form exercised');
      assert.ok(stats.callbackChoice > 0, 'node callbackChoice form exercised');
      assert.ok(stats.proseBullet > 0, 'node proseBullet form exercised');
    }
    if (language === 'python' && dir === 'python-v26') {
      assert.ok(stats.emphasisParam > 0, 'python emphasisParam form exercised');
      assert.ok(stats.describedChoice > 0, 'python describedChoice form exercised');
      assert.ok(stats.untypedDescribed > 0, 'python trailing-dash untypedDescribed form exercised');
    }
    if (language === 'python' && dir === 'python-v30') {
      assert.ok(stats.proseBullet > 0, 'python proseBullet form exercised');
    }
  });
}

test('profile data carries the harvest evidence for every accepted form (review P1-2 rule)', () => {
  for (const language of ['go', 'java', 'node', 'python']) {
    const profile = profiles[language];
    for (const form of profile.bulletForms || []) {
      assert.ok(
        // The five base forms + untypedDescribed (the go ERROR HANDLING
        // single-line shape) predate the batch-15 harvest and are documented
        // on the kernel's bullet-grammar comment; forms added by the P1-2
        // harvest must carry their own formEvidence key.
        ['builder', 'getter', 'param', 'untyped', 'untypedDescribed', 'enumChoice', 'backtickChoice', 'pythonParam', 'pythonException'].includes(form)
          || Object.keys(profile.formEvidence || {}).some((key) => key === form || key.startsWith(`${form}(`)),
        `${language}: bullet form "${form}" has no formEvidence entry`,
      );
    }
  }
});

test('PARAMS marker accepts both upstream faces and refuses an unparsed marker', () => {
  const pyProfile = profiles.python;
  const base = (markerLine) => `# Widget()

Creates a widget.

\`\`\`python
Widget(x)
\`\`\`

${markerLine}

- **x** (*int*) - The widget count.
`;
  // colon-inside face (the majority upstream face) parses
  const inside = parsePage(base('**PARAMETERS:**'), pyProfile, 'inside');
  assert.equal(inside.params.length, 1);
  assert.equal(inside.params[0].name, 'x');
  // colon-outside face (2026-10-23 pymilvus Highlighter family) parses too
  const outside = parsePage(base('**PARAMETERS**:'), pyProfile, 'outside');
  assert.equal(outside.params.length, 1);
  assert.equal(outside.params[0].name, 'x');
  // a marker the profile chain somehow misses is a loud rejection, never a
  // silent params=[] (the wall that deleted the Highlighter Constructor
  // section while document==artifact verification stayed green).
  const strippedProfile = { ...pyProfile, paramsHeadings: [] };
  assert.throws(
    () => parsePage(base('**PARAMETERS**:'), strippedProfile, 'unparsed'),
    (error) => error.code === REJECTION_CODES.PARAMS_SECTION_UNPARSED,
  );
});

