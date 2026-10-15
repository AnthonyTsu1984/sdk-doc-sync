const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REJECTION_CODES,
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

- \`CreateCollectionReq(String collectionName)\` (*CreateCollectionReq*)

    Creates a request to create a collection.

**PARAMETERS:**

- **collectionName** (*String*)

    The name of the collection.

**RETURN TYPE:**

*Void*

**RETURNS:**

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

test('flattenDescription collapses multi-line bullet prose', () => {
  assert.equal(flattenDescription(['Check `err != nil`', 'for failure details.']), 'Check `err != nil` for failure details.');
});
