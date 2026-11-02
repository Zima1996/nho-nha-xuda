import Storage from 'expo-sqlite/kv-store';
import * as Notifications from 'expo-notifications';
import type { AppData, Entry } from '@/types/entry';

const DATA_KEY = 'nho-nha.data.v1';
const now = new Date();
export function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const todayAt = (hour: number, minute = 0) => {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

export const starterData: AppData = {
  theme: 'the-anh',
  todayKey: localDayKey(now),
  entries: [
    {
      id: 'sample-call-mom', kind: 'task', title: 'Gọi cho mẹ', body: '', status: 'todo', priority: 'high',
      color: '#E8927E', dueAt: todayAt(10, 30), dayKey: localDayKey(now), imageUris: [], createdAt: now.toISOString(),
    },
    {
      id: 'sample-vitamins', kind: 'routine', title: 'Uống vitamin', body: 'Nhớ uống sau bữa sáng nha 🍊', status: 'todo', priority: 'normal',
      color: '#EFC65D', dueAt: todayAt(12), dayKey: localDayKey(now), repeat: 'daily', imageUris: [], createdAt: now.toISOString(),
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

export function rollOverDailyItems(data: AppData, nextDay = localDayKey()): AppData {
  if (data.todayKey === nextDay) return data;
  const entries = data.entries.flatMap((entry) => {
    if (entry.kind === 'note' || entry.kind === 'event') return [entry];
    const lastDay = entry.dayKey || data.todayKey || nextDay;
    if (lastDay >= nextDay) return [entry];
    if (entry.status === 'done') return [];
    const dueIsPast = !!entry.dueAt && new Date(entry.dueAt).getTime() < new Date(`${nextDay}T00:00:00`).getTime();
    return [{
      ...entry,
      dayKey: nextDay,
      ...(dueIsPast ? { dueAt: undefined, reminderAt: undefined, reminderChoice: undefined, notificationId: undefined } : {}),
    }];
  });
  return { ...data, todayKey: nextDay, entries };
}

async function cancelOldDailyNotifications(before: AppData, after: AppData): Promise<void> {
  const retained = new Set(after.entries.map((entry) => entry.notificationId).filter(Boolean));
  await Promise.all(before.entries
    .filter((entry) => entry.notificationId && !retained.has(entry.notificationId))
    .map((entry) => Notifications.cancelScheduledNotificationAsync(entry.notificationId!).catch(() => undefined)));
}

let saveQueue: Promise<void> = Promise.resolve();

export async function loadAppData(): Promise<AppData> {
  const saved = await Storage.getItem(DATA_KEY);
  if (!saved) {
    const initial = { ...starterData, todayKey: localDayKey() };
    await saveAppData(initial);
    return initial;
  }

  const parsed = JSON.parse(saved) as Partial<AppData>;
  if (!Array.isArray(parsed.entries)) throw new Error('Saved app data is missing its entries list.');
  const validThemes = ['energy', 'nature', 'the-anh'];
  const theme = validThemes.includes(parsed.theme as string)
    ? parsed.theme as AppData['theme']
    : ['peach', 'nho'].includes(parsed.theme as string) ? 'the-anh' : starterData.theme;
  const entries = parsed.entries.map((entry) => ({
    ...entry,
    imageUris: Array.isArray(entry.imageUris) ? entry.imageUris : [],
  }));
  const wasLegacy = !parsed.todayKey;
  const migrated: AppData = {
    ...parsed,
    theme,
    entries: wasLegacy
      ? entries.map((entry) => entry.kind === 'note' || entry.kind === 'event' ? entry : { ...entry, dayKey: localDayKey() })
      : entries,
    todayKey: parsed.todayKey || localDayKey(),
  };
  const normalized = rollOverDailyItems(migrated, localDayKey());
  await cancelOldDailyNotifications(migrated, normalized);
  if (JSON.stringify(normalized) !== saved) await saveAppData(normalized);
  return normalized;
}

export async function saveAppData(data: AppData): Promise<void> {
  const serialized = JSON.stringify(data);
  saveQueue = saveQueue.catch(() => undefined).then(() => Storage.setItem(DATA_KEY, serialized));
  await saveQueue;
}

export function makeEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function updateEntries(entries: Entry[], entry: Entry): Entry[] {
  const existing = entries.some((item) => item.id === entry.id);
  return existing ? entries.map((item) => item.id === entry.id ? entry : item) : [entry, ...entries];
}
