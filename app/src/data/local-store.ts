import Storage from 'expo-sqlite/kv-store';
import type { AppData, Entry } from '@/types/entry';

const DATA_KEY = 'nho-nha.data.v1';
const sampleColors: Record<string, string> = {
  'sample-call-mom': '#B94A2B',
  'sample-vitamins': '#C8891D',
  'sample-coffee': '#466A4D',
  'sample-note': '#70517A',
};

const now = new Date();
const todayAt = (hour: number, minute = 0) => {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

export const starterData: AppData = {
  theme: 'the-anh',
  entries: [
    {
      id: 'sample-call-mom', kind: 'task', title: 'Gọi cho mẹ', body: '', status: 'todo', priority: 'high',
      color: '#E8927E', dueAt: todayAt(10, 30), imageUris: [], createdAt: now.toISOString(),
    },
    {
      id: 'sample-vitamins', kind: 'routine', title: 'Uống vitamin', body: 'Nhớ uống sau bữa sáng nha 🍊', status: 'todo', priority: 'normal',
      color: '#EFC65D', dueAt: todayAt(12), repeat: 'daily', imageUris: [], createdAt: now.toISOString(),
    },
    {
      id: 'sample-coffee', kind: 'event', title: 'Hẹn cà phê với Mai', body: '', status: 'todo', priority: 'normal',
      color: '#8FA28A', dueAt: todayAt(16), imageUris: [], createdAt: now.toISOString(),
    },
    {
      id: 'sample-note', kind: 'note', title: 'Ý tưởng cuối tuần', body: 'Đi dạo vườn hoa rồi tìm quán bánh mới 🌼', status: 'todo', priority: 'low',
      color: '#B69AB8', imageUris: [], createdAt: now.toISOString(),
    },
  ],
};

export async function loadAppData(): Promise<AppData> {
  try {
    const saved = await Storage.getItem(DATA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as AppData;
      const entries = parsed.entries.map((entry) => sampleColors[entry.id] ? { ...entry, color: sampleColors[entry.id] } : entry);
      const theme = ['peach', 'nho'].includes(parsed.theme as string) ? 'the-anh' : parsed.theme;
      const migrated = { ...parsed, theme, entries };
      if (theme !== parsed.theme || entries.some((entry, index) => entry.color !== parsed.entries[index]?.color)) await saveAppData(migrated);
      return migrated;
    }
  } catch (error) {
    console.warn('Could not load local app data', error);
  }
  await saveAppData(starterData);
  return starterData;
}

export async function saveAppData(data: AppData): Promise<void> {
  await Storage.setItem(DATA_KEY, JSON.stringify(data));
}

export function makeEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function updateEntries(entries: Entry[], entry: Entry): Entry[] {
  const existing = entries.some((item) => item.id === entry.id);
  return existing ? entries.map((item) => item.id === entry.id ? entry : item) : [entry, ...entries];
}
