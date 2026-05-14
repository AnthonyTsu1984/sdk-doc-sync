This operation adds regions to an existing project.

## Usage

```bash
zilliz project add-regions [OPTIONS]
```

## Options

- **--project-id** (*string*) -
  **[REQUIRED]**
  Specifies the target project ID.
- **--region** (*string*) -
  **[REQUIRED]**
  Specifies one region ID. Repeat this option to add multiple regions.

In v1.4, the request payload uses `regionIds` in the backend contract.

## Example

```bash
zilliz project add-regions --project-id proj_xxx --region aws-us-west-2
```