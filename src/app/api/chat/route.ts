import crypto from "crypto";
import { NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { evaluate } from "@/lib/policy";
import { classifyPrompt, decideRoute, CATEGORIES } from "@/lib/policy/classifier";
import { sanitizePrompt, MASK_LABELS } from "@/lib/policy/sanitizer";
import {
  getPolicySnapshot,
  createDecisionLog,
  getActiveMaskTerms,
} from "@/lib/db";
import {
  llmStreamChat,
  estimateTokens,
  type LlmMessage,
} from "@/lib/llm/client";
import type { ChatStreamChunk } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageRole = "system" | "user" | "assistant";

type NormalizedMessage = {
  role: MessageRole;
  content: string;
};

const PIPELINE_VERSION = "phase3-dlp-router-1.0";

const RISK_FA: Record<string, string> = {
  low: "کم",
  medium: "متوسط",
  high: "بالا",
  critical: "بحرانی",
};

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

function buildLocalNotice(
  classifierCategory: string,
  classifierRisk: string,
  classifierReason: string,
  maskSummary: string | null
): string {
  const categoryFa = CATEGORIES[classifierCategory]?.fa ?? classifierCategory;
  const lines = [
    "🔒 **این درخواست حساس تشخیص داده شد و به «مدل زبانی محلی» سازمان مسیریابی شد.**",
    "",
    `- دسته‌بندی: ${categoryFa}`,
    `- سطح ریسک: ${RISK_FA[classifierRisk] ?? classifierRisk}`,
    `- دلیل: ${classifierReason}`,
  ];
  if (maskSummary) {
    lines.push(`- داده‌های ماسک‌شده: ${maskSummary}`);
  }
  lines.push(
    "",
    "پاسخ‌دهی توسط مدل محلی در فاز بعدی فعال می‌شود؛ در این فاز تشخیص و مسیریابی پیاده‌سازی شده و **هیچ داده‌ای به سرویس هوش مصنوعی بیرونی ارسال نشد**."
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

  // ── Layer 2: Deterministic policy engine (فاز ۲ — روی متن اصلی) ──────
  const policySnapshot = await getPolicySnapshot(organizationId);

  const decision = await evaluate({
    prompt: lastUserMessage,
    organizationId,
    policySnapshot,
  });

  const promptHash = crypto
    .createHash("sha256")
    .update(lastUserMessage)
    .digest("hex");

  const streamEncoder = new TextEncoder();

  // ── Engine BLOCK path (مسدودسازی قطعی قواعد) ─────────────────────────
  if (decision.action === "BLOCK") {
    await createDecisionLog({
      userId,
      organizationId,
      action: "BLOCK",
      score: decision.score,
      reasons: decision.reasons,
      matchedRuleIds: decision.matchedRules.map((r) => r.code),
      promptHash,
      promptPreview: maskPreview(sanitized.maskedText),
      promptLength: lastUserMessage.length,
      latencyMs: Math.round(decision.latencyMs),
      engineVersion: decision.engineVersion,
      route: "BLOCKED",
      maskCount: sanitized.totalCount,
      maskLabels: sanitized.findings,
      sourceIp,
    });

    const blockedChunk: ChatStreamChunk = {
      type: "blocked",
      reason: decision.reasons.join("\n"),
      matchedRules: decision.matchedRules,
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

  // ── Layer 3: Smart Policy Classifier (تشخیص معنایی) ───────────────────
  const classifier = await classifyPrompt(sanitized.maskedText);
  const route = decideRoute(classifier);
  const maskSummary =
    sanitized.totalCount > 0
      ? sanitized.findings
          .map((f) => `${MASK_LABELS[f.label]} ×${f.count}`)
          .join("، ")
      : null;

  const metaChunk: ChatStreamChunk = {
    type: "meta",
    route,
    maskLabels: sanitized.findings,
    classifier: {
      isSensitive: classifier.isSensitive,
      category: classifier.category,
      riskLevel: classifier.riskLevel,
      reason: classifier.reason,
      method: classifier.method,
    },
  };

  // ── Router: CRITICAL → توقف + Violation Alert (ثبت در لاگ ممیزی) ─────
  if (route === "BLOCKED") {
    const categoryFa = CATEGORIES[classifier.category]?.fa ?? classifier.category;
    const blockReason = `تخلف بحرانی از سیاست امنیتی شناسایی شد (${categoryFa}). درخواست متوقف و در کارتابل حراست ثبت شد.\n${classifier.reason}`;

    await createDecisionLog({
      userId,
      organizationId,
      action: "BLOCK",
      score: 1,
      reasons: [blockReason],
      matchedRuleIds: [],
      promptHash,
      promptPreview: maskPreview(sanitized.maskedText),
      promptLength: lastUserMessage.length,
      latencyMs: Math.round(decision.latencyMs),
      engineVersion: PIPELINE_VERSION,
      route: "BLOCKED",
      maskCount: sanitized.totalCount,
      maskLabels: sanitized.findings,
      isSensitive: classifier.isSensitive,
      classifierCategory: classifier.category,
      classifierRisk: classifier.riskLevel,
      classifierReason: classifier.reason,
      classifierLatencyMs: classifier.latencyMs,
      sourceIp,
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

  // ── Router: SENSITIVE → مدل محلی (فعلاً: پیام جایگزین شفاف) ──────────
  if (route === "LOCAL") {
    const notice = buildLocalNotice(
      classifier.category,
      classifier.riskLevel,
      classifier.reason,
      maskSummary
    );

    await createDecisionLog({
      userId,
      organizationId,
      action: "ALLOW",
      score: decision.score,
      reasons: [...decision.reasons, `مسیریابی به مدل محلی (${classifier.category})`],
      matchedRuleIds: decision.matchedRules.map((r) => r.code),
      promptHash,
      promptPreview: maskPreview(sanitized.maskedText),
      promptLength: lastUserMessage.length,
      latencyMs: Math.round(decision.latencyMs),
      engineVersion: PIPELINE_VERSION,
      route: "LOCAL",
      maskCount: sanitized.totalCount,
      maskLabels: sanitized.findings,
      isSensitive: classifier.isSensitive,
      classifierCategory: classifier.category,
      classifierRisk: classifier.riskLevel,
      classifierReason: classifier.reason,
      classifierLatencyMs: classifier.latencyMs,
      sourceIp,
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

  // ── Router: GENERAL → External LLM با نسخهٔ ماسک‌شده ─────────────────
  const outboundMessages: LlmMessage[] = messages.map((m, idx) =>
    idx === messages.length - 1 - lastUserIndex
      ? { role: "user", content: sanitized.maskedText }
      : { role: m.role, content: m.content }
  );

  let completionTokens: number | undefined;

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
        send(metaChunk);

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
        const message =
          error instanceof Error
            ? error.message
            : "خطای نامشخص در ارتباط با سرویس مدل زبانی";

        console.error("[/api/chat] external LLM error:", error);
        send({ type: "error", message });
      } finally {
        closed = true;
        controller.close();

        // لاگ ممیزی پس از اتمام پاسخ (پس‌زمینه — مسیر پاسخ را بلاک نمی‌کند)
        createDecisionLog({
          userId,
          organizationId,
          action: "ALLOW",
          score: decision.score,
          reasons: decision.reasons,
          matchedRuleIds: decision.matchedRules.map((r) => r.code),
          promptHash,
          promptPreview: maskPreview(sanitized.maskedText),
          promptLength: lastUserMessage.length,
          latencyMs: Math.round(decision.latencyMs),
          engineVersion: PIPELINE_VERSION,
          route: "EXTERNAL",
          maskCount: sanitized.totalCount,
          maskLabels: sanitized.findings,
          isSensitive: classifier.isSensitive,
          classifierCategory: classifier.category,
          classifierRisk: classifier.riskLevel,
          classifierReason: classifier.reason,
          classifierLatencyMs: classifier.latencyMs,
          sourceIp,
          promptTokens: estimateTokens(outboundMessages.map((m) => m.content).join("\n")),
          completionTokens: completionTokens ?? null,
        }).catch(() => {
          // لاگ نباید جریان پاسخ کاربر را مختل کند
        });
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
