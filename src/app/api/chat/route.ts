import { NextRequest } from "next/server";
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
