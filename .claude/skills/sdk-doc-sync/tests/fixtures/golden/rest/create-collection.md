# Create a collection

Creates a collection in the selected database.

```plaintext
POST /v2/vectordb/collections
```

## Authentication

- **ApiKeyAuth** (*apiKey*) -
  Use a Zilliz Cloud API key as a bearer token.
  Constraints: in: header; name: Authorization.

## Request

### Query

- **dbName** (*string*) - Default: `default`
  Database name.

### Header

- **X-Request-ID** (*string*) -
  Caller-provided request identifier.
  Constraints: format: uuid; nullable.

### Body

Content type: `application/json`

- **collectionName** (*string*) - **\[REQUIRED\]**
  Collection name.
- **dimension** (*integer*) - **\[REQUIRED\]**
  Vector dimension.
  Constraints: format: int64.
- **consistencyLevel** (*string*) - Default: `Bounded`
  Consistency level.
  Constraints: enum: Strong, Bounded, Eventually.
- **schema** (*object*) -
  Optional custom schema.
  - **fields** (*array&lt;object&gt;*) -
    Field definitions.
    - **name** (*string*) - **\[REQUIRED\]**
      Field name.
    - **dataType** (*string*) - **\[REQUIRED\]**
      Field data type.
      Constraints: enum: Int64, VarChar, FloatVector.
    - **description** (*string*) -
      Optional field description.
      Constraints: nullable.

## Responses

### 200

Collection created.

- **code** (*integer*) - **\[REQUIRED\]**
  Status code.
- **data** (*object*) - **\[REQUIRED\]**
  Created collection metadata.
  - **collectionName** (*string*) - **\[REQUIRED\]**
    Created collection name.

### 400

Invalid collection definition.

- **code** (*integer*) - **\[REQUIRED\]**
  Error code.
- **message** (*string*) - **\[REQUIRED\]**
  Error message.

## Examples

### cURL request

```bash
curl --request POST 'https://api.example.test/v2/vectordb/collections?dbName=default' --header 'Authorization: Bearer ${ZILLIZ_API_KEY}' --header 'Content-Type: application/json' --data '{"collectionName":"docs","dimension":128}'
```

### Request body

```json
{
  "collectionName": "docs",
  "dimension": 128,
  "consistencyLevel": "Bounded",
  "schema": {
    "fields": [
      {
        "name": "id",
        "dataType": "Int64"
      },
      {
        "name": "vector",
        "dataType": "FloatVector",
        "description": null
      }
    ]
  }
}
```

### 200 response

```json
{
  "code": 0,
  "data": {
    "collectionName": "docs"
  }
}
```

### 400 response

```json
{
  "code": 1100,
  "message": "invalid dimension"
}
```
