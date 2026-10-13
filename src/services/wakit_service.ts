import { AppConfig } from '../utils/config';

export interface WakitSendResult {
  success: boolean;
  requestId?: string;
  expiresAt?: string;
  channel?: string;
  error?: string;
}

export interface WakitVerifyParams {
  id?: string;
  code: string;
  to?: string;
}

export interface WakitVerifyResult {
  success: boolean;
  verified: boolean;
  status?: string;
  error?: string;
}

export class WakitService {
  private static get isDev(): boolean {
    return process.env.ENVIRONMENT === 'development' || process.env.NODE_ENV === 'development';
  }

  public static get apiKey(): string {
    return (process.env.WAKIT_API_KEY || '').trim();
  }

  public static get baseUrl(): string {
    return (process.env.WAKIT_BASE_URL || 'https://wakit.in/api/v1').trim().replace(/\/+$/, '');
  }

  public static isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  public static normalizeIndianPhone(phoneNumber: string): { ok: boolean; tenDigits: string; e164: string } {
    const raw = (phoneNumber || '').replace(/\D/g, '');
    let tenDigits = raw;
    if (raw.length === 12 && raw.startsWith('91')) {
      tenDigits = raw.slice(2);
    } else if (raw.length === 11 && raw.startsWith('0')) {
      tenDigits = raw.slice(1);
    } else if (raw.length > 10) {
      tenDigits = raw.slice(-10);
    }

    const isValid = tenDigits.length === 10 && /^[6-9]\d{9}$/.test(tenDigits);
    return {
      ok: isValid,
      tenDigits,
      e164: `+91${tenDigits}`,
    };
  }

  public static async sendOtp(phoneNumber: string): Promise<WakitSendResult> {
    const normalized = this.normalizeIndianPhone(phoneNumber);
    if (!normalized.ok) {
      return { success: false, error: 'Enter a valid 10-digit Indian mobile number' };
    }

    const testPhones = ['0000000000', '9999999999'];
    const testOtpEnabled =
      !AppConfig.isProduction && (process.env.ALLOW_TEST_OTP || '').trim().toLowerCase() === 'true';
    if (testOtpEnabled && testPhones.includes(normalized.tenDigits)) {
      return {
        success: true,
        requestId: `test_wakit_${Date.now()}`,
        channel: 'whatsapp',
      };
    }

    const key = this.apiKey;
    if (!key) {
      if (this.isDev) {
        return {
          success: true,
          requestId: `sim_wakit_${Date.now()}`,
          channel: 'whatsapp',
        };
      }
      return {
        success: false,
        error: 'WAKIT_API_KEY is not configured on server',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${this.baseUrl}/otp/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          to: normalized.e164,
        }),
        signal: controller.signal,
      });

      const data: any = await response.json().catch(() => ({}));

      if (response.ok && data.success === true && data.data?.id) {
        return {
          success: true,
          requestId: String(data.data.id),
          expiresAt: data.data.expires_at,
          channel: data.data.channel || 'whatsapp',
        };
      }

      const errorMessage =
        data.error?.message ||
        data.message ||
        (Array.isArray(data.errors) ? data.errors.join(', ') : '') ||
        `Wakit dispatch failed (HTTP ${response.status})`;

      return {
        success: false,
        error: errorMessage,
      };
    } catch (error: any) {
      const isAbort = error.name === 'AbortError';
      return {
        success: false,
        error: isAbort ? 'Wakit OTP request timed out. Please try again.' : 'Network error reaching Wakit WhatsApp gateway',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public static async verifyOtp({ id, code, to }: WakitVerifyParams): Promise<WakitVerifyResult> {
    const cleanCode = (code || '').trim();
    if (!cleanCode || cleanCode.length < 4 || cleanCode.length > 8) {
      return {
        success: false,
        verified: false,
        error: 'Invalid OTP format',
      };
    }

    const key = this.apiKey;
    if (!key) {
      if (this.isDev && (cleanCode === '123456' || cleanCode === '000000')) {
        return {
          success: true,
          verified: true,
          status: 'verified',
        };
      }
      return {
        success: false,
        verified: false,
        error: 'WAKIT_API_KEY is not configured on server',
      };
    }

    const payload: Record<string, any> = {
      code: cleanCode,
    };

    const isUuid = id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
    if (isUuid) {
      payload.id = id!.trim();
    }

    if (to) {
      const normalized = this.normalizeIndianPhone(to);
      if (normalized.ok) {
        payload.to = normalized.e164;
      }
    }

    if (!payload.id && !payload.to) {
      return {
        success: false,
        verified: false,
        error: 'Missing verification identifier',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${this.baseUrl}/otp/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data: any = await response.json().catch(() => ({}));

      if (response.ok && data.success === true) {
        const isVerified = data.data?.verified === true || data.data?.status === 'verified';
        const status = data.data?.status || (isVerified ? 'verified' : 'failed');
        return {
          success: true,
          verified: isVerified,
          status,
          error: isVerified ? undefined : (status === 'expired' ? 'OTP has expired. Please request a new one.' : 'Incorrect OTP code. Please try again.'),
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          verified: false,
          error: 'No active OTP found for this number or session has expired.',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          verified: false,
          error: 'Too many verification attempts. Please request a new OTP.',
        };
      }

      const errorMessage =
        data.error?.message ||
        data.message ||
        `Verification request failed (HTTP ${response.status})`;

      return {
        success: false,
        verified: false,
        error: errorMessage,
      };
    } catch (error: any) {
      const isAbort = error.name === 'AbortError';
      return {
        success: false,
        verified: false,
        error: isAbort ? 'Wakit verification timed out. Please try again.' : 'Network error verifying OTP with WhatsApp gateway',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
