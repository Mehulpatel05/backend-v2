import { Context } from 'hono';
import { Env, Variables } from '../types';
import { D1Client } from './d1_http_client';

const globalD1Client = new D1Client();

export function getDatabase(c: Context<{ Bindings: Env; Variables: Variables }>) {
  if (c.env && c.env.DB) {
    return c.env.DB;
  }
  return globalD1Client as any;
}
