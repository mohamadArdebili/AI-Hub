// Live Semantic Classifier Evaluator CLI
// Runs eval/classifier-eval-set.json through live Ollama model and outputs metrics

import evalDataset from '../eval/classifier-eval-set.json';
import { OllamaClient } from '../src/lib/policy/local-llm/ollama-client';
import { OllamaSemanticPolicyClassifier } from '../src/lib/policy/local-llm/semantic-classifier';
import { evaluateSemanticClassifier, type ClassifierEvalItem } from '../src/lib/policy/local-llm/eval-classifier';

async function run() {
  console.log('=== Running Semantic Classifier Evaluation ===');
  const client = new OllamaClient(undefined, {
    enabled: true,
    model: process.env.OLLAMA_POLICY_MODEL ?? 'qwen3:1.7b',
    classifierTimeoutMs: 30000,
  });

  const availability = await client.checkAvailability();
  console.log('Ollama Availability:', availability);

  if (!availability.available) {
    console.error('Ollama is not available, cannot run live evaluation');
    process.exit(1);
  }

  const classifier = new OllamaSemanticPolicyClassifier(client, { timeoutMs: 40000 });
  const metrics = await evaluateSemanticClassifier(
    classifier,
    evalDataset as ClassifierEvalItem[],
    { timeoutMs: 40000 },
  );

  console.log('\n=== Evaluation Results ===');
  console.log(`Total Queries:        ${metrics.totalQueries}`);
  console.log(`Accuracy:             ${(metrics.accuracy * 100).toFixed(1)}%`);
  console.log(`Sensitive Precision:  ${(metrics.sensitivePrecision * 100).toFixed(1)}%`);
  console.log(`Sensitive Recall:     ${(metrics.sensitiveRecall * 100).toFixed(1)}%`);
  console.log(`Sensitive F1 Score:   ${(metrics.sensitiveF1 * 100).toFixed(1)}%`);
  console.log(`Safe Accuracy:        ${(metrics.safeAccuracy * 100).toFixed(1)}%`);
  console.log(`Fallback/Uncertain:   ${metrics.fallbackCount}`);
  console.log(`Avg Latency:          ${metrics.avgLatencyMs.toFixed(0)} ms`);

  if (metrics.mismatches.length > 0) {
    console.log('\n--- Mismatches ---');
    for (const m of metrics.mismatches) {
      console.log(`- Prompt: "${m.prompt}"`);
      console.log(`  Expected: ${m.expectedDecision}, Actual: ${m.actualDecision} (${m.actualScope})`);
      console.log(`  Confidence: ${m.confidence}, Reason: ${m.reasonFa}`);
    }
  } else {
    console.log('\nAll queries matched expected decisions!');
  }
}

run().catch((err) => {
  console.error('Evaluation run failed:', err);
  process.exit(1);
});
