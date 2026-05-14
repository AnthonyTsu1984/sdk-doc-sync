This operation lists external-collection refresh jobs so you can review recent submissions, states, and completion outcomes.

## Usage

```bash
zilliz external-collection refresh list [--external-collection-id <string>] [--limit <integer>]
```

## Options

- **--external-collection-id** (*string*) -
  Specifies the external collection ID to filter jobs for one collection.
- **--limit** (*integer*) -
  Specifies the maximum number of jobs to return.

## Example

```bash
zilliz external-collection refresh list --external-collection-id extc_1234567890 --limit 20
```
