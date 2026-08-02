This operation returns details for a previously submitted external-collection refresh job, including lifecycle status and error information when present.

## Usage

```bash
zilliz external-collection refresh describe --job-id <string>
```

## Options

- **--job-id** (*string*) -
  **[REQUIRED]**
  Specifies the refresh job ID returned by `zilliz external-collection refresh trigger`.

## Example

```bash
zilliz external-collection refresh describe --job-id ecrj_1234567890
```
