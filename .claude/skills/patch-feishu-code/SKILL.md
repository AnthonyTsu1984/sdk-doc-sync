---
name: patch-feishu-code
description: Use when an existing invocation names patch-feishu-code; this is a compatibility entry that delegates the complete workflow to procedure-code-sync.
---

# Patch Feishu Code Compatibility Entry

This deprecated name preserves existing invocations. Load and follow [Procedure Code Sync](../procedure-code-sync/SKILL.md) as the canonical skill. Do not define or execute an independent workflow here.

When returning run-local results, include `"compatibilityTelemetry": {"alias": "patch-feishu-code", "canonical": "procedure-code-sync", "invocationCount": 1}`. Do not create an independent telemetry store.
