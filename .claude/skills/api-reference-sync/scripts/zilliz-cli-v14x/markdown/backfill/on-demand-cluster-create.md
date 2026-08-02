This operation creates an on-demand cluster using the cloud-control-api v1.4 contract.

## Usage

```bash
zilliz on-demand-cluster create [OPTIONS]
```

## Options

- **--cluster-name** (*string*) -
  **[REQUIRED]**
  Specifies the cluster name. In v1.4, this option is required.
- **--cu-size** (*integer*) -
  **[REQUIRED]**
  Specifies compute unit size. In v1.4, `--cu` is replaced by `--cu-size` and minimum value is `8`.
- **--session-ttl** (*duration*) -
  Specifies session lifetime. The minimum supported value is `60s`.

## Example

```bash
zilliz on-demand-cluster create --cluster-name od-demo --cu-size 8 --session-ttl 60s
```