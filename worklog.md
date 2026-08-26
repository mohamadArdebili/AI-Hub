---
Task ID: 1
Agent: main (Z.ai Code)
Task: Phase 1 — Build a minimal, professional chatbot-style website (like ChatGPT/z.ai) where the user's prompt is proxied through our backend to an external LLM API (via z-ai-web-dev-sdk) and the reply is streamed back and displayed.

Work Log:
- Read `/home/z/my-project/upload/PROJECT_CONTEXT.md` (Enterprise AI Security Gateway). Confirmed Phase 1 scope = chat UI + gateway proxy to external LLM only; security controls (DLP, classifier, local LLM) are future phases.
- Inspected existing project: Next.js 16 App Router, shadcn/ui (New York), z-ai-web-dev-sdk@0.0.18 installed, dev server already running on :3000.
- Invoked the LLM skill and inspected `node_modules/z-ai-web-dev-sdk/dist/index.js` — confirmed `stream:true` returns a raw `ReadableStream` (SSE) from the upstream OpenAI-compatible API.
- Created `src/lib/chat-types.ts` — shared `ChatMessage` + `ChatStreamChunk` (delta/done/error) types.
- Created `src/hooks/use-chat.ts` — manages message state, posts to `/api/chat`, parses the SSE stream, progressively appends deltas to the pending assistant message, handles stop/reset/errors. Includes a Persian system prompt.
- Created `src/app/api/chat/route.ts` — POST endpoint that validates/normalizes messages, caps history at 30 turns, calls `zai.chat.completions.create({stream:true})`, parses upstream SSE `data:` chunks, re-emits them to the browser as our own SSE stream (`text/event-stream`). This is the gateway proxy: user → our site → external LLM → streamed reply.
- Built chat UI components in `src/components/chat/`:
  - `chat-header.tsx` — sticky header with brand, online dot, "new chat" + theme toggle.
  - `chat-messages.tsx` — scrollable log region with auto-scroll, custom scrollbar.
  - `chat-message.tsx` — user/assistant bubbles, avatar, markdown rendering (react-markdown) with inline code + language-tagged code blocks (copy button), copy action, streaming cursor, error display.
  - `chat-input.tsx` — auto-growing textarea, Enter to send / Shift+Enter newline, send button, stop button while streaming.
  - `chat-suggestions.tsx` — empty-state with 4 Persian prompt suggestions.
  - `typing-indicator.tsx` — three-dot bounce animation.
  - `theme-toggle.tsx` — light/dark via next-themes.
  - `theme-provider.tsx` (in src/components) — next-themes wrapper.
- Rewrote `src/app/page.tsx` — full-height `h-[100dvh] flex flex-col` layout: sticky header, scrollable main, pinned input footer (ChatGPT-style; input never overlays content).
- Updated `src/app/layout.tsx` — RTL (`dir="rtl" lang="fa"`), Vazirmatn font (Persian+Latin), ThemeProvider, Persian metadata + viewport themeColor.
- Updated `src/app/globals.css` — Vazirmatn as `--font-sans`, neutral professional theme, custom `.chat-scroll` scrollbar, full `.chat-markdown` typography (RTL-aware), chat-bounce/cursor/fade-in animations.

Verification (Agent Browser, mandatory self-check):
- `bun run lint` → 0 errors.
- Opened `/` → renders cleanly (no blank screen, no hydration crash, no console errors).
- Golden path: typed a Persian prompt → send button enabled → clicked send → `POST /api/chat 200` (dev log) → assistant reply STREAMED in progressively in Persian. Copy button appeared.
- Clicked a suggestion → auto-sent → full markdown reply rendered (h1/h2/h3, lists, bold, inline code, language-tagged code blocks with copy buttons).
- Dark mode toggle → `html.dark` applied.
- Mobile viewport 390x844 → layout holds, suggestions stack to 1 column, input pinned to bottom.
- Layout: header sticky top, messages scroll internally, input pinned at bottom (never overlays content).

Stage Summary:
- Phase 1 is complete and browser-verified. The flow is exactly: user prompt → our site (/api/chat) → external LLM via z-ai-web-dev-sdk (streamed) → reply displayed live.
- Architecture is intentionally gateway-shaped so security controls (DLP, semantic classifier, policy engine, local LLM) can be inserted in `route.ts` before the upstream call in later phases, per PROJECT_CONTEXT.md.
- Deliverables: `src/app/api/chat/route.ts`, `src/hooks/use-chat.ts`, `src/lib/chat-types.ts`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, and 7 components under `src/components/chat/` + `src/components/theme-provider.tsx`.
- UI is Persian/RTL, minimal and professional, with streaming, markdown, code blocks, copy actions, dark mode, and responsive layout.
