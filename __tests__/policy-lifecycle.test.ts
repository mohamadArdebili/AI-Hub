// Policy lifecycle tests — document transitions + rule review status machine
// (pure functions; prompt §3 policy-lifecycle.test.ts)

import { describe, it, expect } from 'vitest';
import {
  canTransitionLifecycle,
  type LifecycleState,
} from '@/lib/policy/ingestion';

/** Rule-level review machine (mirrors /api/admin/rules/[id] PATCH reviewAction). */
function canReviewRule(status: string): boolean {
  return ['DRAFT', 'PENDING_LLM', 'REVIEW'].includes(status);
}

describe('document lifecycle — full cycle', () => {
  it('DRAFT → REVIEW → ACTIVE walks the happy path', () => {
    let state: LifecycleState = 'DRAFT';
    expect(canTransitionLifecycle(state, 'REVIEW')).toBe(true);
    state = 'REVIEW';
    expect(canTransitionLifecycle(state, 'ACTIVE')).toBe(true);
    state = 'ACTIVE';
    expect(canTransitionLifecycle(state, 'ARCHIVED')).toBe(true);
  });

  it('only REVIEW may be activated (fail-closed activation contract)', () => {
    for (const from of ['DRAFT', 'ACTIVE', 'ARCHIVED'] as LifecycleState[]) {
      expect(canTransitionLifecycle(from, 'ACTIVE')).toBe(false);
    }
    expect(canTransitionLifecycle('REVIEW', 'ACTIVE')).toBe(true);
  });

  it('REVIEW can be sent back to DRAFT', () => {
    expect(canTransitionLifecycle('REVIEW', 'DRAFT')).toBe(true);
  });

  it('ARCHIVED is terminal', () => {
    expect(canTransitionLifecycle('ARCHIVED', 'DRAFT')).toBe(false);
    expect(canTransitionLifecycle('ARCHIVED', 'REVIEW')).toBe(false);
    expect(canTransitionLifecycle('ARCHIVED', 'ACTIVE')).toBe(false);
  });
});

describe('rule review status machine', () => {
  it('DRAFT / PENDING_LLM / REVIEW rules are reviewable', () => {
    expect(canReviewRule('DRAFT')).toBe(true);
    expect(canReviewRule('PENDING_LLM')).toBe(true);
    expect(canReviewRule('REVIEW')).toBe(true);
  });

  it('ACTIVE / REJECTED / ARCHIVED rules are NOT re-reviewable', () => {
    expect(canReviewRule('ACTIVE')).toBe(false);
    expect(canReviewRule('REJECTED')).toBe(false);
    expect(canReviewRule('ARCHIVED')).toBe(false);
  });
});
