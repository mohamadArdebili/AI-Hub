// Hybrid Retriever (Dense Semantic + BM25 Lexical + Reciprocal Rank Fusion)
// (MIGRATION_PLAN_REVIEWED_v1.1 §3.4, spec §56, §0.1 #5, Rule 18, §71 Phase 3)

import { normalizePersian } from '../normalize';
import { computeBM25 } from '../detectors';
import type { PolicyConcept, RetrievedConcept } from '../concepts/types';
import { getActiveConcepts } from '../concepts/repository';
import { type EmbeddingProvider, OllamaEmbeddingProvider } from './embeddings';
import { type VectorStore, PrismaVectorStore } from './vector-store';
import { SemanticRetriever } from './semantic-retriever';

export interface HybridRetrieverOptions {
  organizationId: string;
  documentId?: string;
  onlyActiveDocument?: boolean;
  topK?: number;
  minDenseScore?: number;
  minLexicalScore?: number;
  rrfConstantK?: number; // default 60
}

/**
 * Builds lexical tokens for a PolicyConcept from its title, description, and keywords.
 */
export function buildConceptLexicalTokens(concept: PolicyConcept): string[] {
  const parts: string[] = [
    concept.conceptKey.replace(/_/g, ' '),
    concept.name,
    concept.nameFa ?? '',
    concept.descriptionFa,
    ...(concept.keywords ?? []),
    ...(concept.positiveExamples ?? []),
  ];

  const full = normalizePersian(parts.join(' ')).toLowerCase();
  return full.split(/[\s,،؛\.!؟\?:\-_()\[\]{}"]+/).filter((t) => t.length > 1);
}

export class HybridRetriever {
  private semanticRetriever: SemanticRetriever;
  private vectorStore: VectorStore;
  private embeddingProvider: EmbeddingProvider;

  constructor(
    embeddingProvider?: EmbeddingProvider,
    vectorStore?: VectorStore,
  ) {
    this.embeddingProvider = embeddingProvider ?? new OllamaEmbeddingProvider();
    this.vectorStore = vectorStore ?? new PrismaVectorStore();
    this.semanticRetriever = new SemanticRetriever(this.embeddingProvider, this.vectorStore);
  }

  /**
   * Hybrid retrieval combining dense vector search and BM25 lexical search with RRF ranking.
   */
  async retrieve(
    prompt: string,
    options: HybridRetrieverOptions,
  ): Promise<RetrievedConcept[]> {
    const normPrompt = normalizePersian(prompt);
    if (!normPrompt.trim()) {
      return [];
    }

    const topK = options.topK ?? parseInt(process.env.POLICY_RETRIEVAL_TOP_K ?? '5', 10);
    const rrfK = options.rrfConstantK ?? 60;
    const minLexical =
      options.minLexicalScore ??
      parseFloat(process.env.POLICY_LEXICAL_MIN_SCORE ?? '0');

    // 1. Fetch active concepts pool for lexical and metadata (scoped strictly to active policy document: AGENT_TASK §17)
    const activeConcepts = await getActiveConcepts(options.organizationId, {
      documentId: options.documentId,
      onlyActiveDocument: options.onlyActiveDocument ?? (options.documentId ? false : true),
    });

    if (activeConcepts.length === 0) {
      return [];
    }

    // ── A. Dense Semantic Retrieval ──────────────────────────────────────────
    let denseCandidates: RetrievedConcept[] = [];
    try {
      denseCandidates = await this.semanticRetriever.retrieve(normPrompt, {
        organizationId: options.organizationId,
        documentId: options.documentId,
        onlyActiveDocument: options.onlyActiveDocument,
        topK: Math.max(topK * 2, 10),
        minDenseScore: options.minDenseScore ?? 0, // Keep all candidates for RRF ranking
      });
    } catch (err) {
      // In case embedding is offline or fails, continue with lexical (fail-graceful fusion)
      console.warn('[hybrid-retriever] dense retrieval failed, falling back to lexical:', err);
    }

    // ── B. Lexical BM25 Retrieval ────────────────────────────────────────────
    const promptTokens = normPrompt
      .toLowerCase()
      .split(/[\s,،؛\.!؟\?:\-_()\[\]{}"]+/)
      .filter((t) => t.length > 1);

    const chunkTokens = activeConcepts.map(buildConceptLexicalTokens);
    const bm25Scores = computeBM25(promptTokens, chunkTokens);

    const lexicalCandidates: Array<{ concept: PolicyConcept; lexicalScore: number }> = [];
    for (let i = 0; i < activeConcepts.length; i++) {
      const score = bm25Scores[i] ?? 0;
      if (score > minLexical) {
        lexicalCandidates.push({ concept: activeConcepts[i], lexicalScore: score });
      }
    }
    // Sort lexical descending
    lexicalCandidates.sort((a, b) => b.lexicalScore - a.lexicalScore);

    // ── C. Reciprocal Rank Fusion (RRF) ──────────────────────────────────────
    const fusionMap = new Map<
      string,
      {
        concept: PolicyConcept;
        denseScore: number;
        lexicalScore: number;
        rrfScore: number;
      }
    >();

    // 1. Add Dense ranks
    for (let rank = 0; rank < denseCandidates.length; rank++) {
      const { concept, denseScore } = denseCandidates[rank];
      const rrfIncrement = 1 / (rrfK + (rank + 1));

      const entry = fusionMap.get(concept.id) ?? {
        concept,
        denseScore: denseScore ?? 0,
        lexicalScore: 0,
        rrfScore: 0,
      };

      entry.denseScore = denseScore ?? 0;
      entry.rrfScore += rrfIncrement;
      fusionMap.set(concept.id, entry);
    }

    // 2. Add Lexical ranks
    for (let rank = 0; rank < lexicalCandidates.length; rank++) {
      const { concept, lexicalScore } = lexicalCandidates[rank];
      const rrfIncrement = 1 / (rrfK + (rank + 1));

      const entry = fusionMap.get(concept.id) ?? {
        concept,
        denseScore: 0,
        lexicalScore: 0,
        rrfScore: 0,
      };

      entry.lexicalScore = lexicalScore;
      entry.rrfScore += rrfIncrement;
      fusionMap.set(concept.id, entry);
    }

    // 3. Collect and sort by RRF score descending
    const fused = Array.from(fusionMap.values());
    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    // Return Top-K with rich scores
    return fused.slice(0, topK).map((item) => ({
      concept: item.concept,
      score: item.rrfScore,
      denseScore: item.denseScore,
      lexicalScore: item.lexicalScore,
      rrfScore: item.rrfScore,
    }));
  }
}
