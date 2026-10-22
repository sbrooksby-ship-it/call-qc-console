"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

type Phase = "idle" | "thinking" | "answered";

type MorphOrbProps = {
  onSubmit: (text: string, signal: AbortSignal) => Promise<string> | string;
};

const STATUS_LABELS = ["Thinking", "Searching", "Analyzing", "Composing"];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function MorphOrb({ onSubmit }: MorphOrbProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerVisible, setAnswerVisible] = useState(false);
  const [statusIndex, setStatusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (phase !== "thinking") return;
    const timer = window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % STATUS_LABELS.length);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "answered") {
      setAnswerVisible(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setAnswerVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== "thinking") return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const size = 180;
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * pixelRatio;
    canvas.height = size * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const dots: Array<{ x: number; y: number; z: number; seed: number }> = [];
    const count = 190;
    for (let index = 0; index < count; index += 1) {
      const y = 1 - (index / (count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const angle = Math.PI * (3 - Math.sqrt(5)) * index;
      dots.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, seed: index * 1.71 });
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const draw = (time: number) => {
      context.clearRect(0, 0, size, size);
      const rotation = reducedMotion ? 0.35 : time * 0.00032;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const tilt = 0.35;
      const center = size / 2;
      for (const dot of dots) {
        const x = dot.x * cosine - dot.z * sine;
        const z = dot.x * sine + dot.z * cosine;
        const y = dot.y * Math.cos(tilt) - z * Math.sin(tilt);
        const depth = dot.y * Math.sin(tilt) + z * Math.cos(tilt);
        const perspective = 2.7 / (2.7 - depth);
        const shimmer = reducedMotion ? 0 : Math.sin(time * 0.002 + dot.seed) * 0.12;
        const alpha = Math.max(0.12, Math.min(0.94, 0.23 + (depth + 1) * 0.28 + shimmer));
        const radius = (1.05 + (depth + 1) * 0.72) * perspective;
        context.beginPath();
        context.fillStyle = `rgba(26, ${126 + Math.round((depth + 1) * 30)}, ${91 + Math.round((depth + 1) * 18)}, ${alpha})`;
        context.arc(center + x * 53 * perspective, center - y * 53 * perspective, radius, 0, Math.PI * 2);
        context.fill();
      }
      if (!reducedMotion) frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || phase === "idle") return;
      requestRef.current?.abort();
      requestRef.current = null;
      busyRef.current = false;
      setPhase("idle");
      setAnswer("");
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = value.trim();
    if (!question || busyRef.current) return;

    busyRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setValue("");
    setAnswer("");
    setStatusIndex(0);
    setPhase("thinking");

    try {
      const [result] = await Promise.all([
        Promise.resolve(onSubmit(question, controller.signal)),
        wait(900),
      ]);
      if (controller.signal.aborted) return;
      setAnswer(typeof result === "string" && result.trim() ? result : "I couldn't generate a response. Please try again.");
      setPhase("answered");
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnswer(error instanceof Error ? error.message : "The assistant request failed. Please try again.");
      setPhase("answered");
    } finally {
      if (!controller.signal.aborted) {
        busyRef.current = false;
        requestRef.current = null;
      }
    }
  }

  function reset() {
    setPhase("idle");
    setAnswer("");
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  return (
    <div className="fixed bottom-5 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col items-end sm:bottom-7 sm:right-7">
      {phase === "idle" && (
        <form
          onSubmit={handleSubmit}
          className="flex h-[60px] w-full items-center gap-2 rounded-full border border-emerald-950/10 bg-white px-4 shadow-[0_14px_48px_-16px_rgba(10,52,38,0.42)] ring-1 ring-white/80 transition duration-500 motion-reduce:transition-none"
        >
          <Sparkles size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            maxLength={2000}
            placeholder="Ask anything..."
            aria-label="Ask the AI assistant"
            onChange={(event) => setValue(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send question"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-forest text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
      )}

      {phase === "thinking" && (
        <div className="flex min-h-44 w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/90 py-3 shadow-[0_20px_60px_-20px_rgba(10,52,38,0.45)] backdrop-blur-xl motion-reduce:transition-none">
          <canvas ref={canvasRef} className="h-[180px] w-[180px]" aria-hidden="true" />
          <p className="-mt-2 min-h-5 text-xs font-medium tracking-wide text-emerald-900" aria-live="polite">
            {STATUS_LABELS[statusIndex]}<span className="animate-pulse">...</span>
          </p>
        </div>
      )}

      {phase === "answered" && (
        <section
          aria-label="AI assistant answer"
          className={`w-full overflow-hidden rounded-xl border border-emerald-950/10 bg-white shadow-[0_20px_60px_-20px_rgba(10,52,38,0.42)] transition-[opacity,transform] duration-500 motion-reduce:transition-none ${answerVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}
        >
          <header className="flex items-center gap-2 border-b border-slate-100 bg-emerald-50/70 px-4 py-3 text-sm font-semibold text-forest">
            <span className="size-2 rounded-full bg-emerald-600 shadow-[0_0_12px_rgba(5,150,105,0.45)]" aria-hidden="true" />
            Answer
          </header>
          <div className="max-h-[min(50vh,360px)] overflow-y-auto px-4 py-3">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{answer}</p>
          </div>
          <footer className="flex justify-end border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            >
              New question
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}