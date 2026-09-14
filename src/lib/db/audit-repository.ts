// Policy Audit Log repository — Sensitive-Data Layer (prompt §1.5/§1.6).
//
// HARD RULE (prompt §0.4/§4): raw sensitive content (prompt text, chunk text,
// quotes, detector input) must NEVER be written here. Callers pass metadata
// only — hashes, lengths, types, ids, labels, counts. This repository also
// mirrors a structured, grep-able line to stdout.

import { db } from './client';
import type { PolicyAuditLog } from './types';

export type PolicyAuditAction =
  | 'UPLOAD'
  | 'CHUNKING'
  | 'TEXT_REPAIR'
  | 'RULE_EXTRACT'
  | 'RULE_PROPOSE'
  | 'RULE_ACCEPT'
  | 'RULE_REJECT'
  | 'ACTIVATION'
  | 'LIFECYCLE'
  | 'REPROCESS'
  | 'DELETE_DRAFT'
  | 'RUNTIME_SENSITIVE'
  | 'RUNTIME_UNCERTAIN'
  | 'CONCEPT_EXTRACT'
  | 'CONCEPT_EXTRACTION'
  | 'CONCEPT_APPROVE'
  | 'CONCEPT_REJECT'
  | 'CONCEPT_ARCHIVE'
  | 'CONCEPT_EDIT'
  | 'CONCEPT_DELETE';

export interface PolicyAuditInput {
  organizationId: string;
  actorId?: string | null;
  action: PolicyAuditAction;
  targetType:
    | 'POLICY_DOCUMENT'
    | 'POLICY_RULE'
    | 'POLICY_CHUNK'
    | 'RUNTIME_DECISION'
    | 'POLICY_CONCEPT'
    | 'POLICY_UNIT';
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  metadataJson?: string;
}

/** Guard: recursively strip any suspiciously large raw-text fields. */
function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && value.length > 300) {
      // Long strings are never metadata — they are content. Store length only.
      clean[key] = { truncated: true, length: value.length };
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export async function createPolicyAuditLog(input: PolicyAuditInput): Promise<void> {
  let rawMeta = input.metadata;
  if (!rawMeta && input.metadataJson) {
    try {
      rawMeta = JSON.parse(input.metadataJson);
    } catch {
      rawMeta = {};
    }
  }
  const metadata = sanitizeMetadata(rawMeta);
  try {
    await db.policyAuditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metadataJson: JSON.stringify(metadata),
      },
    });
    // Structured stdout line — grep-able, metadata only.
    console.log(
      `[policy-audit] action=${input.action} target=${input.targetType}:${input.targetId ?? '-'} ` +
        `actor=${input.actorId ?? 'system'} org=${input.organizationId} meta=${JSON.stringify(metadata)}`,
    );
  } catch (err) {
    // Audit logging must never break the business flow.
    console.error('[policy-audit] failed to persist audit log:', err);
  }
}

export async function getPolicyAuditLogs(
  organizationId: string,
  limit = 200,
): Promise<PolicyAuditLog[]> {
  return db.policyAuditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 500),
  });
}
