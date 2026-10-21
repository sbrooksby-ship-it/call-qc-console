import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

const PAGE_BATCH_SIZE = 10;
const PAGE_FETCH_SIZE = 500;
const EMBEDDING_DIMENSIONS = 768;
const encoder = new TextEncoder();

type WikiPage = {
  id: string;
  title: string;
  content: string;
};

function responseError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function progressEvent(event: Record<string, string | number>): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  const [providedDigest, expectedDigest] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  return difference === 0;
}

export async function POST(request: Request): Promise<Response> {
  const compileSecret = process.env.COMPILE_WIKI_SECRET;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!compileSecret || !geminiApiKey || !supabaseUrl || !supabaseServiceRoleKey) {
    return responseError("Wiki compilation is not configured on the server.", 500);
  }

  let providedSecret: unknown;
  try {
    const body = await request.json() as { secret?: unknown };
    providedSecret = body.secret;
  } catch {
    return responseError("A valid JSON request body is required.", 400);
  }

  if (typeof providedSecret !== "string" || providedSecret.length > 4096
    || !await secretsMatch(providedSecret, compileSecret)) {
    return responseError("Invalid compile secret.", 401);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(progressEvent({ type: "status", message: "Loading wiki pages..." }));
        const pages: WikiPage[] = [];
        for (let offset = 0; ; offset += PAGE_FETCH_SIZE) {
          const { data, error } = await supabase
            .from("wiki_pages")
            .select("id,title,content")
            .order("id")
            .range(offset, offset + PAGE_FETCH_SIZE - 1);
          if (error) throw new Error(`Unable to load wiki pages: ${error.message}`);
          const batch = (data ?? []) as WikiPage[];
          pages.push(...batch);
          if (batch.length < PAGE_FETCH_SIZE) break;
        }

        controller.enqueue(progressEvent({ type: "total", total: pages.length }));
        if (pages.length === 0) {
          controller.enqueue(progressEvent({ type: "complete", processed: 0, total: 0 }));
          controller.close();
          return;
        }

        let processed = 0;
        for (let offset = 0; offset < pages.length; offset += PAGE_BATCH_SIZE) {
          const batch = pages.slice(offset, offset + PAGE_BATCH_SIZE);
          controller.enqueue(progressEvent({
            type: "status",
            message: `Embedding batch ${Math.floor(offset / PAGE_BATCH_SIZE) + 1} of ${Math.ceil(pages.length / PAGE_BATCH_SIZE)}...`,
          }));

          const embeddingResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${encodeURIComponent(geminiApiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requests: batch.map((page) => ({
                  model: "models/gemini-embedding-001",
                  content: { parts: [{ text: `${page.title}\n\n${page.content}`.slice(0, 3500) }] },
                  outputDimensionality: EMBEDDING_DIMENSIONS,
                })),
              }),
            },
          );

          const embeddingPayload = await embeddingResponse.json() as {
            embeddings?: Array<{ values?: number[] }>;
            error?: { message?: string };
          };
          if (!embeddingResponse.ok) {
            throw new Error(embeddingPayload.error?.message ?? `Gemini embedding request failed (${embeddingResponse.status}).`);
          }
          if (!embeddingPayload.embeddings || embeddingPayload.embeddings.length !== batch.length) {
            throw new Error("Gemini returned an unexpected number of embeddings.");
          }

          for (let index = 0; index < batch.length; index += 1) {
            const values = embeddingPayload.embeddings[index].values;
            if (!values || values.length !== EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value))) {
              throw new Error(`Gemini returned an invalid embedding for "${batch[index].title}".`);
            }

            const { error } = await supabase
              .from("wiki_pages")
              .update({ embedding: values })
              .eq("id", batch[index].id);
            if (error) throw new Error(`Unable to save embedding for "${batch[index].title}": ${error.message}`);

            processed += 1;
            controller.enqueue(progressEvent({ type: "progress", processed, total: pages.length }));
          }
        }

        controller.enqueue(progressEvent({ type: "complete", processed, total: pages.length }));
        controller.close();
      } catch (error) {
        controller.enqueue(progressEvent({
          type: "error",
          message: error instanceof Error ? error.message : "Wiki compilation failed.",
        }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
