import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './index';

const port = Number(process.env.PORT) || 3000;

console.log(`🚀 Nearhood Backend V2 starting on http://0.0.0.0:${port}`);

serve({
  fetch: app.fetch,
  port,
});
