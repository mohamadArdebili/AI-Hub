import crypto from 'crypto';
import { db } from '@/lib/db/client';
import { getActiveCompiledRules, getActiveMaskTerms } from '@/lib/db';
import { runDetectionV2 } from './detection/detection-pipeline';
import { withinDeadline } from './detection/deadline';
import type { DetectionOutcome } from './types';

export interface PolicyMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function serializeConversation(messages: PolicyMessage[]): string {
  return JSON.stringify(messages.map(({ role, content }) => ({ role, content })));
}

export function payloadHash(payload: string): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function policyRevision(documentId: string, organizationId: string, updatedAt: Date): Promise<string> {
  const concepts = await db.policyConcept.findMany({
    where: { documentId, organizationId }, orderBy: { id: 'asc' },
    include: { examples: true, embedding: true },
  });
  if (!concepts.some(c => c.reviewStatus === 'ACTIVE') ||
      concepts.some(c => c.reviewStatus === 'REVIEW' || c.reviewStatus === 'DRAFT')) {
    throw new Error('POLICY_REVIEW_INCOMPLETE');
  }
  return payloadHash(JSON.stringify({ updatedAt, concepts }));
}

/** Shared by chat and the admin tester; no external model is used here. */
export async function detectConversation(messages: PolicyMessage[], organizationId: string): Promise<DetectionOutcome> {
  const startedAt = Date.now();
  const payload = serializeConversation(messages);
  const budget = Number(process.env.POLICY_DETECTION_TIMEOUT_MS ?? '15000');
  const deadline = startedAt + budget;
  try {
    if (process.env.POLICY_SEMANTIC_ENABLED === 'false' || !Number.isFinite(budget) || budget <= 0) {
      throw new Error('POLICY_DETECTION_UNAVAILABLE');
    }
    return await withinDeadline((async () => {
      const documents = await db.policyDocument.findMany({
        where: { organizationId, isActive: true, lifecycle: 'ACTIVE' },
        select: { id: true, version: true, updatedAt: true },
      });
      if (documents.length !== 1) throw new Error('NO_UNAMBIGUOUS_ACTIVE_POLICY');
      const document = documents[0];
      const revision = await policyRevision(document.id, organizationId, document.updatedAt);
      const [compiledRules, dictionaries] = await Promise.all([
        getActiveCompiledRules(organizationId), getActiveMaskTerms(organizationId),
      ]);
      const outcome = await runDetectionV2({
        prompt: payload, messages, organizationId, documentId: document.id, compiledRules, dictionaries,
        activePolicyVersion: document.version, timeoutBudgetMs: Math.max(1, deadline - Date.now()),
      });
      return {
        ...outcome,
        policyDocumentId: document.id,
        policyRevision: revision,
        processing: { ...outcome.processing, egressPayloadHash: payloadHash(payload) },
      };
    })(), deadline);
  } catch {
    return {
      decision: 'UNCERTAIN', action: 'LOCAL_ONLY', route: 'LOCAL', pipelineHealth: 'FAILED', hits: [],
      reason: 'سیاست آماده یا سرویس تشخیص در دسترس نیست؛ درخواست فقط در مسیر محلی مجاز است.',
      processing: { normalizedInputHash: payloadHash(payload), egressPayloadHash: payloadHash(payload),
        durationMs: Date.now() - startedAt, localLlmUsed: false, externalLlmInvoked: false },
    };
  }
}

/** Recheck the policy snapshot immediately before egress. */
export async function assertCurrentPolicy(outcome: DetectionOutcome, organizationId: string): Promise<void> {
  const document = await db.policyDocument.findFirst({
    where: { id: outcome.policyDocumentId ?? '', organizationId, isActive: true, lifecycle: 'ACTIVE' },
    select: { version: true, updatedAt: true },
  });
  if (!document || document.version !== outcome.policyVersion || await policyRevision(outcome.policyDocumentId!, organizationId, document.updatedAt) !== outcome.policyRevision) {
    throw new Error('POLICY_CHANGED_DURING_DETECTION');
  }
}
