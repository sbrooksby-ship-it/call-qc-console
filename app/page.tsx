"use client";

import { createClient } from "@supabase/supabase-js";
import { Activity, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Flag, RefreshCw, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
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

type WikiCompileEvent =
  | { type: "status"; message: string }
  | { type: "total"; total: number }
  | { type: "progress"; processed: number; total: number }
  | { type: "complete"; processed: number; total: number }
  | { type: "error"; message: string };

const SECTION_NAMES: Record<string, string> = {
  BG: "Beginning",
  ARC: "ARC & Trust",
  OE: "Ownership & Responsibility & Effort",
  PE: "Personalization & Education",
  QC: "Quality Communication",
  CL: "Closing",
  CC: "Call Control",
  COMP: "Compliance",
};

const SECTION_MAX: Record<string, number> = {
  Beginning: 10,
  "ARC & Trust": 20,
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

function parseDate(value: unknown): string | null {
  const raw = text(value);
  const fullDate = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (fullDate) {
    return `${fullDate[1]}-${fullDate[2].padStart(2, "0")}-${fullDate[3].padStart(2, "0")}`;
  }

  const shortDate = raw.match(/(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?/);
  if (!shortDate) return null;
  let year = shortDate[3] ? Number(shortDate[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  return `${year}-${shortDate[1].padStart(2, "0")}-${shortDate[2].padStart(2, "0")}`;
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

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function scoreCellClass(score: number | undefined): string {
  if (score == null) return "bg-slate-50 text-slate-300";
  if (score >= 4) return "bg-emerald-100 text-emerald-900";
  if (score >= 3) return "bg-amber-100 text-amber-900";
  return "bg-rose-100 text-rose-900";
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
  accent,
}: {
  label: string;
  value: string;
  note: string;
  delta?: number | null;
  accent: string;
}) {
  const positive = delta != null && delta >= 0;
  return (
    <article className="relative min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white px-5 py-5 shadow-[0_2px_8px_rgba(23,61,50,0.04)]">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-3 font-display text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      <div className="mt-3 flex min-h-5 items-center gap-1.5 text-xs text-slate-500">
        {delta != null && (positive
          ? <ArrowUpRight aria-hidden="true" size={14} className="text-emerald-700" />
          : <ArrowDownRight aria-hidden="true" size={14} className="text-rose-700" />)}
        <span className={delta == null ? "" : positive ? "text-emerald-800" : "text-rose-800"}>
          {delta == null ? note : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts vs first half`}
        </span>
      </div>
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
  const [passThreshold, setPassThreshold] = useState(DEFAULT_PASS_THRESHOLD);
  const [callSort, setCallSort] = useState<CallSort>({ column: "date", direction: "desc" });
  const [meterSort, setMeterSort] = useState<{ column: string; direction: "asc" | "desc" }>({ column: "label", direction: "asc" });
  const [sectionView, setSectionView] = useState<"chart" | "table">("chart");
  const [compileSecret, setCompileSecret] = useState("");
  const [compilingWiki, setCompilingWiki] = useState(false);
  const [compileProgress, setCompileProgress] = useState<{ processed: number; total: number; message: string } | null>(null);
  const [compileMessage, setCompileMessage] = useState("");
  const [compileError, setCompileError] = useState("");

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

  const filteredRows = useMemo(() => rows.filter((row) => {
    if ((startDate || endDate) && !row.date) return false;
    if (startDate && row.date && row.date < startDate) return false;
    if (endDate && row.date && row.date > endDate) return false;
    if (agentFilter === "Sales" || agentFilter === "Care") return row.callType === agentFilter;
    return agentFilter === "All agents" || row.agent === agentFilter;
  }), [rows, startDate, endDate, agentFilter]);

  const calls = useMemo(() => summarizeCalls(filteredRows), [filteredRows]);
  const sections = useMemo(() => summarizeSections(filteredRows), [filteredRows]);
  const previousSections = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return [];
    const windowLength = Math.round(
      (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime())
      / 86_400_000,
    ) + 1;
    const previousStart = shiftDate(startDate, -windowLength);
    const previousEnd = shiftDate(startDate, -1);
    const previousRows = rows.filter((row) => {
      if (!row.date || row.date < previousStart || row.date > previousEnd) return false;
      if (agentFilter === "Sales" || agentFilter === "Care") return row.callType === agentFilter;
      return agentFilter === "All agents" || row.agent === agentFilter;
    });
    return summarizeSections(previousRows);
  }, [rows, startDate, endDate, agentFilter]);
  const isAgentView = !["All agents", "Sales", "Care"].includes(agentFilter);
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
    const dailyScores = new Map<string, number[]>();
    for (const call of calls) {
      if (!call.date) continue;
      const scores = dailyScores.get(call.date) ?? [];
      scores.push(call.percentage);
      dailyScores.set(call.date, scores);
    }

    return Array.from(dailyScores, ([date, scores]) => ({
      date,
      average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [calls]);

  const metrics = useMemo(() => {
    const percentages = calls.map((call) => call.percentage);
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
      highest: percentages.length ? Math.max(...percentages) : null,
      lowest: percentages.length ? Math.min(...percentages) : null,
      passRate: calls.length ? passing / calls.length * 100 : null,
      averageDelta,
      passDelta,
    };
  }, [calls, passThreshold, startDate, endDate]);

  const jevMetrics = useMemo(() => {
    const checkedCalls = calls.filter((call) => call.jevCount > 0);
    const averageConfidence = checkedCalls.length
      ? checkedCalls.reduce((sum, call) => sum + call.jevProbabilityTotal / call.jevCount, 0) / checkedCalls.length
      : null;
    const flaggedQuestions = calls.reduce((sum, call) => sum + call.jevFlags, 0);
    return { checkedCalls: checkedCalls.length, averageConfidence, flaggedQuestions };
  }, [calls]);

  const meterBank = useMemo(() => {
    const byCall = !["All agents", "Sales", "Care"].includes(agentFilter);
    const values = new Map<string, Map<string, number[]>>();
    for (const row of filteredRows) {
      const label = byCall ? `${row.call} (${row.callType})` : row.agent;
      const categories = values.get(label) ?? new Map<string, number[]>();
      const scores = categories.get(row.category) ?? [];
      scores.push(row.score);
      categories.set(row.category, scores);
      values.set(label, categories);
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
    return { categories, data };
  }, [filteredRows, agentFilter]);

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

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-forest/20 bg-forest text-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-lime-200">
              <span className="h-2 w-2 rounded-full bg-lime-400" /> Balance of Nature
            </div>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Call QC Console</h1>
            <p className="mt-2 text-sm text-emerald-100/75">Quality performance at a glance</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="hidden text-xs text-emerald-100/70 sm:inline">{loading ? "Syncing call scores" : `${rows.length.toLocaleString()} score rows loaded`}</span>
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
                disabled={compilingWiki}
                className="h-10 w-36 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-emerald-100/60 focus:border-lime-300 focus:ring-2 focus:ring-lime-300/30 disabled:opacity-60 sm:w-40"
              />
              <button
                type="submit"
                disabled={compilingWiki || !compileSecret.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-lime-300/50 bg-lime-400 px-3 text-sm font-bold text-forest transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {compilingWiki ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                <span>{compilingWiki ? "Compiling..." : "Compile Knowledge Wiki"}</span>
              </button>
            </form>
            <button
              type="button"
              onClick={() => setRefreshCount((count) => count + 1)}
              disabled={loading}
              title="Refresh call scores"
              aria-label="Refresh call scores"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {(compilingWiki || compileMessage || compileError) && (
          <div className="mx-auto max-w-[1440px] px-5 pb-4 sm:px-8 lg:px-10" aria-live="polite">
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

      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <section aria-label="Dashboard filters" className="-mt-1 grid gap-3 border-b border-slate-200 bg-white/85 px-4 py-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_1.2fr_auto] lg:px-5">
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            From
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 block h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-forest focus:ring-2 focus:ring-leaf/30" />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            To
            <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 block h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-forest focus:ring-2 focus:ring-leaf/30" />
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Agent / call type
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="mt-1.5 block h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-forest focus:ring-2 focus:ring-leaf/30">
              <option>All agents</option>
              <option>Sales</option>
              <option>Care</option>
              {agents.map((agent) => <option key={agent}>{agent}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Pass threshold
            <span className="mt-1.5 flex h-10 items-center gap-3 rounded border border-slate-300 bg-white px-3 focus-within:border-forest focus-within:ring-2 focus-within:ring-leaf/30">
              <input type="range" min="0" max="100" step="1" value={passThreshold} onChange={(event) => setPassThreshold(Number(event.target.value))} aria-label="Pass threshold percentage" className="h-1 min-w-0 flex-1 accent-forest" />
              <span className="w-11 text-right text-sm font-bold tabular-nums text-slate-800">{passThreshold}%</span>
            </span>
          </label>
          <button
            type="button"
            onClick={resetFilters}
            title="Restore the full date range, all agents, and the default pass threshold"
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-forest/30"
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

        <section aria-label="Call performance metrics" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Calls graded" value={loading ? "…" : metrics.count.toLocaleString()} note="Complete calls in this view" accent="bg-forest" />
          <MetricCard label="Average call score" value={number(metrics.average)} note="Across selected calls" delta={metrics.averageDelta} accent="bg-sky-600" />
          <MetricCard label="Highest call" value={number(metrics.highest)} note="Top call score" accent="bg-emerald-600" />
          <MetricCard label="Lowest call" value={number(metrics.lowest)} note="Lowest call score" accent="bg-amber-500" />
          <MetricCard label={`Pass rate · ${passThreshold}%`} value={number(metrics.passRate)} note="Calls at or above target" delta={metrics.passDelta} accent="bg-rose-500" />
        </section>

        <div role="status" className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm">
          <span className="font-medium">
            Jev overall confidence:{" "}
            <strong>{jevMetrics.averageConfidence == null ? "Pending" : `${(jevMetrics.averageConfidence * 100).toFixed(0)}%`}</strong>
            {jevMetrics.averageConfidence != null && <> across <strong>{jevMetrics.checkedCalls}</strong> checked calls</>}
            {jevMetrics.averageConfidence == null && " — no checked calls in this filter yet."}
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-rose-700">
            <Flag size={15} fill="currentColor" aria-hidden="true" />
            {jevMetrics.flaggedQuestions} flagged {jevMetrics.flaggedQuestions === 1 ? "question" : "questions"}
          </span>
        </div>

        {loading ? (
          <div className="mt-6 flex min-h-64 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-500">
            <Activity className="mr-2 animate-pulse text-leaf" size={18} /> Loading performance data…
          </div>
        ) : !error && calls.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="font-display text-lg font-bold text-slate-800">No completed calls in this view</p>
            <p className="mt-1 text-sm text-slate-500">Try a different date range or agent filter.</p>
          </div>
        ) : !error && (
          <>
            <section aria-labelledby="score-trend-heading" className="mt-6 rounded-md border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(23,61,50,0.04)] sm:p-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">Call quality over time</p>
                <h2 id="score-trend-heading" className="mt-1 font-display text-lg font-bold text-slate-900">Score trend</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isAgentView ? `Average call score by day for ${agentFilter}` : "Average call score by day"}
                </p>
              </div>
              <div className="mt-5 h-[280px] w-full">
                {scoreTrend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scoreTrend} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                      <CartesianGrid stroke="#e8ede7" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(value: number) => `${value}%`}
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={42}
                      />
                      <Tooltip
                        labelFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString()}
                        formatter={(value) => [`${Number(value).toFixed(1)}%`, "Average call score"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="average"
                        name="Average call score"
                        stroke="#2f6b4f"
                        strokeWidth={2.5}
                        dot={{ fill: "#2f6b4f", r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-sm text-slate-500">No dated call scores to chart.</div>}
              </div>
            </section>

            <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
              <article className="min-w-0 rounded-md border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(23,61,50,0.04)] sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">Quality breakdown</p>
                    <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Section performance</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <div role="group" aria-label="Section performance view" className="inline-flex rounded border border-slate-300 p-0.5">
                      <button
                        type="button"
                        aria-pressed={sectionView === "chart"}
                        onClick={() => setSectionView("chart")}
                        className={`rounded px-2.5 py-1 text-xs font-semibold transition ${sectionView === "chart" ? "bg-forest text-white" : "text-slate-600 hover:bg-slate-100"}`}
                      >
                        Chart
                      </button>
                      <button
                        type="button"
                        aria-pressed={sectionView === "table"}
                        onClick={() => setSectionView("table")}
                        className={`rounded px-2.5 py-1 text-xs font-semibold transition ${sectionView === "table" ? "bg-forest text-white" : "text-slate-600 hover:bg-slate-100"}`}
                      >
                        Table
                      </button>
                    </div>
                    <span className="rounded-sm bg-emerald-50 px-2 py-1 text-xs font-semibold text-forest">Target {passThreshold}%</span>
                  </div>
                </div>
                {sectionView === "chart" ? (
                  <div className="mt-5 h-[330px] w-full" role="img" aria-label="Horizontal bar chart showing average call score percentage by section">
                    {sections.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sections} layout="vertical" margin={{ top: 4, right: 18, left: 5, bottom: 4 }} barCategoryGap={10}>
                          <CartesianGrid horizontal={false} stroke="#e8ede7" />
                          <XAxis type="number" domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="section" width={154} tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Average score"]} cursor={{ fill: "#f5f7f2" }} />
                          <ReferenceLine x={passThreshold} stroke="#c33c3c" strokeDasharray="5 4" />
                          <Bar dataKey="percentage" fill="#4b8f56" radius={[0, 3, 3, 0]} maxBarSize={22} label={{ position: "right", formatter: (value: number) => `${value.toFixed(0)}%`, fill: "#475569", fontSize: 10 }} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <div className="flex h-full items-center justify-center text-sm text-slate-500">No section scores to chart.</div>}
                  </div>
                ) : (
                  <div className="mt-5 max-h-[330px] overflow-auto">
                    {sections.length ? (
                      <table className="w-full min-w-[600px] border-separate border-spacing-0 text-left text-sm">
                        <caption className="sr-only">Raw score, percentage, and previous-period change by section</caption>
                        <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">
                          <tr>
                            <th scope="col" className="border-b border-slate-200 px-4 py-3">Section</th>
                            <th scope="col" className="border-b border-slate-200 px-4 py-3 text-right">Raw Score</th>
                            <th scope="col" className="border-b border-slate-200 px-4 py-3 text-right">Percentage</th>
                            <th scope="col" className="border-b border-slate-200 px-4 py-3 text-right">Previous Period</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sections.map((section, index) => {
                            const previous = previousSections.find((item) => item.section === section.section);
                            const change = previous ? section.percentage - previous.percentage : null;
                            return (
                              <tr key={section.section} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                                <th scope="row" className="border-b border-slate-100 px-4 py-3 text-left font-semibold text-slate-800">{section.section}</th>
                                <td className="border-b border-slate-100 px-4 py-3 text-right font-medium tabular-nums text-slate-700">{section.rawScore.toFixed(2)} / {section.maxScore}</td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{section.percentage.toFixed(1)}%</td>
                                <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                                  {previous ? (
                                    <span className="inline-flex flex-col items-end gap-0.5">
                                      <span className="font-medium text-slate-700">{previous.percentage.toFixed(1)}%</span>
                                      <span className={`text-xs font-semibold ${change != null && change > 0 ? "text-emerald-700" : change != null && change < 0 ? "text-rose-700" : "text-slate-500"}`}>
                                        {change != null && change > 0 ? "+" : ""}{change?.toFixed(1)} pp
                                      </span>
                                    </span>
                                  ) : <span className="text-slate-400">No prior data</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : <div className="flex h-full min-h-64 items-center justify-center text-sm text-slate-500">No section scores to display.</div>}
                  </div>
                )}
              </article>

              <article className="rounded-md border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(23,61,50,0.04)] sm:p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">At a glance</p>
                <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Current selection</h2>
                <dl className="mt-6 divide-y divide-slate-100">
                  <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-sm text-slate-500">Score rows</dt><dd className="font-display text-lg font-bold tabular-nums text-slate-900">{filteredRows.length.toLocaleString()}</dd></div>
                  <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-sm text-slate-500">Agents represented</dt><dd className="font-display text-lg font-bold tabular-nums text-slate-900">{new Set(filteredRows.map((row) => row.agent)).size}</dd></div>
                  <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-sm text-slate-500">Sections with scores</dt><dd className="font-display text-lg font-bold tabular-nums text-slate-900">{sections.length}</dd></div>
                  <div className="flex items-baseline justify-between gap-4 py-3"><dt className="text-sm text-slate-500">Passing calls</dt><dd className="font-display text-lg font-bold tabular-nums text-forest">{calls.filter((call) => call.percentage >= passThreshold).length} <span className="font-sans text-xs font-medium text-slate-500">of {calls.length}</span></dd></div>
                </dl>
              </article>
            </section>

            <section
              aria-label="Coaching priorities and agent call breakdown"
              className={`mt-6 grid gap-4 ${isAgentView || agentFilter === "All agents" ? "xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]" : "xl:grid-cols-1"}`}
            >
              {isAgentView && (
                <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_2px_8px_rgba(23,61,50,0.04)]">
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
                            <tr key={`${call.call}-${call.date ?? "unknown"}`} className="hover:bg-slate-50">
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

              {agentFilter === "All agents" && (
                <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_2px_8px_rgba(23,61,50,0.04)]">
                  <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">Team performance</p>
                    <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Agent Leaderboard</h2>
                    <p className="mt-1 text-xs text-slate-500">Ranked by average call score · {calls.length} calls</p>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    {agentLeaderboard.length ? (
                      <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">
                          <tr>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3">Agent</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3 text-right">Calls Graded</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3 text-right">Avg Call Score</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3 text-right">Pass Rate %</th>
                            <th scope="col" className="border-b border-slate-200 px-3 py-3 text-right">Trend (vs First Half)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentLeaderboard.map((agent, index) => (
                            <tr key={agent.agent} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                              <th scope="row" className="border-b border-slate-100 px-3 py-3 text-left font-semibold text-slate-800">{agent.agent}</th>
                              <td className="border-b border-slate-100 px-3 py-3 text-right tabular-nums text-slate-600">{agent.callsGraded}</td>
                              <td className="border-b border-slate-100 px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{agent.average?.toFixed(1) ?? "—"}%</td>
                              <td className="border-b border-slate-100 px-3 py-3 text-right tabular-nums text-slate-700">{agent.passRate.toFixed(1)}%</td>
                              <td className="border-b border-slate-100 px-3 py-3 text-right">
                                {agent.trend == null ? (
                                  <span className="text-slate-400">Not enough data</span>
                                ) : (
                                  <span className={`inline-flex items-center justify-end gap-1 font-semibold tabular-nums ${agent.trend > 0 ? "text-emerald-700" : agent.trend < 0 ? "text-rose-700" : "text-slate-500"}`}>
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
                </article>
              )}

              <article className="rounded-md border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(23,61,50,0.04)] sm:p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-rose-700">Coaching focus</p>
                <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Coaching Priorities</h2>
                <p className="mt-1 text-xs text-slate-500">Five lowest-scoring criteria · {agentFilter}</p>
                <div className="mt-5 space-y-2.5">
                  {coachingPriorities.length ? coachingPriorities.map(({ category, average }) => (
                    <div key={category} className="rounded border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                      <p className="font-bold">{category}</p>
                      <p className="mt-1 text-xs font-medium">Avg Score: {average.toFixed(2)} / 5.0</p>
                    </div>
                  )) : <p className="py-8 text-center text-sm text-slate-500">No criteria scores match the current filters.</p>}
                </div>
              </article>
            </section>

            <section className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_2px_8px_rgba(23,61,50,0.04)]">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">Coaching detail</p>
                  <h2 className="mt-1 font-display text-lg font-bold text-slate-900">Meter bank</h2>
                  <p className="mt-1 text-xs text-slate-500">Average score by criterion · scale of 1 to 5</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-600" aria-label="Score legend">
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-rose-300" />Critical · 1–2</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-300" />Average · 3</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-300" />Excellent · 4–5</span>
                </div>
              </div>
              <div className="max-h-[560px] overflow-auto">
                {meterBank.data.length && meterBank.categories.length ? (
                  <table className="w-full min-w-max border-separate border-spacing-0 text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">
                      <tr>
                        <th
                          scope="col"
                          aria-sort={meterSort.column === "label" ? (meterSort.direction === "asc" ? "ascending" : "descending") : "none"}
                          className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left"
                        >
                          <button
                            type="button"
                            onClick={() => changeMeterSort("label")}
                            className="inline-flex items-center gap-1.5 font-bold text-slate-600 transition hover:text-forest"
                          >
                            {agentFilter === "All agents" || agentFilter === "Sales" || agentFilter === "Care" ? "Agent" : "Call"}
                            <span aria-hidden="true" className={meterSort.column === "label" ? "text-forest" : "text-slate-300"}>
                              {meterSort.column === "label" ? (meterSort.direction === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        </th>
                        {meterBank.categories.map((category) => {
                          const description = criterionDescription(category);
                          const active = meterSort.column === category;
                          return (
                            <th
                              scope="col"
                              key={category}
                              title={description}
                              aria-sort={active ? (meterSort.direction === "asc" ? "ascending" : "descending") : "none"}
                              className="max-w-32 border-b border-slate-200 px-3 py-3 text-center"
                            >
                              <button
                                type="button"
                                title={description}
                                aria-label={`Sort by ${category}: ${description}`}
                                onClick={() => changeMeterSort(category)}
                                className="inline-flex items-center justify-center gap-1.5 font-bold text-slate-600 transition hover:text-forest"
                              >
                                {category}
                                <span aria-hidden="true" className={active ? "text-forest" : "text-slate-300"}>
                                  {active ? (meterSort.direction === "asc" ? "▲" : "▼") : "↕"}
                                </span>
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
                            {agentFilter === "All agents" || agentFilter === "Sales" || agentFilter === "Care" ? (
                              <button
                                type="button"
                                onClick={() => setAgentFilter(item.label)}
                                className="cursor-pointer text-left transition hover:text-blue-600 hover:underline focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-blue-500"
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
                  </table>
                ) : <p className="px-6 py-12 text-center text-sm text-slate-500">No category scores match these filters.</p>}
              </div>
              <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-500 sm:px-6">
                Showing {meterBank.data.length} {agentFilter === "All agents" || agentFilter === "Sales" || agentFilter === "Care" ? "agents" : "calls"} · {meterBank.categories.length} criteria
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}