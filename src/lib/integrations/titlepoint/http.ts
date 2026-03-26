import https from 'https';

/**
 * POST transport matching legacy Order.php curl_post():
 *
 *   $post_array_string = '';
 *   foreach ($requestParams as $key => $value) {
 *       $post_array_string .= $key . '=' . $value . '&';
 *   }
 *   $ch = curl_init($end_point);
 *   curl_setopt($ch, CURLOPT_POST, true);
 *   curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
 *   curl_setopt($ch, CURLOPT_POSTFIELDS, $post_array_string);
 *
 * Result: POST with raw "key=value&key=value&" body. No URL-encoding.
 * Content-Type defaults to application/x-www-form-urlencoded (PHP cURL default).
 * Used by: Titlepoint.php library (post-order automation).
 */
export function tpPostRawForm(
  url: string,
  params: Record<string, string | number>,
  timeoutMs = 30_000,
): Promise<{ status: number; body: string }> {
  const rawBody = buildRawBody(params);
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(rawBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('TitlePoint request timeout'));
    }, timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.write(rawBody);
    req.end();
  });
}

/**
 * GET transport matching legacy frontend TitlePoint.php file_get_contents + http_build_query:
 *
 *   $request = $requestUrl . http_build_query($requestParams);
 *   $file = file_get_contents($request, false, $context);
 *
 * Result: GET with URL-encoded query string. Values are percent-encoded.
 * Used by: frontend/controllers/order/TitlePoint.php (pre-order AJAX).
 */
export function tpGetEncoded(
  url: string,
  params: Record<string, string | number>,
  timeoutMs = 30_000,
): Promise<{ status: number; body: string }> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  ).toString();
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const fullPath = parsed.pathname + '?' + qs;
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: fullPath,
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('TitlePoint request timeout'));
    }, timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

function buildRawBody(params: Record<string, string | number>): string {
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
