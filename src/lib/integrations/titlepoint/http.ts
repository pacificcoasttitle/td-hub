import https from 'https';

export interface TitlePointHttpResult {
  status: number;
  body: string;
  response: {
    contentType: string | null;
  };
}

export function sendTitlePointGet(
  finalUrl: string,
  timeoutMs = 30_000,
): Promise<TitlePointHttpResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(finalUrl);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            response: {
              contentType: typeof res.headers['content-type'] === 'string'
                ? res.headers['content-type']
                : null,
            },
          });
        });
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

export function sendTitlePointPost(
  url: string,
  rawBody: string,
  timeoutMs = 30_000,
): Promise<TitlePointHttpResult> {
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
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            response: {
              contentType: typeof res.headers['content-type'] === 'string'
                ? res.headers['content-type']
                : null,
            },
          });
        });
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
