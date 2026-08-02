This operation triggers an external collection refresh job.

## Usage

```bash
zilliz external-collection refresh trigger [OPTIONS]
```

## Options

- **--cluster-id** (*string*) -
  **[REQUIRED]**
  Specifies the cluster ID.
- **--collection-name** (*string*) -
  **[REQUIRED]**
  Specifies the external collection name.

## Example

```bash
zilliz external-collection refresh trigger --cluster-id clus_xxx --collection-name ext_orders
```