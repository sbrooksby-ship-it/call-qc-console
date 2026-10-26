import { createClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { secretsMatch } from "@/lib/server/secrets";

export const runtime = "edge";

type ScoreUpdateEnvironment = Partial<Record<
  "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "COMPILE_WIKI_SECRET",
  string
>>;

function responseError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export async function POST(request: Request): Promise<Response> {
  let cloudflareEnv: ScoreUpdateEnvironment = {};
  try {
    cloudflareEnv = getRequestContext().env as ScoreUpdateEnvironment;
  } catch {
    // The request context is unavailable when running outside Cloudflare.
  }

  const supabaseUrl = cloudflareEnv.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = cloudflareEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expectedSecret = cloudflareEnv.COMPILE_WIKI_SECRET || process.env.COMPILE_WIKI_SECRET;
  if (!supabaseUrl || !serviceRoleKey || !expectedSecret) {
    return responseError("Score overrides are not configured on the server.", 500);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_192) return responseError("Score update request is too large.", 413);

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 8_192) {
      return responseError("Score update request is too large.", 413);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!isRecord(parsed)) {
      return responseError("A valid JSON object is required.", 400);
    }
    body = parsed;
  } catch {
    return responseError("A valid JSON request body is required.", 400);
  }

  if (typeof body.secret !== "string" || !body.secret.trim() || body.secret.length > 4096
    || !await secretsMatch(body.secret, expectedSecret)) {
    return responseError("Invalid admin secret.", 401);
  }
  if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 200) {
    return responseError("A valid score row ID is required.", 400);
  }
  if (typeof body.newScore !== "number" || !Number.isFinite(body.newScore)
    || body.newScore < 1 || body.newScore > 5) {
    return responseError("Score must be a number between 1 and 5.", 400);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: existingRows, error: readError } = await supabase
      .from("call_scores")
      .select("id, score, original_ai_score")
      .eq("id", body.id.trim());

    if (readError) {
      console.error("Score override lookup failed:", readError);
      return responseError("Could not update the score.", 500);
    }
    if (existingRows?.length !== 1) {
      return existingRows?.length
        ? responseError("Score row ID matched more than one record.", 409)
        : responseError("Score row was not found.", 404);
    }

    const existingRow = existingRows[0];
    const { data: updatedRows, error: updateError } = existingRow.original_ai_score === null
      ? await supabase
        .from("call_scores")
        .update({
          original_ai_score: existingRow.score,
          score: body.newScore,
          manually_overridden: true,
        })
        .eq("id", body.id.trim())
        .is("original_ai_score", null)
        .select("id")
      : await supabase
        .from("call_scores")
        .update({ score: body.newScore })
        .eq("id", body.id.trim())
        .select("id");

    if (updateError) {
      console.error("Score override failed:", updateError);
      return responseError("Could not update the score.", 500);
    }

    if (updatedRows?.length === 1) return Response.json({ success: true });
    if (updatedRows?.length) {
      return responseError("Score row ID matched more than one record.", 409);
    }

    if (existingRow.original_ai_score === null) {
      const { data: concurrentUpdateRows, error: concurrentUpdateError } = await supabase
        .from("call_scores")
        .update({ score: body.newScore })
        .eq("id", body.id.trim())
        .select("id");

      if (concurrentUpdateError) {
        console.error("Score override failed:", concurrentUpdateError);
        return responseError("Could not update the score.", 500);
      }
      if (concurrentUpdateRows?.length === 1) return Response.json({ success: true });
      if (concurrentUpdateRows?.length) {
        return responseError("Score row ID matched more than one record.", 409);
      }
    }

    return responseError("Score row was not found.", 404);
  } catch (error) {
    console.error("Score override failed:", error);
    return responseError("Could not update the score.", 500);
  }
}
