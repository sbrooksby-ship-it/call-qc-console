import { createClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { secretsMatch } from "@/lib/server/secrets";

export const runtime = "edge";

type RemoveCallEnvironment = Partial<Record<
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
  let cloudflareEnv: RemoveCallEnvironment = {};
  try {
    cloudflareEnv = getRequestContext().env as RemoveCallEnvironment;
  } catch {
    // The request context is unavailable when running outside Cloudflare.
  }

  const supabaseUrl = cloudflareEnv.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = cloudflareEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expectedSecret = cloudflareEnv.COMPILE_WIKI_SECRET || process.env.COMPILE_WIKI_SECRET;
  if (!supabaseUrl || !serviceRoleKey || !expectedSecret) {
    return responseError("Score removal is not configured on the server.", 500);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_768) return responseError("Score removal request is too large.", 413);

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 32_768) {
      return responseError("Score removal request is too large.", 413);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!isRecord(parsed)) return responseError("A valid JSON object is required.", 400);
    body = parsed;
  } catch {
    return responseError("A valid JSON request body is required.", 400);
  }

  if (typeof body.secret !== "string" || !body.secret.trim() || body.secret.length > 4096
    || !await secretsMatch(body.secret, expectedSecret)) {
    return responseError("Invalid admin secret.", 401);
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500
    || !body.ids.every((id) => typeof id === "string" && id.trim().length > 0 && id.length <= 200)
    || new Set(body.ids).size !== body.ids.length) {
    return responseError("A list of unique score row IDs is required.", 400);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from("call_scores")
      .delete()
      .in("id", body.ids)
      .select("id");

    if (error) {
      console.error("Call score removal failed:", error);
      return responseError("Could not remove the call scores.", 500);
    }
    if (data?.length !== body.ids.length) {
      return responseError(
        data?.length
          ? "Only some score rows were found and removed. Refresh the dashboard to verify the call."
          : "No score rows were found for this call.",
        data?.length ? 409 : 404,
      );
    }

    return Response.json({ success: true, deleted: data.length });
  } catch (error) {
    console.error("Call score removal failed:", error);
    return responseError("Could not remove the call scores.", 500);
  }
}
