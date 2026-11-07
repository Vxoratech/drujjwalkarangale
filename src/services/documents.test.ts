import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, sanitizeFileName, validateDocumentFile } from './documents';

describe('sanitizeFileName', () => {
  it('strips directories, control characters and leading dots', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\Asha\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('.hidden.pdf')).toBe('hidden.pdf');
    expect(sanitizeFileName('line\nbreak\t.pdf')).toBe('linebreak.pdf');
    expect(sanitizeFileName('   ')).toBe('document');
  });

  it('keeps the extension when truncating long names', () => {
    const name = sanitizeFileName(`${'a'.repeat(300)}.pdf`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('keeps Marathi filenames intact', () => {
    expect(sanitizeFileName('रक्त तपासणी अहवाल.pdf')).toBe('रक्त तपासणी अहवाल.pdf');
  });
});

describe('validateDocumentFile', () => {
  const file = (type: string, size: number) => ({ type, size }) as File;
  it('accepts PDFs and images up to 10 MB', () => {
    expect(validateDocumentFile(file('application/pdf', 1000))).toBeNull();
    expect(validateDocumentFile(file('image/webp', MAX_DOCUMENT_BYTES))).toBeNull();
  });
  it('rejects other types, empty and oversize files', () => {
    expect(validateDocumentFile(file('application/x-msdownload', 10))).toBe('type');
    expect(validateDocumentFile(file('application/pdf', 0))).toBe('size');
    expect(validateDocumentFile(file('application/pdf', MAX_DOCUMENT_BYTES + 1))).toBe('size');
  });
});
