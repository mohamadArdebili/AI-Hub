import crypto from "crypto";
import { NextRequest } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { evaluate } from "@/lib/policy";
import {
  getActivePolicyDocument,
  getPolicySnapshot,
  createDecisionLog,
} from "@/lib/db";
import type { ChatStreamChunk } from "@/lib/chat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageRole = "system" | "user" | "assistant";

type NormalizedMessage = {
  role: MessageRole;
  content: string;
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

export async function POST(req: NextRequest) {
  // ── Auth check ────────────────────────────────────────────────────────
  const session = await getAuthSession(req);
  if (!session?.user) {
    return jsonError("دسترسی غیرمجاز", 401);
  }

  const userId = session.user.id;
  const organizationId = session.user.organizationId;

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
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user")?.content;

  if (!lastUserMessage) {
    return jsonError("هیچ پیام کاربری یافت نشد.");
  }

  // ── Policy evaluation ────────────────────────────────────────────────
  const policySnapshot = await getPolicySnapshot(organizationId);

  const decision = await evaluate({
    prompt: lastUserMessage,
    organizationId,
    policySnapshot,
  });

  // ── Log the decision ─────────────────────────────────────────────────
  const promptHash = crypto
    .createHash("sha256")
    .update(lastUserMessage)
    .digest("hex");

  await createDecisionLog({
    userId,
    organizationId,
    action: decision.action,
    score: decision.score,
    reasons: decision.reasons,
    matchedRuleIds: decision.matchedRules.map((r) => r.code),
    promptHash,
    promptPreview: maskPreview(lastUserMessage),
    promptLength: lastUserMessage.length,
    latencyMs: Math.round(decision.latencyMs),
    engineVersion: decision.engineVersion,
  });

  // ── BLOCK path ───────────────────────────────────────────────────────
  if (decision.action === "BLOCK") {
    const encoder = new TextEncoder();

    const blockedChunk: ChatStreamChunk = {
      type: "blocked",
      reason: decision.reasons.join("\n"),
      matchedRules: decision.matchedRules,
    };

    const doneChunk: ChatStreamChunk = { type: "done" };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(blockedChunk)}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── ALLOW path — GapGPT streaming (unchanged) ────────────────────────
  const apiKey = process.env.GAPGPT_API_KEY;
  const baseUrl = (
    process.env.GAPGPT_BASE_URL ?? "https://api.gapgpt.app/v1"
  ).replace(/\/$/, "");
  const model = process.env.GAPGPT_MODEL ?? "gpt-4o";

  if (!apiKey) {
    return jsonError(
      "متغیر GAPGPT_API_KEY در فایل .env تنظیم نشده است.",
      500
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (chunk: ChatStreamChunk) => {
        if (!closed) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }
      };

      try {
        const upstreamResponse = await fetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              model,
              messages,
              stream: true,
            }),
            signal: req.signal,
          }
        );

        if (!upstreamResponse.ok) {
          const details = await upstreamResponse.text();

          console.error("[/api/chat] GapGPT API error:", {
            status: upstreamResponse.status,
            details,
          });

          throw new Error(
            `خطا از GapGPT API (${upstreamResponse.status}): ${
              details || "پاسخ نامشخص"
            }`
          );
        }

        if (!upstreamResponse.body) {
          throw new Error("GapGPT API بدنهٔ stream ارسال نکرد.");
        }

        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processPayload = (payload: string) => {
          if (!payload || payload === "[DONE]") return;

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                };
              }>;
            };

            const content = parsed.choices?.[0]?.delta?.content;

            if (typeof content === "string" && content.length > 0) {
              send({ type: "delta", content });
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

        // پردازش دادهٔ باقی‌مانده در buffer
        const tail = buffer.trim();
        if (tail) {
          const payload = tail
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");

          processPayload(payload);
        }

        send({ type: "done" });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "خطای نامشخص در ارتباط با GapGPT API";

        console.error("[/api/chat] error:", error);
        send({ type: "error", message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
