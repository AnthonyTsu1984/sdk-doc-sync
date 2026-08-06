---
name: feishu-code-verify
description: Use when an existing invocation names feishu-code-verify; this is a compatibility entry that delegates the complete workflow to doc-code-verify.
---

# Feishu Code Verify Compatibility Entry

This deprecated name preserves existing invocations. Load and follow [Doc Code Verify](../doc-code-verify/SKILL.md) as the canonical skill. Do not define or execute an independent workflow here.

When returning run-local results, include `"compatibilityTelemetry": {"alias": "feishu-code-verify", "canonical": "doc-code-verify", "invocationCount": 1}`. Do not create an independent telemetry store.
