---
title: "Example Document - All Features"
slug: "example-document"
description: "A comprehensive example demonstrating all supported markdown features"
---

# Example Document - All Features

This document demonstrates all the markdown features supported by the markdown-to-feishu converter.

## Text Formatting{#text-formatting}

You can use **bold text**, *italic text*, ~~strikethrough text~~, and `inline code`.

You can also combine them: **bold with *italic* inside** and `code with **bold**`.

Links work too: [Visit Milvus Documentation](https://milvus.io/docs) for more information.

## Code Blocks{#code-blocks}

### Python Example

```python
from pymilvus import MilvusClient

# Create a Milvus client
client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

# Create a collection
client.create_collection(
    collection_name="my_collection",
    dimension=128
)

# Insert data
data = [
    {"id": 1, "vector": [0.1] * 128, "text": "Hello"},
    {"id": 2, "vector": [0.2] * 128, "text": "World"}
]
client.insert(collection_name="my_collection", data=data)

print("Data inserted successfully!")
```

### JavaScript Example

```javascript
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

const client = new MilvusClient({
    address: 'localhost:19530',
    username: 'root',
    password: 'Milvus'
});

async function main() {
    // Create collection
    await client.createCollection({
        collection_name: 'my_collection',
        dimension: 128
    });

    // Insert data
    const data = [
        { id: 1, vector: Array(128).fill(0.1), text: 'Hello' },
        { id: 2, vector: Array(128).fill(0.2), text: 'World' }
    ];

    await client.insert({
        collection_name: 'my_collection',
        data: data
    });

    console.log('Data inserted successfully!');
}

main();
```

### Bash Example

```bash
curl -X POST "http://localhost:19530/v1/vector/insert" \
  -H "Content-Type: application/json" \
  -d '{
    "collection_name": "my_collection",
    "data": [
      {"id": 1, "vector": [0.1, 0.2], "text": "Hello"},
      {"id": 2, "vector": [0.3, 0.4], "text": "World"}
    ]
  }'
```

## Lists{#lists}

### Bullet Lists

- **First item**: This is the first item
- **Second item**: This is the second item with some details
  - Nested item 2.1
  - Nested item 2.2
    - Deep nested item
  - Nested item 2.3
- **Third item**: Back to the main level
- **Fourth item**: The last item

### Ordered Lists

1. **Setup**: Install Milvus on your system
2. **Configuration**: Configure the connection parameters
   1. Set the URI
   2. Set the credentials
   3. Test the connection
3. **Data Preparation**: Prepare your vector data
4. **Insert**: Insert the data into collections
5. **Query**: Query your data

### Mixed Lists

1. First ordered item
   - Bullet point under ordered
   - Another bullet
2. Second ordered item
   - More bullets
     1. Ordered under bullet
     2. Another ordered item

## Tables{#tables}

### Simple Table

<table>
  <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Required</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>collection_name</td>
    <td>string</td>
    <td>Yes</td>
    <td>The name of the collection</td>
  </tr>
  <tr>
    <td>dimension</td>
    <td>integer</td>
    <td>Yes</td>
    <td>Vector dimension</td>
  </tr>
  <tr>
    <td>metric_type</td>
    <td>string</td>
    <td>No</td>
    <td>Distance metric (L2, IP, COSINE)</td>
  </tr>
  <tr>
    <td>timeout</td>
    <td>float</td>
    <td>No</td>
    <td>Request timeout in seconds</td>
  </tr>
</table>

### Table with Merged Cells

<table>
  <tr>
    <th colspan="2">Method Information</th>
    <th>Details</th>
  </tr>
  <tr>
    <td rowspan="2">create_collection()</td>
    <td>Purpose</td>
    <td>Creates a new collection</td>
  </tr>
  <tr>
    <td>Returns</td>
    <td>None</td>
  </tr>
  <tr>
    <td rowspan="2">insert()</td>
    <td>Purpose</td>
    <td>Inserts data into collection</td>
  </tr>
  <tr>
    <td>Returns</td>
    <td>Insert result with IDs</td>
  </tr>
</table>

## Blockquotes{#blockquotes}

> This is a blockquote. It's useful for highlighting important information or quotes.
>
> Blockquotes can span multiple paragraphs and lines.

> **Note**: You can use formatting inside blockquotes too.
>
> - Bullet points
> - Also work
> - Inside quotes

## Dividers{#dividers}

You can use horizontal rules to separate sections:

---

This is after a divider.

---

And another divider above this text.

## Admonitions{#admonitions}

<Admonition type="info" icon="📘" title="Information">

This is an informational admonition. Use it to provide helpful tips or additional context.

You can include **formatted text** and `code` inside admonitions.

</Admonition>

<Admonition type="caution" icon="🚧" title="Warning">

This is a warning admonition. Use it to alert users about potential issues or important considerations.

Be careful when modifying production data!

</Admonition>

## Conditional Content{#conditional-content}

The following content is conditionally displayed based on the target platform:

<include target="milvus">

**For Milvus users:**

Connect to your local Milvus instance:

```python
client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)
```

</include>

<include target="zilliz">

**For Zilliz Cloud users:**

Connect to your Zilliz Cloud cluster:

```python
client = MilvusClient(
    uri="https://your-cluster.api.gcp-us-west1.zillizcloud.com:19530",
    token="your-api-key"
)
```

</include>

Content here is visible to all targets.

## Complex Example{#complex-example}

Here's a complete example combining multiple features:

### Request Syntax{#request-syntax}

```python
create_collection(
    collection_name: str,
    dimension: int,
    metric_type: str = "COSINE",
    timeout: Optional[float] = None
) -> None
```

**Parameters:**

- **collection_name** (*str*) -

  **[REQUIRED]**

  The name of the collection to create. Must be unique within the database.

- **dimension** (*int*) -

  **[REQUIRED]**

  The dimension of the vector field. Must be a positive integer.

- **metric_type** (*str*) -

  The distance metric used for similarity search. Options:
  - `L2`: Euclidean distance
  - `IP`: Inner product
  - `COSINE`: Cosine similarity (default)

- **timeout** (*float* | *None*)

  The timeout duration for this operation. Setting this to `None` indicates that this operation timeouts when any response arrives or any error occurs.

**Returns:**

*None*

**Exceptions:**

- **MilvusException** - This exception will be raised when any error occurs during this operation.
- **TimeoutError** - Raised when the operation exceeds the timeout limit.

### Example Usage{#example-usage}

<Admonition type="info" icon="📘" title="Prerequisites">

Before running this example, ensure you have:

1. Installed the PyMilvus library
2. Started a Milvus instance
3. Configured the connection parameters

</Admonition>

```python
from pymilvus import MilvusClient, DataType

# Initialize client
client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

try:
    # Create collection
    client.create_collection(
        collection_name="my_vectors",
        dimension=128,
        metric_type="COSINE"
    )
    print("✅ Collection created successfully!")

except MilvusException as e:
    print(f"❌ Error: {e}")
```

**Output:**

```
✅ Collection created successfully!
```

---

## Related Methods{#related-methods}

- `drop_collection()` - Deletes a collection
- `describe_collection()` - Gets collection information
- `list_collections()` - Lists all collections
- `has_collection()` - Checks if collection exists

## End of Document{#end}

This document demonstrated all supported markdown features. For more information, visit the [Milvus Documentation](https://milvus.io/docs).
