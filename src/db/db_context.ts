import { Context } from 'hono';
import { Env, Variables } from '../types';
import { SqliteD1Adapter } from './sqlite_engine';

let globalSqliteAdapter: SqliteD1Adapter | null = null;

export function getDatabase(c: Context<{ Bindings: Env; Variables: Variables }>) {
  if (c?.env && (c.env as any).DB) {
    return (c.env as any).DB;
  }
  if (!globalSqliteAdapter) {
    globalSqliteAdapter = new SqliteD1Adapter();
  }
  return globalSqliteAdapter as any;
}
