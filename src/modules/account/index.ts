import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { executeDeleteAccount } from './delete_account_service';

export const accountApp = new Hono<{ Bindings: Env; Variables: Variables }>();

accountApp.delete('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);
  const result = await executeDeleteAccount(db, user.userHandle, user.installationId);

  if (!result.success) {
    return c.json(result, 500);
  }

  return c.json(result, 200);
});

accountApp.delete('/delete', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);
  const result = await executeDeleteAccount(db, user.userHandle, user.installationId);

  if (!result.success) {
    return c.json(result, 500);
  }

  return c.json(result, 200);
});

export { executeDeleteAccount };
