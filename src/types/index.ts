export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
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
