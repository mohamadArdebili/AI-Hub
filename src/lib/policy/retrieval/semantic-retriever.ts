// Dense Semantic Retriever for Policy Concepts
// (MIGRATION_PLAN_REVIEWED_v1.1 §3.3, spec §16, §56, §71 Phase 3)

import { normalizePersian } from '../normalize';
import type { RetrievedConcept } from '../concepts/types';
import { type EmbeddingProvider, OllamaEmbeddingProvider } from './embeddings';
import { type VectorStore, PrismaVectorStore } from './vector-store';

export interface SemanticRetrieverOptions {
  organizationId: string;
  documentId?: string;
  onlyActiveDocument?: boolean;
  topK?: number;
  minDenseScore?: number;
}

export class SemanticRetriever {
  private embeddingProvider: EmbeddingProvider;
  private vectorStore: VectorStore;

  constructor(
    embeddingProvider?: EmbeddingProvider,
    vectorStore?: VectorStore,
  ) {
    this.embeddingProvider = embeddingProvider ?? new OllamaEmbeddingProvider();
    this.vectorStore = vectorStore ?? new PrismaVectorStore();
  }

  /**
   * Retrieves Top-K active concepts using dense cosine similarity on the normalized prompt.
   */
  async retrieve(
    prompt: string,
    options: SemanticRetrieverOptions,
  ): Promise<RetrievedConcept[]> {
    const normalized = normalizePersian(prompt);
    if (!normalized.trim()) {
      return [];
    }

    const minScore =
      options.minDenseScore ??
      parseFloat(process.env.POLICY_DENSE_MIN_SCORE ?? '0.45');
    const topK = options.topK ?? parseInt(process.env.POLICY_RETRIEVAL_TOP_K ?? '5', 10);

    // 1. Embed query
    const queryVector = await this.embeddingProvider.embed(normalized);

    if (!queryVector.length || !queryVector.every(Number.isFinite) || !queryVector.some(v => v !== 0)) {
      throw new Error('INVALID_QUERY_EMBEDDING');
    }

    // 2. Vector search in store (scoped to active document if documentId omitted: AGENT_TASK §17)
    const results = await this.vectorStore.search(queryVector, {
      organizationId: options.organizationId,
      documentId: options.documentId,
      onlyActiveDocument: options.onlyActiveDocument ?? (options.documentId ? false : true),
      topK,
      minScore,
    });

    return results.map(({ concept, score }) => ({
      concept,
      score,
      denseScore: score,
    }));
  }
}
