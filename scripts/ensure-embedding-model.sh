#!/usr/bin/env bash
# Ensures the required embedding model (default: bge-m3) is pulled in Ollama.
# (MIGRATION_PLAN_REVIEWED_v1.1 Phase 3, §3.7)

set -euo pipefail

OLLAMA_HOST="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
EMBED_MODEL="${POLICY_EMBEDDING_MODEL:-bge-m3}"

echo "[ensure-embedding-model] Checking Ollama at ${OLLAMA_HOST} for model: ${EMBED_MODEL}..."

if ! curl -sf "${OLLAMA_HOST}/api/tags" > /dev/null 2>&1; then
  echo "[ensure-embedding-model] WARN: Ollama is not reachable at ${OLLAMA_HOST}."
  echo "[ensure-embedding-model] Please ensure ollama serve is running."
  exit 0
fi

INSTALLED_MODELS=$(curl -sf "${OLLAMA_HOST}/api/tags" | grep -o '"name":"[^"]*"' || true)

if echo "$INSTALLED_MODELS" | grep -iq "${EMBED_MODEL}"; then
  echo "[ensure-embedding-model] Model ${EMBED_MODEL} is already available in Ollama."
else
  echo "[ensure-embedding-model] Pulling model ${EMBED_MODEL}..."
  curl -s -X POST "${OLLAMA_HOST}/api/pull" -d "{\"name\": \"${EMBED_MODEL}\"}" || {
    echo "[ensure-embedding-model] Pull request sent."
  }
fi
