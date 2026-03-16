import https from 'https';

/**
 * TitlePoint's FortiWeb WAF blocks requests where special characters (#, ;)
 * are URL-encoded. The legacy PHP sends a raw body via curl_post() with
 * CURLOPT_POSTFIELDS as a string — characters like # ; and spaces are NOT
 * encoded. Node's fetch/URLSearchParams always encodes them, triggering the
 * WAF. We use Node https.request to send a truly raw body.
 */
export function rawPost(url: string, rawBody: string, timeoutMs = 30_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(rawBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    const timer = setTimeout(() => { req.destroy(); reject(new Error('TitlePoint request timeout')); }, timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.write(rawBody);
    req.end();
  });
}

export function buildRawBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&') + '&';
}

export function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function extractXmlResult(parsed: Record<string, unknown>, ...rootTags: string[]): Record<string, unknown> {
  for (const tag of rootTags) {
    if (parsed[tag] != null) {
      const root = parsed[tag];
      return (typeof root === 'object' && root !== null ? root : {}) as Record<string, unknown>;
    }
  }
  return parsed as Record<string, unknown>;
}
