import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** UPPERCASE_HEX(MD5(UTF8(text))) */
export function md5Upper(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();
}

/** 换票签名：原文 ticket + appid + SECRET；ticket 必须是“解码一次”后的原文 */
export function ticketSignature(rawTicket: string, appid: string, secret: string): string {
  return md5Upper(rawTicket + appid + secret);
}

/** 查询/刷新签名：原文 access_token + appid + SECRET */
export function tokenSignature(rawToken: string, appid: string, secret: string): string {
  return md5Upper(rawToken + appid + secret);
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 从原始请求 URL 中取出参数并只解码一次。
 * 不使用 application/x-www-form-urlencoded 规则：'+' 保持为加号，不会变成空格；
 * '%2B' 解码为 '+'；已解码的 '/'、'=' 原样保留。返回 null 表示缺失或编码非法。
 */
export function rawQueryParam(originalUrl: string, name: string): string | null {
  const queryStart = originalUrl.indexOf('?');
  if (queryStart < 0) return null;
  const query = originalUrl.slice(queryStart + 1).split('#')[0]!;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key !== name) continue;
    const raw = eq < 0 ? '' : part.slice(eq + 1);
    try {
      const value = decodeURIComponent(raw);
      return value || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 出站查询串：每个值只编码一次（encodeURIComponent，'+' → %2B，空格 → %20） */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

/** 日志脱敏：去掉 ticket、access_token、signature 的值 */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:ticket|access_token|signature|token)=)[^&#]*/gi, '$1[redacted]');
}

/**
 * 令牌加密（AES-256-GCM）。生产/测试环境必须配置持久密钥；
 * mock 未配置时使用进程内随机密钥（重启后旧 mock 令牌不可解密，这是预期行为）。
 */
let ephemeralKey: Buffer | null = null;

function keyFrom(secret: string): Buffer {
  if (secret) return createHash('sha256').update(secret, 'utf8').digest();
  ephemeralKey ??= randomBytes(32);
  return ephemeralKey;
}

export function encryptSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptSecret(sealed: string, keyMaterial: string): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyMaterial), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** originId：仅字母数字下划线，带环境前缀，持久唯一 */
export function newOriginId(environment: string): string {
  return `zhian_${environment}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}
