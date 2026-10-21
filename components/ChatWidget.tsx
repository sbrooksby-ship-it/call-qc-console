"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, MessageCircle, X } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_MESSAGE_LENGTH = 2000;

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

    const updatedMessages: ChatMessage[] = [...messages, { role: "user", content: message }];
    setMessages([...updatedMessages, { role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: updatedMessages.slice(-9, -1),
        }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || `Assistant request failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The assistant response stream is unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...updatedMessages, { role: "assistant", content: answer }]);
      }
      answer += decoder.decode();
      setMessages([...updatedMessages, { role: "assistant", content: answer || "I couldn't generate a response. Please try again." }]);
    } catch (sendError) {
      setMessages(updatedMessages);
      setError(sendError instanceof Error ? sendError.message : "The assistant request failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {isOpen && (
        <section
          aria-label="AI Assistant"
          className="flex h-[min(600px,calc(100dvh-7rem))] w-[min(450px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between bg-forest px-4 py-3.5 text-white">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <MessageCircle size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-sm font-bold">AI Assistant</h2>
                <p className="text-xs text-emerald-100/75">Knowledge Wiki answers</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close AI Assistant"
              className="rounded-md p-2 text-emerald-50 transition hover:bg-white/10"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div ref={messageListRef} aria-live="polite" className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4">
            {messages.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
                Ask a question about call quality, coaching guidance, or the Knowledge Wiki.
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "rounded-br-sm bg-forest text-white"
                    : "rounded-bl-sm border border-slate-200 bg-white text-slate-800 shadow-sm"
                }`}>
                  {message.content || (sending && index === messages.length - 1
                    ? <span className="inline-flex items-center gap-2 text-slate-500"><LoaderCircle size={14} className="animate-spin" /> Thinking...</span>
                    : "")}
                </div>
              </div>
            ))}
            {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
          </div>

          <form onSubmit={sendMessage} className="border-t border-slate-200 bg-white p-3">
            <label className="sr-only" htmlFor="ai-chat-message">Message the AI Assistant</label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white p-1.5 transition focus-within:border-forest focus-within:ring-2 focus-within:ring-leaf/20">
              <input
                ref={inputRef}
                id="ai-chat-message"
                type="text"
                value={input}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask a question..."
                disabled={sending}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-forest text-white transition hover:bg-forest/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-1.5 text-right text-[10px] text-slate-400">AI answers may need verification</p>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? "Close AI Assistant" : "Open AI Assistant"}
        aria-expanded={isOpen}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-forest text-white shadow-lg ring-1 ring-white/20 transition hover:scale-105 hover:bg-forest/90 focus:outline-none focus:ring-4 focus:ring-leaf/40"
      >
        {isOpen ? <X size={23} aria-hidden="true" /> : <MessageCircle size={23} aria-hidden="true" />}
      </button>
    </div>
  );
}
