import { describe, expect, it } from 'vitest';
import { buildReport, routePattern } from './monitoring';

describe('error monitoring', () => {
  it('removes ids and query strings from routes', () => {
    expect(routePattern('/patients/7d1c2b8e-2f62-4d1a-9b4b-0d6b9a7f1e21?q=Sunita%20Pawar')).toBe('/patients/:id');
    expect(routePattern('/print/invoices/7d1c2b8e-2f62-4d1a-9b4b-0d6b9a7f1e21#top')).toBe('/print/invoices/:id');
  });

  it('never includes messages or values that may contain patient data', () => {
    const err = Object.assign(new Error('duplicate key (phone)=(+91 98220 10001) for Sunita Pawar'), { code: '23505', details: 'Key (phone)=(+91 98220 10001)' });
    const report = buildReport(err, 'mutation', '/patients/7d1c2b8e-2f62-4d1a-9b4b-0d6b9a7f1e21');
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/98220|Sunita|duplicate|7d1c2b8e/);
    expect(report).toMatchObject({ kind: 'Error', code: '23505', route: '/patients/:id', source: 'mutation' });
  });

  it('drops codes that are not short identifiers', () => {
    expect(buildReport({ code: 'Sunita Pawar 98220' }, 'query', '/').code).toBeUndefined();
  });
});
