# BYOC Documentation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor BYOC and BYOC-I documentation so users can clearly understand projects, dataplanes, multi-region deployment, cloud-specific prerequisites, and troubleshooting paths.

**Architecture:** Reorganize the docs around provider-specific deployment paths first. Keep AWS, GCP, and Azure as the primary navigation groups because BYOC setup is dominated by provider-specific identity, networking, storage, Kubernetes, and Terraform details. Use shared concept/reference pages as supporting material linked from each provider flow, not as the main path users must traverse before deploying.

**Tech Stack:** Feishu/Lark wiki docs, Zilliz Cloud Developer Hub content, BYOC/BYOC-I deployment pages for AWS, GCP, and Azure.

---

## Source Evidence

- Feishu wiki roots reviewed:
  - `Deploy BYOC on AWS`
  - `Deploy BYOC-I on AWS`
  - `Deploy BYOC on GCP`
  - `Deploy BYOC-I on GCP`
  - `Deploy BYOC-I on Microsoft Azure`
- Child docs reviewed:
  - AWS BYOC children: S3 bucket/IAM role, EKS IAM role, cross-account IAM role, customer-managed VPC, permissions in roles, tiered storage.
  - GCP BYOC children: Cloud Storage/service account, GKE service account, cross-account service account, customer-managed VPC, required permissions, required API services.
- Chat/screenshot signal:
  - Users missed that one BYOC project can contain multiple dataplanes/regions.
  - Existing release note says multi-dataplane support exists, but deployment docs bury the concept.
  - GCP BYOC-I had confusion around `gcp_project_id`, supported regions, and tiered query node selection.
- Current-doc structure observed on 2026-07-07:
  - `Deploy BYOC on AWS` has six child docs and already uses a manual-console runbook model for S3, IAM roles, VPC, permissions, and tiered storage.
  - `Deploy BYOC on GCP` has six child docs and already uses a manual-console runbook model for Cloud Storage, service accounts, VPC, permissions, and required API services.
  - `Deploy BYOC-I on AWS`, `Deploy BYOC-I on GCP`, and `Deploy BYOC-I on Azure` have no child docs; each combines Zilliz Cloud UI steps, provider-console prerequisites, Terraform deployment, data plane management, support access, and sometimes permissions into one long page.
  - AWS BYOC has three deployment methods in one procedure: CloudFormation, Terraform, and manual AWS console setup.
  - Azure BYOC-I contains cross-cloud copy issues: `AWS cloud regions`, `Azure Private Service Connect`, `VPC Endpoint`, `VPC and EKS` screenshot text, AWS instance types, and `Data plans`.
  - GCP BYOC-I now includes `gcp_project_id` in the Terraform apply example, but the variable is buried in Step 4 and should be promoted into a Terraform variables/reference page and troubleshooting entry.

## External SaaS Documentation Patterns

- Databricks keeps customer-managed cloud setup provider-specific. Its AWS customer-managed VPC page sits under `Databricks on AWS`, has a cloud/provider switcher, and combines an overview with AWS-specific requirements such as VPC region, CIDR sizing, DNS, subnets, security groups, PrivateLink, firewall/outbound access, instance profiles, and S3 bucket policies.
- Anyscale separates shared architecture from setup flows. Its architecture page explains the control plane and customer data plane model, while its cloud setup material defines a logical cloud that connects the control plane to resources in AWS, Google Cloud, or Kubernetes. It also uses a decision table for setup options such as serverless, Anyscale-managed, customer-defined, and Kubernetes.
- Astronomer separates control-plane and data-plane architecture pages, and the data-plane page is deeply operational: responsibilities, components, network endpoints, control-plane integration, outage behavior, monitoring, and next steps.
- Pinecone keeps project/org concepts separate from operational guides, organizes integrations by provider where cloud storage differs, and has troubleshooting pages centered on concrete user problems.

**Best-practice conclusion:** For BYOC docs, provider-first grouping is the right primary information architecture, but the current docs also need a second explicit axis: operating surface. Each provider flow should tell users when they are working in Zilliz Cloud, the provider console, Terraform/CLI, or post-deployment operations.

## Terraform Provider Evidence

Use the Terraform Registry/provider docs and the `terraform-zilliz-examples` repository as the source of truth for Terraform-based paths.

- Terraform Registry provider: `zilliztech/zillizcloud` latest version `0.6.41`, published 2026-07-06. Source repository: `https://github.com/zilliztech/terraform-provider-zillizcloud`.
- Relevant provider docs:
  - `docs/guides/create-a-byoc-project.md`
  - `docs/guides/create-a-byoc-i-project.md`
  - `docs/guides/prepare-resources-for-aws-byoc.md`
  - `docs/guides/prepare-resources-for-gcp-byoc.md`
  - `docs/resources/byoc_project.md`
  - `docs/resources/byoc_i_project.md`
  - `docs/resources/byoc_i_project_agent.md`
  - `docs/resources/byoc_i_project_settings.md`
  - `docs/data-sources/byoc_i_project_settings.md`
- The BYOC-I project resource schema supports AWS, GCP, and Azure:
  - AWS: `region`, `network.vpc_id`, `network.subnet_ids`, `network.security_group_ids`, optional `network.vpc_endpoint_id`, `role_arn.storage`, `role_arn.eks`, `role_arn.cross_account`, `storage.bucket_id`, optional CSE fields.
  - GCP: `project_id`, `region`, `gke.cluster_name`, `gke.zones`, service-account identities, VPC/subnet names, optional `psc_endpoint_ip`, and GCS bucket ID.
  - Azure: `region`, managed identities for kubelet/maintenance/storage, `network.vnet_id`, `network.subnet_ids`, `network.nsg_ids`, optional `private_endpoint_id`, storage account and container.
- The BYOC-I agent resource has `wait_until_ready` and read-only `status`; this should drive validation language for BYOC-I deployment completion.
- The BYOC-I settings resource/data source returns `data_plane_id`, `project_id`, `op_config.agent_image_url`, `op_config.token`, node quotas, `tiered_node_quota`, and whether agent bootstrap is required. These explain why the Zilliz Cloud console gives users generated IDs/tokens and why Terraform needs to consume them.
- The AWS BYOC Terraform guide includes outputs that map directly back to Zilliz Cloud form fields: bucket name, storage role ARN, EKS role ARN, bootstrap/cross-account role ARN, VPC ID, subnet IDs, and security group ID.
- The GCP BYOC Terraform guide includes a mature variable/output/troubleshooting structure. It should be the model for all Terraform pages: prerequisites, API enablement, authentication, required variables, optional variables, commands, outputs, provider-console verification, troubleshooting, and cleanup.
- The Terraform docs themselves contain some wording drift, such as generic settings descriptions that still say `AWS region`. Treat schemas and examples as technical authority, but rewrite customer docs with provider-correct terminology.

## Refined Diagnosis After Reading Current Docs

The docs are not failing because they lack enough content. They are failing because the content is arranged by page history rather than by the user's deployment journey.

- Standard BYOC AWS/GCP already have good provider-console child docs. Preserve that model, but rename and group the child docs as provider-console runbooks and reference pages.
- BYOC-I AWS/GCP/Azure need the same decomposition that BYOC AWS/GCP already have. Today, the BYOC-I pages are overloaded and force users to jump between Zilliz Cloud UI, cloud console setup, Terraform, data plane states, support access, and permissions without stable section boundaries.
- AWS BYOC should expose deployment method choice earlier: CloudFormation quickstart, Terraform, or manual console setup. The current page presents all three inside a long resource-settings step.
- GCP BYOC-I should stop treating `gcp_project_id` as a note after a screenshot. It is a deployment-critical customer project identifier and belongs in a Terraform variable table, the deploy step, and troubleshooting.
- Azure BYOC-I should be treated as a content repair project before IA polish. It has provider terminology and screenshot-copy issues that can actively mislead users.
- Multi-data-plane behavior exists as a sentence inside Step 3, but should be a first-screen concept and a post-deploy operation pattern.

## Proposed Target Information Architecture

```text
BYOC
├─ Overview
│  ├─ Choose BYOC or BYOC-I
│  ├─ BYOC architecture
│  ├─ Projects and data planes
│  ├─ Multi-region deployments
│  └─ Supported regions and feature availability
├─ BYOC on AWS
│  ├─ Deploy BYOC on AWS
│  ├─ Choose an AWS deployment method
│  ├─ Deploy with AWS CloudFormation
│  ├─ Deploy with Terraform
│  ├─ Deploy manually with the AWS console
│  ├─ AWS prerequisites
│  ├─ AWS console operations
│  ├─ AWS permissions and networking
│  ├─ Configure a customer-managed VPC on AWS
│  ├─ Enable tiered storage on AWS
│  └─ Troubleshoot BYOC on AWS
├─ BYOC on GCP
│  ├─ Deploy BYOC on GCP
│  ├─ Deploy with Terraform
│  ├─ Deploy manually with the GCP console
│  ├─ GCP prerequisites
│  ├─ GCP console operations
│  ├─ GCP permissions and networking
│  ├─ Configure a customer-managed VPC on GCP
│  ├─ Required GCP API services
│  └─ Troubleshoot BYOC on GCP
├─ BYOC-I on AWS
│  ├─ Deploy BYOC-I on AWS
│  ├─ AWS BYOC-I Terraform deployment
│  ├─ AWS BYOC-I prerequisites
│  ├─ AWS BYOC-I console operations
│  ├─ AWS BYOC-I permissions
│  ├─ AWS BYOC-I networking
│  └─ Troubleshoot BYOC-I on AWS
├─ BYOC-I on GCP
│  ├─ Deploy BYOC-I on GCP
│  ├─ GCP BYOC-I Terraform deployment
│  ├─ GCP BYOC-I prerequisites
│  ├─ GCP BYOC-I console operations
│  ├─ GCP BYOC-I permissions
│  ├─ GCP BYOC-I networking
│  ├─ GCP Terraform variables
│  └─ Troubleshoot BYOC-I on GCP
└─ BYOC-I on Azure
   ├─ Deploy BYOC-I on Azure
   ├─ Azure BYOC-I Terraform deployment
   ├─ Azure BYOC-I prerequisites
   ├─ Azure BYOC-I console operations
   ├─ Azure BYOC-I permissions
   ├─ Azure BYOC-I networking
   └─ Troubleshoot BYOC-I on Azure

Shared reference pages linked from provider groups:
├─ Manage data planes
├─ Technical support access
├─ Data plane states
└─ BYOC troubleshooting index
```

## Page Type Model

Use this page type model inside each provider group:

```text
Deploy page
├─ Short overview and decision points
├─ Zilliz Cloud console steps
├─ Handoffs to provider-console runbooks
├─ Handoffs to Terraform/CLI
└─ Validation and next steps

Provider-console runbook
├─ Console, service, required role, and output artifact
├─ Click-by-click steps
├─ What to copy back to Zilliz Cloud or Terraform
└─ Validation and common mistakes

Terraform/CLI page
├─ Required local tools and auth
├─ Variable table
├─ Commands
├─ Resource schema mapping
├─ Expected output
├─ What to copy back to Zilliz Cloud
└─ Recovery/troubleshooting

Reference page
├─ Permissions
├─ Networking requirements
├─ API/service enablement
├─ Region/feature availability
└─ Limits and support constraints

Operations page
├─ Add or deploy another data plane
├─ Data plane states
├─ Suspend/resume where supported
├─ Technical support access
└─ Delete/rename constraints
```

## Refactor Principles

- Keep the user's selected provider as the main path. Provider-specific prerequisites, permissions, networking, commands, screenshots, and troubleshooting should sit next to the provider deployment page.
- Separate deployment method from cloud provider. For AWS BYOC, make CloudFormation, Terraform, and manual AWS console setup explicit choices. For BYOC-I, make Terraform deployment explicit because the current pages rely on Terraform even when the note says the guide demonstrates console setup.
- Put only the minimum concept explanation before the procedure: explain project, data plane, region, cluster, and deployment mode in a short intro, then link to shared concept pages.
- Treat a data plane as the deployment unit and a project as the container.
- Make multi-dataplane support visible in page introductions, not only in release notes or late-stage management sections.
- Treat provider-console operations as first-class procedural content. Every step that leaves Zilliz Cloud for AWS, GCP, or Azure should name the console, service, required role, exact artifact to create or copy, and validation signal.
- Move repeated or reference-heavy content out of deployment pages, but keep the extracted pages provider-scoped when the content differs by AWS, GCP, or Azure.
- Keep existing URLs where possible; when moving content, leave redirects or prominent cross-links.

## Task 0: Apply Different Treatments By Doc Family

**Files / Pages:**
- `Deploy BYOC on AWS` and six AWS child docs.
- `Deploy BYOC on GCP` and six GCP child docs.
- `Deploy BYOC-I on AWS`
- `Deploy BYOC-I on GCP`
- `Deploy BYOC-I on Microsoft Azure`

- [ ] **Step 1: Preserve and reorganize standard BYOC child docs**

  AWS/GCP BYOC already have useful provider-console child docs. Do not collapse them into a generic shared prerequisite section. Instead:
  - Keep provider-specific child docs under the provider group.
  - Rename/group them as console runbooks, networking reference, permissions reference, and operations.
  - Fix duplicate or confusing headings such as duplicate `Step 2` and duplicate `Step 4`.
  - Keep the deploy page as an orchestration page that links into the relevant child docs at the moment users need them.

- [ ] **Step 2: Decompose BYOC-I long pages**

  Split each BYOC-I long page into:
  - Deploy BYOC-I on [provider]
  - [Provider] BYOC-I prerequisites
  - [Provider] BYOC-I console operations
  - [Provider] BYOC-I Terraform deployment
  - [Provider] BYOC-I permissions
  - [Provider] BYOC-I networking
  - Troubleshoot BYOC-I on [provider]

- [ ] **Step 3: Repair Azure before moving content**

  First fix provider correctness in Azure BYOC-I, then refactor it. Otherwise copied AWS/GCP content can spread into new pages.

## Task 1: Create The Shared Concept Page

**Files / Pages:**
- Create: `BYOC Deployment / Overview / Projects and data planes`
- Modify: all five deployment pages to link to the concept page.

- [ ] **Step 1: Draft the concept page**

  Include this canonical explanation:

  ```text
  A BYOC project is a logical container for one or more data planes.

  A data plane is a region-specific infrastructure deployment in your cloud account.
  To deploy BYOC in multiple regions, add multiple data planes under the same project
  when your organization and deployment mode support it.

  When you create clusters, select the target region or data plane in the project.
  Existing BYOC projects remain compatible and may have only one data plane.
  ```

- [ ] **Step 2: Add a decision table**

  ```text
  | Need | Recommended action |
  |---|---|
  | Same product environment, multiple regions | Add multiple data planes to one project |
  | Separate tenants, teams, billing, or governance boundary | Create separate projects |
  | A region is not shown in the UI | Check supported regions and contact support |
  | Existing project has one data plane | Continue using it or add another data plane if supported |
  ```

- [ ] **Step 3: Add acceptance checks**

  Verify the page answers:
  - Can one project have multiple data planes?
  - Does one data plane map to one region-specific infrastructure unit?
  - Where does the user choose a target region/data plane when creating clusters?
  - What should users do if the UI does not show the target region?

## Task 2: Add A Multi-Dataplane Callout To Every Deployment Page

**Files / Pages:**
- Modify: `Deploy BYOC on AWS`
- Modify: `Deploy BYOC-I on AWS`
- Modify: `Deploy BYOC on GCP`
- Modify: `Deploy BYOC-I on GCP`
- Modify: `Deploy BYOC-I on Microsoft Azure`

- [ ] **Step 1: Insert the same intro callout near the top**

  Place it after the first description and before prerequisites:

  ```text
  Note: A BYOC project can contain multiple data planes. Each data plane represents
  a region-specific infrastructure deployment. To deploy in another supported region,
  add another data plane under the same project instead of creating a separate project,
  unless you need project-level isolation for billing, access control, or governance.
  ```

- [ ] **Step 2: Normalize terminology in step headings**

  Use:
  - `Create a project` for the logical project container.
  - `Prepare the data plane` for choosing cloud, region, architecture, and sizing.
  - `Deploy the data plane` for creating or applying cloud infrastructure.
  - `Manage data planes` for states such as undeployed, deploying, running, suspended.

- [ ] **Step 3: Add a link from each callout**

  Link “multiple data planes” to `Projects and data planes`.

## Task 3: Move Data Plane Management Out Of The Bottom Of Pages

**Files / Pages:**
- Create or update: `BYOC Deployment / Overview / Manage data planes`
- Modify: BYOC-I AWS, BYOC-I GCP, BYOC-I Azure.
- Modify: BYOC AWS and BYOC GCP if their UI also exposes multi-dataplane management.

- [ ] **Step 1: Extract common data plane states**

  Cover:
  - `Undeployed`: data plane can be deployed or reopened.
  - `Deploying`: infrastructure deployment/agent activation is in progress.
  - `Running`: clusters can be created in this data plane.
  - `Suspended`: project/data plane operations are limited until resumed, when applicable.

- [ ] **Step 2: Add state-specific action guidance**

  ```text
  | State | What it means | Available action |
  |---|---|---|
  | Undeployed | Data plane has not been deployed yet | Deploy data plane |
  | Deploying | Deployment is in progress | Wait; do not rename or delete |
  | Running | Data plane is available | Create clusters or manage settings |
  | Suspended | Compute resources are halted | Resume before creating or managing clusters |
  ```

- [ ] **Step 3: Replace repeated page sections with short summaries**

  Each deployment page should say:

  ```text
  After deployment, manage data planes from the project or Data Planes page.
  For state descriptions and supported actions, see Manage data planes.
  ```

## Task 4: Fix GCP BYOC-I Immediate Documentation Gaps

**Files / Pages:**
- Modify: `Deploy BYOC-I on GCP`
- Modify: `GCP BYOC-I permissions` or `GCP prerequisites`, depending on final IA.

- [ ] **Step 1: Promote `gcp_project_id`**

  In `Step 4: Deploy the data plane`, make this impossible to miss:

  ```text
  When you run `terraform apply`, you must pass your customer GCP project ID:

  terraform apply \
    -var="dataplane_id=zilliz-byoc-gcp-us-west1-74xxxx" \
    -var="project_id=project-xxxxx" \
    -var="gcp_project_id=YOUR_GCP_PROJECT_ID"
  ```

- [ ] **Step 2: Add supported-region guidance**

  Add near `Applicable VPC regions`:

  ```text
  If a region is not listed or not selectable in the Zilliz Cloud console, that
  region is not currently supported for this BYOC-I deployment path. Contact
  Zilliz support to confirm availability or request access.
  ```

- [ ] **Step 3: Resolve tiered query node wording**

  If tiered query node instance selection is not supported for GCP BYOC-I yet, add:

  ```text
  Tiered Query Node instance selection may not be available in all GCP BYOC-I regions
  or release phases. If the selector is unavailable, continue with the displayed
  default settings or contact Zilliz support.
  ```

  If it is supported, replace the screenshot and update the step to show where the instance type is selected.

## Task 5: Fix Azure BYOC-I Cross-Cloud Copy Issues

**Files / Pages:**
- Modify: `Deploy BYOC-I on Microsoft Azure`

- [ ] **Step 1: Correct region wording**

  Replace “AWS cloud regions” with “Azure regions”.

- [ ] **Step 2: Correct cloud resource names**

  Replace incorrect generic/cloud terms:
  - `VPC` -> `Virtual Network` or `VNet`
  - `VPC Endpoint` -> `Azure Private Link` / `private endpoint`, depending on product UI
  - `EKS` -> `AKS`
  - `GCE instances` -> `Azure VM instances`

- [ ] **Step 3: Fix typo in heading**

  Replace `Data plans with a Running tag` with `Data planes with a Running tag`.

- [ ] **Step 4: Confirm prerequisites match BYOC-I Azure**

  Ensure the page covers:
  - Subscription ID
  - Resource group name
  - Terraform runner permissions
  - Required Azure role assignments
  - Azure Private Link/private connectivity behavior

## Task 6: Extract Cloud Prerequisites

**Files / Pages:**
- Create: `AWS prerequisites`
- Create: `GCP prerequisites`
- Create: `Azure prerequisites`
- Modify: existing AWS/GCP child pages or add them as children under the prerequisite pages.

- [ ] **Step 1: Group AWS prerequisite docs**

  Include links to:
  - Create S3 Bucket and IAM Role
  - Create EKS IAM Role
  - Create Cross-Account IAM Role
  - Configure a Customer-Managed VPC on AWS
  - Permissions in Roles
  - Enable Tiered Storage for Existing Clusters

- [ ] **Step 2: Group GCP prerequisite docs**

  Include links to:
  - Create Cloud Storage Bucket and Service Account
  - Create GKE Service Account
  - Create a Cross-Account Service Account
  - Configure a Customer-Managed VPC on GCP
  - Required Permissions
  - Required GCP API Services

- [ ] **Step 3: Create Azure prerequisite coverage**

  Add or link sections for:
  - Azure subscription and resource group
  - IAM role assignment / RBAC requirements
  - VNet and private connectivity
  - AKS and VM-related deployment resources

## Task 7: Move Permissions Into Reference Pages

**Files / Pages:**
- Create or update: `AWS BYOC-I permissions`
- Create or update: `GCP BYOC-I permissions`
- Create or update: `Azure BYOC-I permissions`
- Modify: BYOC-I deployment pages.

- [ ] **Step 1: Extract long permissions sections**

  Move the permission lists out of deployment procedures.

- [ ] **Step 2: Replace with short prerequisite links**

  Use:

  ```text
  Before deploying, make sure your cloud account has the required permissions.
  For the complete permission list, see [provider] BYOC-I permissions.
  ```

- [ ] **Step 3: Add a permissions summary table**

  Each reference page should start with:

  ```text
  | Permission area | Used for |
  |---|---|
  | Networking | VPC/VNet, subnets, routing, private connectivity |
  | Kubernetes | EKS/GKE/AKS cluster and node pool management |
  | Storage | S3/GCS/Azure storage resources |
  | IAM/RBAC | Service accounts, roles, policies, impersonation |
  | Tags/labels | Resource scoping and cleanup |
  ```

## Task 8: Add Provider Console Operation Pages

**Files / Pages:**
- Create or update: `AWS console operations`
- Create or update: `GCP console operations`
- Create or update: `Azure console operations`
- Create or update BYOC-I variants if the console actions differ materially from BYOC.
- Modify deployment pages to link into the exact console operation section at the point of use.

- [ ] **Step 1: Split console operations from permission references**

  Use this rule:
  - Deployment pages explain the end-to-end sequence.
  - Console operation pages show click-by-click provider-console work.
  - Permission pages list the required permissions and policies.
  - Networking pages explain topology, endpoints, CIDRs, subnets, routing, and private connectivity.

- [ ] **Step 2: Use a consistent provider-console step template**

  Each console operation should include:

  ```text
  ## Create or configure [resource]

  Console: AWS / Google Cloud / Azure
  Service: IAM / S3 / EKS / VPC / Cloud Storage / GKE / VNet / AKS / Private Link
  Required role: [admin role or least-privilege role]
  Used by: [Zilliz project creation / data plane deployment / cluster creation / tiered storage]

  Steps:
  1. Open [provider service] in the [provider] console.
  2. Create or select [resource].
  3. Configure [fields that must match Zilliz Cloud].
  4. Copy [ID/ARN/name/principal] back to Zilliz Cloud or Terraform variables.

  Validation:
  - [Provider resource exists]
  - [Trust relationship or service account binding is active]
  - [Zilliz Cloud data plane status changes or Terraform plan succeeds]

  Common mistakes:
  - [Wrong project/account/subscription]
  - [Wrong region]
  - [Missing trust principal]
  - [Copied display name instead of resource ID]
  ```

- [ ] **Step 3: Add provider-specific operation inventories**

  AWS:
  - Select or confirm AWS account and region.
  - Create or confirm S3 bucket for object storage/tiered storage.
  - Create IAM roles and trust policies.
  - Configure EKS-related IAM role.
  - Configure cross-account IAM role for Zilliz access.
  - Configure VPC, subnets, route tables, security groups, and PrivateLink where applicable.

  GCP:
  - Select or confirm customer GCP project and region.
  - Enable required GCP APIs.
  - Create Cloud Storage bucket.
  - Create service accounts.
  - Configure service account impersonation or trust relationship.
  - Configure GKE-related service account.
  - Configure VPC, subnet, firewall, routes, and Private Service Connect where applicable.
  - Copy `gcp_project_id` explicitly into Terraform examples.

  Azure:
  - Select subscription, tenant, and resource group.
  - Create or confirm storage resources if required.
  - Configure managed identity, service principal, or role assignments.
  - Configure AKS-related permissions.
  - Configure VNet, subnets, network security groups, route tables, and Azure Private Link/private endpoints where applicable.

- [ ] **Step 4: Add ownership markers inside deployment procedures**

  Prefix each procedural step with the surface where it happens:

  ```text
  Zilliz Cloud: Create the BYOC project
  AWS console: Create the cross-account IAM role
  Terraform: Deploy the data plane
  Zilliz Cloud: Verify the data plane is running
  ```

  This prevents users from losing context when switching between Zilliz Cloud, a provider console, and local Terraform.

- [ ] **Step 5: Add screenshot and drift guidance**

  Use screenshots only for provider-console screens that are hard to find or easy to misconfigure. Pair screenshots with stable textual anchors such as service names, field labels, resource IDs, and validation checks so the docs still work after provider UI changes.

## Task 9: Build Terraform Pages From Provider Docs

**Files / Pages:**
- Create or update: `Deploy BYOC with Terraform on AWS`
- Create or update: `Deploy BYOC with Terraform on GCP`
- Create or update: `Deploy BYOC-I with Terraform on AWS`
- Create or update: `Deploy BYOC-I with Terraform on GCP`
- Create or update: `Deploy BYOC-I with Terraform on Azure`
- Modify: all provider deployment pages to link to the Terraform page instead of relying on screenshots.

- [ ] **Step 1: Define Terraform as a first-class deployment method**

  Add this model to the provider deployment pages:

  ```text
  Use Terraform when you want repeatable infrastructure deployment, versioned configuration,
  CI/CD integration, or a reviewable plan before resource creation. The Zilliz Cloud console
  provides IDs, tokens, and deployment settings; Terraform creates or registers the cloud
  resources and activates the data plane.
  ```

- [ ] **Step 2: Use provider docs as canonical source**

  For each Terraform page, cross-check against:
  - `zillizcloud_byoc_project` for standard BYOC.
  - `zillizcloud_byoc_i_project_settings` for BYOC-I project/data-plane settings generated from Zilliz Cloud.
  - `zillizcloud_byoc_i_project` for BYOC-I cloud infrastructure registration.
  - `zillizcloud_byoc_i_project_agent` for BYOC-I agent activation and readiness.
  - `prepare-resources-for-aws-byoc` and `prepare-resources-for-gcp-byoc` for standard BYOC infrastructure preparation.
  - `create-a-byoc-i-project` for BYOC-I bootstrap flow, but rewrite it provider-specifically because the current guide is AWS-centered while the resource schema supports AWS, GCP, and Azure.

- [ ] **Step 3: Add variable and schema mapping tables**

  Each Terraform page should have a table like:

  ```text
  | Terraform input | Where to get it | Used for | Validation |
  |---|---|---|---|
  | project_id | Zilliz Cloud Deploy Data Plane dialog | Registers the BYOC-I project | Matches the project shown in Zilliz Cloud |
  | data_plane_id | Zilliz Cloud Deploy Data Plane dialog | Identifies the data plane to deploy | Data plane status changes after apply |
  | gcp_project_id | Customer GCP project | Tells Terraform where to create GCP resources | Resources appear in the intended GCP project |
  ```

  Provider-specific required values:
  - AWS BYOC: S3 bucket name/ID, storage role ARN, EKS role ARN, cross-account/bootstrap role ARN, VPC ID, subnet IDs, security group ID, optional VPC endpoint ID.
  - GCP BYOC: GCP project ID, region/zones, VPC/subnet names, GCS bucket, storage service account, management service account, GKE node service account, PSC endpoint if enabled.
  - AWS BYOC-I: `project_id`, `data_plane_id`, AWS region, VPC/subnets/security group, optional VPC endpoint, role ARNs, storage bucket ID, optional CSE fields.
  - GCP BYOC-I: `project_id`, `data_plane_id`, `gcp.project_id`, region, GKE cluster name/zones, service-account emails, VPC/subnet names, bucket ID, optional PSC endpoint IP.
  - Azure BYOC-I: `project_id`, `data_plane_id`, Azure region, managed identity IDs, VNet ID, subnet IDs, NSG IDs, optional private endpoint ID, storage account, storage container.

- [ ] **Step 4: Document outputs and copy-back actions**

  For standard BYOC Terraform preparation, document outputs and where they go in the Zilliz Cloud console:
  - AWS: bucket name, storage role ARN, EKS role ARN, cross-account/bootstrap role ARN, VPC ID, subnet IDs, security group ID, optional VPC endpoint ID.
  - GCP: VPC name/ID, primary/pod/service/load-balancer subnet names, GCS bucket name, service account emails, optional private link endpoint.

  For BYOC-I Terraform deployment, document expected readiness signals:
  - Terraform apply succeeds.
  - BYOC-I project agent resource reaches ready state when `wait_until_ready` is enabled.
  - Zilliz Cloud data plane status moves from undeployed/deploying to running.

- [ ] **Step 5: Add Terraform troubleshooting**

  Add provider-specific entries:
  - AWS: Terraform runner lacks IAM, EKS, EC2, S3, or tagging permissions.
  - AWS: wrong external ID or wrong role ARN copied into Zilliz Cloud.
  - GCP: `gcp_project_id` missing or points to the wrong project.
  - GCP: required APIs are not enabled.
  - GCP: Resource Manager tags are unavailable; use pre-created tag IDs or disable tag creation when supported.
  - Azure: Terraform principal lacks Contributor or User Access Administrator role.
  - Azure: wrong subscription/resource group/managed identity IDs.
  - All providers: `terraform plan` fails, `terraform apply` partially succeeds, agent never becomes ready, or data plane remains deploying.

- [ ] **Step 6: Keep Terraform docs version-aware**

  Add a small source note:

  ```text
  This procedure is based on zilliztech/zillizcloud Terraform provider v0.6.41.
  Check the Terraform Registry for the latest provider schema before changing variables.
  ```

## Task 10: Add Troubleshooting Entries For The Observed User Questions

**Files / Pages:**
- Create or update: `BYOC Troubleshooting`

- [ ] **Step 1: Add multi-region/dataplane troubleshooting**

  Question:

  ```text
  Why can't I deploy multiple regions under one BYOC project?
  ```

  Answer:

  ```text
  A project can contain multiple data planes when the deployment mode and target
  regions support it. If you cannot add another data plane, check whether the
  target region is supported for your cloud and BYOC mode. If the region is
  supported but unavailable in the UI, contact Zilliz support.
  ```

- [ ] **Step 2: Add GCP BYOC-I Terraform variable troubleshooting**

  Question:

  ```text
  Terraform fails or creates resources in the wrong GCP project.
  ```

  Answer:

  ```text
  Confirm that `terraform apply` includes `-var="gcp_project_id=YOUR_GCP_PROJECT_ID"`.
  This value should be the customer GCP project where the BYOC-I data plane resources
  are deployed.
  ```

- [ ] **Step 3: Add tiered query node troubleshooting**

  Question:

  ```text
  I cannot select a Tiered Query Node instance type.
  ```

  Answer:

  ```text
  Tiered Query Node instance selection may depend on cloud provider, region, and
  release phase. If the selector is not available, use the displayed default
  settings or contact Zilliz support to confirm availability.
  ```

## Task 11: QA The Refactor

**Files / Pages:**
- Review all modified BYOC pages.

- [ ] **Step 1: Verify conceptual coverage**

  Confirm every deployment page answers:
  - What is the project?
  - What is the data plane?
  - Can a project have multiple data planes?
  - Which step creates the project?
  - Which step deploys one data plane?

- [ ] **Step 2: Verify provider terminology**

  Check:
  - AWS: VPC, EKS, S3, IAM role, PrivateLink.
  - GCP: VPC, GKE, Cloud Storage, service account, Private Service Connect, `gcp_project_id`.
  - Azure: VNet, AKS, subscription, resource group, Azure Private Link, RBAC.

- [ ] **Step 3: Verify links**

  Confirm links from:
  - Deployment pages to `Projects and data planes`.
  - Deployment pages to provider prerequisites.
  - BYOC-I pages to provider permissions.
  - Troubleshooting entries to deployment pages.

- [ ] **Step 4: Verify moved content is still discoverable**

  Search for:
  - `multiple data planes`
  - `gcp_project_id`
  - `Tiered Query Node`
  - `Technical Support Access`
  - `supported regions`

  Each search should land on at least one concept/reference page and the relevant provider deployment page.

## Recommended Execution Order

1. Fix `Deploy BYOC-I on GCP` immediate issues.
2. Create `Projects and data planes`.
3. Add multi-dataplane callouts to all deployment pages.
4. Extract `Manage data planes`.
5. Fix Azure terminology/copy issues.
6. Extract prerequisites and permissions.
7. Add provider console operation pages and surface markers in deployment steps.
8. Build Terraform pages from the provider docs and reference examples.
9. Add troubleshooting entries.
10. QA links, terminology, Terraform schema alignment, and discoverability.

## Completion Criteria

- A reader can learn from docs, without reading release notes, that one project can contain multiple regional data planes.
- GCP BYOC-I explicitly documents `gcp_project_id`.
- Terraform deployment pages map Zilliz Cloud fields, provider-console resources, Terraform variables, provider schema fields, outputs, and validation signals.
- Region support limitations have a clear path to support.
- Tiered Query Node selection behavior is either documented as supported or clearly caveated.
- Azure BYOC-I no longer contains AWS/GCP terminology.
- Provider-console work is explicit: users can tell which steps happen in Zilliz Cloud, AWS/GCP/Azure console, Terraform, or CLI.
- Long provider deployment pages are shorter and route reference-heavy details to concept, prerequisite, permissions, and troubleshooting pages.
