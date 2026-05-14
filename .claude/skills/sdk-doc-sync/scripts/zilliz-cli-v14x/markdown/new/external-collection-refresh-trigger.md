This operation starts an external-collection refresh job for a linked external collection so the latest source-side changes can be synchronized.

## Usage

```bash
zilliz external-collection refresh trigger --external-collection-id <string>
```

## Options

- **--external-collection-id** (*string*) -
  **[REQUIRED]**
  Specifies the external collection ID to refresh.
- **--async** (*boolean*) -
  Specifies whether to return immediately after submitting the refresh job.

## Example

```bash
zilliz external-collection refresh trigger --external-collection-id extc_1234567890
```
