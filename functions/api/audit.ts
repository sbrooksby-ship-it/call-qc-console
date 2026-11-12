interface Env {
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface AuditContext {
  request: Request;
  env: Env;
}

interface ClaimRecord {
  id?: unknown;
  status?: unknown;
  proposed_claim?: unknown;
  target_tier?: unknown;
  supporting_study?: unknown;
  topic_title?: unknown;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestPost = async (context: AuditContext): Promise<Response> => {
  try {
    let payload: unknown;
    try {
      payload = await context.request.json();
    } catch {
      return jsonResponse({ error: "A valid JSON request body is required." }, 400);
    }

    const record = isObject(payload) && isObject(payload.record)
      ? payload.record as ClaimRecord
      : null;

    if (typeof record?.id !== "string" || !record.id || record.status !== "pending") {
      return jsonResponse({ ignored: true });
    }

    const supabaseUrl = context.env.SUPABASE_URL || context.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      context.env.SUPABASE_SERVICE_ROLE_KEY || context.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const geminiKey = context.env.GEMINI_API_KEY;

    if (!supabaseUrl || !supabaseKey || !geminiKey) {
      return jsonResponse({ error: "Missing Supabase or Gemini environment variables." }, 500);
    }

    const supabaseHeaders = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    const claimUrl = new URL("/rest/v1/claim_submissions", supabaseUrl);
    claimUrl.searchParams.set("id", `eq.${record.id}`);

    const processingResponse = await fetch(claimUrl, {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({ status: "processing" }),
    });
    if (!processingResponse.ok) {
      throw new Error(`Could not mark claim as processing (${processingResponse.status}).`);
    }

    const prompt = `You are a senior dietary supplement & CPG regulatory compliance auditor (FDA 21 CFR 101.93 / DSHEA / FTC substantiation standards).
Evaluate the following marketing claim proposal and return ONLY valid JSON with two keys:
1. "topic_title": A concise 2-4 word title for the sidebar (e.g. "Tart Cherry Joint Comfort").
2. "ai_evaluation": A structured Markdown compliance brief formatted EXACTLY like this:
### Regulatory & Evidence Summary
- **Classification:** [Structure/Function Claim, Disease Claim Violation, or Nutrient Content Claim]
- **Substantiation Risk:** [Low, Moderate, or High risk + specific regulatory reasoning]
- **Study Methodology:** [Relevant clinical trial design / evidence standard]
- **Clinical Outcomes:** [Key physiological mechanisms or documented study endpoints]
- **Confidence Rating:** [High, Moderate, or Flag]

Proposed Claim: "${typeof record.proposed_claim === "string" ? record.proposed_claim : ""}"
Target Tier: "${typeof record.target_tier === "string" ? record.target_tier : "Not specified"}"
Supporting Study Provided: "${typeof record.supporting_study === "string" ? record.supporting_study : "None provided"}"`;

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API request failed (${geminiResponse.status}).`);
    }

    const geminiData = await geminiResponse.json() as GeminiResponse;
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error("Gemini returned an empty evaluation.");
    }

    const parsed: unknown = JSON.parse(rawText);
    if (!isObject(parsed)) {
      throw new Error("Gemini returned an invalid evaluation.");
    }

    const completedResponse = await fetch(claimUrl, {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({
        status: "completed",
        topic_title: record.topic_title || parsed.topic_title || "Claim Audit",
        ai_evaluation: parsed.ai_evaluation || rawText,
      }),
    });
    if (!completedResponse.ok) {
      throw new Error(`Could not save claim evaluation (${completedResponse.status}).`);
    }

    return jsonResponse({ success: true, id: record.id });
  } catch (error) {
    console.error("Claim audit failed:", error);
    return jsonResponse({ error: "Claim audit could not be completed." }, 500);
  }
};
