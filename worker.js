const PREFIX = "/chesstok";
const PAGES_ORIGIN = "https://chesstok.pages.dev";

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'; trusted-types default; require-trusted-types-for 'script'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-DNS-Prefetch-Control": "off",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=(), clipboard-read=(), clipboard-write=()"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.href, 308);
    }

    if (!url.pathname.startsWith(`${PREFIX}/`)) {
      return withSecurityHeaders(new Response("Not found", { status: 404 }));
    }

    const assetUrl = new URL(request.url);
    assetUrl.protocol = "https:";
    assetUrl.host = new URL(PAGES_ORIGIN).host;
    assetUrl.pathname = url.pathname.slice(PREFIX.length) || "/";
    let response = await fetch(new Request(assetUrl, request));

    if (response.status === 404 && wantsHtml(request)) {
      assetUrl.pathname = "/index.html";
      response = await fetch(new Request(assetUrl, request));
    }

    return withSecurityHeaders(response);
  }
};

function wantsHtml(request) {
  return request.headers.get("accept")?.includes("text/html");
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
