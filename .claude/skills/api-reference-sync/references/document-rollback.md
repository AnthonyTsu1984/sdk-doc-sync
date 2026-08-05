# Collaborative Document Rollback

This contract defines full rollback for one document review unit in the collaborative SDK API-reference workflow. Rollback is available after the unit has executed and before release acceptance finalization. It reverses the unit's Docx, Drive, and Bitable mutations without advancing or rewinding `scan-state.json`.

## Boundary

Rollback supports both of these states:

- the document has executed and is awaiting `APPROVE_DOCUMENT`;
- the document has an accepted receipt, but the release has not completed `APPROVE_ACCEPTANCE` finalization.

A session with `status: finalized` or `scanStateUpdated: true` cannot be reopened or rolled back in place. Correct it through a new reviewed release.

Rollback is a new destructive operation. `APPROVE_WRITES`, `APPROVE_DOCUMENT`, and `APPROVE_ACCEPTANCE` do not authorize it. The only valid authorization is:

```text
APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>
```

The digest binds the exact review unit, original execution journal, inverse actions, targets, dependencies, before-state evidence, and expected postconditions. Any drift invalidates approval.

## Durable Evidence Before Mutation

Rollback evidence must be durable before the corresponding Feishu mutation starts. The original execution journal's prepared entry records a rollback capsule containing only the state required to invert that action:

- the complete raw Bitable fields for every existing record that will be updated;
- the existing record ID and document token;
- a Docx history version ID and a canonical pre-write block digest for `UPDATE_IN_PLACE`;
- the original VirtualNode fields before a folder repoint;
- the approved resource ownership and dependency information;
- the expected absence proof for records, documents, folders, and VirtualNodes that will be created.

The observed entry records created record IDs, document tokens, folder tokens, resource resolutions, and verified post-write identities as structured rollback evidence, not only as an opaque digest. A process crash between preparation and mutation can therefore be reconciled without guessing. A process crash after mutation can derive the exact inverse operation from the prepared and observed entries.

The persistent review session records the active unit's completed execution journal path and digest before document acceptance. This makes an unaccepted document recoverable across processes and chat sessions.

## Action Inverses

### `CREATE`

1. Verify that the current record and Docx still match the identities created by the original journal.
2. Delete the created Bitable record and verify that it is absent.
3. Delete the created Docx and verify that it is absent.

The rollback must not delete a record or document whose live identity has drifted from the original observed result.

### `COPY_PATCH_AND_REPOINT`

1. Verify that the Bitable record still points to the observed copied Docx and still matches the post-write identity.
2. Restore the complete pre-write Bitable fields, including the original `Docs` title and link, parent record, Type, Progress, Targets, version metadata, and every other field changed by execution.
3. Verify that Bitable points to the original source Docx and matches the captured before-state.
4. Delete the copied-and-patched Docx and verify that it is absent.

The COPY source document was not modified. Do not call history revert for it and do not attempt to restore its content. "Restore the original document pointer" means restoring the Bitable record's original `Docs` field.

### `UPDATE_IN_PLACE`

1. Verify that the live record and document token still match the executed unit.
2. Revert the Docx with the history version captured before mutation.
3. Refetch the Docx and verify its canonical block digest against the pre-write digest.
4. Restore the complete pre-write Bitable fields and verify them.

If a usable history version and pre-write block digest cannot be persisted before mutation, the write is not rollback-capable and must be blocked before patching. If Feishu rejects the history revert or verification fails, record a partial rollback and leave the session receipt and state unchanged.

### `UPDATE_RECORD_METADATA` and `DEPRECATE`

Restore the complete pre-write Bitable fields and verify the exact restored values. These actions do not mutate Docx content.

### `CREATE_VIRTUAL_NODE`

Verify the observed record identity, delete the created Bitable record, and verify absence.

### `CREATE_FOLDER`

If execution repointed an existing VirtualNode, restore that record's complete pre-write fields and verify its original folder link first. Delete the created folder only after its dependent documents and records have been reversed, the folder is empty, and no other executed review unit references it. Verify folder absence after deletion.

### `ORPHAN` and `NOOP`

These actions have no mutation and produce no inverse action.

## Shared Resources and Ordering

Rollback executes the original unit's action graph in reverse dependency order. Document and record inverses run before deleting their parent VirtualNode or folder resources.

A resource may be deleted only when the original journal proves that the unit created it and the current session proves that no other executed or accepted unit uses it. If a later unit depends on that resource, rollback is blocked with the dependent review-unit IDs. The user must roll back dependent units first. A future, unexecuted unit does not block deletion because live planning will recreate or resolve the resource when that unit is selected.

Pre-existing resources are never deleted. A pre-existing VirtualNode that was repointed is restored from before-state.

## Rollback Manifest and Journal

Rollback planning is read-only. It validates the session, original execution journal, current live identities, dependency graph, and before-state evidence, then emits:

- `rollbackManifest`;
- `rollbackManifestDigest`;
- the exact inverse action order and side effects;
- shared-resource blockers;
- missing or drifted evidence blockers;
- `scanStateUpdated: false`.

Execution requires the exact digest-bound approval. Before each mutation, a rollback journal appends a durable prepared entry. After each mutation and live verification, it appends an observed entry. A successful completion sentinel is written only when every inverse action is verified. Partial rollback is never reported as complete and never changes the review session.

Rollback replay is prohibited when a journal already contains an unresolved prepared action. The operator must reconcile the live target and append a verified observed result before continuation.

## Session Transition

Only a successfully completed rollback journal may update the review session:

- for an unaccepted unit, clear its active execution and return it to reviewed planning;
- for an accepted unit, remove its accepted receipt;
- if an acceptance manifest was already built, clear it and return `acceptance_pending` to `in_progress`;
- append an immutable rollback receipt containing the original execution journal digest and rollback journal digest;
- keep `scanStateUpdated: false`.

The receipt or active execution is removed only after rollback completion has been verified. A failed or partial rollback leaves both intact so resume remains fail-closed.

After rollback, the unit must be regenerated against live state. A replacement write requires a new execution batch digest, a new `APPROVE_WRITES`, a new execution journal, and a new `APPROVE_DOCUMENT`.

## Verification Requirements

Completion requires live proof that:

- every restored Bitable record matches its captured raw before-state for the fields touched by the original action;
- every created Bitable record and VirtualNode selected for deletion is absent;
- every copied or created Docx selected for deletion is absent;
- every reverted in-place Docx matches its pre-write canonical block digest;
- every deleted folder is absent and was empty immediately before deletion;
- every retained shared resource still resolves for its dependent units;
- historical source documents remain unchanged;
- `scan-state.json` was not modified.

All unrecovered resources, tokens, record IDs, failed steps, and reconciliation instructions must be included in a partial rollback result.
