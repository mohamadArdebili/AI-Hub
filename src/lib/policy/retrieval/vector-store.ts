// In-Process Prisma Vector Store for Policy Concepts
// (MIGRATION_PLAN_REVIEWED_v1.1 §3.2, spec §16, §17, §71 Phase 3)

import { db } from '@/lib/db/client';
import type { PolicyConcept } from '../concepts/types';
import { getActiveConcepts } from '../concepts/repository';
import {
  type EmbeddingProvider,
  buildConceptEmbeddingText,
  computeEmbeddingTextHash,
} from './embeddings';

export interface ScoredConcept {
  concept: PolicyConcept;
  score: number; // Cosine similarity: -1..1 (typically 0..1 for normalized embeddings)
}

export interface VectorStoreSearchOptions {
  organizationId: string;
  documentId?: string;
  onlyActiveDocument?: boolean;
  topK?: number;
  minScore?: number;
}

/**
 * Computes cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface VectorStore {
  upsertEmbedding(
    conceptId: string,
    vector: number[],
    model: string,
    textHash: string,
  ): Promise<void>;
  deleteEmbedding(conceptId: string): Promise<void>;
  search(queryVector: number[], options: VectorStoreSearchOptions): Promise<ScoredConcept[]>;
  rebuildIndex(
    organizationId: string,
    documentId: string,
    embeddingProvider: EmbeddingProvider,
  ): Promise<{ indexed: number; failed: number }>;
}

export class PrismaVectorStore implements VectorStore {
  /**
   * Saves or updates an embedding vector for a concept.
   */
  async upsertEmbedding(
    conceptId: string,
    vector: number[],
    model: string,
    textHash: string,
  ): Promise<void> {
    await db.policyConceptEmbedding.upsert({
      where: { conceptId },
      create: {
        conceptId,
        vector: JSON.stringify(vector),
        model,
        dim: vector.length,
        textHash,
      },
      update: {
        vector: JSON.stringify(vector),
        model,
        dim: vector.length,
        textHash,
      },
    });
  }

  /**
   * Removes an embedding vector when a concept is modified or deleted.
   */
  async deleteEmbedding(conceptId: string): Promise<void> {
    await db.policyConceptEmbedding.deleteMany({
      where: { conceptId },
    });
  }

  /**
   * In-process dense cosine similarity search against ACTIVE concepts (spec §16).
   * Inactive, draft, or unapproved concepts are strictly ignored.
   */
  async search(
    queryVector: number[],
    options: VectorStoreSearchOptions,
  ): Promise<ScoredConcept[]> {
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0;

    // Fetch active concepts with their embeddings
    const concepts = await getActiveConcepts(options.organizationId, {
      documentId: options.documentId,
      onlyActiveDocument: options.onlyActiveDocument,
    });

    const scored: ScoredConcept[] = [];

    for (const concept of concepts) {
      if (!concept.embedding || !concept.embedding.vector) {
        continue;
      }

      const score = cosineSimilarity(queryVector, concept.embedding.vector);
      if (score >= minScore) {
        scored.push({ concept, score });
      }
    }

    // Sort descending by cosine score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
  }

  /**
   * Rebuilds embeddings for all ACTIVE concepts of a policy document.
   */
  async rebuildIndex(
    organizationId: string,
    documentId: string,
    embeddingProvider: EmbeddingProvider,
  ): Promise<{ indexed: number; failed: number }> {
    const concepts = await getActiveConcepts(organizationId, { documentId });

    if (concepts.length === 0) {
      return { indexed: 0, failed: 0 };
    }

    let indexed = 0;
    let failed = 0;

    const texts = concepts.map((c) => buildConceptEmbeddingText(c));
    const hashes = texts.map((t) => computeEmbeddingTextHash(t));

    try {
      const vectors = await embeddingProvider.embedBatch(texts);

      for (let i = 0; i < concepts.length; i++) {
        const concept = concepts[i];
        const vector = vectors[i];
        const textHash = hashes[i];

        if (!vector || vector.length === 0) {
          failed++;
          continue;
        }

        await this.upsertEmbedding(concept.id, vector, embeddingProvider.getModel(), textHash);
        indexed++;
      }

      // Record indexedAt timestamp on PolicyDocument
      await db.policyDocument.update({
        where: { id: documentId },
        data: { indexedAt: new Date() },
      });
    } catch (err) {
      console.error('[vector-store] rebuildIndex failed:', err);
      throw err;
    }

    return { indexed, failed };
  }
}
