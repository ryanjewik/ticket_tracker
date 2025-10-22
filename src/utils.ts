import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(process.cwd(), '.session_data');

export function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
  }
}
// naive eTLD+1 (last two labels is fine for these domains)
function siteKeyFromUrl(url: string) {
  const { hostname } = new URL(url);
  const parts = hostname.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

export type SitePaths = {
  baseDir: string;
  siteDir: string;
  cookies: string; // JSON file path for cookies
  ls: string;      // JSON file path for localStorage
};

export function sitePaths(siteKey: string): SitePaths {
  // Allow override of the base dir; default to ".session_data" under the project cwd
  const baseDir = process.env.SESSION_BASE_DIR
    ? path.resolve(process.env.SESSION_BASE_DIR)
    : path.join(process.cwd(), '.session_data');

  const siteDir = path.join(baseDir, siteKey);
  ensureDir(siteDir);

  // Files we read/write for persistence
  const cookies = path.join(siteDir, 'cookies.json');
  const ls = path.join(siteDir, 'localstorage.json');

  // Ensure their parent dirs exist (siteDir already exists; this is belt & suspenders)
  ensureDir(path.dirname(cookies));
  ensureDir(path.dirname(ls));

  return { baseDir, siteDir, cookies, ls };
}

function saveJSON(p: string, v: any) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}
function readJSON<T = any>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export { ROOT_DIR, siteKeyFromUrl, saveJSON, readJSON };