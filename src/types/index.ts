export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  OLA_MAPS_API_KEY?: string;
  OLA_MAPS_PROJECT_ID?: string;
  OLA_MAPS_CLIENT_ID?: string;
  OLA_MAPS_CLIENT_SECRET?: string;
  MAPS_PROVIDER?: string;
  GOOGLE_MAPS_API_KEY?: string;
  GROQ_API_KEY?: string;
}

export interface UserContext {
  installationId: string;
  userHandle: string;
}

export interface AuthSession {
  installation_id: string;
  token_hash: string;
  user_handle: string;
  revoked_at: string | null;
}

export type Variables = {
  user: UserContext;
};
