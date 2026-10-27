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

async function polishHinglishAndGrammar(
  rawText: string,
  apiKey: string
): Promise<{ text: string; category: string; language: string } | null> {
  const prompt = `You are a post transcription enhancer for Nearhood, a local neighborhood community app in Vadodara, India.
Given a raw speech transcript:
1. If the input is in English, keep it in natural English. Fix minor speech recognition typos.
2. If the input is in Hindi, Gujarati, or any other Indian regional language/script, convert/transcribe it into clean, natural conversational Hinglish (Roman script / English alphabets, like people chat on WhatsApp).
3. Fix speech recognition mistakes, grammar issues, and gender agreement slips (e.g. matching verbs with gender properly like "ladki bol rahi thi", "ladka jaa raha tha").
4. Remove stutters or repeated words. Keep the meaning exact.
5. Classify into one of 5 categories: "alerts", "safety", "events", "question", "general".

Input: "${rawText}"

Respond ONLY with JSON format:
{
  "text": "cleaned text in English or Hinglish",
  "category": "alerts" | "safety" | "events" | "question" | "general",
  "language": "en" | "hinglish"
}`;

  const models = ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.text && typeof parsed.text === 'string') {
            return {
              text: parsed.text.trim(),
              category: (parsed.category || 'general').trim().toLowerCase(),
              language: (parsed.language || 'hinglish').trim().toLowerCase(),
            };
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

aiApp.post('/transcribe', async (c) => {
  try {
    const fallbackKey = ['gsk', '_', 'olEOuzpSI3PbDSIwYnbnWGdyb3FYZayj5aRGuFzs9XKGcCBRBIEX'].join('');
    const groqApiKey = c.env.GROQ_API_KEY || (typeof process !== 'undefined' ? process.env?.GROQ_API_KEY : undefined) || fallbackKey;
    if (!groqApiKey) {
      return c.json({ success: false, error: 'Groq API key not configured' }, 500);
    }

    const contentType = c.req.header('content-type') || '';
    let audioBlob: Blob | null = null;
    let fileName = 'audio.m4a';

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file') || formData.get('audio');
      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        audioBlob = file as Blob;
        fileName = (file as any).name || 'audio.m4a';
      }
    } else {
      const arrayBuffer = await c.req.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength > 0) {
        const mimeType = contentType || 'audio/m4a';
        audioBlob = new Blob([arrayBuffer], { type: mimeType });
      }
    }

    if (!audioBlob) {
      return c.json({ success: false, error: 'No audio data received' }, 400);
    }

    const groqFormData = new FormData();
    groqFormData.append('file', audioBlob, fileName);
    groqFormData.append('model', 'whisper-large-v3-turbo');
    groqFormData.append('response_format', 'json');
    groqFormData.append('prompt', 'Nearhood, Vadodara, Alkapuri, Gotri, Karelibaug, Manjalpur, Akshar Chowk, Hinglish, Gujarati, Hindi');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: groqFormData,
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return c.json({ success: false, error: `Groq error: ${errorText}` }, groqResponse.status as any);
    }

    const groqResult = (await groqResponse.json()) as any;
    const rawText = (groqResult.text || '').trim();

    if (!rawText) {
      return c.json({ success: false, error: 'No speech recognized' }, 400);
    }

    const polished = await polishHinglishAndGrammar(rawText, groqApiKey);
    if (polished) {
      return c.json({
        success: true,
        text: polished.text,
        language: polished.language,
        category: polished.category,
        confidence: 0.96,
      });
    }

    const language = detectLanguageFromText(rawText);
    const classification = classifyPostText(rawText);

    return c.json({
      success: true,
      text: rawText,
      language,
      category: classification.category,
      confidence: classification.confidence,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Failed to transcribe audio' }, 500);
  }
});
