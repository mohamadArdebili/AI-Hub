// Legacy SEMANTIC PolicyRule to PolicyConcept Data Migration Script
// (MIGRATION_PLAN_REVIEWED_v1.1 §3.3, §6.7)
// Converts legacy keyword-based SEMANTIC PolicyRule records to structured PolicyConcept records
// in REVIEW status with provenance tracking.

import { db } from '../src/lib/db/client';
import crypto from 'crypto';

function mapSeverityToSensitivity(severity: string): 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'HIGHLY_CONFIDENTIAL' {
  switch (severity) {
    case 'CRITICAL':
      return 'HIGHLY_CONFIDENTIAL';
    case 'HIGH':
      return 'CONFIDENTIAL';
    case 'MEDIUM':
      return 'INTERNAL';
    case 'LOW':
    default:
      return 'PUBLIC';
  }
}

function mapActionToConceptAction(
  action: string,
  severity: string,
): 'ALLOW_EXTERNAL' | 'ROUTE_LOCAL' | 'MASK_AND_ALLOW_EXTERNAL' | 'BLOCK' {
  if (severity === 'CRITICAL') return 'BLOCK';
  switch (action) {
    case 'MASK':
      return 'MASK_AND_ALLOW_EXTERNAL';
    case 'BLOCK_EXTERNAL':
    case 'FLAG_REVIEW':
    default:
      return 'ROUTE_LOCAL';
  }
}

function sanitizeConceptKey(code: string, title: string): string {
  const cleanCode = code.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (cleanCode && cleanCode.length > 2) {
    return `legacy_${cleanCode}`;
  }
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 30);
  return `legacy_${cleanTitle || crypto.randomBytes(4).toString('hex')}`;
}

export async function migrateLegacySemanticRules(): Promise<{
  totalLegacyRules: number;
  migratedCount: number;
  skippedCount: number;
  errors: Array<{ ruleId: string; error: string }>;
}> {
  console.log('🔄 Starting migration of legacy SEMANTIC PolicyRule records to PolicyConcept...');

  const legacyRules = await db.policyRule.findMany({
    where: {
      detectorType: 'SEMANTIC',
      documentId: { not: null },
    },
    include: {
      document: true,
    },
  });

  console.log(`Found ${legacyRules.length} legacy SEMANTIC rules with document association.`);

  let migratedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ ruleId: string; error: string }> = [];

  for (const rule of legacyRules) {
    if (!rule.documentId) {
      skippedCount++;
      continue;
    }

    try {
      const conceptKey = sanitizeConceptKey(rule.code, rule.title);

      // Check if concept with this key already exists for this document
      const existing = await db.policyConcept.findUnique({
        where: {
          documentId_conceptKey: {
            documentId: rule.documentId,
            conceptKey,
          },
        },
      });

      if (existing) {
        console.log(`Skipping rule ${rule.code}: conceptKey "${conceptKey}" already exists.`);
        skippedCount++;
        continue;
      }

      let keywords: string[] = [];
      try {
        keywords = JSON.parse(rule.keywords);
      } catch {
        keywords = [];
      }

      const quote = rule.sourceQuote || rule.body || rule.title;
      const quoteHash = crypto.createHash('sha256').update(quote.trim()).digest('hex');

      const sensitivity = mapSeverityToSensitivity(rule.severity);
      const action = mapActionToConceptAction(rule.action, rule.severity);

      // Positive examples: use keywords or rule title
      const positiveExamples = keywords.length > 0 ? keywords.slice(0, 5) : [rule.title];

      await db.$transaction(async (tx) => {
        const concept = await tx.policyConcept.create({
          data: {
            organizationId: rule.organizationId,
            documentId: rule.documentId!,
            conceptKey,
            name: rule.title,
            nameFa: rule.title,
            descriptionFa: rule.body || rule.title,
            category: rule.category || 'legacy_migration',
            sensitivity,
            action,
            conditions: '[]',
            keywords: JSON.stringify(keywords),
            sourceQuote: quote,
            sourcePage: rule.sourcePage ?? null,
            confidence: 0.8,
            reviewStatus: 'REVIEW', // Always REVIEW per spec §3.3
            extractedByModel: 'legacy_rule_migration',
            reviewNote: `Migrated from legacy PolicyRule ${rule.code} (${rule.id})`,
            textHash: quoteHash,
            sources: {
              create: {
                quote,
                page: rule.sourcePage ?? null,
                quoteHash,
              },
            },
            examples: {
              create: positiveExamples.map((ex) => ({
                kind: 'POSITIVE',
                text: ex,
              })),
            },
          },
        });

        // Update legacy rule status to indicate it has been migrated
        await tx.policyRule.update({
          where: { id: rule.id },
          data: {
            reviewNote: `Migrated to PolicyConcept ${concept.id} (${concept.conceptKey})`,
          },
        });
      });

      migratedCount++;
      console.log(`✅ Migrated rule ${rule.code} -> PolicyConcept (${conceptKey}) in REVIEW status.`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Failed to migrate rule ${rule.code}:`, errorMsg);
      errors.push({ ruleId: rule.id, error: errorMsg });
    }
  }

  console.log('\nMigration Summary:');
  console.log(`Total rules scanned: ${legacyRules.length}`);
  console.log(`Successfully migrated: ${migratedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errors.length}`);

  return {
    totalLegacyRules: legacyRules.length,
    migratedCount,
    skippedCount,
    errors,
  };
}

if (process.argv[1]?.endsWith('migrate-legacy-semantic-rules.ts')) {
  migrateLegacySemanticRules()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed with fatal error:', err);
      process.exit(1);
    });
}
