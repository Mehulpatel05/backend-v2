function decodeB64(val: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(val, 'base64').toString('utf8');
  }
  return typeof atob !== 'undefined' ? atob(val) : '';
}

export const AppConfig = {
  get cfAccountId(): string {
    return process.env.CLOUDFLARE_ACCOUNT_ID || decodeB64('ODdhZGE2ZGQ4MDdmMzk1OGQ4Y2IzOTZiNTIxMTY2MmM=');
  },
  get cfApiToken(): string {
    return process.env.CLOUDFLARE_API_TOKEN || decodeB64('Y2Z1dF9jdzBDQjZpdW53cVBxZEhSVnc0VVdWRmVlR1FZTDBFckJLMDRLbXJzNGI0OWI0Yjk=');
  },
  get d1DatabaseId(): string {
    return process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || decodeB64('NmI2ZjQ4ZGMtZTNiNS00MjVkLWFlYTktNGJhMTE0YTJlN2Rl');
  },
  get r2Bucket(): string {
    return process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'nearhood';
  },
  get r2AccessKeyId(): string {
    return process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || decodeB64('MDYzYTkyOGY0OWJmMGQ2Yjc0M2IyMzAyNWU2NmFiM2M=');
  },
  get r2SecretAccessKey(): string {
    return process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || decodeB64('N2FlMTRmZWRmZGE0OTBlZjc1YjI5M2M4YjI0YzRmZTQwZGI4YjE2MGJhNDAwMWI3MzgxMDFlMmNlOTc0NDhmMg==');
  },
  get r2Endpoint(): string {
    return process.env.R2_ENDPOINT_URL || decodeB64('aHR0cHM6Ly84N2FkYTZkZDgwN2YzOTU4ZDhjYjM5NmI1MjExNjYyYy5yMi5jbG91ZGZsYXJlc3RvcmFnZS5jb20=');
  },
  get r2PublicUrl(): string {
    return process.env.R2_PUBLIC_URL_PREFIX || 'https://pub-87ada6dd807f3958d8cb396b5211662c.r2.dev';
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET || 'MyJwtSecret2026Vadodara';
  },
};
