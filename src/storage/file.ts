import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Show } from '../types.js';

const DATA_DIR = 'data/posters';

export async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

export async function getStoredShows(month: string): Promise<Show[]> {
  try {
    const filePath = join(DATA_DIR, `posters-${month}.json`);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function storeShows(month: string, shows: Show[]) {
  await ensureDataDir();
  const filePath = join(DATA_DIR, `posters-${month}.json`);
  await writeFile(filePath, JSON.stringify(shows, null, 2));
} 