import { db } from './client';
import type { PolicyDecisionLog, DecisionLogEntry } from './types';
import type { PolicyAction } from '@prisma/client';

export async function createDecisionLog(entry: DecisionLogEntry): Promise<PolicyDecisionLog> {
  return db.policyDecisionLog.create({
    data: {
      userId: entry.userId,
      organizationId: entry.organizationId,
      action: entry.action as PolicyAction,
      score: entry.score,
      reasons: JSON.stringify(entry.reasons),
      matchedRuleIds: JSON.stringify(entry.matchedRuleIds),
      promptHash: entry.promptHash,
      promptPreview: entry.promptPreview,
      promptLength: entry.promptLength,
      latencyMs: entry.latencyMs,
      engineVersion: entry.engineVersion,
      // Phase 3 audit fields
      route: entry.route ?? null,
      maskCount: entry.maskCount ?? 0,
      maskLabels: JSON.stringify(entry.maskLabels ?? []),
      isSensitive: entry.isSensitive ?? null,
      classifierCategory: entry.classifierCategory ?? null,
      classifierRisk: entry.classifierRisk ?? null,
      classifierReason: entry.classifierReason ?? null,
      classifierLatencyMs: entry.classifierLatencyMs ?? null,
      sourceIp: entry.sourceIp ?? null,
      promptTokens: entry.promptTokens ?? null,
      completionTokens: entry.completionTokens ?? null,
      // Phase 5 Semantic Pipeline audit fields (spec §37)
      sensitivity: entry.sensitivity ?? null,
      matchedConceptIds: JSON.stringify(entry.matchedConceptIds ?? []),
      retrievalScores:
        typeof entry.retrievalScores === 'string'
          ? entry.retrievalScores
          : JSON.stringify(entry.retrievalScores ?? []),
      classifierMethod: entry.classifierMethod ?? null,
      egressMode: entry.egressMode ?? null,
      policyVersion: entry.policyVersion ?? null,
      pipelineHealth: entry.pipelineHealth ?? null,
    },
  });
}

export interface DecisionLogFilters {
  action?: PolicyAction;
  route?: 'EXTERNAL' | 'LOCAL' | 'BLOCKED';
  classifierRisk?: string;
  userId?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  pageSize?: number;
}

export async function getDecisionLogs(
  organizationId: string,
  filters?: DecisionLogFilters,
): Promise<{ logs: PolicyDecisionLog[]; total: number }> {
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 20;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = { organizationId };

  if (filters?.action) {
    where.action = filters.action;
  }
  if (filters?.route) {
    where.route = filters.route;
  }
  if (filters?.classifierRisk) {
    where.classifierRisk = filters.classifierRisk;
  }
  if (filters?.userId) {
    where.userId = filters.userId;
  }
  if (filters?.fromDate || filters?.toDate) {
    where.createdAt = {} as Record<string, unknown>;
    if (filters.fromDate) (where.createdAt as Record<string, unknown>).gte = filters.fromDate;
    if (filters.toDate) (where.createdAt as Record<string, unknown>).lte = filters.toDate;
  }

  const [logs, total] = await Promise.all([
    db.policyDecisionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    db.policyDecisionLog.count({ where }),
  ]);

  return { logs, total };
}

export async function getDecisionLogStats(organizationId: string): Promise<{
  total: number;
  blocked: number;
  allowed: number;
  todayBlocked: number;
  todayTotal: number;
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total, blocked, allowed, todayBlocked, todayTotal] = await Promise.all([
    db.policyDecisionLog.count({ where: { organizationId } }),
    db.policyDecisionLog.count({ where: { organizationId, action: 'BLOCK' } }),
    db.policyDecisionLog.count({ where: { organizationId, action: 'ALLOW' } }),
    db.policyDecisionLog.count({
      where: { organizationId, action: 'BLOCK', createdAt: { gte: todayStart } },
    }),
    db.policyDecisionLog.count({
      where: { organizationId, createdAt: { gte: todayStart } },
    }),
  ]);

  return { total, blocked, allowed, todayBlocked, todayTotal };
}
