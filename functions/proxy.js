export async function onRequest(context) {
  const { request } = context;

  // 1. Handle CORS Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing "url" parameter', { status: 400 });
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return new Response('Invalid "url" parameter', { status: 400 });
  }

  // 2. Attach Custom Headers (Cookie, Referer, Origin, User-Agent)
  const upstreamHeaders = new Headers();
  const cookie = reqUrl.searchParams.get('cookie');
  const referer = reqUrl.searchParams.get('referer');
  const origin = reqUrl.searchParams.get('origin');
  const ua = reqUrl.searchParams.get('ua');

  if (cookie) upstreamHeaders.set('Cookie', cookie);
  if (referer) upstreamHeaders.set('Referer', referer);
  if (origin) upstreamHeaders.set('Origin', origin);
  if (ua) upstreamHeaders.set('User-Agent', ua);

  if (request.headers.has('Range')) {
    upstreamHeaders.set('Range', request.headers.get('Range'));
  }

  try {
    const response = await fetch(parsedTarget.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    // 3. If HLS Manifest (.m3u8), rewrite relative segment/sub-playlist URLs to absolute URLs
    // so hls.js can proxy sub-playlists and .ts segments seamlessly
    if (parsedTarget.pathname.endsWith('.m3u8') || contentType.includes('mpegurl')) {
      const text = await response.text();
      const baseUrl = new URL('.', parsedTarget.toString()).toString();

      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          return new URL(trimmed, baseUrl).toString();
        } catch {
          return line;
        }
      }).join('\n');

      return new Response(rewritten, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response('Proxy Error: ' + err.message, { status: 502 });
  }
}
