# CreateCollection()

Creates a collection through the C++ client.

<include target="milvus">
Available to Milvus users.
</include>

```c++
Status CreateCollection(const CreateCollectionRequest& request, CreateCollectionResponse& response)
```

## Request Syntax{#request-syntax}

```c++
auto request = CreateCollectionRequest()
    .WithCollectionName(collection_name)
    .WithDimension(dimension)
    .AddField(field)
    .EnableDynamicField()
    .AddExtraParam(key, value);
```

**REQUEST METHODS:**

- `WithCollectionName(const std::string& collection_name)`
  Sets the collection name.
- `WithDimension(int64_t dimension)`
  Sets the vector dimension.
- `AddField(const FieldSchema& field)`
  Adds a schema field.
- `EnableDynamicField()`
  Enables the dynamic field.
- `AddExtraParam(const std::string& key, const std::string& value)`
  Adds an extra request parameter.

**RETURNS:**

*Status*

Returns the operation status and fills the response object.

- **response** ([CreateCollectionResponse](/reference/cpp/create-collection-response)) - **\[REQUIRED\]**
  The created collection response.

**ERROR HANDLING:**

- **Status**
  status.IsOk() is false. Inspect the status code and message for failure details.

## Example{#example}

### Create a collection

Builds a request and checks the returned status.

```c++
auto request = milvus::CreateCollectionRequest().WithCollectionName("docs").WithDimension(128);
auto status = client->CreateCollection(request, response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
