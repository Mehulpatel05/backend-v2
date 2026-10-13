import test from 'node:test';
import assert from 'node:assert/strict';
import { WakitService } from '../src/services/wakit_service';

test('WakitService.normalizeIndianPhone handles standard 10-digit mobile numbers', () => {
  const result = WakitService.normalizeIndianPhone('9876543210');
  assert.equal(result.ok, true);
  assert.equal(result.tenDigits, '9876543210');
  assert.equal(result.e164, '+919876543210');
});

test('WakitService.normalizeIndianPhone handles formatted +91 numbers', () => {
  const result = WakitService.normalizeIndianPhone('+91 83065 90731');
  assert.equal(result.ok, true);
  assert.equal(result.tenDigits, '8306590731');
  assert.equal(result.e164, '+918306590731');
});

test('WakitService.normalizeIndianPhone handles numbers starting with leading 0', () => {
  const result = WakitService.normalizeIndianPhone('07600284921');
  assert.equal(result.ok, true);
  assert.equal(result.tenDigits, '7600284921');
  assert.equal(result.e164, '+917600284921');
});

test('WakitService.normalizeIndianPhone rejects invalid Indian mobile prefixes and lengths', () => {
  assert.equal(WakitService.normalizeIndianPhone('1234567890').ok, false);
  assert.equal(WakitService.normalizeIndianPhone('98765').ok, false);
  assert.equal(WakitService.normalizeIndianPhone('').ok, false);
  assert.equal(WakitService.normalizeIndianPhone('abcdefghij').ok, false);
});

test('WakitService.sendOtp rejects invalid phone numbers without making external calls', async () => {
  const result = await WakitService.sendOtp('invalid-phone');
  assert.equal(result.success, false);
  assert.match(result.error || '', /valid 10-digit Indian mobile/i);
});

test('WakitService.verifyOtp rejects invalid OTP formats', async () => {
  const shortResult = await WakitService.verifyOtp({ id: '019f6da2-e20f-717f-8c21-76f93f58992e', code: '12' });
  assert.equal(shortResult.success, false);
  assert.equal(shortResult.verified, false);

  const missingResult = await WakitService.verifyOtp({ code: '123456' });
  assert.equal(missingResult.success, false);
  assert.equal(missingResult.verified, false);
});

test('WakitService.isConfigured checks for API key presence', () => {
  const configured = WakitService.isConfigured();
  assert.equal(typeof configured, 'boolean');
});
