import { AppConfig } from './config';

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createMediaSignature(key: string, exp: number): Promise<string> {
  const secret = AppConfig.mediaSigningSecret;
  const hmacKey = await getHmacKey(secret);
  const data = new TextEncoder().encode(`${key}:${exp}`);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, data);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyMediaSignature(key: string, expStr: string, sigStr: string): Promise<boolean> {
  const exp = parseInt(expStr, 10);
  if (isNaN(exp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return false;

  const expectedSig = await createMediaSignature(key, exp);
  if (expectedSig.length !== sigStr.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ sigStr.charCodeAt(i);
  }
  return diff === 0;
}
