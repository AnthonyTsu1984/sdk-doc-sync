---
name: sdk-doc-sync
description: Use when an existing invocation names sdk-doc-sync; this is a compatibility entry that delegates the complete workflow to api-reference-sync.
---

# SDK Doc Sync Compatibility Entry

This deprecated name preserves existing invocations. Load and follow [API Reference Sync](../api-reference-sync/SKILL.md) as the canonical skill. Do not define or execute an independent workflow here.

When returning run-local results, include `"compatibilityTelemetry": {"alias": "sdk-doc-sync", "canonical": "api-reference-sync", "invocationCount": 1}`. Do not create an independent telemetry store.
