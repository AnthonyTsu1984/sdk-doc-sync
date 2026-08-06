---
name: localization-docs
description: Use when an existing invocation names localization-docs; this is a compatibility entry that delegates the complete workflow to localized-doc-sync.
---

# Localization Docs Compatibility Entry

This deprecated name preserves existing invocations. Load and follow [Localized Doc Sync](../localized-doc-sync/SKILL.md) as the canonical skill. Do not define or execute an independent workflow here.

When returning run-local results, include `"compatibilityTelemetry": {"alias": "localization-docs", "canonical": "localized-doc-sync", "invocationCount": 1}`. Do not create an independent telemetry store.
