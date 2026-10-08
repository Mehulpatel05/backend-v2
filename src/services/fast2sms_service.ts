/**
 * Fast2SMS Gateway Service
 * Interfaces with https://www.fast2sms.com/dev/bulkV2 for sending SMS OTPs
 * Supports both:
 * - Route "otp": Pre-approved Fast2SMS DLT-free OTP route
 * - Route "q": Quick custom text message ("Your Nearhood verification code is...")
 */

import { AppConfig } from '../utils/config';

export interface Fast2SmsSendResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

export class Fast2SmsService {
  private static get isDev(): boolean {
    return (process.env.ENVIRONMENT === 'development' || process.env.NODE_ENV === 'development');
  }

  public static get apiKey(): string {
    return (process.env.FAST2SMS_API_KEY || '').trim();
  }

  private static get baseUrl(): string {
    return (process.env.FAST2SMS_BASE_URL || 'https://www.fast2sms.com/dev/bulkV2').trim();
  }

  public static get senderId(): string {
    return (process.env.FAST2SMS_SENDER_ID || '').trim();
  }

  public static get templateId(): string {
    return (process.env.FAST2SMS_TEMPLATE_ID || process.env.FAST2SMS_MESSAGE_ID || '').trim();
  }

  private static get route(): string {
    return (process.env.FAST2SMS_ROUTE || 'q').trim().toLowerCase();
  }

  public static isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Send 6-digit OTP code to Indian phone number (+91XXXXXXXXXX or 10-digit)
   */
  public static async sendOtp(phoneNumber: string, otpCode: string): Promise<Fast2SmsSendResult> {
    const cleanDigits = phoneNumber.replace(/\D/g, '');
    const tenDigits = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;

    if (tenDigits.length !== 10) {
      return { success: false, error: 'Valid 10-digit phone number is required' };
    }

    // Review/QA numbers: only honoured when explicitly enabled outside
    // production, matching the gate in modules/auth (ALLOW_TEST_OTP).
    const testPhones = ['0000000000', '9999999999'];
    const testOtpEnabled =
      !AppConfig.isProduction && (process.env.ALLOW_TEST_OTP || '').trim().toLowerCase() === 'true';
    if (testOtpEnabled && testPhones.includes(tenDigits)) {
      const testReqId = `test_fast2sms_${Date.now()}`;
      return { success: true, requestId: testReqId };
    }

    const apiKey = this.apiKey;
    if (!apiKey) {
      if (this.isDev) {
        console.warn('[Fast2SmsService] FAST2SMS_API_KEY is not set in development mode. Simulating success.');
        return { success: true, requestId: `sim_${Date.now()}` };
      }
      return {
        success: false,
        error: 'FAST2SMS_API_KEY is not configured on server.',
      };
    }

    // Build payload according to selected route
    let payload: any;
    if (this.route === 'dlt') {
      if (!this.senderId || !this.templateId) {
        console.error('[Fast2SmsService] FAST2SMS_SENDER_ID and FAST2SMS_TEMPLATE_ID are required for DLT route.');
        return {
          success: false,
          error: 'DLT SMS configuration missing: FAST2SMS_SENDER_ID and FAST2SMS_TEMPLATE_ID are required.',
        };
      }
      payload = {
        route: 'dlt',
        sender_id: this.senderId,
        message: this.templateId,
        variables_values: otpCode,
        numbers: tenDigits,
      };
    } else if (this.route === 'otp') {
      payload = {
        route: 'otp',
        variables_values: otpCode,
        numbers: tenDigits,
      };
    } else {
      payload = {
        route: 'q',
        message: `Your Nearhood verification code is ${otpCode}. Valid for 5 minutes. Do not share this OTP with anyone.`,
        language: 'english',
        flash: 0,
        numbers: tenDigits,
      };
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'authorization': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await response.json().catch(() => ({}));

      // Fast2SMS returns { "return": true, "request_id": "...", "message": ["SMS sent successfully."] }
      if (response.ok && (data.return === true || data.status_code === 200)) {
        const requestId = data.request_id || `f2s_${Date.now()}`;
        return {
          success: true,
          requestId: String(requestId),
        };
      } else {
        const msg = Array.isArray(data.message) ? data.message.join(', ') : (data.message || data.error || `HTTP ${response.status}`);
        console.error('[Fast2SmsService] Send failed:', msg);
        return {
          success: false,
          error: msg || 'Fast2SMS delivery failed',
        };
      }
    } catch (e: any) {
      console.error('[Fast2SmsService] Network error during send:', e);
      return {
        success: false,
        error: e.message || 'Network error connecting to Fast2SMS gateway',
      };
    }
  }
}
