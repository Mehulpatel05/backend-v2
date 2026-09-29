/**
 * Cloudflare D1 Unified Adapter
 * Reads credentials strictly from process.env / Cloudflare Bindings
 */

export interface D1QueryResult<T = any> {
  results?: T[];
  meta?: any;
  success?: boolean;
}

export class D1Client {
  private accountId: string;
  private apiToken: string;
  private databaseId: string;

  constructor(accountId?: string, apiToken?: string, databaseId?: string) {
    this.accountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = apiToken || process.env.CLOUDFLARE_API_TOKEN || '';
    this.databaseId = databaseId || process.env.D1_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID || '';
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<D1QueryResult<T>> {
    if (!this.accountId || !this.apiToken || !this.databaseId) {
      console.warn('[D1Client] Cloudflare D1 environment variables are not configured.');
      return { results: [], meta: { changes: 0 } };
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql,
          params,
        }),
      });

      const data: any = await response.json();
      if (!data.success && data.errors && data.errors.length > 0) {
        console.error('[D1 HTTP Error]:', data.errors);
        return { results: [], meta: { changes: 0 } };
      }

      const firstResult = data.result?.[0] || {};
      return {
        results: firstResult.results || [],
        meta: firstResult.meta || { changes: 0 },
        success: data.success,
      };
    } catch (err) {
      console.error('[D1 Network Error]:', err);
      return { results: [], meta: { changes: 0 } };
    }
  }

  prepare(sql: string) {
    return {
      bind: (...params: any[]) => ({
        all: async <T = any>() => this.query<T>(sql, params),
        first: async <T = any>() => {
          const res = await this.query<T>(sql, params);
          return (res.results && res.results.length > 0) ? res.results[0] : null;
        },
        run: async () => this.query(sql, params),
      }),
    };
  }

  async batch(statements: any[]) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}
