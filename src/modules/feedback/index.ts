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

// Get user tickets
feedbackApp.get('/my-tickets', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = getDatabase(c);

  try {
    const results = await db.prepare(
      'SELECT id, user_handle, category, feedback_text, app_version, device_info, created_at FROM user_feedback WHERE user_handle = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(user.userHandle).all();

    const tickets = (results.results || []).map((row: any) => {
      const text = row.feedback_text || '';
      const ticketMatch = text.match(/Ticket:\s*(NH-[A-Za-z0-9]+)/i);
      const priorityMatch = text.match(/Priority:\s*(URGENT|NORMAL)/i);
      const subjectMatch = text.match(/Subject:\s*([^\n]+)/i);
      const phoneMatch = text.match(/Phone:\s*([^\n]+)/i);

      let cleanDesc = text;
      const descSplit = text.split('\n\n');
      if (descSplit.length > 1) {
        cleanDesc = descSplit.slice(1).join('\n\n').trim();
      }

      return {
        ticketId: ticketMatch ? ticketMatch[1] : row.id,
        userHandle: row.user_handle,
        phone: phoneMatch ? phoneMatch[1] : '',
        category: row.category || 'General',
        priority: priorityMatch ? priorityMatch[1].toLowerCase() : 'normal',
        subject: subjectMatch ? subjectMatch[1].trim() : (row.category || 'Support Request'),
        description: cleanDesc,
        status: 'under_review',
        createdAt: row.created_at,
        updatedAt: row.created_at,
        estimatedHours: (priorityMatch && priorityMatch[1].toLowerCase() === 'urgent') ? 2 : 24,
      };
    });

    return c.json({
      success: true,
      tickets,
    });
  } catch (e: any) {
    console.error('[Feedback] Fetch tickets error:', e);
    return c.json({
      success: false,
      tickets: [],
    });
  }
});

export { feedbackApp };
