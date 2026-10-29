import { describe, expect, it } from 'vitest';
import { formatRupees, parseAmountExpression } from '../shared/money.ts';
import { hashPin, isValidPin, verifyPin } from '../shared/pin.ts';
import { addDays, isValidIsoDate, season, seasonOf, todayInIndia } from '../shared/season.ts';
import { lockDurationMs } from '../shared/lockout.ts';
import { toDevanagari } from '../shared/devanagari.ts';

describe('parseAmountExpression', () => {
  it('reads plain and formatted amounts', () => {
    expect(parseAmountExpression('2100')).toBe(210000);
    expect(parseAmountExpression('₹2,100')).toBe(210000);
    expect(parseAmountExpression('12.5')).toBe(1250);
  });
  it('adds and multiplies the way the ledger notes are written', () => {
    expect(parseAmountExpression('800+700+600')).toBe(210000);
    expect(parseAmountExpression('3*600')).toBe(180000);
    expect(parseAmountExpression('3x600 + 500')).toBe(230000);
  });
  it('rejects empty, zero, malformed and absurd input', () => {
    for (const bad of ['', '0', '+', '800+', '8..0', 'abc', '5-2', '1.234', '999999999999']) {
      expect(parseAmountExpression(bad), bad).toBeNull();
    }
  });
});

describe('formatRupees', () => {
  it('uses Indian digit grouping', () => {
    expect(formatRupees(17_22_023_00)).toBe('₹17,22,023');
    expect(formatRupees(-500_00)).toBe('−₹500');
    expect(formatRupees(500_00, { sign: true })).toBe('+₹500');
  });
});

describe('season', () => {
  it('runs December to November and is named after the year it ends in', () => {
    const s = season(2026);
    expect(s.from).toBe('2025-12-01');
    expect(s.to).toBe('2026-12-01');
    expect(s.months).toHaveLength(12);
    expect(s.months[0]).toBe('2025-12');
    expect(s.months[11]).toBe('2026-11');
  });
  it('places a date in its season', () => {
    expect(seasonOf('2025-12-01')).toBe(2026);
    expect(seasonOf('2026-11-30')).toBe(2026);
    expect(seasonOf('2026-12-01')).toBe(2027);
  });
  it('validates and shifts dates', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('uses the farm\'s date, not UTC', () => {
    // 20:00 UTC on 28 Oct is 01:30 on 29 Oct in India.
    expect(todayInIndia(new Date('2026-10-28T20:00:00Z'))).toBe('2026-10-29');
  });
});

describe('PIN', () => {
  it('accepts only four digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
  it('verifies the right PIN and rejects others', async () => {
    const hash = await hashPin('4821');
    expect(await verifyPin('4821', hash)).toBe(true);
    expect(await verifyPin('4822', hash)).toBe(false);
    expect(await verifyPin('4821', 'garbage')).toBe(false);
    expect(await hashPin('4821')).not.toBe(hash); // salted
  });
});

describe('lockDurationMs', () => {
  it('locks every 5 failures, doubling, capped at a day', () => {
    expect(lockDurationMs(4)).toBe(0);
    expect(lockDurationMs(5)).toBe(15 * 60_000);
    expect(lockDurationMs(6)).toBe(0);
    expect(lockDurationMs(10)).toBe(30 * 60_000);
    expect(lockDurationMs(100)).toBe(24 * 60 * 60_000);
  });
});

describe('toDevanagari', () => {
  it('spells common names the way they are written in Hindi', () => {
    const cases: [string, string][] = [
      ['Samarth', 'समर्थ'], ['Vikas', 'विकास'], ['Sanjay', 'संजय'], ['Lakshmi', 'लक्ष्मी'], ['Pooja', 'पूजा'],
      ['Ramesh Kumar', 'रमेश कुमार'], ['Mohan Lal', 'मोहन लाल'], ['Neelam', 'नीलम'], ['Kamla Devi', 'कम्ला देवी'],
      ['Promila Madam', 'प्रोमिला मैडम'], ['Rajinder Singh', 'रजिंदेर सिंह'],
    ];
    for (const [latin, hindi] of cases) expect(toDevanagari(latin)).toBe(hindi);
  });
  it('leaves a name already in Hindi alone', () => {
    expect(toDevanagari('समर्थ')).toBe('समर्थ');
  });
});
