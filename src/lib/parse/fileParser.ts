import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface RawParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
}

export async function parseUploadedFile(file: File): Promise<RawParsedFile> {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  if (isXlsx) {
    return parseXlsx(file);
  }
  return parseCsv(file);
}

function parseCsv(file: File): Promise<RawParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        const headers = (results.meta.fields ?? []).filter(Boolean);
        resolve({ headers, rows: results.data.filter((r) => Object.values(r).some((v) => v !== '' && v !== null && v !== undefined)) });
      },
      error: (err: Error) => reject(err),
    });
  });
}

async function parseXlsx(file: File): Promise<RawParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}
