export async function onRequest(context) {
  const { request } = context;

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
  if (!targetUrl) return new Response('Missing "url" parameter', { status: 400 });

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return new Response('Invalid "url" parameter', { status: 400 });
  }

  const upstreamHeaders = new Headers();
  const cookie = reqUrl.searchParams.get('cookie');
  const referer = reqUrl.searchParams.get('referer');
  const origin = reqUrl.searchParams.get('origin');
  const ua = reqUrl.searchParams.get('ua');

  if (ua && ua !== 'Default') {
    upstreamHeaders.set('User-Agent', ua);
  } else if (parsedTarget.hostname.includes('hotstar.com')) {
    upstreamHeaders.set('User-Agent', 'Hotstar;in.startv.hotstar/25.02.24.8.11169 (Android/15)');
  } else {
    upstreamHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  }

  if (cookie) upstreamHeaders.set('Cookie', cookie);
  if (referer) upstreamHeaders.set('Referer', referer);
  if (origin) upstreamHeaders.set('Origin', origin);
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
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Set-Cookie');

    const setCookieHeader = response.headers.get('set-cookie');
    let inheritedCookie = cookie || '';
    if (setCookieHeader) {
      const extracted = setCookieHeader.split(';')[0];
      if (extracted && !inheritedCookie.includes(extracted)) {
        inheritedCookie = inheritedCookie ? `${inheritedCookie}; ${extracted}` : extracted;
      }
    }

    if (parsedTarget.pathname.endsWith('.m3u8') || contentType.includes('mpegurl')) {
      const text = await response.text();
      const finalUrl = response.url || parsedTarget.toString();
      const baseUrl = new URL('.', finalUrl).toString();
      const parentQuery = new URL(finalUrl).search;

      const wrapInProxy = (rawChildUrl) => {
        let absUrl = new URL(rawChildUrl, baseUrl).toString();
        if (!absUrl.includes('hdnea=') && !absUrl.includes('hdntl=') && parentQuery) {
          absUrl += (absUrl.includes('?') ? '&' : '') + parentQuery.replace(/^\?/, '');
        }
        const p = new URL('/proxy', reqUrl.origin);
        p.searchParams.set('url', absUrl);
        if (inheritedCookie) p.searchParams.set('cookie', inheritedCookie);
        if (referer) p.searchParams.set('referer', referer);
        if (origin) p.searchParams.set('origin', origin);
        if (ua) p.searchParams.set('ua', ua);
        return p.toString();
      };

      const rewritten = text.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (match, uri) => `URI="${wrapInProxy(uri)}"`);
        }
        return wrapInProxy(trimmed);
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
