---
name: draft-verified-docs
description: Use when an existing invocation names draft-verified-docs; this is a compatibility entry that delegates the complete workflow to verified-doc-authoring.
---

# Draft Verified Docs Compatibility Entry

This deprecated name preserves existing invocations. Load and follow [Verified Doc Authoring](../verified-doc-authoring/SKILL.md) as the canonical skill. Do not define or execute an independent workflow here.

When returning run-local results, include `"compatibilityTelemetry": {"alias": "draft-verified-docs", "canonical": "verified-doc-authoring", "invocationCount": 1}`. Do not create an independent telemetry store.
