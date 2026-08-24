const ALLOWED_STATUSES = new Set([200, 404, 410, 500]);

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await context.params;
  const status = Number(code);
  if (!ALLOWED_STATUSES.has(status)) {
    return Response.json({ error: "Unsupported demo status" }, { status: 400 });
  }
  const canonical = new URL(`/api/demo/status/${status}`, request.url).toString();
  return new Response(
    `<!doctype html><html lang="ja"><head><title>HTTP ${status} Demo</title><meta name="description" content="実HTTP ${status}応答を確認する安全なDemo endpointです。"><link rel="canonical" href="${canonical}"></head><body><h1>HTTP ${status}</h1><a href="/api/demo/site/home">Demo Home</a></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
