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
    if (!secret) {
      if (AppConfig.isProduction) {
        // Never fall back to a well-known default in production — that is
        // equivalent to having no secret at all.
        throw new Error('[AppConfig] JWT_SECRET is required in production but is not set.');
      }
      return 'dev_jwt_secret_nearhood_2026';
    }
    return secret;
  },

  get isProduction(): boolean {
    const env = (process.env.ENVIRONMENT || process.env.NODE_ENV || '').trim().toLowerCase();
    return env === 'production';
  },

  get isDevelopment(): boolean {
    const env = (process.env.ENVIRONMENT || process.env.NODE_ENV || '').trim().toLowerCase();
    return env === 'development' || env === 'dev' || env === 'test';
  },

  /**
   * Secret used to sign media proxy URLs. Falls back to JWT_SECRET so a single
   * configured secret is enough for a working deployment.
   */
  get mediaSigningSecret(): string {
    const secret = (process.env.MEDIA_SIGNING_SECRET || '').trim();
    if (secret) return secret;
    return AppConfig.jwtSecret;
  },

  /**
   * Grace period for media URLs minted before signing existed. While true,
   * unsigned requests for private (chat) media are logged but still served.
   * Flip to 'false' once the signed-URL app build has rolled out.
   */
  get mediaAllowLegacyUnsigned(): boolean {
    const raw = (process.env.MEDIA_LEGACY_UNSIGNED || '').trim().toLowerCase();
    if (raw === '') return true; // default: permissive, log-only
    return raw === 'true';
  },

  get publicBaseUrl(): string {
    return (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  },
};

