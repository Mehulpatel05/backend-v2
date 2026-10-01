import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging, Message } from 'firebase-admin/messaging';

let isFirebaseInitialized = false;

function initFirebaseAdmin(): boolean {
  if (isFirebaseInitialized || getApps().length > 0) {
    return true;
  }

  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) {
    console.warn('[FCM] No GOOGLE_APPLICATION_CREDENTIALS_JSON found in environment.');
    return false;
  }

  try {
    const serviceAccount = JSON.parse(credsJson);
    initializeApp({
      credential: cert(serviceAccount),
    });
    isFirebaseInitialized = true;
    console.log(`[FCM] Firebase Admin successfully initialized for project: ${serviceAccount.project_id}`);
    return true;
  } catch (err) {
    console.error('[FCM] Failed to initialize Firebase Admin SDK:', err);
    return false;
  }
}

export interface PushNotificationPayload {
  targetHandle: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  channelId?: string;
  db: any;
}

export async function sendPushNotification({
  targetHandle,
  title,
  body,
  data = {},
  channelId = 'nearhood_channel',
  db,
}: PushNotificationPayload): Promise<boolean> {
  const cleanHandle = targetHandle.replace(/^@+/, '').trim().toLowerCase();
  if (!cleanHandle) return false;

  const initialized = initFirebaseAdmin();
  if (!initialized) return false;

  try {
    // 1. Fetch user's registered FCM token from profiles table
    const profile = (await db.prepare(
      'SELECT fcm_token FROM profiles WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
    )
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as { fcm_token?: string } | null;

    const fcmToken = profile?.fcm_token?.trim();
    if (!fcmToken) {
      console.log(`[FCM] No FCM token found for user @${cleanHandle}`);
      return false;
    }

    // 2. Format string data payload (FCM data requires string key-value pairs)
    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    stringData['title'] = title;
    stringData['body'] = body;

    // 3. Dispatch message
    const message: Message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          channelId: channelId || 'nearhood_channel',
          sound: 'default',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
    };

    const response = await getMessaging().send(message);
    console.log(`[FCM] Successfully sent push to @${cleanHandle}: ${response}`);
    return true;
  } catch (error: any) {
    console.error(`[FCM] Error sending push to @${cleanHandle}:`, error?.message || error);

    // If token is invalid or unregistered, clean it up from profiles to prevent future failures
    if (
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token'
    ) {
      try {
        await db.prepare('UPDATE profiles SET fcm_token = "" WHERE LOWER(handle) = ?')
          .bind(cleanHandle)
          .run();
        console.log(`[FCM] Cleared stale token for @${cleanHandle}`);
      } catch (_) {}
    }
    return false;
  }
}
