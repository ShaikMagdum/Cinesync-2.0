export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  const urlParams = new URL(request.url).searchParams;
  const targetUrl = urlParams.get('url');

  if (!targetUrl) {
    return new Response('Missing "url" query parameter.', { status: 400 });
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return new Response('Invalid target URL.', { status: 400 });
  }

  // Construct upstream request headers
  const headers = new Headers();
  const cookie = urlParams.get('cookie');
  const referer = urlParams.get('referer');
  const origin = urlParams.get('origin');
  const ua = urlParams.get('ua');

  if (cookie) headers.set('Cookie', cookie);
  if (referer) headers.set('Referer', referer);
  if (origin) headers.set('Origin', origin);
  if (ua) headers.set('User-Agent', ua);

  // Forward Byte-Range headers (essential for DASH/HLS video segments)
  if (request.headers.has('Range')) {
    headers.set('Range', request.headers.get('Range'));
  }

  try {
    const response = await fetch(parsedTarget.toString(), {
      method: request.method,
      headers: headers,
      redirect: 'follow',
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response('Proxy Error: ' + err.message, { status: 502 });
  }
}