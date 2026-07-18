# zilliz project create

## Description

Creates a Zilliz Cloud project.

## Synopsis

```bash
zilliz project create [OPTIONS]
```

## Options

- **--name** (*string*) - **\[REQUIRED\]**
  Project name.
  Constraints: shorthand: -n; api-name: name.
- **--region** (*string*) - **\[REQUIRED\]**
  Deployment region.
  Constraints: choices: aws-us-west-2, gcp-us-west1; repeatable; shorthand: -r; api-name: region.
- **--plan** (*string*) - **\[REQUIRED\]** Default: `serverless`
  Subscription plan.
  Constraints: choices: serverless, dedicated; api-name: plan.
- **--api-key** (*string*) -
  Overrides the configured API key for this command.
  Constraints: api-name: apiKey.

## Notes

- The --api-key option overrides the configured API key for this command.

## Example

```bash
zilliz project create --name docs --region aws-us-west-2 --plan serverless
```
