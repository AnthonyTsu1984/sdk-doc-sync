# Management -> 运维指南 Alignment

Use this maintained alignment file when syncing English source table `Management` (`tblZMzoITXNsyKmQ`) to Chinese target table `运维指南` (`tblMuHkoG4qMugeX`).

Last inspected: 2026-06-18.

## Sources

- English base: `Ac7xbs2k1ad7bjsCXr0ccHe9nMh`
- English table: `tblZMzoITXNsyKmQ`
- Chinese base: `I6YUb1M0JajHrqsJGcLcZNh7neP`
- Chinese table: `tblMuHkoG4qMugeX`
- Chinese wiki pool: `https://zilliverse.feishu.cn/wiki/LoNhwUIsLip6GMk9fkjcDJdJnCh`
- Chinese Cloud Docs root inside the pool: `https://zilliverse.feishu.cn/wiki/XyeFwdx6kiK9A6kq3yIcLNdEnDd`

## Current State

- Source table snapshot: `145` records.
- Target table snapshot: `0` records.
- Chinese wiki pool snapshot: `790` nodes.
- The usable counterpart subtree is `Cloud Docs`, not `Lakebase Docs`, `商业版部署手册`, or `Deprecations`.
- Target `Chapter` options are not aligned for Management. They currently look like Deployment/BYOC options:
  - `Deploy BYOC on AWS`
  - `Deploy BYOC-I on AWS`
  - `Deploy BYOC on GCP`
  - `Deploy BYOC-I on Microsoft Azure`
- Do not populate `Chapter` for Management records until the target field options are corrected or the user explicitly approves using blank `Chapter` values.
- Audit Logs slug convention:
  - Section row `Audit Logs` / `审计日志` uses slug `auditing` in both source and target tables.
  - Canonical row `VectorDB Audit Logs` / `VectorDB 审计日志` keeps slug `audit-logs`.

## Record Creation Pattern

- Section rows should mirror the existing Chinese Development table pattern:
  - `Placement Type`: `section`
  - `Docs`: pseudo link such as `[组织](http://组织)`
  - no real wiki document needs to be created for pure table sections.
- Canonical/ref rows should link to the existing Chinese wiki doc when a counterpart exists.
- Preserve source `Slug`, `Placement Type`, `Targets`, `Keywords`, `Progress`, `Notebook`, `Beta`, `Ref Target Doc`, and parent hierarchy unless an exception below says otherwise.
- Build parent links only after creating parent records in the target table, using target record IDs.
- Do not write `Seq. ID` because it is an auto-number field.

## Primary Counterpart Sections

Use these Chinese sections as the counterpart pool for Management:

| English area | Chinese section | Wiki token |
|---|---|---|
| Organizations | 组织 | `B1rYwr4rJi0UM7kpppxcQvwin7l` |
| Projects | 项目 | `FqTCwzQ7pifaAKkajQdchERrnEd` |
| Clusters / Dedicated Cluster | Serving 集群 | `H4Jlw1x88iCj9Pk2LUxcChVtnzb` |
| On-Demand Cluster | 按需计算 | `QZp3wE5pbi96fhkTLrjceVQGnnc` |
| Global Cluster | Serving 集群 / 全球集群 | `ResZwp9H4itTv4k4P4lcmwUZnvc` |
| Backup & Restore | 备份与恢复 | `SbePwiLrZi2hZqk5NpRcmramnEN` |
| Migrations | 数据迁移 | `PU8HwyM6Kiv0C4krF58cTNOVnSe` |
| Metrics & Alerts | 指标与告警 | `SlItwMcOyikiWVkr7Glcy9sinMg` |
| Access Control | 安全 / 访问控制 | `EoZvwmbpfiPqIdk0cxocyw9mnlX` |
| Authentication | 安全 / 用户鉴权 | `ZdQxwDlFbiPLCNkXISXcyqtBn3r` |
| IP Allowlists / Private Endpoint | 安全 / 网络与安全 | `VCp1wTKc8io1kGkHknEcHX25nLb` |
| Audit Logs | 安全 / 审计日志 | `BEo3wjHfwiCjSxkmrlQcD7QAnhb` |
| Access Logs | 安全 / 访问日志 | `N34RwlG1Fi8t8QkrsfjcWlMun7J` |
| Billing Management | 账单管理 | `Dhb6w8X1IiZgFskollvcvjvYnsf` |
| Cost Management | 成本管理 | `FSOZwAyqpihFYpklKLUczzEBng3` |
| Limits & API Availability | 约束与限制 | `Y3PXwA1Y0i5pZokIw8NcWCzPnxh` |

## High-Confidence Doc Counterparts

Use these exact wiki docs where available:

| Source slug/title | Chinese title | Wiki token |
|---|---|---|
| `organization-users` / Manage Organization Users | 组织用户 | `PzjhwZkgqiiVmakWT03c8VDAnTh` |
| `organization-settings` / Manage Organization Settings | 组织设置 | `AkYpwsObJihszLkXBz6ca0XDnOc` |
| `use-recycle-bin` / Use Recycle Bin | 回收站 | `FgDZw6JJuiICETkqrqHckN4pneb` |
| `manage-projects` / Manage Projects | 项目管理 | `KHwEwoWy3iSRO1kTpIjc21jNnsb` |
| `project-users` / Manage Project Users | 项目用户 | `GZriwpM0Gi7fcukuo8xc736VnBh` |
| `job-center` / Manage Project Jobs | 项目任务 | `YtLLwrOl0in7OqkdMpPc4ZkxnVd` |
| `create-cluster` / Create Cluster | 创建集群 | `M3fWwcqJpimd7YkaoLucY7eBnne` |
| `connect-to-clusters` / Connect to Clusters | 连接集群 | `HU31wDHCCiN9qIknZ2fcLmconNh` |
| `manage-cluster` / Manage Cluster | 管理集群 | `IRirwe30tilo1qkJlR7ca2MUnvn` |
| `scale-cluster` / Scale Cluster | 集群扩缩容 | `MeCPwj8n0i2x1BksjOHc3OKRn55` |
| `scale-query-cu` / Scale Query CU | Query CU 扩缩容 | `KgrNwYNN6iuoEMkdpwjcTOeanrb` |
| `manage-replica` / Scale Replica | Replica 扩缩容 | `A8MYw6Wj2ilF2akZeKYcwJGSnSY` |
| `cron-expression` / Cron Expression | Cron 表达式 | `FJkpwLOJRisXX0kxqC8ck8YAn4c` |
| `global-cluster-explained` | 全球集群概览 | `LdpTwpzkFinz6lkW3Jpce7QQnJd` |
| `create-global-cluster` | 创建全球集群 | `SgDzwGKoHiV6flk3OJ9cGFaZnuf` |
| `connect-to-global-cluster` | 连接全球集群 | `VfF8wgQEmixhpkkxEFDchYoinBv` |
| `switchover-and-failover` | 优雅切换和强切 | `GopSwoGT3iIQSOkD15tcWQ7Dn5e` |
| `scale-global-cluster` | 全球集群扩缩容 | `ER5PwvwjIiBcG4kughjcE1GLnjh` |
| `monitor-global-cluster` | 监控全球集群 | `SQ3fw6BdJioGuKk5J2XcY7RRnid` |
| `manage-global-cluster` | 管理全球集群 | `NpmyweSc9icYKak5XFvcP8iAnXd` |
| `create-backup` | 创建备份 | `GFFswc3z1iQtjQkpmyScL00dnSx` |
| `schedule-automatic-backups` | 设置定时自动备份 | `TXyTwrfxCiStfek4hc7c2nKwnJc` |
| `backup-to-other-regions` | 跨地域备份 | `DwklwhvhBi1xiQkdaxVcbIK0ned` |
| `restore-from-backup-files` | 恢复备份 | `NtkswF6UEi3kB0k8XSEcOKkhnld` |
| `export-backup-files` | 导出备份文件 | `WXBjwo4sgiCDX8kZvBwcJrJCnyg` |
| `manage-backup-files` | 管理备份文件 | `BQjRwYOyZiDjwfkRav6cpFOTnoe` |
| `migrate-from-milvus` | 从 Milvus 迁移至 Zilliz Cloud | `Eao0wFMCxiFiiikrZgScLW3LnZe` |
| `offline-migration` | 离线迁移 | `N6tlwTPPvi0FXvkj4fccCgtTnOg` |
| `via-endpoint` | 通过 Endpoint 从 Milvus 迁移至 Zilliz Cloud | `PtmRwn9bQi6WAKkurfXcEXKKn9b` |
| `via-backup-files` | 通过备份文件从 Milvus 迁移至 Zilliz Cloud | `YBlmwO9ajiU4tYklnjmc6fJPn8e` |
| `via-stage` | 通过备份工具从 Milvus 迁移至 Zilliz Cloud | `ZP6tw8jcQipDKrkY93DcYCetnJb` |
| `migrate-between-clusters` | Zilliz Cloud 跨集群迁移 | `NzDwwYOwhiRi22kutJ2c65tVngg` |
| `external-migration-basics` | 外部迁移概述 | `FD9uwJwjgi8ub4kit1EcXyEQnqs` |
| `migrate-from-pinecone` | 从 Pinecone 迁移至 Zilliz Cloud | `MjDcwfnLMiVRYVkFSqTckwQbnmc` |
| `migrate-from-qdrant` | 从 Qdrant 迁移至 Zilliz Cloud | `Ii6EwCswKihb6LkI0MmcNVZZnIf` |
| `migrate-from-elasticsearch` | 从 Elasticsearch 迁移至 Zilliz Cloud | `CJN4wlKiGi1P8Zk4BHKcF04GnLb` |
| `migrate-from-pgvector` | 从 PostgreSQL 迁移至 Zilliz Cloud | `QrBFw5sXmiaaYRk1YpectbZpnzg` |
| `migrate-from-tencent-cloud` | 从腾讯云向量数据库迁移至 Zilliz Cloud | `WBTjw5BmvisFlLk6uGoc6q71nns` |
| `migrate-from-opensearch` | 从 OpenSearch 迁移至 Zilliz Cloud | `Cf89wr8V3iGmr3kKiqAcP4D1nPb` |
| `metrics-alerts-reference` | 指标快速参考 | `Rca8w6kRRiy7a9kr6adczTcGnoh` |
| `zilliz-cloud-ips` | Zilliz Cloud IP | `J86AwNi3midzR9kqgbHcnX14ntc` |
| `view-cluster-metric-charts` | 查看集群性能指标 | `S3BswPJ4NiKl9okZDoycMvbunMb` |
| `manage-organization-alerts` | 管理组织告警 | `WpDVwYaHMizLWuklBJlcypTzn2d` |
| `manage-project-alerts` | 管理项目告警 | `EUS8w4x9Ii0BmhkJBfQcsoFln5c` |
| `manage-notification-channels` | 管理告警渠道 | `T9z1wL5y9iDgV5kMAx1cAZfxn0b` |
| `prometheus-monitoring` | Prometheus 监控 | `LVC1wq5Qginkeskq2G0c0Z8WnPc` |
| `access-control-overview` | 访问控制概览 | `APGCw9vhAiVHW2kDqtcceEdmn0b` |
| `cluster-users` | 管理集群用户（控制台） | `KKSvwII0Ni7CQ7khuiBcU1gYnQc` |
| `cluster-users-sdk` | 管理集群用户（SDK） | `UX6ew8AtoillJskKRthcZyqinZb` |
| `cluster-roles` | 管理集群角色（控制台） | `A1MewOIxbi6Lq3kmiFkcqVt7nZf` |
| `cluster-roles-sdk` | 管理集群角色（SDK） | `IrLSwdkWWiSeshkNHfVcYhIjnHy` |
| `cluster-privileges` | 权限与权限组 | `PTadwccZmiQ6PpkcQYtcH9OAnSe` |
| `email-accounts` | 邮箱账号 | `SVnkw5IkNiOfALkijr1cw91vn3L` |
| `manage-api-keys` | API 密钥 | `UGzNwB4TmiqTozkJvarceRdenif` |
| `cluster-credentials` | 集群身份凭证 | `VNWiwtYwGi9m0Okhj3Zce8wAnte` |
| `multi-factor-auth` | 管理 MFA | `EWAWwESijisVHFkoAEbcfhvPnZb` |
| `single-sign-on` / Okta SSO rows | 使用 Okta 配置 SSO | `BRygwmdMOiyW0Ckd439cJwR6nHf` |
| `setup-console-ip-allowlist` | 设置控制台 IP 白名单 | `LgvSwz0qxiSMbik6BlbcSiTpn6g` |
| `setup-whitelist` | 设置集群 IP 白名单 | `RwEzw2l4siJB5Ake7FOcVU4knre` |
| `audit-logs` | VectorDB 审计日志 | `OcSgw7LJwiyuC2kdymbcWDV6nNg` |
| `audit-logs-ref` | VectorDB 审计日志参考 | `RNEgwQLoUi4djXkouqQcSbgvnlb` |
| `view-activities` | 查看平台审计日志 | `L7IZwws2oiiByGk53YWcJJ3ynFg` |
| `access-log-overview` | 访问日志概述 | `R0Jiw6mWPiPLo1kU3rocWfoCneg` |
| `configure-access-logs` | 配置访问日志 | `Wl2PwW2aAiYakOk4c8scRPLBn9b` |
| `access-log-reference` | 访问日志参考 | `Hq43w5qtPijHDok3TxKcZ60fnQc` |
| `payment-billing` | 支付方式与账单 | `Uj7IwJpneijPROkAZN7cJRLInrc` |
| `update-billing-profile` | 更新账单接收信息 | `YJNZwKdCTia9L7k5o93cdAUynOg` |
| `view-invoice` | 了解账单 | `NhbHwPiL2i4KWskrcO4cDrSNnzh` |
| `manage-invoice` | 开具发票 | `JTuUwoHUyiqJU6kuu30cN9ibnkh` |
| `failed-payments-organization-recovery` | 处理支付失败与组织冻结 | `OzZfwGPsaiFv7zkFpPOcOKddnSd` |
| `monitor-billing-alerts` | 设置账单告警 | `VHz6wyqArieXOpkujoRctW0hnng` |
| `on-demand-compute-cost` | 按需计算费用 | `XEvpwUMfFirFkNkQZofcwUTcnvd` |
| `dedicated-cluster-cost` | Dedicated 集群费用 | `Gc0Cw50sPikX4vkCxU7cw7kunzb` |
| `serverless-cluster-cost` | Serverless 集群费用 | `MfZawdBV9iFGi4k7HRbcyyj2nCh` |
| `storage-cost` | 存储费用 | `Lv3Awu3uHiZ99AkGKXYc7D0JnCd` |
| `storage-request-cost` | 存储请求费用 | `LuNmwpQRKiOz4ZkEkl4cTkNtnpk` |
| `data-transfer-cost` | 数据传输费用 | `RZoSwcpJniF0ZxkfhaDcFUHin4A` |
| `audit-log-cost` | 审计日志费用 | `HrONwUQ4riQnbgkZGY0ceLp9nUg` |
| `analyze-cost` | 分析成本 | `DeRWwlqYKiH76okxiaBcVFPjnMg` |
| `cost-optimization` | 成本优化 | `ObcZwiYelidyeTk8HGaclpWTnFe` |
| `limits` | 使用限制 | `A8UFwSbMniMl6IkpJkNc4HsHnLc` |
| `api-comparison` | API 异同 | `KOD2wN5jDimhSOk1GshcUbn2nJe` |
| `managed-volumes` ref | Managed Volume, ref to Development table | `JVtGwoZ0Ni6ZEmkTZvyc58kAnjc` |
| `external-volumes` ref | External Volume, ref to Development table | `E9QNwMMUbiVDvtkJQKUcuHR0nxc` |
| `manage-on-demand-clusters` | Manage On-Demand Cluster | `ETznwYhvpitgrtk4Y7dcLSv0nLc` |
| `connect-for-on-demand-search` ref | 连接按需搜索 | `Mj2bw4KFYikkOJkLCOtcDQn0nph` |
| `database-in-serving-clusters` ref | Serving 集群中的 Database | `XIFowGwHFiNkgbkONbgcfhHTnbe` |
| `database-for-on-demand-search` ref | 按需计算中的 Database | `CV70wkhwiiBsplkxFJicEbgEnab` |

## China-Specific Exceptions

Apply these exceptions before reporting missing records:

- Storage integrations:
  - Global `Integrate with AWS S3` maps to Chinese `Amazon S3`: `Bt3swdJKaigDQgkrzSwcoEEgnV4`.
  - Global `Integrate with Google Cloud Storage` and `Integrate with Azure Blob Storage` do not apply to Chinese SaaS.
  - Chinese SaaS also uses `阿里云对象存储`: `IwAbwxWzQiGVc0khATdcOoCbnCg`.
- Private endpoint:
  - Global AWS PrivateLink maps to Chinese `创建亚马逊云科技 PrivateLink`: `EAJywEPq2iGDmNkEDDxcJDYPnsg`.
  - Global GCP Private Service Connect and Azure Private Link do not directly apply to Chinese SaaS.
  - Chinese SaaS also uses `创建阿里云私网连接（Private Link）`: `OZ5Ywbjm0idqAqkOdZrcQU3Wncb`, `创建腾讯云私有连接（Private Link）`: `Pzu4wpY64iWmO6kBsaYcNPmPnNf`, and `创建华为云私网连接`: `Cew9w6MH5iRU8KkNvUUc8V2Xnxg`.
- Billing and marketplace:
  - Global credit-card, AWS/GCP/Azure marketplace, and separate-marketplace-billing records are not one-to-one for Chinese SaaS.
  - Chinese SaaS payment docs include `企业认证` (`VRLOw9Mc7iPWnCkZs2YcoGwSnLh`), `现金充值（对公转账）` (`JZqrwH8V8i6a3jktSQgcyXAEnAg`), `订阅阿里云云市场` (`UTRZwxLf3ikwvbkXrKjcWAwOnmg`), `订阅亚马逊云科技 Marketplace` (`LNxnwCaoeiwvxVkQqCTcWmMFn5g`), `管理订单` (`FJU5wklQuiAJASkHAFlcQShDn9e`), and `续订说明` (`BMzFwP8BbiUeAbkZ0abcDIHlnle`).
- SSO:
  - The Chinese Cloud Docs pool currently exposes only `使用 Okta 配置 SSO`.
  - Source provider-specific SSO pages for Google Workspace, Microsoft Entra, generic SAML IdP, SCIM, and SSO enforcement are not applicable to Chinese SaaS unless product requirements change.
- Rows marked `Chinese: N/A` below are not applicable to Chinese SaaS. Do not create target records for them and do not report them as unresolved missing docs.

## Dry-Run Classification

For the empty target table:

- `NEW_META_FROM_EXISTING_DOC`: create target records that point to existing Chinese docs.
- `NEW_SECTION_META`: create target section records using pseudo links.
- `CHINA_SPECIFIC_EXTRA`: create target records for China-only provider/payment docs listed above, if the user wants the Chinese table to reflect the Chinese docs pool rather than only mirror English source rows.
- `EXCLUDED_GLOBAL_ONLY`: do not create records for global-only providers/marketplaces when a China-specific replacement exists.
- `NOT_APPLICABLE_TO_CHINESE_SAAS`: do not create target records and do not report these as unresolved.

Before live writes, produce a dry-run count with the concrete slugs/titles in each class and ask for approval.

### 2026-06-18 Conservative Dry Run

Target table `tblMuHkoG4qMugeX` is empty, so all approved writes would be record creates.

| Class | Count | Notes |
|---|---:|---|
| `NEW_SECTION_META` | 25 | Create section records with pseudo links and translated labels. |
| `NEW_META_FROM_EXISTING_DOC` | 94 | Create records that point to existing Chinese docs in the pool or existing Chinese Development docs for `ref` rows. |
| `EXCLUDED_GLOBAL_ONLY` | 10 | Do not create for Chinese SaaS unless product requirements change. |
| `NOT_APPLICABLE_TO_CHINESE_SAAS` | 16 | Do not create for Chinese SaaS; these rows are intentionally absent from the target. |
| `UNRESOLVED_MISSING_DOC` | 0 | No remaining missing-doc discrepancies after applying the Management exceptions. |
| `CHINA_SPECIFIC_EXTRA` | 10 | Existing Chinese docs that should be added if the Chinese table should represent Chinese SaaS behavior. |

`EXCLUDED_GLOBAL_ONLY` source rows:

| Seq | Source slug/title | Reason |
|---:|---|---|
| 70 | Integrate with Google Cloud Storage | Global storage provider; Chinese SaaS uses 阿里云对象存储 and Amazon S3. |
| 71 | Integrate with Azure Blob Storage | Global storage provider; Chinese SaaS uses 阿里云对象存储 and Amazon S3. |
| 93 | `setup-a-private-link-gcp` | Global network provider; Chinese SaaS uses Aliyun/Tencent/AWS China/Huawei private links. |
| 94 | `setup-a-private-link-azure` | Global network provider; Chinese SaaS uses Aliyun/Tencent/AWS China/Huawei private links. |
| 112 | `separate-zilliz-cloud-billing-on-aws-marketplace` | Global marketplace billing flow; Chinese SaaS has different payment docs. |
| 113 | `separate-zilliz-cloud-billing-on-azure-marketplace` | Global marketplace billing flow; Chinese SaaS has different payment docs. |
| 115 | `subscribe-by-adding-credit-card` | Global credit-card subscription flow; Chinese SaaS has enterprise/cash/marketplace flows. |
| 121 | `subscribe-on-gcp-marketplace` | Global marketplace provider; no Chinese counterpart in pool. |
| 122 | `subscribe-on-gcp-marketplace-private-offer` | Global marketplace provider; no Chinese counterpart in pool. |
| 123 | `subscribe-on-azure-marketplace` | Global marketplace provider; no Chinese counterpart in pool. |

Non-applicable and resolved source rows from the previous unresolved list:

| Seq | Source slug/title | Chinese docs |
|---:|---|---|
| 13 | `cmek` / Customer-Managed Encryption Keys | Chinese: N/A |
| 14 | `aws-kms` / AWS KMS | Chinese: N/A |
| 21 | `free-and-serverless-clusters` / Free & Serverless Clusters | Chinese: N/A |
| 32 | `on-demand-cluster` / Create On-Demand Cluster | Chinese: N/A |
| 64 | `integrate-with-datadog` / Integrate with Datadog | Chinese: N/A |
| 66 | Managed Volumes | Ref row to Development doc: `https://zilliverse.feishu.cn/wiki/JVtGwoZ0Ni6ZEmkTZvyc58kAnjc` |
| 67 | External Volumes | Ref row to Development doc: `https://zilliverse.feishu.cn/wiki/E9QNwMMUbiVDvtkJQKUcuHR0nxc` |
| 85 | `single-sign-on-with-google-workspace` / Google Workspace (SAML 2.0) | Chinese: N/A |
| 86 | `single-sign-on-with-microsoft-entra` / Microsoft Entra (SAML 2.0) | Chinese: N/A |
| 87 | `single-sign-on-with-other-idp` / Other IdP (SAML 2.0) | Chinese: N/A |
| 88 | `enforce-sso-in-your-organization` / Enforce SSO in Your Organization | Chinese: N/A |
| 105 | `update-payment-method` / Update Payment Method | Chinese: N/A |
| 114 | `credits` / Credits | Chinese: N/A |
| 116 | `advance-pay` / Advance Pay | Chinese: N/A |
| 117 | Marketplace Subscription | Chinese: N/A |
| 118 | `subscribe-on-aws-marketplace-free-trial` / Subscribe to a Free Trial on AWS Marketplace | Chinese: N/A |
| 119 | `subscribe-on-aws-marketplace` / Subscribe to a Public Offer on AWS Marketplace | Chinese: N/A |
| 120 | `subscribe-on-aws-marketplace-private-offer` / Subscribe to a Private Offer on AWS Marketplace | Chinese: N/A |
| 145 | `manage-on-demand-clusters` / Manage On-Demand Cluster | `https://zilliverse.feishu.cn/wiki/ETznwYhvpitgrtk4Y7dcLSv0nLc` |

`CHINA_SPECIFIC_EXTRA` docs available in the pool:

| Proposed slug | Chinese title | Wiki token |
|---|---|---|
| `aliyun-oss` | 阿里云对象存储 | `IwAbwxWzQiGVc0khATdcOoCbnCg` |
| `aliyun-private-link` | 创建阿里云私网连接（Private Link） | `OZ5Ywbjm0idqAqkOdZrcQU3Wncb` |
| `tencent-private-link` | 创建腾讯云私有连接（Private Link） | `Pzu4wpY64iWmO6kBsaYcNPmPnNf` |
| `huawei-private-link` | 创建华为云私网连接 | `Cew9w6MH5iRU8KkNvUUc8V2Xnxg` |
| `enterprise-verification` | 企业认证 | `VRLOw9Mc7iPWnCkZs2YcoGwSnLh` |
| `cash-recharge` | 现金充值（对公转账） | `JZqrwH8V8i6a3jktSQgcyXAEnAg` |
| `aliyun-marketplace` | 订阅阿里云云市场 | `UTRZwxLf3ikwvbkXrKjcWAwOnmg` |
| `amazon-marketplace-cn` | 订阅亚马逊云科技 Marketplace | `LNxnwCaoeiwvxVkQqCTcWmMFn5g` |
| `manage-orders` | 管理订单 | `FJU5wklQuiAJASkHAFlcQShDn9e` |
| `renewal` | 续订说明 | `BMzFwP8BbiUeAbkZ0abcDIHlnle` |
