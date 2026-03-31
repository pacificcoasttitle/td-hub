import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import tls from 'tls';

const u = process.env.TP_USERNAME;
const p = process.env.TP_PASSWORD;

function rawGet(hostname, path, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname }, () => {
      const reqLines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${hostname}`,
        `Connection: close`,
        `Accept: */*`,
        ``,
        ``,
      ].join('\r\n');
      socket.write(reqLines);
    });

    let raw = '';
    socket.on('data', (chunk) => { raw += chunk.toString(); });
    socket.on('end', () => {
      clearTimeout(timer);
      const headerEnd = raw.indexOf('\r\n\r\n');
      if (headerEnd === -1) { resolve({ status: 0, body: raw }); return; }
      const headerBlock = raw.slice(0, headerEnd);
      let body = raw.slice(headerEnd + 4);
      const statusMatch = headerBlock.match(/^HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      if (/transfer-encoding:\s*chunked/i.test(headerBlock)) {
        body = decodeChunked(body);
      }
      resolve({ status, headers: headerBlock, body });
    });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, timeoutMs);
  });
}

function decodeChunked(raw) {
  let result = '';
  let pos = 0;
  while (pos < raw.length) {
    const lineEnd = raw.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const sizeHex = raw.slice(pos, lineEnd).trim();
    const size = parseInt(sizeHex, 16);
    if (isNaN(size) || size === 0) break;
    const chunkStart = lineEnd + 2;
    result += raw.slice(chunkStart, chunkStart + size);
    pos = chunkStart + size + 2;
  }
  return result;
}

// Encode ONLY spaces as %20, leave ; and # and = unencoded
function minimalEncode(s) {
  return s.replace(/ /g, '%20');
}

// ============ TEST 1: GET with space-only encoding ============
const qs1 = minimalEncode([
  `userID=${u}`,
  `password=${p}`,
  `serviceType=TitlePoint.TaxSearch`,
  `parameters=APN=8381-021-001;Property.AutoSearchTaxes=True;Property.AutoSearchProperty=True`,
  `state=CA`,
  `county=LOS ANGELES`,
  `department=`,
  `orderNo=`,
  `customerRef=test-get`,
  `company=`,
  `titleOfficer=`,
  `orderComment=`,
  `starterRemarks=`,
].join('&') + '&');

const path1 = `/TitlePointServices/TpsService.asmx/CreateService3?${qs1}`;

console.log('=== TEST 1: CreateService3 Tax (GET, space→%20) ===');
console.log(`Path length: ${path1.length}`);

try {
  const res = await rawGet('www.titlepoint.com', path1);
  console.log(`Status: ${res.status}`);
  console.log(`Body length: ${res.body.length}`);
  const isHtml = /<html/i.test(res.body);
  const isXml = res.body.trim().startsWith('<?xml') || (res.body.trim().startsWith('<') && !isHtml);
  console.log(`Is HTML: ${isHtml}, Is XML: ${isXml}`);
  if (isXml) {
    console.log(`\n${res.body.slice(0, 800)}`);
  } else if (isHtml) {
    const text = res.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`HTML text: ${text.slice(0, 400)}`);
  } else {
    console.log(`Body: ${res.body.slice(0, 500)}`);
  }
} catch (err) {
  console.log('ERROR:', err.message);
}

// ============ TEST 2: CreateService4 Legal Vesting (GET) ============
const qs2 = minimalEncode([
  `userID=${u}`,
  `password=${p}`,
  `serviceType=TitlePoint.LegalAndVesting2`,
  `fipsCode=06037`,
  `parameters=FIPS=06037;APN=8381-021-001;Address1=1358 5th St;City=La Verne`,
  `department=`,
  `orderNo=`,
  `customerRef=test-lv`,
  `company=`,
  `titleOfficer=`,
  `orderComment=`,
  `starterRemarks=`,
].join('&') + '&');

const path2 = `/TitlePointServices/TpsService.asmx/CreateService4?${qs2}`;

console.log('\n=== TEST 2: CreateService4 Legal Vesting (GET, space→%20) ===');
console.log(`Path length: ${path2.length}`);

try {
  const res = await rawGet('www.titlepoint.com', path2);
  console.log(`Status: ${res.status}`);
  console.log(`Body length: ${res.body.length}`);
  const isHtml = /<html/i.test(res.body);
  const isXml = res.body.trim().startsWith('<?xml') || (res.body.trim().startsWith('<') && !isHtml);
  console.log(`Is HTML: ${isHtml}, Is XML: ${isXml}`);
  if (isXml) {
    console.log(`\n${res.body.slice(0, 800)}`);
  } else if (isHtml) {
    const text = res.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`HTML text: ${text.slice(0, 400)}`);
  } else {
    console.log(`Body: ${res.body.slice(0, 500)}`);
  }
} catch (err) {
  console.log('ERROR:', err.message);
}

// ============ TEST 3: CreateService3 Geo Address (GET) ============
const qs3 = minimalEncode([
  `userID=${u}`,
  `password=${p}`,
  `serviceType=TitlePoint.Geo.Address`,
  `parameters=Address.FullAddress=1358 5th St, La Verne, CA 91750;General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False;General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False;General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;`,
  `state=CA`,
  `county=LOS ANGELES`,
  `department=`,
  `orderNo=`,
  `customerRef=test-geo`,
  `company=`,
  `titleOfficer=`,
  `orderComment=`,
  `starterRemarks=`,
].join('&') + '&');

const path3 = `/TitlePointServices/TpsService.asmx/CreateService3?${qs3}`;

console.log('\n=== TEST 3: CreateService3 Geo Address (GET, space→%20) ===');
console.log(`Path length: ${path3.length}`);

try {
  const res = await rawGet('www.titlepoint.com', path3);
  console.log(`Status: ${res.status}`);
  console.log(`Body length: ${res.body.length}`);
  const isHtml = /<html/i.test(res.body);
  const isXml = res.body.trim().startsWith('<?xml') || (res.body.trim().startsWith('<') && !isHtml);
  console.log(`Is HTML: ${isHtml}, Is XML: ${isXml}`);
  if (isXml) {
    console.log(`\n${res.body.slice(0, 800)}`);
  } else if (isHtml) {
    const text = res.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`HTML text: ${text.slice(0, 400)}`);
  } else {
    console.log(`Body: ${res.body.slice(0, 500)}`);
  }
} catch (err) {
  console.log('ERROR:', err.message);
}
