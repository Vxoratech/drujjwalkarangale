import { describe, expect, it } from 'vitest';
import { isAuthError, isPermissionError, toUserMessage } from './errors';

describe('toUserMessage', () => {
  it('passes through messages our SQL raises on purpose', () => {
    expect(toUserMessage({ code: '23514', message: 'Payment exceeds the outstanding balance' })).toBe(
      'Payment exceeds the outstanding balance.',
    );
  });

  it('hides raw database detail that may contain patient data', () => {
    const msg = toUserMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "x" Key (phone)=(+91 98220 10001)',
    });
    expect(msg).toBe('This record already exists.');
    expect(msg).not.toContain('98220');
  });

  it('maps overlap violations', () => {
    expect(toUserMessage({ code: '23P01', message: 'conflicting key value violates exclusion constraint' })).toMatch(/overlaps/);
  });

  it('falls back to a generic message', () => {
    expect(toUserMessage({ message: 'weird internal failure' })).toBe('Something went wrong. Please try again.');
    expect(toUserMessage(null)).toBe('Something went wrong. Please try again.');
  });

  it('detects permission errors', () => {
    expect(isPermissionError({ code: '42501' })).toBe(true);
    expect(isPermissionError({ message: 'new row violates row-level security policy' })).toBe(true);
    expect(isPermissionError({ code: '23505' })).toBe(false);
  });
});

describe('isAuthError', () => {
  it('detects expired sessions', () => {
    expect(isAuthError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isAuthError({ status: 401 })).toBe(true);
    expect(isAuthError({ code: '42501' })).toBe(false);
  });

  it('passes through plan-limit messages', () => {
    expect(toUserMessage({ code: 'P0001', message: 'Your plan allows up to 2 doctors' })).toBe('Your plan allows up to 2 doctors.');
  });
});
