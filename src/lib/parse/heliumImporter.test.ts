import { describe, it, expect } from 'vitest';
import { importHeliumKeywordFile } from './heliumImporter';
import type { RawParsedFile } from './fileParser';

const FILE = { name: 'cerebro_export.csv', size: 4096 };

function commonCerebroFile(): RawParsedFile {
  return {
    headers: ['Keyword Phrase', 'Search Volume', 'ABA Total Click Share', 'Sponsored ASINs', 'Competing Products', 'Title Density', 'Cerebro IQ Score', 'CPR', 'Position', 'Sponsored Rank', 'Suggested PPC bid'],
    rows: [
      { 'Keyword Phrase': 'coconut body butter', 'Search Volume': '1672', 'ABA Total Click Share': '12%', 'Sponsored ASINs': '3', 'Competing Products': '842', 'Title Density': '3.2', 'Cerebro IQ Score': '61', CPR: '14', Position: '4', 'Sponsored Rank': '2', 'Suggested PPC bid': '$0.95' },
    ],
  };
}

describe('importHeliumKeywordFile — common Cerebro CSV', () => {
  it('parses a realistic Cerebro export with all common columns recognized', () => {
    const { meta, rows } = importHeliumKeywordFile(FILE, commonCerebroFile());
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).toHaveLength(0);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.keyword).toBe('coconut body butter');
    expect(r.searchVolume).toBe(1672);
    expect(r.competingProducts).toBe(842);
    expect(r.titleDensity).toBe(3.2);
    expect(r.cerebroIqScore).toBe(61);
    expect(r.cpr).toBe(14);
    expect(r.organicRank).toBe(4); // from "Position"
    expect(r.sponsoredRank).toBe(2);
    expect(r.suggestedBid).toBe(0.95); // "$" stripped by toNullableNumber
  });
});

describe('importHeliumKeywordFile — header variation tolerance', () => {
  it('is case-insensitive, whitespace-tolerant, and recognizes alternate real column names', () => {
    const file: RawParsedFile = {
      headers: ['  keyword   phrase  ', 'MONTHLY SEARCH VOLUME', 'organic Position', 'ppc rank', 'Products', 'suggested bid', 'ASIN'],
      rows: [
        { '  keyword   phrase  ': 'vanilla body lotion', 'MONTHLY SEARCH VOLUME': '980', 'organic Position': '11', 'ppc rank': '5', Products: '640', 'suggested bid': '1.10', ASIN: 'B0GZVBBRZP' },
      ],
    };
    const { meta, rows } = importHeliumKeywordFile(FILE, file);
    expect(meta.status).not.toBe('FORMAT_NOT_RECOGNIZED');
    expect(rows[0].keyword).toBe('vanilla body lotion');
    expect(rows[0].searchVolume).toBe(980);
    expect(rows[0].organicRank).toBe(11);
    expect(rows[0].sponsoredRank).toBe(5);
    expect(rows[0].competingProducts).toBe(640);
    expect(rows[0].suggestedBid).toBe(1.10);
    expect(rows[0].competitorAsin).toBe('B0GZVBBRZP');
  });

  it('safely ignores unknown columns without throwing or corrupting known fields', () => {
    const file: RawParsedFile = {
      headers: ['Keyword Phrase', 'Search Volume', 'Some Unknown Helium Column', 'Another Future Field'],
      rows: [{ 'Keyword Phrase': 'rose body butter', 'Search Volume': '500', 'Some Unknown Helium Column': 'xyz', 'Another Future Field': '123' }],
    };
    const { rows } = importHeliumKeywordFile(FILE, file);
    expect(rows[0].keyword).toBe('rose body butter');
    expect(rows[0].searchVolume).toBe(500);
  });
});

describe('importHeliumKeywordFile — missing optional columns (DEGRADED, never fabricated)', () => {
  it('marks the import DEGRADED and leaves every unavailable optional field as null, never a fabricated 0', () => {
    const file: RawParsedFile = {
      headers: ['Keyword Phrase'],
      rows: [{ 'Keyword Phrase': 'mango body butter' }],
    };
    const { meta, rows } = importHeliumKeywordFile(FILE, file);
    expect(meta.status).toBe('DEGRADED');
    expect(meta.missingOptionalFields).toContain('searchVolume');
    expect(meta.missingOptionalFields).toContain('suggestedBid');
    expect(rows[0].searchVolume).toBeNull();
    expect(rows[0].suggestedBid).toBeNull();
    expect(rows[0].organicRank).toBeNull();
  });
});

describe('importHeliumKeywordFile — no usable keyword column', () => {
  it('returns FORMAT_NOT_RECOGNIZED with a clear missing-field reason and zero rows', () => {
    const file: RawParsedFile = {
      headers: ['Search Volume', 'Competing Products'],
      rows: [{ 'Search Volume': '100', 'Competing Products': '50' }],
    };
    const { meta, rows } = importHeliumKeywordFile(FILE, file);
    expect(meta.status).toBe('FORMAT_NOT_RECOGNIZED');
    expect(meta.missingRequiredFields).toEqual(['keyword']);
    expect(rows).toHaveLength(0);
  });
});

describe('importHeliumKeywordFile — XLSX-shaped input (parser is format-agnostic)', () => {
  it('parses identically whether the RawParsedFile came from CSV or XLSX (fileParser normalizes both to the same shape)', () => {
    // parseUploadedFile() already normalizes CSV and XLSX into the same
    // RawParsedFile shape (see fileParser.ts) before this importer ever
    // sees it, so a raw XLSX-sourced object (numbers as real JS numbers,
    // not strings, which is what SheetJS produces) must parse the same way.
    const file: RawParsedFile = {
      headers: ['Keyword', 'Search Volume', 'Competing Products'],
      rows: [{ Keyword: 'coconut oil for skin', 'Search Volume': 2200, 'Competing Products': 310 }],
    };
    const { rows } = importHeliumKeywordFile({ name: 'cerebro.xlsx', size: 8192 }, file);
    expect(rows[0].keyword).toBe('coconut oil for skin');
    expect(rows[0].searchVolume).toBe(2200);
    expect(rows[0].competingProducts).toBe(310);
  });
});
