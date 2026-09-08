CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS semantic_receipt_idempotency ON semantic_receipt(workspace_id, idempotency_key);
