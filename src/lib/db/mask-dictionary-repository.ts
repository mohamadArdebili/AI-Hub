import { db } from './client';
import type { MaskDictionary } from './types';
import type { MaskKind } from '@prisma/client';

// ─── Mask Dictionary (Sanitizer dictionaries — Phase 3) ────────────────────

export async function getMaskDictionaries(organizationId: string): Promise<MaskDictionary[]> {
  return db.maskDictionary.findMany({
    where: { organizationId },
    orderBy: [{ kind: 'asc' }, { term: 'asc' }],
  });
}

export async function getActiveMaskTerms(
  organizationId: string,
): Promise<{ seniorOfficers: string[]; telcoHubNodes: string[]; proprietaryServices: string[] }> {
  const rows = await db.maskDictionary.findMany({
    where: { organizationId, isActive: true },
    select: { kind: true, term: true },
  });

  const result = {
    seniorOfficers: [] as string[],
    telcoHubNodes: [] as string[],
    proprietaryServices: [] as string[],
  };

  for (const row of rows) {
    if (row.kind === 'SENIOR_OFFICER') result.seniorOfficers.push(row.term);
    else if (row.kind === 'TELCO_HUB_NODE') result.telcoHubNodes.push(row.term);
    else if (row.kind === 'PROPRIETARY_SERVICE') result.proprietaryServices.push(row.term);
  }

  return result;
}

export async function createMaskDictionary(data: {
  organizationId: string;
  kind: MaskKind;
  term: string;
}): Promise<MaskDictionary> {
  return db.maskDictionary.create({ data });
}

export async function updateMaskDictionary(
  id: string,
  organizationId: string,
  data: Partial<{ term: string; isActive: boolean }>,
): Promise<MaskDictionary> {
  const existing = await db.maskDictionary.findFirst({ where: { id, organizationId } });
  if (!existing) {
    throw new Error(`MaskDictionary entry with id "${id}" not found`);
  }
  return db.maskDictionary.update({ where: { id }, data });
}

export async function deleteMaskDictionary(id: string, organizationId: string): Promise<void> {
  const existing = await db.maskDictionary.findFirst({ where: { id, organizationId } });
  if (!existing) {
    throw new Error(`MaskDictionary entry with id "${id}" not found`);
  }
  await db.maskDictionary.delete({ where: { id } });
}
