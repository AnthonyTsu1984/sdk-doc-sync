A Field instance defines a field in a collection schema, including its data type and constraints.

<include target="milvus">
Available to Milvus users.
</include>

```go
type Field struct {
    Name string
    DataType FieldType
}
```

**FIELDS:**

- **Name** (*string*) -
  The field name.
- **DataType** ([FieldType](/reference/go/field-type)) -
  The data type of the field.

**BUILDER METHODS:**

- `WithName(name string)`
  Sets the name of the field.
- `WithDataType(dataType FieldType)`
  Sets the data type of the field.

**METHODS:**

- `func (f Field) GetDim() (int64, error)`
  Returns the vector dimension of the field.

## Example{#example}

Builds a primary-key field for a schema.

```go
pkField := entity.NewField().
    WithName("id").
    WithDataType(entity.FieldTypeInt64).
    WithIsPrimaryKey(true)
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
