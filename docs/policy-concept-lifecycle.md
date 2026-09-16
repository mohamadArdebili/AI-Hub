# Policy Concept Lifecycle & Admin Editable Semantic Knowledge

## Overview

In this system, semantic policy enforcement relies on structured `PolicyConcept` objects rather than brittle regex keyword bags. LLM-generated concepts extracted from policy PDF documents are suggestions—not immutable laws. Authorized administrators have full authority to review, correct, refine, or delete concepts before and after they become active in runtime semantic retrieval.

---

## 1. Concept Lifecycle Architecture

```text
       Policy PDF Upload
              ↓
   Local LLM Concept Extractor (Structured Output)
              ↓
        PolicyConcept (Status: REVIEW)
              ↓
  ┌──────────────────────────────────────────────┐
  │         Admin Review & Governance            │
  │  - Inspect Provenance (Page & Exact Quote)   │
  │  - Edit Name, Description & Category         │
  │  - Refine Sensitivity & Action Precedence    │
  │  - Manage Positive & Negative Examples       │
  │  - Define Conditions & Exceptions            │
  └──────────────────────┬───────────────────────┘
                         │
             Approve / Save ACTIVE Edit
                         ↓
  ┌──────────────────────────────────────────────┐
  │      Embedding Invalidation & Regeneration   │
  │  1. Invalidate/delete old embedding (atomic) │
  │  2. Build rich embedding text (excl. negs)   │
  │  3. Compute SHA256 textHash                  │
  │  4. Generate vector (Ollama bge-m3 / mock)   │
  │  5. Upsert to In-Process Prisma Vector Store │
  └──────────────────────┬───────────────────────┘
                         │
                         ↓
  ┌──────────────────────────────────────────────┐
  │     Runtime Semantic Detection Pipeline      │
  │  - Strict Active Policy Document Scoping     │
  │  - Drift & Staleness Detection via textHash  │
  │  - Dense Cosine Similarity Retrieval         │
  │  - BM25 Lexical Scoring                      │
  │  - Reciprocal Rank Fusion (RRF)              │
  │  - Local LLM Semantic Evidence Judge         │
  │  - Deterministic Policy Decision Engine      │
  └──────────────────────────────────────────────┘
```

---

## 2. Admin Editing & Data Scope

Authorized Administrators can edit the following fields on a concept via the UI and API (`PATCH /api/admin/concepts/[id]`):

1. **Name (`name`) & Persian Name (`nameFa`)**: Technical and localized display names.
2. **Description (`descriptionFa`)**: Persian semantic definition describing the scope of sensitivity.
3. **Sensitivity**: Existing enum (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `HIGHLY_CONFIDENTIAL`).
4. **Action**: Precedence-governed action:
   - `BLOCK`
   - `ROUTE_LOCAL`
   - `MASK_AND_ALLOW_EXTERNAL`
   - `ALLOW_EXTERNAL`
   *(Strict precedence: `BLOCK > ROUTE_LOCAL > MASK_AND_ALLOW_EXTERNAL > ALLOW_EXTERNAL`)*
5. **Positive Examples**: Examples of sensitive prompts that fall under this concept. Included in the dense vector embedding text.
6. **Negative Examples**: Examples of non-sensitive prompts that might superficially resemble the concept.
   > **Security Rule**: Negative examples are strictly excluded from the vector embedding. They are reserved for the local LLM semantic judge to prevent false positive matches.
7. **Conditions & Exceptions**: Specific organizational stipulations and exemptions. Included in the dense vector embedding text.
8. **Category**: Optional grouping classifier.
9. **Provenance (Read-Only)**: The original quote (`sourceQuote`), page number (`sourcePage`), and extracting model (`extractedByModel`) are preserved and cannot be arbitrarily overwritten, ensuring complete traceability back to the source PDF.

---

## 3. Embedding Invalidation & Regeneration Workflow

Whenever an administrator edits an `ACTIVE` concept (or approves a concept to `ACTIVE` status), the old vector embedding is never silently reused:

1. **Invalidate**: The existing row in `PolicyConceptEmbedding` is deleted immediately.
2. **Regenerate**: A new vector is computed by the embedding provider from:
   - Concept name and key
   - Persian description
   - Positive examples
   - Conditions and exceptions
   - Keywords
3. **Index Update**: The vector, embedding model name, and new SHA-256 `textHash` are upserted into the vector store.
4. **Fail-Closed Guarantee**:
   If the embedding provider fails or is unreachable:
   - The old embedding remains deleted and cannot masquerade as current.
   - The API returns an error (`500`) to the Admin UI, preventing a false sense of success.
   - In retrieval, the concept without a valid embedding or with an unmatching `textHash` is skipped in dense retrieval, preserving fail-closed security.

---

## 4. Multi-Tenant Authorization & Isolation

- All concept queries (`GET`), updates (`PATCH`), and deletions (`DELETE`) verify `concept.organizationId === session.user.organizationId`.
- An administrator from Organization B receives a `404 Not Found` if attempting to inspect or alter Organization A's concepts.

---

## 5. Active Policy Scoping

Runtime retrieval (`HybridRetriever` and `SemanticRetriever`) strictly scopes queries to concepts belonging to the current `ACTIVE` policy document (`policyDocument.isActive === true`). Concepts belonging to archived or previous document revisions never participate in active runtime retrieval, preventing historical policy contamination.
