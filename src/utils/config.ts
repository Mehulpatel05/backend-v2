export const AppConfig = {
  get cfAccountId(): string {
    return (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  },
  get cfApiToken(): string {
    return (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  },
  get d1DatabaseId(): string {
    return (process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
  },
  get r2Bucket(): string {
    return (process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'nearhood').trim();
  },
  get r2AccessKeyId(): string {
    return (process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim();
  },
  get r2SecretAccessKey(): string {
    return (process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '').trim();
  },
  get r2Endpoint(): string {
    return (process.env.R2_ENDPOINT_URL || (this.cfAccountId ? `https://${this.cfAccountId}.r2.cloudflarestorage.com` : '')).trim();
  },
  get r2PublicUrl(): string {
    return (process.env.R2_PUBLIC_URL_PREFIX || process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '').trim();
  },
  get jwtSecret(): string {
    const secret = (process.env.JWT_SECRET || '').trim();
    if (!secret && process.env.NODE_ENV === 'production') {
      console.error('[AppConfig] JWT_SECRET environment variable is missing!');
    }
    return secret || 'dev_jwt_secret_nearhood_2026';
  },
};

