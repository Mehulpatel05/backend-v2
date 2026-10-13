import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging, Message } from 'firebase-admin/messaging';

let isFirebaseInitialized = false;

function initFirebaseAdmin(): boolean {
  if (isFirebaseInitialized || getApps().length > 0) {
    return true;
  }

  const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (rawJson) {
    try {
      const cleanJson = rawJson.trim().replace(/^'([\s\S]*)'$/, '$1');
      const serviceAccount = JSON.parse(cleanJson);
      initializeApp({
        credential: cert(serviceAccount),
      });
      isFirebaseInitialized = true;
      return true;
    } catch (err) {
      console.error('[FCM] Failed to initialize Firebase Admin SDK from JSON:', err);
    }
  }

  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.resolve(process.cwd(), 'firebase-service-account.json'),
    path.resolve(__dirname, '../../firebase-service-account.json'),
    path.resolve(__dirname, '../../../firebase-service-account.json'),
  ].filter(Boolean) as string[];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const fileContent = fs.readFileSync(p, 'utf8');
        const serviceAccount = JSON.parse(fileContent);
        initializeApp({
          credential: cert(serviceAccount),
        });
        isFirebaseInitialized = true;
        return true;
      } catch (err) {
        console.error(`[FCM] Failed to initialize Firebase Admin SDK from ${p}:`, err);
      }
    }
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      isFirebaseInitialized = true;
      return true;
    } catch (err) {
      console.error('[FCM] Failed to initialize Firebase Admin SDK from env vars:', err);
    }
  }

  return false;
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
    const profile = (await db.prepare(
      'SELECT fcm_token FROM profiles WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
    )
      .bind(cleanHandle, `@${cleanHandle}`)
      .first()) as { fcm_token?: string } | null;

    let fcmToken = profile?.fcm_token?.trim();
    if (!fcmToken) {
      const userRow = (await db.prepare(
        'SELECT handle FROM users WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
      ).bind(cleanHandle, `@${cleanHandle}`).first()) as any;
      if (userRow?.handle) {
        const altHandle = userRow.handle.replace(/^@+/, '').trim().toLowerCase();
        const altProfile = (await db.prepare(
          'SELECT fcm_token FROM profiles WHERE LOWER(handle) = ? OR LOWER(handle) = ? LIMIT 1'
        ).bind(altHandle, `@${altHandle}`).first()) as any;
        fcmToken = altProfile?.fcm_token?.trim();
      }
    }

    if (!fcmToken) {
      return false;
    }

    const effectiveTitle = (title || 'Nearhood').trim();
    let effectiveBody = (body || '').trim();
    if (!effectiveBody) {
      const type = (data?.type || '').toString();
      if (type === 'chat' || type === 'message') {
        effectiveBody = 'Sent you a message';
      } else if (type === 'call') {
        effectiveBody = 'Incoming call';
      } else if (type === 'post_like') {
        effectiveBody = 'Liked your post';
      } else if (type === 'post_comment') {
        effectiveBody = 'Commented on your post';
      } else if (type === 'friend_request') {
        effectiveBody = 'Sent you a friend request';
      } else {
        effectiveBody = 'You have a new notification';
      }
    }

    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    stringData['title'] = effectiveTitle;
    stringData['body'] = effectiveBody;

    const message: Message = {
      token: fcmToken,
      notification: {
        title: effectiveTitle,
        body: effectiveBody,
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          channelId: channelId || 'nearhood_channel',
          sound: 'default',
          priority: 'max',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: effectiveTitle,
              body: effectiveBody,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    await getMessaging().send(message);
    return true;
  } catch (error: any) {
    if (
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token'
    ) {
      try {
        await db.prepare('UPDATE profiles SET fcm_token = "" WHERE LOWER(handle) = ? OR LOWER(handle) = ?')
          .bind(cleanHandle, `@${cleanHandle}`)
          .run();
      } catch (_) {}
    }
    return false;
  }
}
