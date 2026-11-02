import type { Entry } from '@/types/entry';

type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string };
type GoogleTokenClient = {
  requestAccessToken(options?: { prompt?: string }): void;
};
type GoogleIdentity = {
  oauth2: {
    initTokenClient(options: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: (error: { type?: string; message?: string }) => void;
    }): GoogleTokenClient;
  };
};
type GoogleWindow = Window & { google?: { accounts?: { oauth2?: GoogleIdentity['oauth2'] } } };
type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};
type EventList = { items?: GoogleEvent[]; nextPageToken?: string };

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';

function getGoogleIdentity(): GoogleIdentity | undefined {
  if (typeof window === 'undefined') return undefined;
  const oauth2 = (window as GoogleWindow).google?.accounts?.oauth2;
  return oauth2 ? { oauth2 } : undefined;
}

export async function requestGoogleAccessToken(clientId: string, prompt = 'select_account'): Promise<string> {
  if (!clientId) throw new Error('Thiếu Google OAuth Client ID.');
  if (typeof window === 'undefined') throw new Error('Đăng nhập Google chỉ dùng được trong app web.');
  let google = getGoogleIdentity();
  for (let attempt = 0; !google && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    google = getGoogleIdentity();
  }
  if (!google) throw new Error('Chưa tải được dịch vụ đăng nhập Google. Hãy kiểm tra kết nối mạng rồi thử lại.');

  return new Promise((resolve, reject) => {
    const tokenClient = google.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error(response.error_description || response.error || 'Google chưa cấp quyền truy cập.'));
      },
      error_callback: (error) => reject(new Error(error.message || 'Không mở được cửa sổ đăng nhập Google.')),
    });
    tokenClient.requestAccessToken({ prompt });
  });
}

async function googleFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    let message = `Google Calendar báo lỗi (${response.status}).`;
    try {
      const result = await response.json() as { error?: { message?: string } };
      message = result.error?.message || message;
    } catch { /* Keep the simple status message. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function getGoogleAccountEmail(token: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Không đọc được tài khoản Google vừa đăng nhập.');
  const profile = await response.json() as { email?: string };
  return profile.email || '';
}

export async function deleteGoogleCalendarEvent(token: string, eventId: string): Promise<void> {
  const response = await fetch(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 410) {
    let message = `Google Calendar báo lỗi (${response.status}).`;
    try { const result = await response.json() as { error?: { message?: string } }; message = result.error?.message || message; } catch { /* Keep the status message. */ }
    throw new Error(message);
  }
}

function startDate(event: GoogleEvent): string | undefined {
  if (event.start?.dateTime) return event.start.dateTime;
  if (event.start?.date) return new Date(`${event.start.date}T09:00:00`).toISOString();
  return undefined;
}

function toGoogleEvent(entry: Entry) {
  const start = new Date(entry.dueAt!);
  const end = entry.endAt ? new Date(entry.endAt) : new Date(start.getTime() + 30 * 60 * 1000);
  return {
    summary: entry.title,
    description: entry.body || undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { nhoNhaEntryId: entry.id } },
  };
}

export async function updateGoogleCalendarEvent(token: string, entry: Entry): Promise<void> {
  if (!entry.googleEventId || !entry.dueAt) return;
  await googleFetch<GoogleEvent>(token, `/calendars/primary/events/${encodeURIComponent(entry.googleEventId)}`, {
    method: 'PATCH', body: JSON.stringify(toGoogleEvent(entry)),
  });
}

export async function syncGoogleCalendar(token: string, entries: Entry[]): Promise<{ entries: Entry[]; imported: number; uploaded: number }> {
  const min = new Date(); min.setDate(min.getDate() - 30);
  const max = new Date(); max.setFullYear(max.getFullYear() + 1);
  const query = new URLSearchParams({
    timeMin: min.toISOString(), timeMax: max.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
  });
  const calendarEvents: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const result = await googleFetch<EventList>(token, `/calendars/primary/events?${query.toString()}`);
    calendarEvents.push(...(result.items || []).filter((event) => event.status !== 'cancelled'));
    pageToken = result.nextPageToken;
  } while (pageToken);

  const remoteIds = new Set(calendarEvents.map((event) => event.id));
  let nextEntries = entries.filter((entry) => {
    if (entry.kind !== 'event' || !entry.googleEventId || !entry.dueAt) return true;
    const eventDay = new Date(entry.dueAt).getTime();
    return eventDay < min.getTime() || eventDay > max.getTime() || remoteIds.has(entry.googleEventId);
  });
  let imported = 0;
  for (const event of calendarEvents) {
    const dueAt = startDate(event);
    if (!dueAt || !event.id) continue;
    const linked = nextEntries.find((entry) => entry.googleEventId === event.id || entry.id === event.extendedProperties?.private?.nhoNhaEntryId);
    if (linked) {
      nextEntries = nextEntries.map((entry) => entry.id === linked.id ? {
        ...entry,
        title: event.summary || entry.title,
        body: event.description ?? entry.body,
        dueAt,
        endAt: event.end?.dateTime || (event.end?.date ? new Date(`${event.end.date}T09:30:00`).toISOString() : entry.endAt),
        googleEventId: event.id,
      } : entry);
    } else {
      nextEntries.unshift({
        id: `google-${event.id}`,
        googleEventId: event.id,
        kind: 'event',
        title: event.summary || 'Sự kiện Google Calendar',
        body: event.description || '',
        status: 'todo',
        priority: 'normal',
        color: '#8FA28A',
        dueAt,
        endAt: event.end?.dateTime || (event.end?.date ? new Date(`${event.end.date}T09:30:00`).toISOString() : undefined),
        imageUris: [],
        createdAt: new Date().toISOString(),
      });
      imported += 1;
    }
  }

  let uploaded = 0;
  for (const entry of nextEntries) {
    if (entry.kind !== 'event' || !entry.dueAt) continue;
    const eventBody = toGoogleEvent(entry);
    if (entry.googleEventId) {
      await googleFetch<GoogleEvent>(token, `/calendars/primary/events/${encodeURIComponent(entry.googleEventId)}`, {
        method: 'PATCH', body: JSON.stringify(eventBody),
      });
    } else {
      const created = await googleFetch<GoogleEvent>(token, '/calendars/primary/events', {
        method: 'POST', body: JSON.stringify(eventBody),
      });
      nextEntries = nextEntries.map((item) => item.id === entry.id ? { ...item, googleEventId: created.id } : item);
      uploaded += 1;
    }
  }

  return { entries: nextEntries, imported, uploaded };
}
