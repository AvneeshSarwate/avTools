export const EDITOR_PATH = '/__cloud/editor';
export const EDITOR_PORT = 8080;

export function editorRequestAllowed(request: Request): boolean {
  // Access authenticates the user; also reject cross-site browser requests to
  // this shell-capable service. Do not weaken code-server's own origin checks.
  const origin = request.headers.get('Origin');
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site' &&
    (!origin || origin === new URL(request.url).origin);
}

export function editorUpstreamRequest(request: Request): Request {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${EDITOR_PATH}/`)) throw new Error('Not an editor route');
  url.pathname = url.pathname.slice(EDITOR_PATH.length);
  const headers = new Headers(request.headers);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.slice(0, -1));
  // Preserve the public Host/Origin for code-server's WebSocket origin check.
  return new Request(url, new Request(request, { headers }));
}

export function editorPendingResponse(request: Request, failed = false): Response {
  const message = failed
    ? 'The editor could not start. Check the editor process output from the devbox terminal, then reload to retry.'
    : 'Starting the editor and restoring your settings…';
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '2' };
  if (!request.headers.get('Accept')?.includes('text/html')) {
    return Response.json({ editor: failed ? 'failed' : 'starting', message }, { status: 503, headers });
  }
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${failed ? '' : '<meta http-equiv="refresh" content="2">'}
<title>Livecode editor</title></head><body><h1>Livecode editor</h1><p>${message}</p>
<p><a href="/projects.html">Projects</a> · <a href="/__cloud/terminal/">Terminal</a></p></body></html>`, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" },
  });
}
