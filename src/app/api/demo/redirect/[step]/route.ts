export async function GET(
  request: Request,
  context: { params: Promise<{ step: string }> },
): Promise<Response> {
  const { step } = await context.params;
  const target = new URL(request.url);

  if (step === "start") {
    target.pathname = "/api/demo/redirect/middle";
    return Response.redirect(target, 301);
  }
  if (step === "middle") {
    target.pathname = "/api/demo/site/about";
    return Response.redirect(target, 302);
  }
  if (step === "loop-a") {
    target.pathname = "/api/demo/redirect/loop-b";
    return Response.redirect(target, 302);
  }
  if (step === "loop-b") {
    target.pathname = "/api/demo/redirect/loop-a";
    return Response.redirect(target, 302);
  }
  return Response.json({ error: "Unknown redirect fixture" }, { status: 404 });
}
