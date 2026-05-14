This operation removes the locally installed Zilliz CLI binary and related installation artifacts.

## Usage

```bash
zilliz uninstall [--purge] [--yes]
```

## Options

- **--purge** (*boolean*) -
  Removes additional local data such as cached install metadata.
- **--yes, -y** (*boolean*) -
  Skips interactive confirmation for destructive cleanup.

## Example

```bash
zilliz uninstall --yes
zilliz uninstall --purge --yes
```
