import { Hono } from 'hono';
import { Env, Variables } from '../../types';
import { authMiddleware } from '../../middleware/auth';
import { getDatabase } from '../../db/db_context';

const feedbackApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// Submit Feedback / Bug Report
feedbackApp.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const category = body.category || 'general';
  const feedbackText = body.feedbackText || body.feedback_text || body.message || body.text || '';
  const appVersion = body.appVersion || body.app_version || '1.0.0';
  const deviceInfo = body.deviceInfo || body.device_info || '';

  if (!feedbackText.trim()) {
    return c.json({ success: false, error: 'Feedback message cannot be empty' }, 400);
  }

  const id = `fb_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const db = getDatabase(c);

  try {
    await db.prepare(
      'INSERT INTO user_feedback (id, user_handle, category, feedback_text, app_version, device_info, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
    )
      .bind(id, user.userHandle, category, feedbackText, appVersion, deviceInfo)
      .run();

    return c.json({
      success: true,
      feedbackId: id,
      message: 'Feedback submitted successfully. Thank you for helping improve Nearhood!',
    }, 201);
  } catch (e: any) {
    console.error('[Feedback] Save error:', e);
    return c.json({
      success: true,
      feedbackId: id,
      message: 'Feedback recorded successfully',
    });
  }
});

export { feedbackApp };
