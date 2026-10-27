"use client";

import { createClient } from "@supabase/supabase-js";
import { Activity, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, BadgeCheck, Flag, Gauge, Leaf, PhoneCall, RefreshCw, RotateCcw, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import MorphOrb from "@/components/MorphOrb";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type RawScoreRow = Record<string, unknown>;

type ScoreRow = {
  date: string | null;
  agent: string;
  call: string;
  category: string;
  score: number;
  callType: "Sales" | "Care";
  callKey: string;
  jevProbability: number | null;
  jevStatus: string;
};

type CallSummary = {
  date: string | null;
  agent: string;
  call: string;
  callKey: string;
  callType: "Sales" | "Care";
  questionCount: number;
  totalScore: number;
  percentage: number;
  jevProbabilityTotal: number;
  jevCount: number;
  jevFlags: number;
};

type CallSortColumn = "call" | "date" | "callType" | "totalScore" | "percentage" | "status";

type CallSort = {
  column: CallSortColumn;
  direction: "asc" | "desc";
};

type SectionSummary = {
  section: string;
  rawScore: number;
  maxScore: number;
  percentage: number;
};

type SectionView = "chart" | "table";

type WikiCompileEvent =
  | { type: "status"; message: string }
  | { type: "total"; total: number }
  | { type: "progress"; processed: number; total: number }
  | { type: "complete"; processed: number; total: number }
  | { type: "error"; message: string };

async function submitChatMessage(message: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
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
  }
  answer += decoder.decode();
  return answer;
}

const SECTION_NAMES: Record<string, string> = {
  BG: "Beginning",
  ARC: "Responsibility & Effort",
  OE: "Ownership & Effort",
  PE: "Personalization & Education",
  QC: "Quality Communication",
  CL: "Closing",
  CC: "Call Control",
  COMP: "Compliance",
};

const SECTION_MAX: Record<string, number> = {
  Beginning: 10,
  "Responsibility & Effort": 20,
  "Ownership & Effort": 15,
  "Personalization & Education": 25,
  "Quality Communication": 40,
  Closing: 20,
  "Call Control": 25,
  Compliance: 25,
};

const SECTION_ORDER = Object.values(SECTION_NAMES);
const PREFIX_ORDER = ["BG", "ARC", "OE", "PE", "QC", "CL", "CC", "COMP"];
const DEFAULT_AGENT_FILTER = "All agents";
const DEFAULT_PASS_THRESHOLD = 80;
const TEAM_AGENTS: Record<string, string[]> = {
  "Team Oswaldo": ["Raul", "Alondra", "Julius", "Bernadetter", "Miguel H", "Adriel"],
  "Team Jose": ["Denia", "Felix", "Vivian", "Miguel R", "Nestor", "Franscisco"],
  "Team Evansen": ["Carlos", "Tyrone", "Rose", "Karl", "Michael"],
  "Team Tamara": ["Roma", "Jesus", "Patrick", "Elaine", "Imelda", "Michel"],
};
const CRITERION_DESCRIPTIONS: Record<string, string> = {
  "ARC 1": "Did the team member create genuine ARC with the customer early in the call?",
  "ARC 2": "Did the team member recognize the customer's emotional state and adjust responses appropriately?",
  "ARC 3": "Maintained or raised the customer's tone throughout the call",
  "ARC 4": "Did the team member strengthen trust in Balance of Nature and its products through authentic personal experience, Success Story, or relevant examples?",
  "BG 1": "What tone did the team member communicate during the first 30 seconds of the interaction?",
  "BG 2": "Delivered the BON greeting and introduced themselves appropriately.",
  "OE 1": "Did the team member actively advocate for the customer's best interests by exploring appropriate solutions and alternatives with a level of effort and persistence suited to the customer's situation?",
  "OE 2": "Did the team member take responsibility for helping the customer rather than deflecting responsibility to others?",
  "OE 3": "Did the customer hear evidence that effort was being invested and feel that their issue mattered?",
  "PE 1": "Used information specific to the customer. Referenced customer history, goals, and concerns",
  "PE 2": "Used purposeful discovery questions to understand the customer's situation, uncover needs, and guide the conversation effectively.",
  "PE 3": "Identified the customer's success with the product (N/A for new customers)",
  "PE 4": "Did the team member effectively respond to all opportunities presented in the call to educate and find solutions to their concerns, needs, and goals?",
  "PE 5": "Did the team member identify and educate the customer on the next appropriate step in their wellness journey and current level of engagement with BON (e.g. WHS, other BON products, Plus Membership, etc.)?",
  "QC 1": "How natural, conversational, smooth, and courteous was the team member's communication?",
  "QC 2": "How well did the team member properly acknowledge the customer throughout the call?",
  "QC 3": "Communicated clearly, concisely, and fluently in a manner that was easy for the customer to understand",
  "QC 4": "Actively listened without interrupting",
  "QC 5": "Used positive and empowering language",
  "QC 6": "Demonstrated confidence and competence",
  "QC 7": "Assumed the sale and/or success with the product",
  "QC 8": "Maintained an appropriate tone throughout the interaction",
  "CL 1": "Summarized actions taken and confirmed issue resolution",
  "CL 2": "Communicated next steps clearly. The customer knows exactly what happens next.",
  "CL 3": "Asked if additional assistance was needed",
  "CL 4": "Ended the call warmly and sincerely. Thanked the customer for calling Balance of Nature.",
  "CC 1": "Effectively guided the conversation",
  "CC 2": "Maintained focus on the customer's primary concern",
  "CC 3": "Managed talk time appropriately and balanced efficiency with customer care",
  "CC 4": "Followed the established call flow",
  "CC 5": "Achieved their VFP by the end of the call",
  "COMP 1": "Properly verified the customer's account (N/A for new customers)",
  "COMP 2": "Collected or verified the customer's email (N/A for new customers)",
  "COMP 3": "Requested the customer to take the customer satisfaction survey after the end of their call",
  "COMP 4": "Did not make any claims about Balance of Nature products treating or preventing any specific disease or condition",
  "COMP 5": "Did the team member properly identify and handle any adverse events, or product complaints that came up in the call?",
};

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizedDateYear(year: number, month: number): number {
  return month === 10 && year === 2010 ? 2026 : year;
}

function normalizeTrendDate(date: string): string {
  return date.replace(/^\d{4}-10-/, "2026-10-");
}

function parseDate(value: unknown): string | null {
  const raw = text(value);
  const fullDate = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (fullDate) {
    const year = normalizedDateYear(Number(fullDate[1]), Number(fullDate[2]));
    return `${year}-${fullDate[2].padStart(2, "0")}-${fullDate[3].padStart(2, "0")}`;
  }

  const currentYear = new Date().getFullYear();
  const datedRangeStart = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{1,2})?\s*(?:[-–—]|to)\s*\d{1,2}[/-]\d{1,2}/i);
  if (datedRangeStart) {
    return `${currentYear}-${datedRangeStart[1].padStart(2, "0")}-${datedRangeStart[2].padStart(2, "0")}`;
  }

  const compactDateRange = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/);
  if (compactDateRange && Number(compactDateRange[3]) >= Number(compactDateRange[2]) && Number(compactDateRange[3]) <= 31) {
    return `${currentYear}-${compactDateRange[1].padStart(2, "0")}-${compactDateRange[2].padStart(2, "0")}`;
  }

  const shortDate = raw.match(/(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?/);
  if (!shortDate) return null;
  const month = Number(shortDate[1]);
  let year = shortDate[3] ? Number(shortDate[3]) : new Date().getFullYear();
  if (month === 10 && year === 10) year = 2026;
  if (year < 100) year += 2000;
  year = normalizedDateYear(year, month);
  return `${year}-${month.toString().padStart(2, "0")}-${shortDate[2].padStart(2, "0")}`;
}

function sectionName(category: string): string {
  const upper = category.toUpperCase();
  const prefix = PREFIX_ORDER.find((item) => upper.startsWith(item));
  return prefix ? SECTION_NAMES[prefix] : "Other";
}

function normalizeRows(rows: RawScoreRow[]): ScoreRow[] {
  return rows.map((row) => {
    const agent = text(row.agent_name ?? row.Agent) || "Unknown agent";
    const call = text(row.call_id ?? row.Call) || "Unknown call";
    const category = text(row.category ?? row.Category) || "Other";
    const date = parseDate(row.date_range ?? row.Date);
    const callTypeText = text(row["Call Type"] ?? row.call_type).toLowerCase();
    const callType = callTypeText === "sales" || callTypeText === "care"
      ? (callTypeText === "sales" ? "Sales" : "Care")
      : call.toLowerCase().includes("sales") ? "Sales" : "Care";
    const scoreValue = Number(row.score ?? row.Score);
    const callKey = `${date ?? "UnknownDate"}||${agent.toLowerCase()}||${call.toLowerCase()}`;
    const jevValue = row.jev_prob == null || text(row.jev_prob) === "" ? null : Number(row.jev_prob);

    return {
      date,
      agent,
      call,
      category,
      score: Number.isFinite(scoreValue) ? scoreValue : 0,
      callType,
      callKey,
      jevProbability: jevValue != null && Number.isFinite(jevValue) ? jevValue : null,
      jevStatus: text(row.jev_status).toLowerCase(),
    };
  });
}

function summarizeCalls(rows: ScoreRow[]): CallSummary[] {
  const grouped = new Map<string, CallSummary>();
  for (const row of rows) {
    const current = grouped.get(row.callKey) ?? {
      date: row.date,
      agent: row.agent,
      call: row.call,
      callKey: row.callKey,
      callType: row.callType,
      questionCount: 0,
      totalScore: 0,
      percentage: 0,
      jevProbabilityTotal: 0,
      jevCount: 0,
      jevFlags: 0,
    };
    current.questionCount += 1;
    current.totalScore += row.score;
    if (row.jevStatus === "flag") current.jevFlags += 1;
    if (row.jevProbability != null) {
      current.jevProbabilityTotal += row.jevProbability;
      current.jevCount += 1;
    }
    grouped.set(row.callKey, current);
  }

  return Array.from(grouped.values())
    .filter((call) => call.questionCount > 5)
    .map((call) => ({ ...call, percentage: (call.totalScore / 180) * 100 }));
}

function summarizeSections(rows: ScoreRow[]): SectionSummary[] {
  const callSections = new Map<string, { section: string; score: number }>();
  for (const row of rows) {
    const section = sectionName(row.category);
    const key = `${row.callKey}||${section}`;
    const current = callSections.get(key) ?? { section, score: 0 };
    current.score += row.score;
    callSections.set(key, current);
  }

  const sections = new Map<string, number[]>();
  callSections.forEach((callSection) => {
    const values = sections.get(callSection.section) ?? [];
    values.push(callSection.score);
    sections.set(callSection.section, values);
  });

  return Array.from(sections, ([section, scores]) => {
    const rawScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const maxScore = SECTION_MAX[section] ?? 10;
    return { section, rawScore, maxScore, percentage: (rawScore / maxScore) * 100 };
  }).sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
}

function weekStart(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function formatMonth(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function scoreCellClass(score: number | undefined): string {
  if (score == null) return "bg-slate-50 text-slate-300";
  if (score >= 4) return "bg-emerald-200 text-emerald-900";
  if (score >= 3.5) return "bg-emerald-100 text-emerald-900";
  if (score >= 2.5) return "bg-amber-100 text-amber-900";
  if (score >= 2) return "bg-orange-100 text-orange-900";
  return "bg-rose-100 text-rose-900";
}

function agentInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
}

function agentHue(name: string): number {
  let hue = 0;
  for (const character of name) hue = (hue * 31 + character.charCodeAt(0)) % 360;
  return hue;
}

function canonicalAgentName(name: string): string {
  const normalized = name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return normalized.startsWith("franscisco") ? `francisco${normalized.slice("franscisco".length)}` : normalized;
}

function matchesAgentFilter(agent: string, callType: ScoreRow["callType"], filter: string): boolean {
  if (filter === DEFAULT_AGENT_FILTER) return true;
  if (filter === "Sales" || filter === "Care") return callType === filter;

  const teamAgents = TEAM_AGENTS[filter];
  if (!teamAgents) return agent === filter;

  const normalizedAgent = canonicalAgentName(agent);
  const agentTokens = normalizedAgent.split(" ");
  return teamAgents.some((teamAgent) => {
    const teamAgentTokens = canonicalAgentName(teamAgent).split(" ");
    return teamAgentTokens.every((token, index) => {
      const agentToken = agentTokens[index];
      return agentToken != null
        && (token === agentToken || (token.length === 1 && agentToken.startsWith(token)));
    });
  });
}

function criterionDescription(category: string): string {
  const code = category.match(/^(BG|ARC|OE|PE|QC|CL|CC|COMP)\s*\d+/i)?.[0]
    .replace(/\s+/g, " ")
    .toUpperCase();
  return (code && CRITERION_DESCRIPTIONS[code]) || `Average score for ${category}`;
}

function MetricCard({
  label,
  value,
  note,
  delta,
  visualKind,
  visualValues = [],
  visualValue,
  threshold,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  delta?: number | null;
  visualKind: "bars" | "sparkline" | "range" | "segments";
  visualValues?: number[];
  visualValue?: number | null;
  threshold?: number;
  onClick?: () => void;
}) {
  const positive = delta != null && delta >= 0;
  const values = visualValues.filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const range = values.length ? Math.max(...values) - min || 1 : 1;
  const points = values.map((item, index) => `${values.length < 2 ? 50 : (index / (values.length - 1)) * 100},${30 - ((item - min) / range) * 26}`).join(" ");
  const clampedValue = Math.max(0, Math.min(100, visualValue ?? 0));
  const Icon = label === "Calls graded"
    ? PhoneCall
    : label === "Average call score"
      ? Gauge
      : label === "Highest call"
        ? TrendingUp
        : label === "Lowest call"
          ? TrendingDown
          : BadgeCheck;
  return (
    <article className={`relative flex min-w-0 flex-col justify-between gap-5 overflow-hidden rounded-2xl border p-5 backdrop-blur-md transition-colors ${label === "Average call score" ? "border-lime-300/25 bg-gradient-to-b from-lime-300/[0.10] to-white/[0.025] hover:from-lime-300/[0.14]" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.065]"} ${onClick ? "cursor-pointer hover:border-lime-300/35" : ""}`}>
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}, ${value}. View the agent and call details.`}
          className="absolute inset-0 z-10 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-300"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-emerald-100/70">{label}</p>
        <Icon aria-hidden="true" size={17} className={label === "Average call score" ? "text-lime-300" : "text-emerald-100/55"} />
      </div>
      <div>
        <p className="font-mono text-[34px] font-medium leading-none tracking-[-0.04em] tabular-nums text-white">{value}</p>
        <div className="mt-3 flex min-h-5 items-center gap-1.5 text-xs text-emerald-100/65">
          {delta != null && (positive
            ? <ArrowUpRight aria-hidden="true" size={14} className="text-lime-300" />
            : <ArrowDownRight aria-hidden="true" size={14} className="text-rose-300" />)}
          <span className={delta == null ? "" : positive ? "text-lime-200" : "text-rose-200"}>
            {delta == null ? note : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts vs first half`}
          </span>
        </div>
      </div>
      {visualKind === "bars" && (
        <div className="flex h-9 items-end gap-1" aria-hidden="true">
          {values.map((item, index) => (
            <span key={index} className={`flex-1 rounded-[3px] ${index === values.length - 1 ? "bg-lime-300" : "bg-white/15"}`} style={{ height: `${30 + ((item - min) / range) * 70}%` }} />
          ))}
        </div>
      )}
      {visualKind === "sparkline" && values.length > 1 && (
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-9 w-full overflow-visible" aria-hidden="true">
          <polyline points={points} fill="none" stroke="rgb(190 242 100)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {visualKind === "range" && (
        <div className="relative flex h-9 items-center" aria-hidden="true">
          <div className="h-1 w-full rounded-full bg-white/10" />
          <div className={`absolute h-1 rounded-full ${label === "Lowest call" ? "bg-rose-300/55" : "bg-lime-300/55"}`} style={{ width: `${clampedValue}%` }} />
          {threshold != null && <span className="absolute h-3 w-px bg-white/40" style={{ left: `${threshold}%` }} />}
          <span className={`absolute size-3 -translate-x-1/2 rounded-full ring-4 ${label === "Lowest call" ? "bg-rose-300 ring-rose-300/20" : "bg-lime-300 ring-lime-300/20"}`} style={{ left: `${clampedValue}%` }} />
        </div>
      )}
      {visualKind === "segments" && (
        <div className="flex h-9 items-center gap-[3px]" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => (
            <span key={index} className={`h-5 flex-1 rounded-[2px] ${index < Math.round((clampedValue / 100) * 24) ? "bg-lime-300" : "bg-white/10"}`} />
          ))}
        </div>
      )}
    </article>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: CallSortColumn;
  sort: CallSort;
  onSort: (column: CallSortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sort.column === column;
  const Indicator = active ? sort.direction === "asc" ? ArrowUp : ArrowDown : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className={`border-b border-slate-200 px-3 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1.5 font-bold transition hover:text-forest ${align === "right" ? "ml-auto" : ""}`}
      >
        {label}
        <Indicator size={13} aria-hidden="true" className={active ? "text-forest" : "text-slate-300"} />
      </button>
    </th>
  );
}

export default function DashboardPage() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [agentFilter, setAgentFilter] = useState(DEFAULT_AGENT_FILTER);
  const [comparisonTeams, setComparisonTeams] = useState<string[]>(() => Object.keys(TEAM_AGENTS));
  const [comparisonMonthA, setComparisonMonthA] = useState("");
  const [comparisonMonthB, setComparisonMonthB] = useState("");
  const [passThreshold, setPassThreshold] = useState(DEFAULT_PASS_THRESHOLD);
  const [sectionView, setSectionView] = useState<SectionView>("chart");
  const [focusCallRequest, setFocusCallRequest] = useState<{ callKey: string } | null>(null);
  const [callSort, setCallSort] = useState<CallSort>({ column: "date", direction: "desc" });
  const [meterSort, setMeterSort] = useState<{ column: string; direction: "asc" | "desc" }>({ column: "label", direction: "asc" });
  const [compileSecret, setCompileSecret] = useState("");
  const [compilingWiki, setCompilingWiki] = useState(false);
  const [compileProgress, setCompileProgress] = useState<{ processed: number; total: number; message: string } | null>(null);
  const [compileMessage, setCompileMessage] = useState("");
  const [compileError, setCompileError] = useState("");
  const [wikiPdf, setWikiPdf] = useState<File | null>(null);
  const [wikiPdfTitle, setWikiPdfTitle] = useState("");
  const [uploadingWikiPdf, setUploadingWikiPdf] = useState(false);
  const wikiPdfInputRef = useRef<HTMLInputElement>(null);
  const callRowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    let active = true;

    async function loadScores() {
      setLoading(true);
      setError("");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) {
        setError("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment to connect.");
        setRows([]);
        setLoading(false);
        return;
      }

      try {
        const supabase = createClient(url, key);
        const allRows: RawScoreRow[] = [];
        const pageSize = 1000;
        for (let start = 0; ; start += pageSize) {
          const { data, error: queryError } = await supabase
            .from("call_scores")
            .select("*")
            .range(start, start + pageSize - 1);
          if (queryError) throw queryError;
          const batch = (data ?? []) as RawScoreRow[];
          allRows.push(...batch);
          if (batch.length < pageSize) break;
        }
        if (active) {
          const normalized = normalizeRows(allRows);
          setRows(normalized);
          const dates = normalized.map((row) => row.date).filter((date): date is string => date != null).sort();
          if (dates.length) {
            setStartDate((current) => current || dates[0]);
            setEndDate((current) => current || dates[dates.length - 1]);
          }
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load call scores.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadScores();
    return () => { active = false; };
  }, [refreshCount]);

  const agents = useMemo(() => Array.from(new Set(rows.map((row) => row.agent))).sort((a, b) => a.localeCompare(b)), [rows]);
  const comparisonMonthOptions = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => row.date ? [row.date.slice(0, 7)] : []))).sort((a, b) => b.localeCompare(a)),
    [rows],
  );
  const activeComparisonMonthA = comparisonMonthOptions.includes(comparisonMonthA)
    ? comparisonMonthA
    : comparisonMonthOptions[0] ?? "";
  const activeComparisonMonthB = comparisonMonthOptions.includes(comparisonMonthB) && comparisonMonthB !== activeComparisonMonthA
    ? comparisonMonthB
    : comparisonMonthOptions.find((month) => month !== activeComparisonMonthA) ?? "";
  const selectedComparisonTeams = useMemo(
    () => Object.keys(TEAM_AGENTS).filter((team) => comparisonTeams.includes(team)),
    [comparisonTeams],
  );
  const defaultDateRange = useMemo(() => {
    const dates = rows.map((row) => row.date).filter((date): date is string => date != null).sort();
    return { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" };
  }, [rows]);

  function resetFilters() {
    setStartDate(defaultDateRange.start);
    setEndDate(defaultDateRange.end);
    setAgentFilter(DEFAULT_AGENT_FILTER);
    setPassThreshold(DEFAULT_PASS_THRESHOLD);
  }

  const isTeamFilter = Object.prototype.hasOwnProperty.call(TEAM_AGENTS, agentFilter);
  const isAgentView = !["All agents", "Sales", "Care"].includes(agentFilter) && !isTeamFilter;
  const isAgentGroupFilter = agentFilter === "All agents" || isTeamFilter;
  const filteredRows = useMemo(() => rows.filter((row) => {
    if ((startDate || endDate) && !row.date) return false;
    if (startDate && row.date && row.date < startDate) return false;
    if (endDate && row.date && row.date > endDate) return false;
    return matchesAgentFilter(row.agent, row.callType, agentFilter);
  }), [rows, startDate, endDate, agentFilter]);

  const calls = useMemo(() => summarizeCalls(filteredRows), [filteredRows]);
  const teamMonthComparison = useMemo(() => {
    const summarizeTeamMonth = (team: string, month: string) => {
      if (!month) return { average: null, passRate: null, callCount: 0 };
      const monthCalls = summarizeCalls(rows.filter((row) =>
        row.date?.startsWith(`${month}-`)
        && matchesAgentFilter(row.agent, row.callType, team)));
      return {
        average: monthCalls.length
          ? monthCalls.reduce((sum, call) => sum + call.percentage, 0) / monthCalls.length
          : null,
        passRate: monthCalls.length
          ? monthCalls.filter((call) => call.percentage >= passThreshold).length / monthCalls.length * 100
          : null,
        callCount: monthCalls.length,
      };
    };

    return selectedComparisonTeams.map((team) => {
      const firstMonth = summarizeTeamMonth(team, activeComparisonMonthA);
      const secondMonth = summarizeTeamMonth(team, activeComparisonMonthB);
      return {
        team,
        firstMonth,
        secondMonth,
        change: firstMonth.average != null && secondMonth.average != null
          ? secondMonth.average - firstMonth.average
          : null,
      };
    });
  }, [activeComparisonMonthA, activeComparisonMonthB, passThreshold, rows, selectedComparisonTeams]);
  const sections = useMemo(() => summarizeSections(filteredRows), [filteredRows]);
  const previousWeekSections = useMemo(() => {
    const latestDate = filteredRows.reduce<string | null>(
      (latest, row) => row.date && (!latest || row.date > latest) ? row.date : latest,
      null,
    );
    if (!latestDate) return new Map<string, number>();

    const latestWeekStart = weekStart(latestDate);
    const previousWeekDate = new Date(`${latestWeekStart}T00:00:00Z`);
    previousWeekDate.setUTCDate(previousWeekDate.getUTCDate() - 7);
    const previousWeekStart = previousWeekDate.toISOString().slice(0, 10);
    const previousWeekRows = rows.filter((row) =>
      matchesAgentFilter(row.agent, row.callType, agentFilter)
      && row.date
      && row.date >= previousWeekStart
      && row.date < latestWeekStart);
    return new Map(summarizeSections(previousWeekRows).map(({ section, percentage }) => [section, percentage]));
  }, [agentFilter, filteredRows, rows]);
  const coachingPriorities = useMemo(() => {
    const criteria = new Map<string, { total: number; count: number }>();
    for (const row of filteredRows) {
      const current = criteria.get(row.category) ?? { total: 0, count: 0 };
      current.total += row.score;
      current.count += 1;
      criteria.set(row.category, current);
    }

    return Array.from(criteria, ([category, scores]) => ({
      category,
      average: scores.total / scores.count,
    }))
      .sort((a, b) => a.average - b.average)
      .slice(0, 5);
  }, [filteredRows]);
  const sortedIndividualCalls = useMemo(() => {
    const direction = callSort.direction === "asc" ? 1 : -1;
    return [...calls].sort((left, right) => {
      let comparison = 0;
      switch (callSort.column) {
        case "call":
          comparison = left.call.localeCompare(right.call);
          break;
        case "date":
          comparison = (left.date ?? "").localeCompare(right.date ?? "");
          break;
        case "callType":
          comparison = left.callType.localeCompare(right.callType);
          break;
        case "totalScore":
          comparison = left.totalScore - right.totalScore;
          break;
        case "percentage":
          comparison = left.percentage - right.percentage;
          break;
        case "status":
          comparison = Number(left.percentage >= passThreshold) - Number(right.percentage >= passThreshold);
          break;
      }
      return comparison * direction;
    });
  }, [calls, callSort, passThreshold]);

  function changeCallSort(column: CallSortColumn) {
    setCallSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  const agentLeaderboard = useMemo(() => {
    const midpoint = startDate && endDate
      ? new Date(`${startDate}T00:00:00`).getTime()
        + (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 2
      : null;
    const agentCalls = new Map<string, { all: number[]; firstHalf: number[]; secondHalf: number[] }>();

    for (const call of calls) {
      const current = agentCalls.get(call.agent) ?? { all: [], firstHalf: [], secondHalf: [] };
      current.all.push(call.percentage);
      if (midpoint != null && call.date) {
        const callTime = new Date(`${call.date}T00:00:00`).getTime();
        (callTime <= midpoint ? current.firstHalf : current.secondHalf).push(call.percentage);
      }
      agentCalls.set(call.agent, current);
    }

    const average = (scores: number[]) => scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;
    return Array.from(agentCalls, ([agent, scores]) => {
      const firstHalfAverage = average(scores.firstHalf);
      const secondHalfAverage = average(scores.secondHalf);
      return {
        agent,
        callsGraded: scores.all.length,
        average: average(scores.all),
        passRate: scores.all.filter((score) => score >= passThreshold).length / scores.all.length * 100,
        trend: firstHalfAverage != null && secondHalfAverage != null
          ? secondHalfAverage - firstHalfAverage
          : null,
      };
    }).sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || a.agent.localeCompare(b.agent));
  }, [calls, endDate, passThreshold, startDate]);
  const scoreTrend = useMemo(() => {
    const weeklyScores = new Map<string, number[]>();
    for (const call of calls) {
      if (!call.date) continue;
      const normalizedDate = normalizeTrendDate(call.date);
      const week = normalizedDate.startsWith("2026-10-")
        ? normalizedDate
        : weekStart(normalizedDate);
      const scores = weeklyScores.get(week) ?? [];
      scores.push(call.percentage);
      weeklyScores.set(week, scores);
    }

    return Array.from(weeklyScores, ([date, scores]) => ({
      date,
      label: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
        timeZone: "UTC",
      }),
      average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      calls: scores.length,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [calls]);

  const metrics = useMemo(() => {
    const percentages = calls.map((call) => call.percentage);
    const highestCall = calls.reduce<CallSummary | null>(
      (best, call) => !best || call.percentage > best.percentage ? call : best,
      null,
    );
    const lowestCall = calls.reduce<CallSummary | null>(
      (worst, call) => !worst || call.percentage < worst.percentage ? call : worst,
      null,
    );
    const passing = calls.filter((call) => call.percentage >= passThreshold).length;
    const midpoint = startDate && endDate
      ? new Date(`${startDate}T00:00:00`).getTime() + (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 2
      : null;
    const firstHalf = midpoint == null ? [] : calls.filter((call) => call.date && new Date(`${call.date}T00:00:00`).getTime() <= midpoint);
    const secondHalf = midpoint == null ? [] : calls.filter((call) => call.date && new Date(`${call.date}T00:00:00`).getTime() > midpoint);
    const average = (items: CallSummary[]) => items.length ? items.reduce((sum, call) => sum + call.percentage, 0) / items.length : null;
    const averageDelta = average(firstHalf) != null && average(secondHalf) != null
      ? average(secondHalf)! - average(firstHalf)!
      : null;
    const passRate = (items: CallSummary[]) => items.length
      ? items.filter((call) => call.percentage >= passThreshold).length / items.length * 100
      : null;
    const passDelta = passRate(firstHalf) != null && passRate(secondHalf) != null
      ? passRate(secondHalf)! - passRate(firstHalf)!
      : null;

    return {
      count: calls.length,
      average: percentages.length ? percentages.reduce((sum, score) => sum + score, 0) / percentages.length : null,
      highest: highestCall?.percentage ?? null,
      highestCall,
      lowest: lowestCall?.percentage ?? null,
      lowestCall,
      passRate: calls.length ? passing / calls.length * 100 : null,
      averageDelta,
      passDelta,
    };
  }, [calls, passThreshold, startDate, endDate]);

  useEffect(() => {
    if (!focusCallRequest) return;
    callRowRefs.current.get(focusCallRequest.callKey)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [focusCallRequest, sortedIndividualCalls]);

  const jevMetrics = useMemo(() => {
    const checkedCalls = calls.filter((call) => call.jevCount > 0);
    const averageConfidence = checkedCalls.length
      ? checkedCalls.reduce((sum, call) => sum + call.jevProbabilityTotal / call.jevCount, 0) / checkedCalls.length
      : null;
    const flaggedQuestions = calls.reduce((sum, call) => sum + call.jevFlags, 0);
    return { checkedCalls: checkedCalls.length, averageConfidence, flaggedQuestions };
  }, [calls]);

  const meterBank = useMemo(() => {
    const byCall = isAgentView;
    const values = new Map<string, Map<string, number[]>>();
    const teamTotals = new Map<string, { total: number; count: number }>();
    for (const row of filteredRows) {
      const label = byCall ? `${row.call} (${row.callType})` : row.agent;
      const categories = values.get(label) ?? new Map<string, number[]>();
      const scores = categories.get(row.category) ?? [];
      scores.push(row.score);
      categories.set(row.category, scores);
      values.set(label, categories);
      const total = teamTotals.get(row.category) ?? { total: 0, count: 0 };
      total.total += row.score;
      total.count += 1;
      teamTotals.set(row.category, total);
    }
    const categories = Array.from(new Set(filteredRows.map((row) => row.category))).sort((a, b) => {
      const aPrefix = PREFIX_ORDER.findIndex((prefix) => a.toUpperCase().startsWith(prefix));
      const bPrefix = PREFIX_ORDER.findIndex((prefix) => b.toUpperCase().startsWith(prefix));
      return (aPrefix < 0 ? PREFIX_ORDER.length : aPrefix) - (bPrefix < 0 ? PREFIX_ORDER.length : bPrefix) || a.localeCompare(b);
    });
    const data = Array.from(values, ([label, scores]) => ({
      label,
      scores: Object.fromEntries(Array.from(scores, ([category, items]) => [
        category,
        items.reduce((sum, score) => sum + score, 0) / items.length,
      ])),
    })).sort((a, b) => a.label.localeCompare(b.label));
    const teamAverage = Object.fromEntries(categories.map((category) => {
      const values = teamTotals.get(category);
      return [category, values ? values.total / values.count : null] as const;
    }));
    return { categories, data, teamAverage };
  }, [filteredRows, isAgentView]);

  const sortedMeterData = useMemo(() => {
    const direction = meterSort.direction === "asc" ? 1 : -1;
    return [...meterBank.data].sort((left, right) => {
      if (meterSort.column === "label") {
        return left.label.localeCompare(right.label, undefined, { numeric: true }) * direction;
      }

      const leftScore = left.scores[meterSort.column];
      const rightScore = right.scores[meterSort.column];
      if (leftScore == null && rightScore == null) return left.label.localeCompare(right.label);
      if (leftScore == null) return 1;
      if (rightScore == null) return -1;
      return (leftScore - rightScore) * direction || left.label.localeCompare(right.label);
    });
  }, [meterBank.data, meterSort]);

  function changeMeterSort(column: string) {
    setMeterSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  const number = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;
  function focusCall(call: CallSummary | null) {
    if (!call) return;
    setAgentFilter(call.agent);
    setFocusCallRequest({ callKey: call.callKey });
  }
  const sectionAverage = sections.length
    ? sections.reduce((sum, section) => sum + section.percentage, 0) / sections.length
    : null;
  const meterGroups: { prefix: string; name: string; categories: string[] }[] = [];
  for (const category of meterBank.categories) {
    const prefix = category.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "OTHER";
    const currentGroup = meterGroups[meterGroups.length - 1];
    if (currentGroup?.prefix === prefix) {
      currentGroup.categories.push(category);
    } else {
      meterGroups.push({
        prefix,
        name: SECTION_NAMES[prefix] ?? "Other",
        categories: [category],
      });
    }
  }

  async function compileKnowledgeWiki() {
    setCompilingWiki(true);
    setCompileProgress({ processed: 0, total: 0, message: "Starting wiki compilation..." });
    setCompileMessage("");
    setCompileError("");

    try {
      const response = await fetch("/api/compile-wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: compileSecret }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || `Wiki compilation failed (${response.status}).`);
      }
      if (!response.body) throw new Error("The server did not return compilation progress.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let completed = false;
      const handleEvent = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as WikiCompileEvent;
        if (event.type === "status") {
          setCompileProgress((current) => ({
            processed: current?.processed ?? 0,
            total: current?.total ?? 0,
            message: event.message,
          }));
        } else if (event.type === "total") {
          setCompileProgress((current) => ({
            processed: current?.processed ?? 0,
            total: event.total,
            message: event.total ? "Preparing embedding batches..." : "No wiki pages found.",
          }));
        } else if (event.type === "progress") {
          setCompileProgress({
            processed: event.processed,
            total: event.total,
            message: `Embedded ${event.processed} of ${event.total} wiki pages.`,
          });
        } else if (event.type === "complete") {
          completed = true;
          setCompileProgress({ processed: event.processed, total: event.total, message: "Compilation complete." });
          setCompileMessage(`Knowledge Wiki compiled successfully. Updated embeddings for ${event.processed} ${event.processed === 1 ? "page" : "pages"}.`);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        lines.forEach(handleEvent);
        if (done) break;
      }
      if (buffered.trim()) handleEvent(buffered);
      if (!completed) throw new Error("The server ended compilation before reporting completion.");
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : "Wiki compilation failed.");
    } finally {
      setCompilingWiki(false);
      setCompileSecret("");
    }
  }

  async function uploadWikiPdf() {
    if (!wikiPdf || !compileSecret.trim() || !wikiPdfTitle.trim()) return;

    setUploadingWikiPdf(true);
    setCompileMessage("");
    setCompileError("");

    try {
      const formData = new FormData();
      formData.set("secret", compileSecret);
      formData.set("title", wikiPdfTitle.trim());
      formData.set("file", wikiPdf);
      const response = await fetch("/api/compile-wiki", {
        method: "POST",
        body: formData,
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(result.error || `PDF upload failed (${response.status}).`);
      }

      setCompileMessage(result.message || "PDF added to the Knowledge Wiki.");
      setWikiPdf(null);
      setWikiPdfTitle("");
      if (wikiPdfInputRef.current) wikiPdfInputRef.current.value = "";
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : "PDF upload failed.");
    } finally {
      setUploadingWikiPdf(false);
      setCompileSecret("");
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fa] pb-12">
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#0d211b]/95 text-white shadow-sm backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_0%,rgba(117,181,69,0.14),transparent_42%)]" aria-hidden="true" />
        <div className="relative mx-auto flex min-h-10 max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-1.5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-lime-300 text-[#173d32] shadow-[0_0_24px_-4px_rgba(190,242,100,0.45)]">
              <Leaf size={17} aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Balance of Nature</p>
              <p className="text-xs text-emerald-100/65">Call QC Console</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-emerald-100/70 sm:inline-flex">
              <span className={`size-1.5 rounded-full ${loading ? "animate-pulse bg-amber-300" : "bg-lime-300"}`} aria-hidden="true" />
              {loading ? "Syncing" : "Synced"}
              {!loading && <span className="font-mono text-white tabular-nums">{rows.length.toLocaleString()}</span>}
              {!loading && " score rows"}
            </span>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void compileKnowledgeWiki();
              }}
            >
              <label className="sr-only" htmlFor="compile-wiki-secret">Wiki compilation secret</label>
              <input
                id="compile-wiki-secret"
                type="password"
                autoComplete="off"
                value={compileSecret}
                onChange={(event) => setCompileSecret(event.target.value)}
                placeholder="Compile secret"
                disabled={compilingWiki || uploadingWikiPdf}
                className="h-8 w-36 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm text-white outline-none placeholder:text-emerald-100/60 transition focus:border-lime-300/50 focus:bg-white/[0.08] focus:ring-2 focus:ring-lime-300/20 disabled:opacity-60 sm:w-40"
              />
              <button
                type="submit"
                disabled={compilingWiki || uploadingWikiPdf || !compileSecret.trim()}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-white/15 bg-lime-300 px-3 text-sm font-bold text-[#173d32] shadow-[0_8px_24px_-8px_rgba(190,242,100,0.8)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {compilingWiki ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                <span>{compilingWiki ? "Compiling..." : "Compile Knowledge Wiki"}</span>
              </button>
            </form>
            <input
              ref={wikiPdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Choose a PDF document to add to the Knowledge Wiki"
              disabled={compilingWiki || uploadingWikiPdf}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setWikiPdf(file);
                setWikiPdfTitle(file?.name.replace(/\.pdf$/i, "").slice(0, 180) ?? "");
                setCompileMessage("");
                setCompileError("");
              }}
              className="max-w-44 text-xs text-white file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-white/15 disabled:opacity-60"
            />
            {wikiPdf && (
              <>
                <label className="sr-only" htmlFor="wiki-pdf-title">Wiki document title</label>
                <input
                  id="wiki-pdf-title"
                  type="text"
                  maxLength={180}
                  value={wikiPdfTitle}
                  onChange={(event) => setWikiPdfTitle(event.target.value)}
                  placeholder="Document title"
                  disabled={compilingWiki || uploadingWikiPdf}
                  className="h-8 w-36 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm text-white outline-none placeholder:text-emerald-100/60 focus:border-lime-300/50 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void uploadWikiPdf()}
                  disabled={compilingWiki || uploadingWikiPdf || !compileSecret.trim() || !wikiPdfTitle.trim()}
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.08] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploadingWikiPdf
                    ? <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
                    : <Upload size={15} aria-hidden="true" />}
                  <span>{uploadingWikiPdf ? "Uploading..." : "Add PDF to Wiki"}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setRefreshCount((count) => count + 1)}
              disabled={loading}
              title="Refresh call scores"
              aria-label="Refresh call scores"
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-white transition hover:bg-white/[0.12] disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {(compilingWiki || uploadingWikiPdf || compileMessage || compileError) && (
          <div className="mx-auto max-w-[1440px] px-5 pb-4 sm:px-8 lg:px-10" aria-live="polite">
            {uploadingWikiPdf && (
              <p className="rounded-md border border-white/15 bg-white/10 px-4 py-3 text-sm text-white">
                Extracting PDF text and adding it to the Knowledge Wiki...
              </p>
            )}
            {compilingWiki && compileProgress && (
              <div className="rounded-md border border-white/15 bg-white/10 px-4 py-3 text-sm text-white">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{compileProgress.message}</span>
                  {compileProgress.total > 0 && <span className="tabular-nums">{Math.round((compileProgress.processed / compileProgress.total) * 100)}%</span>}
                </div>
                {compileProgress.total > 0 && (
                  <progress
                    className="mt-2 block h-2 w-full overflow-hidden rounded accent-lime-400"
                    value={compileProgress.processed}
                    max={compileProgress.total}
                    aria-label="Wiki compilation progress"
                  />
                )}
              </div>
            )}
            {compileMessage && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">{compileMessage}</p>}
            {compileError && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">Could not compile Knowledge Wiki: {compileError}</p>}
          </div>
        )}
      </header>

      <section className="relative overflow-hidden bg-[#0d211b] pb-8 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_42%_70%_at_48%_7%,rgba(0,112,73,0.48),transparent_100%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-20 right-[4%] h-[460px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(141,184,46,0.18),transparent)] blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-24 left-[23%] h-[420px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(0,91,65,0.34),transparent)] blur-2xl" aria-hidden="true" />
        <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6 py-10 sm:py-12">
          <div className="max-w-2xl">
            <p className="mb-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-lime-300">
              <span className="h-px w-6 bg-lime-300/60" aria-hidden="true" />
              Quality overview
            </p>
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-[52px]">
              Every call, scored. <span className="text-emerald-100/65">Every agent, coached.</span>
            </h1>
          </div>
          {isAgentView ? (
            <div className="max-w-xs text-right">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-100/60">Viewing agent</p>
              <p className="mt-1 break-words text-3xl font-semibold leading-tight text-white">{agentFilter}</p>
              {startDate && endDate && (
                <p className="mt-2 text-xs leading-relaxed text-emerald-100/70">
                  <span className="font-mono text-white">{startDate}</span> to <span className="font-mono text-white">{endDate}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="max-w-xs text-sm leading-relaxed text-emerald-100/70">
              Viewing <span className="font-medium text-white">{agentFilter.toLowerCase()}</span>
              {startDate && endDate && <> from <span className="font-mono text-white">{startDate}</span> to <span className="font-mono text-white">{endDate}</span></>}.
            </p>
          )}
        </div>
        <section aria-label="Dashboard filters" className="grid gap-1 rounded-2xl border border-white/10 bg-white/[0.035] p-2 backdrop-blur-md [color-scheme:dark] sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_1.2fr_auto] lg:items-center lg:divide-x lg:divide-white/[0.06]">
          <label className="group flex min-w-0 flex-col gap-1 rounded-xl px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-100/60 transition-colors hover:bg-white/[0.05]">
            From
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full bg-transparent text-sm font-medium normal-case tracking-normal text-white outline-none focus:text-white [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70" />
          </label>
          <label className="group flex min-w-0 flex-col gap-1 rounded-xl px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-100/60 transition-colors hover:bg-white/[0.05]">
            To
            <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="w-full bg-transparent text-sm font-medium normal-case tracking-normal text-white outline-none focus:text-white [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70" />
          </label>
          <label className="group flex min-w-0 flex-col gap-1 rounded-xl px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-100/60 transition-colors hover:bg-white/[0.05]">
            Agent / call type
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="w-full cursor-pointer bg-transparent text-sm font-medium normal-case tracking-normal text-white outline-none [&_option]:bg-[#132b23] [&_option]:text-white [&_optgroup]:bg-[#132b23] [&_optgroup]:text-emerald-100">
              <option>All agents</option>
              <option>Sales</option>
              <option>Care</option>
              <optgroup label="Teams">
                {Object.keys(TEAM_AGENTS).map((team) => <option key={team}>{team}</option>)}
              </optgroup>
              <optgroup label="Agents">
                {agents.map((agent) => <option key={agent}>{agent}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="group flex min-w-0 flex-col gap-1 rounded-xl px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-emerald-100/60 transition-colors hover:bg-white/[0.05]">
            Pass threshold
            <span className="flex h-7 items-center gap-3">
              <input type="range" min="0" max="100" step="1" value={passThreshold} onChange={(event) => setPassThreshold(Number(event.target.value))} aria-label="Pass threshold percentage" className="h-1 min-w-0 flex-1 accent-lime-300" />
              <span className="w-11 text-right font-mono text-sm font-semibold tabular-nums text-lime-300">{passThreshold}%</span>
            </span>
          </label>
          <button
            type="button"
            onClick={resetFilters}
            title="Restore the full date range, all agents, and the default pass threshold"
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-xl px-4 text-sm font-medium text-emerald-100/65 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus:ring-2 focus:ring-lime-300/40"
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>Reset Filters</span>
          </button>
        </section>

        {error && (
          <div role="alert" className="mt-6 flex gap-3 border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            <div><p className="font-bold">Could not load call scores</p><p className="mt-1 break-words">{error}</p></div>
          </div>
        )}

        <section aria-label="Call performance metrics" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Calls graded" value={loading ? "…" : metrics.count.toLocaleString()} note="Complete calls in this view" visualKind="bars" visualValues={scoreTrend.map((point) => point.calls)} />
          <MetricCard label="Average call score" value={number(metrics.average)} note="Across selected calls" delta={metrics.averageDelta} visualKind="sparkline" visualValues={scoreTrend.map((point) => point.average)} />
          <MetricCard label="Highest call" value={number(metrics.highest)} note="Top call score · click to view agent and call" visualKind="range" visualValue={metrics.highest} threshold={passThreshold} onClick={metrics.highestCall ? () => focusCall(metrics.highestCall) : undefined} />
          <MetricCard label="Lowest call" value={number(metrics.lowest)} note="Lowest call score · click to view agent and call" visualKind="range" visualValue={metrics.lowest} threshold={passThreshold} onClick={metrics.lowestCall ? () => focusCall(metrics.lowestCall) : undefined} />
          <MetricCard label={`Pass rate · ${passThreshold}%`} value={number(metrics.passRate)} note="Calls at or above target" delta={metrics.passDelta} visualKind="segments" visualValue={metrics.passRate} />
        </section>

        <div role="status" className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-3.5 text-sm text-emerald-100/70 backdrop-blur-md">
          <span className="inline-flex items-center gap-2.5">
            <ShieldCheck size={17} className="text-lime-300" aria-hidden="true" />
            Jev overall confidence
          </span>
          <span className="flex items-center gap-3">
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10 sm:w-40" role="progressbar" aria-valuenow={jevMetrics.averageConfidence == null ? 0 : jevMetrics.averageConfidence * 100} aria-valuemin={0} aria-valuemax={100} aria-label="Jev overall confidence">
              <span className="block h-full rounded-full bg-lime-300" style={{ width: `${jevMetrics.averageConfidence == null ? 0 : jevMetrics.averageConfidence * 100}%` }} />
            </span>
            <strong className="font-mono text-white tabular-nums">{jevMetrics.averageConfidence == null ? "Pending" : `${(jevMetrics.averageConfidence * 100).toFixed(0)}%`}</strong>
          </span>
          <span>
            {jevMetrics.averageConfidence != null
              ? <>across <strong className="font-mono text-white tabular-nums">{jevMetrics.checkedCalls}</strong> checked calls</>
              : "— no checked calls in this filter yet."}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-200 sm:ml-auto">
            <Flag size={13} fill="currentColor" aria-hidden="true" />
            <strong className="font-mono tabular-nums">{jevMetrics.flaggedQuestions}</strong> flagged {jevMetrics.flaggedQuestions === 1 ? "question" : "questions"}
          </span>
        </div>
        </div>
      </section>

      <div className="relative z-10 -mt-16 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        {loading ? (
          <div className="mt-6 flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-medium text-slate-500 shadow-sm">
            <Activity className="mr-2 animate-pulse text-leaf" size={18} /> Loading performance data…
          </div>
        ) : !error && (
          <>
            <details className="mb-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)]">
              <summary className="cursor-pointer px-5 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest sm:px-6">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-forest">Compare performance</span>
                    <span className="mt-1 block text-sm font-semibold text-slate-900">Teams and months</span>
                  </span>
                  <span className="text-xs text-slate-500">Select months and teams</span>
                </span>
              </summary>
              <div className="border-t border-slate-200 px-5 py-5 sm:px-6">
                <p className="text-xs leading-relaxed text-slate-500">
                  Compare each selected team across two complete calendar months, independent of the dashboard filters. Score change is Month B minus Month A; passing uses the current {passThreshold}% threshold.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                    Month A
                    <select
                      value={activeComparisonMonthA}
                      disabled={!comparisonMonthOptions.length}
                      onChange={(event) => {
                        const nextMonth = event.target.value;
                        setComparisonMonthA(nextMonth);
                        if (nextMonth === activeComparisonMonthB) setComparisonMonthB(activeComparisonMonthA);
                      }}
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-forest focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                    >
                      {comparisonMonthOptions.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                    Month B
                    <select
                      value={activeComparisonMonthB}
                      disabled={comparisonMonthOptions.length < 2}
                      onChange={(event) => {
                        const nextMonth = event.target.value;
                        setComparisonMonthB(nextMonth);
                        if (nextMonth === activeComparisonMonthA) setComparisonMonthA(activeComparisonMonthB);
                      }}
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-forest focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                    >
                      {comparisonMonthOptions.length < 2
                        ? <option value="">A second month is needed</option>
                        : comparisonMonthOptions.filter((month) => month !== activeComparisonMonthA).map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
                    </select>
                  </label>
                </div>
                <fieldset className="mt-5">
                  <legend className="text-xs font-semibold text-slate-600">Teams to compare</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.keys(TEAM_AGENTS).map((team) => {
                      const selected = comparisonTeams.includes(team);
                      return (
                        <button
                          key={team}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setComparisonTeams((current) =>
                            current.includes(team) ? current.filter((item) => item !== team) : [...current, team])}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${selected ? "border-forest bg-emerald-50 text-forest" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"}`}
                        >
                          {team}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                {comparisonMonthOptions.length < 2 ? (
                  <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Scores from at least two different months are needed to compare month to month.</p>
                ) : !selectedComparisonTeams.length ? (
                  <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">Select at least one team to compare.</p>
                ) : (
                  <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left text-sm">
                      <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                        <tr>
                          <th scope="col" className="border-b border-slate-200 px-4 py-3">Team</th>
                          <th scope="col" className="border-b border-slate-200 px-4 py-3">{formatMonth(activeComparisonMonthA)}</th>
                          <th scope="col" className="border-b border-slate-200 px-4 py-3">{formatMonth(activeComparisonMonthB)}</th>
                          <th scope="col" className="border-b border-slate-200 px-4 py-3">Score change (B - A)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamMonthComparison.map(({ team, firstMonth, secondMonth, change }) => (
                          <tr key={team}>
                            <th scope="row" className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">{team}</th>
                            {[firstMonth, secondMonth].map((monthSummary, index) => (
                              <td key={index} className="border-b border-slate-100 px-4 py-3">
                                <span className="block font-mono font-semibold tabular-nums text-slate-900">{monthSummary.average == null ? "—" : `${monthSummary.average.toFixed(1)}%`}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">
                                  {monthSummary.passRate == null ? "No completed calls" : `${monthSummary.passRate.toFixed(1)}% pass · ${monthSummary.callCount} calls`}
                                </span>
                              </td>
                            ))}
                            <td className="border-b border-slate-100 px-4 py-3 font-mono text-sm font-semibold tabular-nums">
                              {change == null ? "—" : (
                                <span className={change > 0 ? "text-emerald-700" : change < 0 ? "text-rose-700" : "text-slate-500"}>
                                  {change > 0 ? "+" : ""}{change.toFixed(1)} pts
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </details>
            {calls.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <p className="font-display text-lg font-bold text-slate-800">No completed calls in this view</p>
                <p className="mt-1 text-sm text-slate-500">Try a different date range or agent filter.</p>
              </div>
            ) : <>
            <section aria-labelledby="score-trend-heading" className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)]">
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-6">
                <div>
                  <p className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-forest">
                    <span className="size-1.5 rounded-full bg-forest" aria-hidden="true" />
                    Call quality over time
                  </p>
                  <h2 id="score-trend-heading" className="mt-2 text-lg font-semibold tracking-tight text-slate-900">Score trend</h2>
                  <p className="mt-1 text-[13px] text-slate-500">Weekly average call score against the pass threshold</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Period average</p>
                    <p className="font-mono text-2xl font-medium tracking-tight text-slate-900 tabular-nums">
                      {scoreTrend.length ? (scoreTrend.reduce((sum, point) => sum + point.average, 0) / scoreTrend.length).toFixed(1) : "—"}
                      <span className="text-base text-slate-500">%</span>
                    </p>
                  </div>
                  {scoreTrend.length > 1 && (
                    <div className="hidden border-l border-slate-200 pl-4 text-right sm:block">
                      <p className="text-xs text-slate-500">Period change</p>
                      <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${scoreTrend[scoreTrend.length - 1].average >= scoreTrend[0].average ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                        {scoreTrend[scoreTrend.length - 1].average >= scoreTrend[0].average ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
                        {scoreTrend[scoreTrend.length - 1].average > scoreTrend[0].average ? "+" : ""}
                        {(scoreTrend[scoreTrend.length - 1].average - scoreTrend[0].average).toFixed(1)} pts
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="h-80 px-3 pb-5">
                {scoreTrend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scoreTrend} margin={{ top: 16, right: 20, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#39b996" />
                          <stop offset="100%" stopColor="#00875e" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#dce5e8" strokeDasharray="3 5" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={12}
                        tick={{ fill: "#64748b", fontSize: 12 }}
                      />
                      <YAxis
                        domain={[Math.max(0, Math.floor(((scoreTrend.length ? Math.min(...scoreTrend.map((point) => point.average)) : 0) - 12) / 10) * 10), 100]}
                        tickFormatter={(value: number) => `${value}%`}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickCount={5}
                        tick={{ fill: "#64748b", fontSize: 12 }}
                      />
                      <ReferenceLine
                        y={passThreshold}
                        stroke="#dc5264"
                        strokeDasharray="5 5"
                        strokeOpacity={0.8}
                        label={{ value: `Pass ${passThreshold}%`, position: "insideTopRight", fill: "#a52d41", fontSize: 11, fontWeight: 600 }}
                      />
                      <Tooltip
                        labelFormatter={(value) => `Week of ${value}`}
                        formatter={(value, _name, item) => [`${Number(value).toFixed(1)}%`, `${item.payload.calls} calls`]}
                      />
                      <Line
                        type="monotone"
                        dataKey="average"
                        stroke="url(#trendStroke)"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 6, fill: "#00875e", stroke: "#fff", strokeWidth: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-sm text-slate-500">No calls in the selected date range.</div>}
              </div>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-3">
              <article className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)] sm:p-6 xl:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-forest">
                      <span className="size-1.5 rounded-full bg-forest" aria-hidden="true" />
                      Rubric breakdown
                    </p>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">Section performance</h2>
                    <p className="mt-1 text-[13px] text-slate-500">
                      {sectionView === "table"
                        ? "Average raw score across selected calls, its percentage, and the percentage from the week before the latest week in this view."
                        : "Average score by rubric section"}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Section performance view">
                    {(["chart", "table"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        aria-pressed={sectionView === view}
                        onClick={() => setSectionView(view)}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${sectionView === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                      >
                        {view}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-5">
                  {sections.length ? (
                    sectionView === "table" ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-left text-sm">
                          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th scope="col" className="px-3 py-3 font-semibold">Section</th>
                              <th scope="col" className="px-3 py-3 text-right font-semibold">Raw score</th>
                              <th scope="col" className="px-3 py-3 text-right font-semibold">Percentage</th>
                              <th scope="col" className="px-3 py-3 text-right font-semibold">Previous week %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sections.map((section) => {
                              const previousPercentage = previousWeekSections.get(section.section);
                              return (
                                <tr key={section.section} className="border-b border-dashed border-slate-200 last:border-b-0">
                                  <th scope="row" className="px-3 py-3 text-left font-medium text-slate-800">{section.section}</th>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">{section.rawScore.toFixed(1)}/{section.maxScore}</td>
                                  <td className="px-3 py-3 text-right font-mono font-medium tabular-nums text-slate-900">{section.percentage.toFixed(1)}%</td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600">{previousPercentage == null ? "—" : `${previousPercentage.toFixed(1)}%`}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <>
                        <div role="img" aria-label="Horizontal bar chart showing average call score percentage by section">
                          <div className="grid grid-cols-[minmax(0,180px)_1fr_52px] items-center gap-x-5">
                            <span />
                            <div className="relative h-6">
                              <span
                                className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700"
                                style={{ left: `${passThreshold}%` }}
                              >
                                Pass {passThreshold}%
                              </span>
                            </div>
                            <span />
                          </div>
                          <ul className="flex flex-col" aria-label="Section score bars">
                            {sections.map((section) => {
                              const barColor = section.percentage < 68
                                ? "bg-gradient-to-r from-rose-400 to-rose-600"
                                : section.percentage < 80
                                  ? "bg-gradient-to-r from-amber-400 to-amber-500"
                                  : "bg-gradient-to-r from-emerald-400 to-emerald-600";
                              return (
                                <li
                                  key={section.section}
                                  className="grid grid-cols-[minmax(0,180px)_1fr_52px] items-center gap-x-5 border-b border-dashed border-slate-200 py-3 last:border-b-0"
                                >
                                  <span className="truncate text-[13px] font-medium text-slate-800">{section.section}</span>
                                  <div
                                    className="relative h-3 rounded-full bg-slate-100"
                                    role="progressbar"
                                    aria-label={`${section.section} average score`}
                                    aria-valuenow={section.percentage}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                  >
                                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, section.percentage))}%` }} />
                                    <span className="absolute -top-3 -bottom-3 w-px bg-rose-500/50" style={{ left: `${passThreshold}%` }} aria-hidden="true" />
                                  </div>
                                  <span className="text-right font-mono text-sm font-medium text-slate-900 tabular-nums">{section.percentage.toFixed(0)}%</span>
                                </li>
                              );
                            })}
                          </ul>
                          <div className="mt-2 grid grid-cols-[minmax(0,180px)_1fr_52px] gap-x-5" aria-hidden="true">
                            <span />
                            <div className="flex justify-between font-mono text-[11px] text-slate-500">
                              {[0, 25, 50, 75, 100].map((tick) => <span key={tick}>{tick}</span>)}
                            </div>
                            <span />
                          </div>
                        </div>
                      </>
                    )
                  ) : <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">No section scores to chart.</div>}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)] sm:p-6">
                <p className="mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-forest">
                  <span className="size-1.5 rounded-full bg-forest" aria-hidden="true" />
                  At a glance
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Section summary</h2>
                <p className="mt-1 text-xs text-slate-500">Rubric health in this view</p>
                <div className="grid place-items-center py-4">
                  <svg viewBox="0 0 128 128" className="size-40 -rotate-90 [grid-area:1/1]" role="img" aria-label={`Average section score: ${sectionAverage == null ? "no data" : `${sectionAverage.toFixed(1)}%`}`}>
                    <defs>
                      <linearGradient id="section-summary-gradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#8fcf6b" />
                        <stop offset="100%" stopColor="#43875d" />
                      </linearGradient>
                    </defs>
                    <circle cx="64" cy="64" r="52" fill="none" stroke="#edf1ed" strokeWidth="10" />
                    <circle
                      cx="64"
                      cy="64"
                      r="52"
                      fill="none"
                      stroke="url(#section-summary-gradient)"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 52}
                      strokeDashoffset={2 * Math.PI * 52 * (1 - Math.min(100, Math.max(0, sectionAverage ?? 0)) / 100)}
                    />
                  </svg>
                  <div className="text-center [grid-area:1/1]">
                    <p className="font-mono text-3xl font-medium tracking-tight text-slate-900 tabular-nums">
                      {sectionAverage?.toFixed(1) ?? "—"}<span className="text-lg text-slate-500">%</span>
                    </p>
                    <p className="text-xs text-slate-500">avg section score</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <dt className="text-xs text-slate-500">Sections scored</dt>
                    <dd className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">{sections.length}</dd>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <dt className="text-xs text-slate-500">Passing calls</dt>
                    <dd className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                      {calls.filter((call) => call.percentage >= passThreshold).length}
                      <span className="ml-1 text-xs font-normal text-slate-500">/ {calls.length}</span>
                    </dd>
                  </div>
                </dl>
                {sections.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {[sections.reduce((best, section) => section.percentage > best.percentage ? section : best), sections.reduce((worst, section) => section.percentage < worst.percentage ? section : worst)].map((section, index) => (
                      <div key={`${index}-${section.section}`} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${index === 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                        <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg bg-white ${index === 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {index === 0 ? <ArrowUpRight size={15} aria-hidden="true" /> : <ArrowDownRight size={15} aria-hidden="true" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[10px] font-bold uppercase tracking-[0.1em] ${index === 0 ? "text-emerald-800" : "text-rose-800"}`}>{index === 0 ? "Strongest" : "Needs attention"}</p>
                          <p className="truncate text-xs font-semibold text-slate-800">{section.section}</p>
                        </div>
                        <span className={`font-mono text-xs font-bold tabular-nums ${index === 0 ? "text-emerald-800" : "text-rose-800"}`}>{section.percentage.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </section>

            <section
              aria-label="Coaching priorities and agent call breakdown"
              className={`mt-6 grid gap-6 ${isAgentView || isAgentGroupFilter ? "xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]" : "xl:grid-cols-1"}`}
            >
              {isAgentView && (
                <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)]">
                  <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">Agent detail</p>
                    <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Individual Call Breakdown</h2>
                    <p className="mt-1 text-xs text-slate-500">{agentFilter} · {calls.length} calls</p>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    {calls.length ? (
                      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">
                          <tr>
                            <SortableHeader label="Call ID" column="call" sort={callSort} onSort={changeCallSort} />
                            <SortableHeader label="Date" column="date" sort={callSort} onSort={changeCallSort} />
                            <SortableHeader label="Call Type" column="callType" sort={callSort} onSort={changeCallSort} />
                            <SortableHeader label="Total Raw Score" column="totalScore" sort={callSort} onSort={changeCallSort} align="right" />
                            <SortableHeader label="Call Percentage" column="percentage" sort={callSort} onSort={changeCallSort} align="right" />
                            <SortableHeader label="Status" column="status" sort={callSort} onSort={changeCallSort} />
                            <th scope="col" className="border-b border-slate-200 px-3 py-3">Jev Confidence</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3">Jev Flags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedIndividualCalls.map((call) => (
                            <tr
                              key={call.callKey}
                              ref={(element) => {
                                if (element) callRowRefs.current.set(call.callKey, element);
                                else callRowRefs.current.delete(call.callKey);
                              }}
                              className={`transition-colors ${focusCallRequest?.callKey === call.callKey ? "bg-lime-100 ring-2 ring-inset ring-lime-400" : "hover:bg-slate-50"}`}
                            >
                              <th scope="row" className="border-b border-slate-100 px-3 py-3 text-left font-semibold text-slate-800">{call.call}</th>
                              <td className="border-b border-slate-100 px-3 py-3 text-slate-600">{call.date ?? "—"}</td>
                              <td className="border-b border-slate-100 px-3 py-3 text-slate-600">{call.callType}</td>
                              <td className="border-b border-slate-100 px-3 py-3 text-right tabular-nums text-slate-700">{call.totalScore}</td>
                              <td className="border-b border-slate-100 px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{call.percentage.toFixed(1)}%</td>
                              <td className="border-b border-slate-100 px-3 py-3">
                                <span className={`rounded px-2 py-1 font-semibold ${call.percentage >= passThreshold ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                                  {call.percentage >= passThreshold ? "Pass" : "Fail"}
                                </span>
                              </td>
                              <td className="border-b border-slate-100 px-3 py-3 text-slate-600">
                                {call.jevCount ? `${((call.jevProbabilityTotal / call.jevCount) * 100).toFixed(0)}%` : "Pending"}
                              </td>
                              <td className="border-b border-slate-100 px-3 py-3 tabular-nums text-slate-600">
                                {call.jevCount ? `${call.jevFlags}/${call.jevCount}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="px-6 py-12 text-center text-sm text-slate-500">No completed calls match this agent and date range.</p>}
                  </div>
                </article>
              )}

              {isAgentGroupFilter && (
                <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)]">
                  <div className="border-b border-slate-200 px-6 py-5">
                    <p className="mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-forest">
                      <span className="size-1.5 rounded-full bg-forest" aria-hidden="true" />
                      Team performance
                    </p>
                    <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Agent leaderboard</h2>
                    <p className="mt-1 text-xs text-slate-500">Ranked by average call score · {calls.length} calls</p>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    {agentLeaderboard.length ? (
                      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-white/95 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 backdrop-blur">
                          <tr>
                            <th scope="col" className="w-14 border-b border-slate-200 py-3 pl-6">#</th>
                            <th scope="col" className="border-b border-slate-200 py-3">Agent</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3 text-right">Calls</th>
                            <th scope="col" className="min-w-48 border-b border-slate-200 px-3 py-3">Avg call score</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3 text-right">Pass rate</th>
                            <th scope="col" className="border-b border-slate-200 py-3 pr-5 pl-3 text-right">Trend</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentLeaderboard.map((agent, index) => (
                            <tr key={agent.agent} className="transition-colors hover:bg-emerald-50/50">
                              <td className="border-b border-slate-100 py-2.5 pl-6">
                                <span className={`inline-flex size-6 items-center justify-center font-mono text-[11px] font-semibold tabular-nums ${index === 0 ? "rounded-full bg-lime-300 text-[#173d32]" : index === 1 ? "rounded-full bg-[#0d211b] text-white" : index === 2 ? "rounded-full bg-[#46544f] text-white" : "text-slate-500"}`}>
                                  {index + 1}
                                </span>
                              </td>
                              <th scope="row" className="border-b border-slate-100 py-2.5 text-left font-semibold text-slate-800">
                                <span className="flex items-center gap-3 whitespace-nowrap">
                                  <span
                                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                                    style={{ backgroundColor: `hsl(${agentHue(agent.agent)} 70% 92%)`, color: `hsl(${agentHue(agent.agent)} 45% 35%)` }}
                                    aria-hidden="true"
                                  >
                                    {agentInitials(agent.agent)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setAgentFilter(agent.agent)}
                                    className="text-left transition hover:text-emerald-700 hover:underline focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-lime-600"
                                    aria-label={`Show dashboard for ${agent.agent}`}
                                  >
                                    {agent.agent}
                                  </button>
                                </span>
                              </th>
                              <td className="border-b border-slate-100 px-3 py-2.5 text-right font-mono text-slate-500 tabular-nums">{agent.callsGraded}</td>
                              <td className="border-b border-slate-100 px-3 py-2.5">
                                <div className="flex items-center gap-3">
                                  <div className="relative h-1.5 flex-1 rounded-full bg-slate-100">
                                    <div className="h-full rounded-full bg-gradient-to-r from-[#8fcf6b] to-[#43875d]" style={{ width: `${agent.average ?? 0}%` }} />
                                    <span className="absolute -top-1 -bottom-1 w-px bg-rose-500/50" style={{ left: `${passThreshold}%` }} aria-hidden="true" />
                                  </div>
                                  <span className="w-12 text-right font-mono font-semibold text-slate-800 tabular-nums">{agent.average?.toFixed(1) ?? "—"}%</span>
                                </div>
                              </td>
                              <td className="border-b border-slate-100 px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">{agent.passRate.toFixed(1)}%</td>
                              <td className="border-b border-slate-100 py-2.5 pr-5 pl-3 text-right">
                                {agent.trend == null ? (
                                  <span className="text-xs text-slate-400">Not enough data</span>
                                ) : (
                                  <span className={`inline-flex items-center justify-end gap-1 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${agent.trend > 0 ? "bg-emerald-50 text-emerald-800" : agent.trend < 0 ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-500"}`}>
                                    {agent.trend > 0 ? <ArrowUpRight size={14} aria-hidden="true" /> : agent.trend < 0 ? <ArrowDownRight size={14} aria-hidden="true" /> : null}
                                    {agent.trend > 0 ? "+" : ""}{agent.trend.toFixed(1)} pts
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="px-6 py-12 text-center text-sm text-slate-500">No agent call scores match this date range.</p>}
                  </div>
                  <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-500">
                    {agentLeaderboard.length} agents ranked · pass at {passThreshold}%
                  </div>
                </article>
              )}

              <article className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)]">
                <p className="mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-rose-700">
                  <span className="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                  Coaching focus
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Coaching priorities</h2>
                <p className="mt-1 text-xs text-slate-500">Five lowest-scoring criteria · {agentFilter}</p>
                <div className="mt-5 space-y-2.5">
                  {coachingPriorities.length ? coachingPriorities.map(({ category, average }, index) => (
                    <div key={category} className={`rounded-2xl border p-4 text-sm transition-colors ${index === 0 ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                          <div className="min-w-0">
                            <p className="font-mono text-[15px] font-semibold tracking-tight text-slate-900">{category}</p>
                            <p className="truncate text-xs text-slate-500">{sectionName(category)}</p>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${average < 1.6 ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{average < 1.6 ? "Critical" : "At risk"}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-3 pl-7">
                        <span className="flex flex-1 gap-1" role="img" aria-label={`Average score ${average.toFixed(2)} out of 5`}>
                          {Array.from({ length: 5 }, (_, index) => {
                            const fill = Math.min(1, Math.max(0, average - index));
                            return <span key={index} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${average < 1.6 ? "bg-rose-500" : "bg-amber-400"}`} style={{ width: `${fill * 100}%` }} /></span>;
                          })}
                        </span>
                        <p className="shrink-0 font-mono text-xs text-slate-500 tabular-nums"><strong className="text-slate-900">{average.toFixed(2)}</strong> / 5</p>
                      </div>
                    </div>
                  )) : <p className="py-8 text-center text-sm text-slate-500">No criteria scores match the current filters.</p>}
                </div>
              </article>
            </section>

            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.16)]">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-forest">
                    <span className="size-1.5 rounded-full bg-forest" aria-hidden="true" />
                    Coaching detail
                  </p>
                  <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Meter bank</h2>
                  <p className="mt-1 text-xs text-slate-500">Average score by criterion · scale of 1 to 5</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500" aria-label="Score legend">
                  <span>Critical</span>
                  <ul className="flex items-center gap-1" aria-label="Score scale">
                    <li className="h-5 w-9 rounded-md bg-rose-100" title="Below 2.0" />
                    <li className="h-5 w-9 rounded-md bg-orange-100" title="2.0 to 2.4" />
                    <li className="h-5 w-9 rounded-md bg-amber-100" title="2.5 to 3.4" />
                    <li className="h-5 w-9 rounded-md bg-emerald-100" title="3.5 to 3.9" />
                    <li className="h-5 w-9 rounded-md bg-emerald-200" title="4.0 and above" />
                  </ul>
                  <span>Excellent</span>
                </div>
              </div>
              <div className="max-h-[560px] overflow-auto">
                {meterBank.data.length && meterBank.categories.length ? (
                  <table className="w-full min-w-max border-separate border-spacing-0 text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">
                      <tr>
                        <th
                          scope="col"
                          rowSpan={2}
                          aria-sort={meterSort.column === "label" ? (meterSort.direction === "asc" ? "ascending" : "descending") : "none"}
                          className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left"
                        >
                          <button
                            type="button"
                            onClick={() => changeMeterSort("label")}
                            className="inline-flex items-center gap-1.5 font-bold text-slate-600 transition hover:text-forest"
                          >
                            {isAgentView ? "Call" : "Agent"}
                            <span aria-hidden="true" className={meterSort.column === "label" ? "text-forest" : "text-slate-300"}>
                              {meterSort.column === "label" ? (meterSort.direction === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        </th>
                        {meterGroups.map((group) => (
                          <th
                            key={group.prefix}
                            scope="colgroup"
                            colSpan={group.categories.length}
                            className="border-b border-l border-slate-200 px-3 py-2 text-left text-[10px] font-semibold normal-case tracking-normal text-slate-500"
                          >
                            <span className="mr-1.5 font-mono font-bold text-slate-800">{group.prefix}</span>
                            {group.name}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {meterBank.categories.map((category) => {
                          const description = criterionDescription(category);
                          const active = meterSort.column === category;
                          return (
                            <th
                              scope="col"
                              key={category}
                              title={description}
                              aria-sort={active ? (meterSort.direction === "asc" ? "ascending" : "descending") : "none"}
                              className="border-b border-slate-200 px-2 py-2 text-center"
                            >
                              <button
                                type="button"
                                title={description}
                                aria-label={`Sort by ${category}: ${description}`}
                                onClick={() => changeMeterSort(category)}
                                className="inline-flex items-center justify-center gap-1.5 font-mono font-semibold text-slate-600 transition hover:text-forest"
                              >
                                {category.match(/\d+/)?.[0] ?? category}
                                <span aria-hidden="true" className={active ? "text-forest" : "text-slate-300"}>
                                  {active ? (meterSort.direction === "asc" ? "▲" : "▼") : "↕"}
                                </span>
                                <span className="sr-only">{category}</span>
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMeterData.map((item) => (
                        <tr key={item.label} className="group">
                          <th scope="row" className="sticky left-0 z-[1] max-w-56 truncate border-b border-r border-slate-100 bg-white px-4 py-3 text-left font-semibold text-slate-800 group-hover:bg-emerald-50" title={item.label}>
                            {!isAgentView ? (
                              <button
                                type="button"
                                onClick={() => setAgentFilter(item.label)}
                                className="cursor-pointer text-left transition hover:text-emerald-700 hover:underline focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-lime-600"
                                aria-label={`Show dashboard for ${item.label}`}
                              >
                                {item.label}
                              </button>
                            ) : item.label}
                          </th>
                          {meterBank.categories.map((category) => {
                            const score = item.scores[category];
                            return <td key={category} className="border-b border-slate-100 px-1.5 py-1 text-center"><span className={`inline-flex min-w-12 justify-center rounded-sm px-2 py-2 font-semibold tabular-nums ${scoreCellClass(score)}`}>{score == null ? "—" : score.toFixed(1)}</span></td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row" className="sticky bottom-0 left-0 z-20 border-t border-r border-slate-700 bg-[#173d32] px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-lime-200">
                          TEAM AVERAGE
                        </th>
                        {meterBank.categories.map((category) => (
                          <td key={category} className="sticky bottom-0 z-10 border-t border-slate-700 bg-[#173d32] px-2 py-3 text-center font-mono text-xs font-semibold text-white tabular-nums">
                            {meterBank.teamAverage[category]?.toFixed(1) ?? "—"}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                ) : <p className="px-6 py-12 text-center text-sm text-slate-500">No category scores match these filters.</p>}
              </div>
              <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-500 sm:px-6">
                Showing {meterBank.data.length} {isAgentView ? "calls" : "agents"} · {meterBank.categories.length} criteria
              </div>
            </section>
            </>}
          </>
        )}
      </div>
      <MorphOrb onSubmit={submitChatMessage} />
    </main>
  );
}