import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  ageFromDob,
  formatDate,
  formatINR,
  formatTime,
  fullName,
  initials,
  istDateTimeToISO,
  isoToIstParts,
  maskPhone,
  rupeesToPaise,
  setDisplayTimeZone,
  todayISO,
} from './index';

describe('formatters', () => {
  it('formats dates as DD/MM/YYYY in IST', () => {
    expect(formatDate('2026-03-09')).toBe('09/03/2026');
    // 20:00 UTC is 01:30 next day in IST
    expect(formatDate('2026-03-09T20:00:00Z')).toBe('10/03/2026');
    expect(formatDate(null)).toBe('—');
  });

  it('formats time in IST', () => {
    expect(formatTime('2026-03-09T04:30:00Z')).toBe('10:00 AM');
  });

  it('formats INR with Indian grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(50000, { whole: true })).toBe('₹500');
  });

  it('converts rupees to paise without float drift', () => {
    expect(rupeesToPaise('1,250.50')).toBe(125050);
    expect(rupeesToPaise(0.29)).toBe(29);
    expect(Number.isNaN(rupeesToPaise('abc'))).toBe(true);
  });

  it('computes today and date arithmetic in IST', () => {
    expect(todayISO(new Date('2026-10-25T19:00:00Z'))).toBe('2026-10-26');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('round-trips IST date/time parts', () => {
    const iso = istDateTimeToISO('2026-11-02', '10:30');
    expect(iso).toBe('2026-11-02T05:00:00.000Z');
    expect(isoToIstParts(iso)).toEqual({ date: '2026-11-02', time: '10:30' });
  });

  it('follows the clinic time zone when it is not IST', () => {
    setDisplayTimeZone('Asia/Dubai');
    try {
      expect(formatTime('2026-03-09T04:30:00Z')).toBe('8:30 AM');
      expect(istDateTimeToISO('2026-11-02', '10:30')).toBe('2026-11-02T06:30:00.000Z');
      expect(isoToIstParts('2026-11-02T06:30:00.000Z')).toEqual({ date: '2026-11-02', time: '10:30' });
    } finally {
      setDisplayTimeZone(null);
    }
  });

  it('computes age', () => {
    expect(ageFromDob('1990-10-26', '2026-10-25')).toBe(35);
    expect(ageFromDob('1990-10-25', '2026-10-25')).toBe(36);
    expect(ageFromDob(null)).toBeNull();
  });

  it('formats names and initials', () => {
    expect(fullName({ first_name: 'Sunita', last_name: 'Pawar' })).toBe('Sunita Pawar');
    expect(fullName({ first_name: 'Lata', last_name: '' })).toBe('Lata');
    expect(initials('Dr. Meera Joshi')).toBe('MJ');
  });

  it('masks phone numbers', () => {
    expect(maskPhone('+91 98220 10001')).toBe('••••• 0001');
  });
});
