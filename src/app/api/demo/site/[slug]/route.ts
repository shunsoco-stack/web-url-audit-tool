function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="ja">${body}</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const canonical = new URL(`/api/demo/site/${slug}`, request.url).toString();

  if (slug === "home") {
    return html(`<head>
      <title>株式会社ミナト｜コーポレートサイト</title>
      <meta name="description" content="Web監査ツールの安全なDemo Dataset用サイトです。">
      <link rel="canonical" href="${canonical}">
    </head><body>
      <main><h1>株式会社ミナト</h1>
        <a href="/api/demo/site/about">会社情報</a>
        <a href="/api/demo/site/missing-metadata">採用情報</a>
        <a href="/api/demo/status/404">旧キャンペーン</a>
        <a href="/api/demo/status/500">障害確認用</a>
        <a href="/api/demo/redirect/start">移転したサービス</a>
        <a href="https://example.com/">外部パートナー</a>
      </main>
    </body>`);
  }

  if (slug === "about") {
    return html(`<head>
      <title>株式会社ミナト｜コーポレートサイト</title>
      <link rel="canonical" href="${canonical}">
    </head><body><main><h1>会社情報</h1><a href="/api/demo/site/home">Home</a></main></body>`);
  }

  if (slug === "missing-metadata") {
    return html(`<head></head><body><main>
      <p>Title、Description、Canonical、H1の欠落を実測するDemo Pageです。</p>
      <a href="/api/demo/site/home">Home</a>
    </main></body>`);
  }

  return html("<head><title>Demo page not found</title></head><body><h1>Not found</h1></body>", 404);
}
