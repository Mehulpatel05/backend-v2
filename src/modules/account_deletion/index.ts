import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';
import { orchestrateAccountDeletion } from './deletion_orchestrator';

export const accountDeletionApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const handlePurgeRequest = async (c: any) => {
  const user = c.get('user');
  if (!user || !user.userHandle) {
    return c.json({ success: false, message: 'Authentication required to delete account' }, 401);
  }

  const db = getDatabase(c);
  const result = await orchestrateAccountDeletion(
    db,
    user.userHandle,
    user.installationId
  );

  if (!result.success) {
    return c.json(result, 500);
  }

  return c.json(result, 200);
};

// Primary dedicated purge route
accountDeletionApp.delete('/purge', authMiddleware, handlePurgeRequest);

// Standard root DELETE /api/v2/account and alias /delete
accountDeletionApp.delete('/', authMiddleware, handlePurgeRequest);
accountDeletionApp.delete('/delete', authMiddleware, handlePurgeRequest);

export { orchestrateAccountDeletion };
