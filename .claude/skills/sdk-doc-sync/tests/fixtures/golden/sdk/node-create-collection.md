# createCollection()

Creates a collection through the Node.js client.

<include target="milvus">
Available to Milvus users.
</include>

```typescript
client.createCollection(data)
```

## Request Syntax

### Simple collection

Creates a collection with a dimension and primary field.

```typescript
await client.createCollection({ collection_name, dimension })
```

**PARAMETERS:**

- **collection\_name** (*string*) - **\[REQUIRED\]**
  Collection name.
- **dimension** (*number*) - **\[REQUIRED\]**
  Vector dimension.
  Constraints: Must be positive.

### Custom schema

Creates a collection from an explicit schema.

```typescript
await client.createCollection({ collection_name, schema })
```

**PARAMETERS:**

- **collection\_name** (*string*) - **\[REQUIRED\]**
  Collection name.
- **schema** ([FieldType\[\]](/reference/node/field-type)) - **\[REQUIRED\]**
  Collection fields.
  - **name** (*string*) - **\[REQUIRED\]**
    Field name.
  - **data\_type** ([DataType](/reference/node/data-type)) - **\[REQUIRED\]**
    Field data type.

**RETURNS:**

[Promise&lt;CreateCollectionResponse&gt;](/reference/node/create-collection-response)

Resolves after the collection is created.

- **status** (*Status*) - **\[REQUIRED\]**
  Operation status.

**EXCEPTIONS:**

- **MilvusError**
  The promise is rejected. Contains the operation failure details.

## Example{#example}

### JavaScript example

Creates a simple collection with JavaScript.

```javascript
await client.createCollection({ collection_name: "docs", dimension: 128 });
```

### TypeScript example

Creates a typed collection request.

```typescript
const request: SimpleCreateCollectionReq = { collection_name: "docs", dimension: 128 };
await client.createCollection(request);
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
