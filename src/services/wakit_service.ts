/**
 * Wakit WhatsApp OTP Gateway Service
 * Interfaces with https://wakit.in/api/v1 for sending & verifying 6-digit WhatsApp OTPs
 */

export interface WakitSendOtpResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

export class WakitService {
  private static get isDev(): boolean {
    return (process.env.ENVIRONMENT === 'development' || process.env.NODE_ENV === 'development');
  }

  private static get apiKey(): string {
    return (process.env.WAKIT_API_KEY || '').trim();
  }

  public static isConfigured(): boolean {
    return (process.env.WAKIT_API_KEY || '').trim().length > 0;
  }

  private static get baseUrl(): string {
    return (process.env.WAKIT_BASE_URL || 'https://wakit.in/api/v1').replace(/\/+$/, '');
  }

  /**
   * Send 6-digit OTP code to Indian phone number (+91XXXXXXXXXX) via WhatsApp
   */
  public static async sendOtp(phoneNumber: string): Promise<WakitSendOtpResult> {
    const cleanDigits = phoneNumber.replace(/\D/g, '');
    const e164 = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;

    // Test numbers bypass ONLY allowed in explicit non-production development environments
    const testPhones = ['+910000000000', '+919999999999'];
    if (this.isDev && testPhones.includes(e164)) {
      const testReqId = `test_otp_${Date.now()}_${Math.floor(100000 + Math.random() * 900000)}`;
      return { success: true, requestId: testReqId };
    }

    const apiKey = this.apiKey;
    if (!apiKey) {
      if (this.isDev) {
        console.warn('[WakitService] WAKIT_API_KEY is not set in development mode. Using dev request ID.');
        const devReqId = `dev_otp_${Date.now()}_${Math.floor(100000 + Math.random() * 900000)}`;
        return { success: true, requestId: devReqId };
      }
      console.error('[WakitService] WAKIT_API_KEY is required in production.');
      return {
        success: false,
        error: 'OTP Service is misconfigured. Please contact support.',
      };
    }

    const url = `${this.baseUrl}/otp/send`;
    const payload = {
      to: e164,
      phone_number: e164,
      code_length: 6,
      expiry_seconds: 300,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await response.json().catch(() => ({}));
      if (response.ok && (data.success !== false)) {
        const reqData = data.data || {};
        const requestId = data.request_id || data.id || reqData.request_id || reqData.id || `req_${Date.now()}`;
        return {
          success: true,
          requestId: String(requestId),
        };
      } else {
        const errMsg = data.error || data.message || `HTTP ${response.status}`;
        console.error('[WakitService] OTP send failed:', errMsg);
        return {
          success: false,
          error: errMsg,
        };
      }
    } catch (e: any) {
      console.error('[WakitService] Network error during send:', e);
      return {
        success: false,
        error: e.message || 'Network error connecting to OTP gateway',
      };
    }
  }

  /**
   * Verify OTP submitted by user
   */
  public static async verifyOtp(requestId: string, otp: string, phoneNumber?: string): Promise<boolean> {
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      return false;
    }

    const cleanPhone = phoneNumber ? (phoneNumber.replace(/\D/g, '').length === 10 ? `+91${phoneNumber.replace(/\D/g, '')}` : `+${phoneNumber.replace(/\D/g, '')}`) : '';

    // Dev test numbers verification ONLY in explicit development environment
    if (this.isDev) {
      const devTestPhones = ['+910000000000', '+919999999999'];
      if ((requestId.startsWith('test_otp_') || requestId.startsWith('dev_otp_')) && (devTestPhones.includes(cleanPhone) || !cleanPhone)) {
        return cleanOtp === '123456';
      }
    }

    const apiKey = this.apiKey;
    if (!apiKey) {
      console.error('[WakitService] Cannot verify OTP without WAKIT_API_KEY in production.');
      return false;
    }

    const url = `${this.baseUrl}/otp/verify`;
    const payload: any = {
      request_id: requestId,
      id: requestId,
      code: cleanOtp,
      otp: cleanOtp,
    };

    if (phoneNumber) {
      const cleanDigits = phoneNumber.replace(/\D/g, '');
      const e164 = cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`;
      payload.to = e164;
      payload.phone_number = e164;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await response.json().catch(() => ({}));
      if (response.ok) {
        const d = data.data || {};
        const isValid =
          d.verified === true ||
          d.valid === true ||
          d.status === 'verified' ||
          data.verified === true ||
          data.valid === true ||
          data.status === 'verified' ||
          (data.success === true && !data.error);

        return Boolean(isValid);
      }
    } catch (e) {
      console.error('[WakitService] Error verifying OTP:', e);
    }

    return false;
  }
}

