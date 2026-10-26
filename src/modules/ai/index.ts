import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { Env, Variables } from '../../types';

export const aiApp = new Hono<{ Bindings: Env; Variables: Variables }>();

const alertKeywords = [
  'alert', 'urgent', 'warning', 'emergency', 'cutoff', 'cut', 'shut',
  'shutdown', 'maintenance', 'watercut', 'paani', 'pani', 'bijli', 'light',
  'power', 'electricity', 'supply', 'pipe', 'pipeline', 'leakage', 'leak',
  'bandh', 'band', 'notice', 'caution', 'attention', 'vmc', 'panioff',
  'lightoff', 'powercut', 'drainage', 'gutter', 'cleaning', 'divert',
  'diversion', 'traffic', 'jam', 'danger', 'khatra', 'ચેતવણી', 'પાણી',
  'વીજળી', 'બંધ', 'સમારકામ', 'નોટિસ', 'ધ્યાન'
];

const safetyKeywords = [
  'safety', 'security', 'theft', 'thief', 'chori', 'chor', 'police',
  'guard', 'securityguard', 'stranger', 'suspicious', 'anjaan', 'shakki',
  'dog', 'dogs', 'straydog', 'kutta', 'kutte', 'bite', 'speedbreaker',
  'breaker', 'cctv', 'camera', 'safe', 'unsafe', 'accident', 'fire',
  'aag', 'smoke', 'helmet', 'robbery', 'snatching', 'kid', 'kids',
  'suraksha', 'surakshit', 'સુરક્ષા', 'ચોરી', 'પોલીસ', 'કૂતરા', 'સાવધાન'
];

const eventKeywords = [
  'event', 'events', 'match', 'cricket', 'boxcricket', 'tournament',
  'badminton', 'football', 'sports', 'game', 'garba', 'navratri',
  'diwali', 'holi', 'celebration', 'party', 'gathering', 'meeting',
  'agm', 'puja', 'pooja', 'aarti', 'bhajan', 'satsang', 'festival',
  'festive', 'amphitheatre', 'clubhouse', 'turf', 'invitation', 'invite',
  'bhojan', 'dinner', 'lunch', 'sunday', 'weekend', 'celebrate', 'function',
  'કાર્યક્રમ', 'ગરબા', 'મેચ', 'ટુર્નામેન્ટ', 'પૂજા', 'આરતી', 'સભા'
];

const questionKeywords = [
  '?', 'kahan', 'kidhar', 'kaun', 'kisko', 'kaise', 'kyun', 'kya',
  'kaisa', 'kaisi', 'recommend', 'recommendation', 'suggest', 'suggestion',
  'best', 'good', 'review', 'advice', 'help', 'chahiye', 'need',
  'looking', 'anyone', 'anybody', 'pata', 'maloom', 'batao', 'batana',
  'contact', 'number', 'address', 'where', 'who', 'how', 'which',
  'what', 'why', 'can', 'does', 'કોણ', 'ક્યાં', 'કેવી', 'કેમ', 'સુ',
  'મદદ', 'સારો', 'સારી', 'નંબર'
];

function scoreKeywords(text: string, list: string[]): number {
  let score = 0;
  const lower = text.toLowerCase();
  for (const item of list) {
    if (lower.includes(item)) {
      score += 2;
    }
  }
  return score;
}

function detectLanguageFromText(text: string): string {
  let gu = 0;
  let hi = 0;
  let en = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x0A80 && code <= 0x0AFF) gu++;
    else if (code >= 0x0900 && code <= 0x097F) hi++;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) en++;
  }
  if (gu > 2) return 'gu';
  if (hi > 2) return 'hi';
  const lower = text.toLowerCase();
  if (lower.includes('hai') || lower.includes('hain') || lower.includes('chhe') || lower.includes('kaale')) {
    return 'hi-Latn';
  }
  return en > 0 ? 'en' : 'hi';
}

function classifyPostText(text: string): { category: string; confidence: number } {
  const clean = text.trim();
  if (!clean) return { category: 'general', confidence: 1.0 };

  if (clean.includes('?')) {
    const isAlert = alertKeywords.some((k) => clean.toLowerCase().includes(k));
    if (!isAlert) {
      return { category: 'question', confidence: 0.95 };
    }
  }

  const alertScore = scoreKeywords(clean, alertKeywords);
  const safetyScore = scoreKeywords(clean, safetyKeywords);
  const eventScore = scoreKeywords(clean, eventKeywords);
  const questionScore = scoreKeywords(clean, questionKeywords);

  if (alertScore > 0 && alertScore >= safetyScore && alertScore >= eventScore && alertScore >= questionScore) {
    return { category: 'alerts', confidence: 0.92 };
  }
  if (safetyScore > 0 && safetyScore >= eventScore && safetyScore >= questionScore) {
    return { category: 'safety', confidence: 0.90 };
  }
  if (eventScore > 0 && eventScore >= questionScore) {
    return { category: 'events', confidence: 0.88 };
  }
  if (questionScore > 0) {
    return { category: 'question', confidence: 0.85 };
  }

  return { category: 'general', confidence: 0.80 };
}

aiApp.post('/classify', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const text = (body.text || '').toString();
    const language = detectLanguageFromText(text);
    const classification = classifyPostText(text);

    return c.json({
      success: true,
      text,
      language,
      category: classification.category,
      confidence: classification.confidence,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to classify' }, 400);
  }
});
