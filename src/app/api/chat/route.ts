import crypto from "crypto";
import { NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { detectConversation, serializeConversation, assertCurrentPolicy } from "@/lib/policy/conversation";
import {
  assertExternalSafeAllowed,
  assertExternalEgressAllowed,
  assertNoExternalLlmInDetection,
} from "@/lib/policy/external-guard";
import { sanitizePrompt, MASK_LABELS } from "@/lib/policy/sanitizer";
import {
  createDecisionLog,
  getActiveMaskTerms,
  createPolicyAuditLog,
} from "@/lib/db";
import {
  llmStreamChat,
  estimateTokens,
  type LlmMessage,
} from "@/lib/llm/client";
import type { ChatStreamChunk, ChatRoute } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageRole = "system" | "user" | "assistant";

type NormalizedMessage = {
  role: MessageRole;
  content: string;
};

const PIPELINE_VERSION = "conversation-policy-routing-3.0";

/** Persian labels for detection hit categories (local-route notice). */
const HIT_CATEGORY_FA: Record<string, string> = {
  national_id: "کد ملی",
  ir_bank_card: "شماره کارت بانکی",
  iban: "شماره شبا",
  api_key: "کلید API",
  private_key: "کلید خصوصی",
  credential: "اعتبارنامه اتصال",
  connection_string: "رشته اتصال پایگاه داده",
  bulk_email: "آدرس ایمیل انبوه",
  bulk_mobile: "شماره موبایل انبوه",
  jailbreak_injection: "تلاش دور زدن فیلتر",
  senior_officer: "مدیر ارشد (دیکشنری)",
  telco_hub_node: "مرکز مخابراتی (دیکشنری)",
  proprietary_service: "سرویس انحصاری (دیکشنری)",
  policy_regex: "قاعدهٔ سیاست سازمانی",
  policy_semantic: "قاعدهٔ معنایی سیاست سازمانی",
};

function hitLabel(hit: { category: string; ruleLabel?: string }): string {
  return hit.ruleLabel ?? HIT_CATEGORY_FA[hit.category] ?? hit.category;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Replace digits with * for safe preview, truncate to 120 chars */
function maskPreview(text: string, maxLen = 120): string {
  const masked = text.replace(/\d/g, "*");
  return masked.length > maxLen ? masked.slice(0, maxLen) + "…" : masked;
}

function parseSseEvents(
  buffer: string,
  onData: (payload: string) => void
): string {
  const events = buffer.split(/\r?\n\r?\n/);
  const remainder = events.pop() ?? "";

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length > 0) {
      onData(dataLines.join("\n"));
    }
  }

  return remainder;
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function getDetectionLabels(
  hits: Array<{ category: string; ruleLabel?: string }>,
  matchedConcepts?: Array<{ category?: string | null; name?: string; nameFa?: string | null; conceptKey?: string }>,
  decision?: string
): string[] {
  const rawLabels: string[] = [];

  for (const h of hits) {
    const label = hitLabel(h);
    if (label) rawLabels.push(label);
  }

  if (matchedConcepts && matchedConcepts.length > 0) {
    for (const c of matchedConcepts) {
      const cat = c.category?.trim();
      if (cat) {
        rawLabels.push(HIT_CATEGORY_FA[cat] ?? cat);
      } else {
        const fallback = c.nameFa?.trim() || c.name?.trim() || c.conceptKey?.trim();
        if (fallback) rawLabels.push(fallback);
      }
    }
  }

  if (rawLabels.length === 0) {
    if (decision === "SENSITIVE") {
      rawLabels.push("سیاست امنیتی سازمانی");
    } else if (decision === "UNCERTAIN") {
      rawLabels.push("عدم قطعیت در تطبیق سیاست (ارجاع احتیاطی)");
    }
  }

  return Array.from(new Set(rawLabels));
}

function buildLocalNotice(
  outcomeReason: string,
  hits: Array<{ category: string; ruleLabel?: string }>,
  decision: string,
  maskSummary: string | null,
  matchedConcepts?: Array<{ category?: string | null; name?: string; nameFa?: string | null; conceptKey?: string }>
): string {
  const labels = getDetectionLabels(hits, matchedConcepts, decision);
  const categoryText = labels.length > 0 ? labels.join("، ") : "سیاست سازمانی";

  const lines = [
    decision === "SENSITIVE"
      ? "🔒 **این درخواست حساس تشخیص داده شد و به «مسیر امن محلی» سازمان هدایت شد.**"
      : "⚠️ **نتیجهٔ تشخیص مبهم بود و به‌صورت fail-closed به «مسیر امن محلی» هدایت شد.**",
    "",
    `- دستهٔ تشخیص: ${categoryText}`,
    `- دلیل: ${outcomeReason || (decision === "SENSITIVE" ? "انطباق با سیاست‌های امنیتی سازمان" : "نیاز به بررسی در محیط امن محلی")}`,
  ];
  if (maskSummary) {
    lines.push(`- داده‌های ماسک‌شده: ${maskSummary}`);
  }
  lines.push(
    "",
    "در این فاز تشخیص و مسیریابی قطعی پیاده‌سازی شده و **هیچ داده‌ای به سرویس هوش مصنوعی بیرونی ارسال نشد**. پاسخ‌دهی با مدل محلی در فاز بعدی فعال می‌شود."
  );
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  // ── Auth check ────────────────────────────────────────────────────────
  const session = await getAuthSession(req);
  if (!session?.user) {
    return jsonError("دسترسی غیرمجاز", 401);
  }

  const userId = session.user.id;
  const organizationId = session.user.organizationId;
  const sourceIp = getClientIp(req);

  // ── Parse body ────────────────────────────────────────────────────────
  let body: { messages?: unknown };

  try {
    body = await req.json();
  } catch {
    return jsonError("بدنه درخواست معتبر نیست.");
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError("فیلد messages الزامی است و باید آرایه‌ای غیرخالی باشد.");
  }

  const normalized: NormalizedMessage[] = body.messages.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("role" in item) ||
      !("content" in item)
    ) {
      return [];
    }

    const role = item.role;
    const content = item.content;

    if (
      (role !== "system" && role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      return [];
    }

    return [{ role, content: content.trim() } as NormalizedMessage];
  });

  if (normalized.length === 0) {
    return jsonError("هیچ پیام معتبری ارسال نشده است.");
  }

  // جلوگیری از ارسال تاریخچه‌های بسیار طولانی
  const messages = normalized.slice(-30);

  // ── Find the last user message ────────────────────────────────────────
  const lastUserIndex = [...messages]
    .reverse()
    .findIndex((m) => m.role === "user");
  const lastUserMessage =
    lastUserIndex === -1 ? undefined : messages[messages.length - 1 - lastUserIndex].content;

  if (!lastUserMessage) {
    return jsonError("هیچ پیام کاربری یافت نشد.");
  }

  // ── Layer 1: Sanitizer (ماسک‌گذاری قطعی) ─────────────────────────────
  const dictionaries = await getActiveMaskTerms(organizationId);
  const sanitized = sanitizePrompt(lastUserMessage, dictionaries);

  const promptHash = crypto
    .createHash("sha256")
    .update(lastUserMessage)
    .digest("hex");

  const streamEncoder = new TextEncoder();
  const outcome = await detectConversation(messages, organizationId);
  assertNoExternalLlmInDetection(outcome);

  const decisionScore = outcome.decision === "SAFE" ? 0 : 1;
  const decisionReasons = outcome.reason ? [outcome.reason] : [];
  const decisionMatchedRuleIds = outcome.matchedConcepts?.map(c => c.conceptKey) ?? [];
  const decisionLatencyMs = outcome.processing.durationMs;

  const maskSummary =
    sanitized.totalCount > 0
      ? sanitized.findings
          .map((f) => `${MASK_LABELS[f.label]} ×${f.count}`)
          .join("، ")
      : null;

  const chatRoute: ChatRoute = outcome.route ?? "LOCAL";

  const detectionLabels = getDetectionLabels(
    outcome.hits,
    outcome.matchedConcepts,
    outcome.decision
  );

  const primaryCategory =
    outcome.hits[0]?.category ??
    outcome.matchedConcepts?.[0]?.category ??
    outcome.matchedConcepts?.[0]?.nameFa ??
    outcome.matchedConcepts?.[0]?.name ??
    (outcome.decision === "SENSITIVE" ? "policy_semantic" : null);

  const allAuditCategories = Array.from(
    new Set(
      [
        ...outcome.hits.map((h) => h.category),
        ...(outcome.matchedConcepts ?? []).map(
          (c) => c.category || c.nameFa || c.name
        ),
      ].filter((x): x is string => Boolean(x && x.trim()))
    )
  );

  const metaChunk: ChatStreamChunk = {
    type: "meta",
    route: chatRoute,
    maskLabels: chatRoute === "EXTERNAL_DIRECT" ? [] : sanitized.findings,
    detection: {
      decision: outcome.decision,
      hitLabels: detectionLabels,
      method: outcome.classifier?.method ?? "deterministic",
    },
  };

  // ── Router: BLOCKED or SENSITIVE-critical → توقف کامل (کارت تخلف بحرانی) ────
  const isBlocked = chatRoute === "BLOCKED";

  if (isBlocked) {
    const blockReason = "این درخواست به دلیل درخواست افشای اطلاعات بسیار حساس یا نقض سیاست امنیتی متوقف شد.";

    await createDecisionLog({
      userId,
      organizationId,
      action: "BLOCK",
      score: 1,
      reasons: [blockReason],
      matchedRuleIds: outcome.hits
        .map((h) => h.ruleId)
        .filter((x): x is string => Boolean(x)),
      promptHash,
      promptPreview: maskPreview(sanitized.maskedText),
      promptLength: lastUserMessage.length,
      latencyMs: Math.round(decisionLatencyMs),
      engineVersion: PIPELINE_VERSION,
      route: "BLOCKED",
      maskCount: sanitized.totalCount,
      maskLabels: sanitized.findings,
      isSensitive: true,
      classifierCategory: primaryCategory,
      classifierRisk: "critical",
      classifierReason: outcome.reason ?? null,
      classifierLatencyMs: outcome.processing.durationMs,
      sourceIp,
      sensitivity: outcome.sensitivity,
      matchedConceptIds: outcome.matchedConcepts?.map((c) => c.conceptId) ?? [],
      retrievalScores: outcome.matchedConcepts?.map((c) => ({ conceptId: c.conceptId, score: c.score })) ?? [],
      classifierMethod: outcome.classifier?.method,
      policyVersion: outcome.policyVersion,
      pipelineHealth: outcome.pipelineHealth,
    });

    await createPolicyAuditLog({
      organizationId,
      actorId: userId,
      action: "RUNTIME_SENSITIVE",
      targetType: "RUNTIME_DECISION",
      targetId: null,
      metadata: {
        decision: outcome.decision,
        action: outcome.action,
        hitCount: outcome.hits.length + (outcome.matchedConcepts?.length ?? 0),
        categories: allAuditCategories,
        normalizedInputHash: outcome.processing.normalizedInputHash,
        durationMs: outcome.processing.durationMs,
      },
    });

    const blockedChunk: ChatStreamChunk = {
      type: "blocked",
      reason: blockReason,
      matchedRules: [],
    };

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            streamEncoder.encode(`data: ${JSON.stringify(blockedChunk)}\n\n`)
          );
          controller.enqueue(
            streamEncoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
          controller.close();
        },
      }),
      { headers: sseHeaders() }
    );
  }

  // ── Router: LOCAL or non-external SENSITIVE / UNCERTAIN → مسیر امن محلی (fail-closed) ─
  const isLocal = chatRoute !== "EXTERNAL_DIRECT";

  if (isLocal) {
    const notice = buildLocalNotice(
      outcome.reason ?? "",
      outcome.hits,
      outcome.decision,
      maskSummary,
      outcome.matchedConcepts
    );

    await createDecisionLog({
      userId,
      organizationId,
      action: "ALLOW",
      score: decisionScore,
      reasons: [...decisionReasons, `مسیریابی به مسیر امن محلی (${outcome.decision})`],
      matchedRuleIds: decisionMatchedRuleIds,
      promptHash,
      promptPreview: maskPreview(sanitized.maskedText),
      promptLength: lastUserMessage.length,
      latencyMs: Math.round(decisionLatencyMs),
      engineVersion: PIPELINE_VERSION,
      route: "LOCAL",
      maskCount: sanitized.totalCount,
      maskLabels: sanitized.findings,
      isSensitive: outcome.decision === "SENSITIVE",
      classifierCategory: primaryCategory,
      classifierRisk: outcome.decision === "SENSITIVE" ? "high" : "medium",
      classifierReason: outcome.reason ?? null,
      classifierLatencyMs: outcome.processing.durationMs,
      sourceIp,
      sensitivity: outcome.sensitivity,
      matchedConceptIds: outcome.matchedConcepts?.map((c) => c.conceptId) ?? [],
      retrievalScores: outcome.matchedConcepts?.map((c) => ({ conceptId: c.conceptId, score: c.score })) ?? [],
      classifierMethod: outcome.classifier?.method,
      policyVersion: outcome.policyVersion,
      pipelineHealth: outcome.pipelineHealth,
    });

    await createPolicyAuditLog({
      organizationId,
      actorId: userId,
      action: outcome.decision === "SENSITIVE" ? "RUNTIME_SENSITIVE" : "RUNTIME_UNCERTAIN",
      targetType: "RUNTIME_DECISION",
      targetId: null,
      metadata: {
        decision: outcome.decision,
        action: outcome.action,
        hitCount: outcome.hits.length + (outcome.matchedConcepts?.length ?? 0),
        categories: allAuditCategories,
        normalizedInputHash: outcome.processing.normalizedInputHash,
        durationMs: outcome.processing.durationMs,
      },
    });

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            streamEncoder.encode(`data: ${JSON.stringify(metaChunk)}\n\n`)
          );
          controller.enqueue(
            streamEncoder.encode(
              `data: ${JSON.stringify({ type: "delta", content: notice })}\n\n`
            )
          );
          controller.enqueue(
            streamEncoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
          controller.close();
        },
      }),
      { headers: sseHeaders() }
    );
  }

  // ── Router: EXTERNAL_DIRECT or EXTERNAL_MASKED → External LLM با گارد سخت ────────
  // The exact payload classified above is the only payload eligible for egress.
  const outboundMessages: LlmMessage[] = messages.map(({ role, content }) => ({ role, content }));

  let completionTokens: number | undefined;
  let externalInvoked = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (chunk: ChatStreamChunk) => {
        if (!closed) {
          controller.enqueue(
            streamEncoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }
      };

      try {
        assertExternalEgressAllowed({
          outcome, route: chatRoute, egressPayload: serializeConversation(outboundMessages),
          expectedPolicyVersion: outcome.policyVersion,
        });
        assertExternalSafeAllowed(outcome);
        await assertCurrentPolicy(outcome, organizationId);
        send(metaChunk);
        externalInvoked = true;
        const result = await llmStreamChat(outboundMessages, req.signal);

        if (result.kind === "sse") {
          const reader = result.response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullText = "";

          const processPayload = (payload: string) => {
            if (!payload || payload === "[DONE]") return;

            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string | null } }>;
                usage?: { completion_tokens?: number };
              };

              const content = parsed.choices?.[0]?.delta?.content;
              if (typeof content === "string" && content.length > 0) {
                fullText += content;
                send({ type: "delta", content });
              }
              if (parsed.usage?.completion_tokens) {
                completionTokens = parsed.usage.completion_tokens;
              }
            } catch {
              // پیام‌های غیر JSON یا keep-alive مربوط به provider نادیده گرفته می‌شوند.
            }
          };

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            buffer = parseSseEvents(buffer, processPayload);
          }

          const tail = buffer.trim();
          if (tail) {
            const payload = tail
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            processPayload(payload);
          }

          completionTokens ??= estimateTokens(fullText);
        } else {
          // Development provider (z-ai) — single full response.
          completionTokens = estimateTokens(result.content);
          send({ type: "delta", content: result.content });
        }

        send({ type: "done" });
      } catch (error) {

        console.error("[/api/chat] external LLM error:", error);
        if (!externalInvoked) {
          send({ ...metaChunk, route: "LOCAL", detection: { ...metaChunk.detection!, decision: "UNCERTAIN" } });
          send({ type: "delta", content: "سیاست در حین بررسی تغییر کرد یا مجوز ارسال خارجی تأیید نشد؛ درخواست در مسیر امن محلی نگه داشته شد." });
          send({ type: "done" });
        } else {
          send({ type: "error", message: "امکان پردازش امن درخواست در حال حاضر وجود ندارد." });
        }
      } finally {
        closed = true;
        controller.close();

        // لاگ ممیزی پس از اتمام پاسخ (پس‌زمینه — مسیر پاسخ را بلاک نمی‌کند)
        createDecisionLog({
          userId,
          organizationId,
          action: "ALLOW",
          score: decisionScore,
          reasons: decisionReasons,
          matchedRuleIds: decisionMatchedRuleIds,
          promptHash,
          promptPreview: maskPreview(sanitized.maskedText),
          promptLength: lastUserMessage.length,
          latencyMs: Math.round(decisionLatencyMs),
          engineVersion: PIPELINE_VERSION,
          route: externalInvoked ? "EXTERNAL_DIRECT" : "LOCAL",
          maskCount: 0,
          maskLabels: [],
          isSensitive: false,
          classifierCategory: null,
          classifierRisk: "low",
          classifierReason: outcome.reason ?? null,
          classifierLatencyMs: outcome.processing.durationMs,
          sourceIp,
          promptTokens: estimateTokens(outboundMessages.map((m) => m.content).join("\n")),
          completionTokens: completionTokens ?? null,
          sensitivity: outcome.sensitivity,
          matchedConceptIds: outcome.matchedConcepts?.map((c) => c.conceptId) ?? [],
          retrievalScores: outcome.matchedConcepts?.map((c) => ({ conceptId: c.conceptId, score: c.score })) ?? [],
          classifierMethod: outcome.classifier?.method,
          policyVersion: outcome.policyVersion,
          pipelineHealth: outcome.pipelineHealth,
        }).catch(() => {
          // لاگ نباید جریان پاسخ کاربر را مختل کند
        });
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
