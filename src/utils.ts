import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(process.cwd(), '.session_data');

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// naive eTLD+1 (last two labels is fine for these domains)
function siteKeyFromUrl(url: string) {
  const { hostname } = new URL(url);
  const parts = hostname.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function sitePaths(siteKey: string) {
  const siteDir = path.join(ROOT_DIR, siteKey);
  ensureDir(siteDir);
  return {
    siteDir,
    cookies: path.join(siteDir, 'cookies.json'),
    ls: path.join(siteDir, 'localstorage.json'),
    networkLog: path.join(siteDir, 'network_log.json'),
  };
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

export { ROOT_DIR, siteKeyFromUrl, sitePaths, saveJSON, readJSON };