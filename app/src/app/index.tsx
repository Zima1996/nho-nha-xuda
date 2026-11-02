import { useAudioRecorder, useAudioRecorderState, RecordingPresets, IOSOutputFormat, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useMemo, useRef, useState } from 'react';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import {
  Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { entryColorOptions, palettes } from '@/constants/palettes';
import { AudioPlayback } from '@/components/AudioPlayback';
import { MediaImage } from '@/components/MediaImage';
import { loadAppData, localDayKey, rollOverDailyItems, saveAppData, starterData, updateEntries } from '@/data/local-store';
import { saveMedia } from '@/data/media-store';
import { deleteGoogleCalendarEvent, getGoogleAccountEmail, requestGoogleAccessToken, syncGoogleCalendar, updateGoogleCalendarEvent } from '@/services/google-calendar';
import type { AppData, Entry, EntryKind, ThemeName } from '@/types/entry';

type Tab = 'today' | 'calendar' | 'settings';
type CalendarSection = 'events' | 'notes';
type CalendarViewMode = 'month' | 'week' | 'day';
type ComposerMode = 'task' | 'note' | 'voice' | 'event';
type Draft = Omit<Entry, 'id' | 'createdAt'>;
type BrowserSpeechResult = { transcript: string };
type BrowserSpeechEvent = Event & { resultIndex: number; results: ArrayLike<ArrayLike<BrowserSpeechResult> & { isFinal: boolean }> };
type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition };
const KIND_LABEL: Record<EntryKind, string> = { task: 'Task', event: 'Event', routine: 'Routine', note: 'Note' };
const KIND_ICON: Record<EntryKind, string> = { task: '☑', event: '✿', routine: '↻', note: '✎' };
const PET_ICONS = [
  require('../../assets/pets/generic-pixel-icons/dog-cream.png'),
  require('../../assets/pets/generic-pixel-icons/dog-ginger-white.png'),
  require('../../assets/pets/generic-pixel-icons/cat-calico.png'),
  require('../../assets/pets/generic-pixel-icons/cat-collar.png'),
  require('../../assets/pets/generic-pixel-icons/cat-tabby.png'),
  require('../../assets/pets/generic-pixel-icons/cat-tuxedo.png'),
];
function petFor(value: string, seed: number) {
  const hash = [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, Math.floor(seed * 10000));
  return PET_ICONS[(hash >>> 0) % PET_ICONS.length];
}
const themeCopy: Record<ThemeName, { nudge: string; empty: string; notes: string }> = {
  energy: { nudge: 'Mỗi việc nhỏ là một bước tiến.', empty: 'Thêm điều đầu tiên mình muốn nhớ nhé.', notes: 'Ý tưởng nào cũng đáng được giữ lại.' },
  nature: { nudge: 'Mình cứ thong thả từng việc nhé.', empty: 'Để dành một điều muốn nhớ ở đây.', notes: 'Cất lại những điều quan trọng với bạn.' },
  'the-anh': { nudge: 'Mình làm từng việc một nhé.', empty: 'Bắt đầu bằng một điều cần nhớ.', notes: 'Cất lại những điều quan trọng.' },
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function newDraft(kind: EntryKind = 'task'): Draft {
  return { kind, title: '', body: '', status: 'todo', priority: 'normal', color: entryColorOptions[0], imageUris: [], repeat: 'none' };
}
function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function today(hour: number) {
  const date = new Date(); date.setHours(hour, 0, 0, 0);
  if (date.getTime() < Date.now()) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
function when(value?: string) {
  return value ? new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
}
function googleErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Hãy thử lại sau nhé.';
  if (/invalid_client|client was not found|oauth client.*not found/i.test(message)) {
    return 'Google không tìm thấy OAuth Client ID của app (401 invalid_client). Trong Google Cloud, hãy dùng OAuth client loại Web application, thêm https://zima1996.github.io vào Authorized JavaScript origins, rồi cập nhật Client ID đang dùng trong GitHub Actions. Không thể sửa cấu hình Cloud từ trong app.';
  }
  return message;
}
function calendarDates(focus: Date, mode: CalendarViewMode): Date[] {
  const start = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate());
  if (mode === 'day') return [start];
  const mondayOffset = (start.getDay() + 6) % 7;
  if (mode === 'week') {
    start.setDate(start.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  }
  start.setDate(1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
}
function calendarHeading(date: Date, mode: CalendarViewMode): string {
  if (mode === 'month') return date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
  if (mode === 'day') return date.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const end = new Date(date); end.setDate(end.getDate() + 6);
  return `${date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('today');
  const [calendarSection, setCalendarSection] = useState<CalendarSection>('events');
  const [calendarMode, setCalendarMode] = useState<CalendarViewMode>('month');
  const [calendarFocus, setCalendarFocus] = useState(() => { const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0); return todayDate; });
  const [eventDetail, setEventDetail] = useState<Entry | null>(null);
  const [data, setData] = useState<AppData>(starterData);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [googleAccessToken, setGoogleAccessToken] = useState<string>();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [petSeed, setPetSeed] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setPetSeed(Math.random()), 0); return () => clearTimeout(timer); }, []);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>('task');
  const [draft, setDraft] = useState<Draft>(newDraft());
  const [eventDateText, setEventDateText] = useState('');
  const [eventTimeText, setEventTimeText] = useState('09:00');
  const [audioUri, setAudioUri] = useState<string>();
  const [voiceSaveError, setVoiceSaveError] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const transcriptRef = useRef('');
  const partialRef = useRef('');
  const contentBeforeTranscriptRef = useRef('');
  const browserRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const shouldRecognizeRef = useRef(false);
  const autoSaveVoiceRef = useRef(false);
  const pendingVoiceAudioRef = useRef<string | undefined>(undefined);
  const browserRecognitionEndRef = useRef<(() => void) | null>(null);
  const finishVoiceNoteRef = useRef<(() => void) | null>(null);
  const voiceSaveBusyRef = useRef(false);
  const recordingOptions = useMemo(() => {
    if (Platform.OS === 'ios') return {
      ...RecordingPresets.HIGH_QUALITY,
      extension: '.mp3',
      ios: { ...RecordingPresets.HIGH_QUALITY.ios, outputFormat: IOSOutputFormat.MPEGLAYER3 },
    };
    if (Platform.OS === 'web') {
      const supportsMp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4');
      return {
        ...RecordingPresets.HIGH_QUALITY,
        extension: supportsMp4 ? '.m4a' : '.webm',
        web: { mimeType: supportsMp4 ? 'audio/mp4' : 'audio/webm', bitsPerSecond: 128_000 },
      };
    }
    return RecordingPresets.HIGH_QUALITY;
  }, []);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder);
  const tablet = width >= 760;
  const colors = palettes[data.theme];
  const copy = themeCopy[data.theme];

  useSpeechRecognitionEvent('result', (event) => {
    const value = event.results?.[0]?.transcript;
    if (!value) return;
    let spokenText: string;
    if (event.isFinal) {
      transcriptRef.current = [transcriptRef.current, value].filter(Boolean).join(' ');
      partialRef.current = '';
      spokenText = transcriptRef.current;
    } else {
      partialRef.current = value;
      spokenText = [transcriptRef.current, partialRef.current].filter(Boolean).join(' ');
    }
    setTranscript(spokenText);
    setDraft((current) => ({ ...current, body: [contentBeforeTranscriptRef.current, spokenText].filter(Boolean).join('\n') }));
  });
  useSpeechRecognitionEvent('error', (event) => {
    setTranscribing(false);
    if (event.error !== 'aborted') Alert.alert('Chưa chuyển được thành chữ', 'Bạn có thể thử lại hoặc giữ nguyên bản ghi âm.');
  });
  useSpeechRecognitionEvent('end', () => {
    setTranscribing(false);
    if (autoSaveVoiceRef.current) finishVoiceNoteRef.current?.();
  });

  useEffect(() => {
    loadAppData().then((saved) => { setData(saved); setReady(true); }).catch((error) => {
      console.warn('Could not load saved app data; keeping it untouched', error);
      setLoadFailed(true);
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (ready && !loadFailed) saveAppData(data).catch((error) => console.warn('Local save failed', error));
  }, [data, ready, loadFailed]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const todayKey = localDayKey(clock);
  useEffect(() => {
    if (!ready || loadFailed || data.todayKey === todayKey) return;
    const nextData = rollOverDailyItems(data, todayKey);
    const retainedNotifications = new Set(nextData.entries.map((entry) => entry.notificationId).filter(Boolean));
    const timer = setTimeout(() => {
      data.entries.filter((entry) => entry.notificationId && !retainedNotifications.has(entry.notificationId))
        .forEach((entry) => Notifications.cancelScheduledNotificationAsync(entry.notificationId!).catch(() => undefined));
      setData((current) => current.todayKey === todayKey ? current : rollOverDailyItems(current, todayKey));
    }, 0);
    return () => clearTimeout(timer);
  }, [data, ready, todayKey, loadFailed]);
  const greeting = clock.getHours() >= 5 && clock.getHours() < 12
    ? 'Chào buổi sáng, Xuda'
    : clock.getHours() >= 12 && clock.getHours() < 18
      ? 'Chào buổi chiều, Xuda'
      : 'Chào buổi tối, Xuda';

  const list = useMemo(() => {
    let result = data.entries;
    if (tab === 'today') result = result.filter((item) => (item.kind === 'task' || item.kind === 'routine') && (!item.dayKey || item.dayKey <= todayKey));
    if (tab === 'calendar') result = result.filter((item) => calendarSection === 'events'
      ? item.kind === 'event' && !!item.dueAt && localDayKey(new Date(item.dueAt)) === localDayKey(calendarFocus)
      : item.kind === 'note');
    if (query.trim()) {
      const needle = query.trim().toLocaleLowerCase('vi');
      result = result.filter((item) => (item.title + ' ' + item.body + ' ' + (item.transcript || '')).toLocaleLowerCase('vi').includes(needle));
    }
    return [...result].sort((a, b) => (a.dueAt || a.createdAt).localeCompare(b.dueAt || b.createdAt));
  }, [data.entries, tab, calendarSection, calendarFocus, query, todayKey]);
  const calendarCells = useMemo(() => calendarDates(calendarFocus, calendarMode), [calendarFocus, calendarMode]);

  function moveCalendar(direction: -1 | 1) {
    setCalendarFocus((current) => {
      const next = new Date(current);
      if (calendarMode === 'month') next.setMonth(next.getMonth() + direction, 1);
      else next.setDate(next.getDate() + direction * (calendarMode === 'week' ? 7 : 1));
      return next;
    });
  }

  function begin(kindValue: EntryKind = 'task', item?: Entry, mode?: ComposerMode) {
    setEditing(item?.id || null);
    setComposerMode(mode || (kindValue === 'note' ? 'note' : kindValue === 'event' ? 'event' : 'task'));
    if (item) {
      const { id: _id, createdAt: _created, ...rest } = item;
      setDraft({ ...rest, imageUris: [...item.imageUris] });
      setAudioUri(item.audioUri);
      setTranscript(item.transcript || '');
      if (kindValue === 'event') {
        const date = item.dueAt ? new Date(item.dueAt) : calendarFocus;
        setEventDateText(localDayKey(date));
        setEventTimeText(when(item.dueAt) || '09:00');
      }
    } else {
      const blank = newDraft(kindValue);
      if (kindValue === 'event') {
        const date = new Date(calendarFocus); date.setHours(9, 0, 0, 0);
        blank.dueAt = date.toISOString();
        setEventDateText(localDayKey(date)); setEventTimeText('09:00');
      } else { setEventDateText(''); setEventTimeText('09:00'); }
      setDraft(blank); setAudioUri(undefined); setTranscript('');
    }
    transcriptRef.current = item?.transcript || '';
    setVisible(true);
  }
  function beginVoiceNote() {
    autoSaveVoiceRef.current = true;
    voiceSaveBusyRef.current = false;
    setVoiceSaveError(false);
    pendingVoiceAudioRef.current = undefined;
    begin('note', undefined, 'voice');
  }
  function beginQuickNote(item?: Entry) {
    autoSaveVoiceRef.current = false;
    pendingVoiceAudioRef.current = undefined;
    begin('note', item, 'note');
  }
  async function chooseTheme(theme: ThemeName) {
    const nextData = { ...data, theme };
    setData(nextData);
    try { await saveAppData(nextData); }
    catch { Alert.alert('Chưa lưu được màu sắc', 'Theme đã đổi tạm thời. Hãy thử lại sau khi thiết bị hoạt động bình thường.'); }
  }
  function put(item: Entry) {
    setData((current) => ({
      ...current,
      entries: current.entries.some((entry) => entry.id === item.id)
        ? current.entries.map((entry) => entry.id === item.id ? item : entry)
        : [item, ...current.entries],
    }));
  }
  async function persistEntry(item: Entry) {
    const nextData: AppData = { ...data, entries: updateEntries(data.entries, item) };
    setData(nextData);
    await saveAppData(nextData);
  }
  async function finishVoiceNote() {
    const audio = pendingVoiceAudioRef.current;
    if (!audio || !autoSaveVoiceRef.current || voiceSaveBusyRef.current) return;
    voiceSaveBusyRef.current = true;
    const body = draft.body.trim() || transcriptRef.current.trim();
    const now = new Date();
    const title = body.split('\n')[0]?.trim().slice(0, 54) || `Bản ghi âm · ${when(now.toISOString())}`;
    const item: Entry = {
      ...newDraft('note'),
      id: data.entries.find((entry) => entry.kind === 'note' && entry.audioUri === audio)?.id || id(),
      title,
      body,
      transcript: body,
      audioUri: audio,
      imageUris: [...draft.imageUris],
      createdAt: now.toISOString(),
    };
    try {
      await persistEntry(item);
      autoSaveVoiceRef.current = false;
      pendingVoiceAudioRef.current = undefined;
      setVoiceSaveError(false);
      setVisible(false);
      setTranscribing(false);
      Alert.alert('Đã lưu ghi âm', 'Bản ghi, phần chữ và ảnh đã được lưu trong Ghi chú ở tab Lịch.');
    } catch {
      setVoiceSaveError(true);
      Alert.alert('Chưa lưu được ghi âm', 'Bản ghi vẫn đang mở. Hãy chạm “Thử lưu lại” để lưu lần nữa.');
    } finally {
      voiceSaveBusyRef.current = false;
    }
  }
  finishVoiceNoteRef.current = () => { void finishVoiceNote(); };
  async function connectGoogle() {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      Alert.alert('Cần cấu hình Google', 'Mã ứng dụng Google chưa được thêm vào GitHub. Mình sẽ hướng dẫn bạn tạo và cài mã này sau khi chuẩn bị xong app.');
      return;
    }
    setGoogleBusy(true);
    try {
      const token = await requestGoogleAccessToken(clientId);
      const email = await getGoogleAccountEmail(token);
      setGoogleAccessToken(token);
      setData((current) => ({ ...current, googleEmail: email || current.googleEmail }));
      Alert.alert('Đã kết nối Google', email ? `Đang dùng ${email}.` : 'Bạn đã cấp quyền Google.');
    } catch (error) {
      Alert.alert('Chưa đăng nhập được', googleErrorMessage(error));
    } finally { setGoogleBusy(false); }
  }
  async function syncCalendar() {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      Alert.alert('Cần cấu hình Google', 'Mã ứng dụng Google chưa được thêm vào GitHub. Mình sẽ hướng dẫn bạn tạo và cài mã này sau khi chuẩn bị xong app.');
      return;
    }
    setGoogleBusy(true);
    try {
      // Tokens stay in memory; ask Google for a fresh one after the app is reopened or the token expires.
      const token = await requestGoogleAccessToken(clientId, googleAccessToken ? '' : 'select_account');
      const email = await getGoogleAccountEmail(token);
      const result = await syncGoogleCalendar(token, data.entries);
      const syncedAt = new Date().toISOString();
      setGoogleAccessToken(token);
      setData((current) => ({ ...current, entries: result.entries, googleEmail: email || current.googleEmail, googleLastSyncedAt: syncedAt }));
      Alert.alert('Đã đồng bộ lịch', `Đã nhập ${result.imported} sự kiện và thêm ${result.uploaded} sự kiện lên Google Calendar.`);
    } catch (error) {
      Alert.alert('Chưa đồng bộ được', googleErrorMessage(error));
    } finally { setGoogleBusy(false); }
  }
  async function setReminder(item: Entry) {
    if (!item.reminderAt) return undefined;
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return undefined;
    const time = new Date(item.reminderAt);
    const seconds = item.repeat === 'daily' ? 86400 : item.repeat === 'weekly' ? 604800 : 0;
    return Notifications.scheduleNotificationAsync({
      content: { title: 'Nhớ nha Xuda · ' + item.title, body: item.body || 'Đến giờ mình đã hẹn rồi đó 🌼', data: { entryId: item.id } },
      trigger: seconds
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: true }
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: time },
    });
  }
  async function save() {
    const previous = data.entries.find((entry) => entry.id === editing);
    const noteContent = draft.body.trim();
    const title = draft.kind === 'note'
      ? previous?.title || noteContent.split('\n')[0]?.slice(0, 54) || (draft.imageUris.length ? `Ghi chú · ${when(new Date().toISOString())}` : '')
      : draft.title.trim() || noteContent.split('\n')[0]?.slice(0, 54) || transcript.trim().split('\n')[0]?.slice(0, 54) || (audioUri ? 'Bản ghi âm mới' : '');
    if (!title) { Alert.alert('Thêm một chút nội dung nhé', 'Viết ghi chú hoặc thêm ảnh trước khi lưu.'); return; }
    let eventDueAt = previous?.dueAt;
    if (draft.kind === 'event') {
      const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDateText);
      const timeParts = /^(\d{2}):(\d{2})$/.exec(eventTimeText);
      const parsedDueAt = dateParts && timeParts ? new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]), Number(timeParts[1]), Number(timeParts[2])) : new Date(NaN);
      if (!dateParts || !timeParts || Number(dateParts[2]) < 1 || Number(dateParts[2]) > 12 || Number(dateParts[3]) !== parsedDueAt.getDate() || Number(dateParts[2]) - 1 !== parsedDueAt.getMonth() || Number(timeParts[1]) > 23 || Number(timeParts[2]) > 59 || Number.isNaN(parsedDueAt.getTime())) {
        Alert.alert('Kiểm tra ngày và giờ', 'Nhập ngày theo dạng YYYY-MM-DD và giờ theo dạng HH:MM.'); return;
      }
      eventDueAt = parsedDueAt.toISOString();
    }
    if (previous?.notificationId && (!draft.reminderAt || draft.reminderAt !== previous.reminderAt)) {
      Notifications.cancelScheduledNotificationAsync(previous.notificationId).catch(() => undefined);
    }
    const item: Entry = {
      ...draft, title, id: editing || id(), createdAt: previous?.createdAt || new Date().toISOString(),
      audioUri: audioUri || draft.audioUri, transcript: transcript || draft.transcript,
      ...((draft.kind === 'task' || draft.kind === 'routine') ? { dayKey: previous?.dayKey || todayKey } : {}),
      ...(draft.kind === 'event' ? { dueAt: eventDueAt, endAt: previous?.endAt || (eventDueAt ? new Date(new Date(eventDueAt).getTime() + 30 * 60_000).toISOString() : undefined) } : {}),
    };
    if (item.kind === 'event' && item.googleEventId) {
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      if (!clientId) { Alert.alert('Chưa cập nhật được Google Calendar', 'Hãy cấu hình lại đăng nhập Google trước khi sửa sự kiện đã đồng bộ.'); return; }
      setGoogleBusy(true);
      try {
        const token = googleAccessToken || await requestGoogleAccessToken(clientId);
        await updateGoogleCalendarEvent(token, item);
        setGoogleAccessToken(token);
      } catch (error) {
        Alert.alert('Chưa cập nhật được Google Calendar', googleErrorMessage(error));
        setGoogleBusy(false);
        return;
      }
      setGoogleBusy(false);
    }
    if (item.reminderAt && (!previous || item.reminderAt !== previous.reminderAt)) {
      try { item.notificationId = await setReminder(item); }
      catch { Alert.alert('Nhắc nhở chưa bật', 'Bạn có thể bật quyền thông báo trong Cài đặt iPhone.'); }
    }
    try {
      await persistEntry(item);
      setVisible(false);
    } catch {
      setEditing(item.id);
      Alert.alert('Chưa lưu được ghi chú', 'Ghi chú vẫn đang mở. Hãy thử lưu lại khi thiết bị sẵn sàng.');
    }
  }
  async function removeEntry(entryId = editing) {
    const item = data.entries.find((entry) => entry.id === entryId);
    if (!item || !entryId) return;
    if (item.googleEventId) {
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      if (!clientId) { Alert.alert('Chưa xóa được sự kiện', 'Hãy cấu hình lại đăng nhập Google trước khi xóa sự kiện đã đồng bộ.'); return; }
      setGoogleBusy(true);
      try {
        const token = googleAccessToken || await requestGoogleAccessToken(clientId);
        await deleteGoogleCalendarEvent(token, item.googleEventId);
        setGoogleAccessToken(token);
      } catch (error) {
        Alert.alert('Chưa xóa được sự kiện Google', error instanceof Error ? error.message : 'Hãy kết nối lại Google rồi thử lần nữa.');
        setGoogleBusy(false);
        return;
      }
      setGoogleBusy(false);
    }
    if (item.notificationId) Notifications.cancelScheduledNotificationAsync(item.notificationId).catch(() => undefined);
    const nextData = { ...data, entries: data.entries.filter((entry) => entry.id !== entryId) };
    setData(nextData);
    try { await saveAppData(nextData); }
    catch { Alert.alert('Chưa lưu thay đổi', 'Sự kiện đã được xóa khỏi Google Calendar, nhưng app chưa lưu được thay đổi trên thiết bị. Hãy đồng bộ lại.'); return; }
    setVisible(false);
    setEventDetail(null);
  }
  async function choosePhoto(camera: boolean) {
    try {
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsEditing: true });
      if (!result.canceled && result.assets[0]?.uri) {
        const uri = await saveMedia(result.assets[0].uri, '.jpg');
        setDraft((value) => ({ ...value, imageUris: [...value.imageUris, uri] }));
      }
    } catch { Alert.alert('Chưa thêm được ảnh', 'Thử chụp ảnh hoặc chọn lại từ thư viện nhé.'); }
  }
  async function stopBrowserTranscription() {
    const recognition = browserRecognitionRef.current;
    if (!recognition || !shouldRecognizeRef.current) return;
    shouldRecognizeRef.current = false;
    await new Promise<void>((resolve) => {
      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        browserRecognitionEndRef.current = null;
        resolve();
      };
      const timeout = window.setTimeout(complete, 1600);
      browserRecognitionEndRef.current = complete;
      try { recognition.stop(); } catch { complete(); }
    });
  }
  async function closeComposer() {
    if (recorderState.isRecording) {
      await record();
      return;
    }
    autoSaveVoiceRef.current = false;
    pendingVoiceAudioRef.current = undefined;
    setVisible(false);
  }
  async function record() {
    try {
      if (recorderState.isRecording) {
        if (Platform.OS === 'web') await stopBrowserTranscription();
        await recorder.stop();
        if (recorder.uri) {
          const fallbackExtension = Platform.OS === 'ios' ? '.mp3' : '.m4a';
          const uri = await saveMedia(recorder.uri, fallbackExtension);
          setAudioUri(uri); setDraft((value) => ({ ...value, audioUri: uri }));
          if (composerMode === 'voice') {
            pendingVoiceAudioRef.current = uri;
            if (Platform.OS === 'web') finishVoiceNoteRef.current?.();
            else transcribe(uri);
          }
        }
      } else {
        let permission = await getRecordingPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) { Alert.alert('Cần quyền micro', 'Hãy bật quyền micro cho Nhớ nha Xuda trong Cài đặt iPhone để ghi âm.'); return; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync(); recorder.record();
        if (Platform.OS === 'web') startBrowserTranscription();
      }
    } catch { Alert.alert('Chưa ghi âm được', 'Kiểm tra quyền micro rồi thử lại nhé.'); }
  }
  function startBrowserTranscription() {
    const SpeechRecognition = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      Alert.alert('Trình duyệt chưa hỗ trợ chuyển giọng nói', 'Hãy mở app bằng Safari trên iPhone hoặc Chrome trên máy tính. Bản ghi âm vẫn được lưu.');
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onresult = (event) => {
        let finalText = transcriptRef.current;
        let interimText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const value = result?.[0]?.transcript?.trim();
          if (!value) continue;
          if (result.isFinal) finalText = [finalText, value].filter(Boolean).join(' ');
          else interimText = [interimText, value].filter(Boolean).join(' ');
        }
        transcriptRef.current = finalText;
        partialRef.current = interimText;
        const spokenText = [finalText, interimText].filter(Boolean).join(' ');
        setTranscript(spokenText);
        setDraft((current) => ({ ...current, body: [contentBeforeTranscriptRef.current, spokenText].filter(Boolean).join('\n') }));
      };
      recognition.onerror = (event) => {
        setTranscribing(false);
        if (event.error !== 'aborted' && event.error !== 'no-speech') Alert.alert('Chưa chuyển được thành chữ', 'Kiểm tra quyền micro và kết nối mạng, rồi thử ghi âm lại nhé.');
      };
      recognition.onend = () => {
        if (shouldRecognizeRef.current) {
          window.setTimeout(() => { try { recognition.start(); } catch { /* A recognition session may still be winding down. */ } }, 250);
        } else {
          setTranscribing(false);
          browserRecognitionEndRef.current?.();
        }
      };
      browserRecognitionRef.current = recognition;
      shouldRecognizeRef.current = true;
      contentBeforeTranscriptRef.current = draft.body.trim();
      transcriptRef.current = ''; partialRef.current = ''; setTranscript(''); setTranscribing(true);
      recognition.start();
    } catch {
      shouldRecognizeRef.current = false;
      setTranscribing(false);
      Alert.alert('Chưa bật được nhận dạng giọng nói', 'Kiểm tra quyền micro của Safari rồi thử lại nhé.');
    }
  }
  async function transcribe(sourceUri = audioUri) {
    if (!sourceUri) return;
    if (Platform.OS === 'web') {
      Alert.alert('Chuyển lời nói thành chữ', 'Trên iPhone, lời nói được chuyển thành chữ ngay trong lúc ghi âm. Hãy ghi âm mới để tạo văn bản.');
      return;
    }
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Chưa có quyền nhận dạng giọng nói', 'Bản ghi âm vẫn được lưu; bạn có thể bật quyền nhận dạng giọng nói trong Cài đặt.');
        if (autoSaveVoiceRef.current) finishVoiceNoteRef.current?.();
        return;
      }
      contentBeforeTranscriptRef.current = transcript && draft.body.endsWith(transcript)
        ? draft.body.slice(0, -transcript.length).trim()
        : draft.body.trim();
      transcriptRef.current = ''; partialRef.current = ''; setTranscript('');
      setDraft((current) => ({ ...current, body: contentBeforeTranscriptRef.current }));
      setTranscribing(true);
      ExpoSpeechRecognitionModule.start({
        lang: 'vi-VN', interimResults: true, continuous: true,
        requiresOnDeviceRecognition: Platform.OS === 'ios',
        audioSource: { uri: sourceUri, audioChannels: 1, sampleRate: 16000 },
      });
    } catch {
      setTranscribing(false);
      Alert.alert('Chưa chuyển được thành chữ', 'Bản ghi âm vẫn được giữ lại để bạn nghe sau.');
      if (autoSaveVoiceRef.current) finishVoiceNoteRef.current?.();
    }
  }
  const total = data.entries.filter((entry) => (entry.kind === 'task' || entry.kind === 'routine') && (!entry.dayKey || entry.dayKey <= todayKey)).length;
  const done = data.entries.filter((entry) => (entry.kind === 'task' || entry.kind === 'routine') && (!entry.dayKey || entry.dayKey <= todayKey) && entry.status === 'done').length;
  const mainWidth = tablet ? 930 : 600;


  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.paper }]}>
      <View style={[s.shell, { maxWidth: mainWidth }]}>
        <View style={s.topbar}>
          <View style={[s.logo, { backgroundColor: colors.soft }]}><CalicoMascot color={colors.primaryDark} /></View>
          <View style={{ flex: 1 }}><Text style={[s.brand, { color: colors.ink }]}>Nhớ nha Xuda</Text></View>
          <Pressable onPress={() => setTab('settings')} style={[s.avatar, { backgroundColor: colors.surfaceAlt }]}><Image source={petFor('avatar', petSeed)} style={s.avatarPet} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {tab === 'today' && <>
            <View style={s.hero}>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { color: colors.ink }]}>{greeting} <Text style={{ color: colors.primary }}>✿</Text></Text>
              </View>
            </View>
            <View style={[s.progress, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={s.progressTop}><View style={[s.progressIcon, { backgroundColor: colors.soft }]}><Image source={petFor('progress', petSeed)} style={s.progressPet} /></View>
                <View style={{ flex: 1 }}><Text style={[s.progressTitle, { color: colors.ink }]}>{done} / {total} việc đã xong</Text></View>
                <Text style={[s.progressNumber, { color: colors.primary }]}>{total ? Math.round(done / total * 100) : 0}%</Text></View>
              <View style={[s.progressTrack, { backgroundColor: colors.line }]}><View style={[s.progressFill, { width: `${total ? Math.round(done / total * 100) : 0}%`, backgroundColor: colors.primary }]} /></View>
            </View>
            <View style={s.sectionTop}><Text style={[s.sectionTitle, { color: colors.ink }]}>Việc cần nhớ</Text><QuickActions palette={colors} onRecord={beginVoiceNote} onAdd={() => beginQuickNote()} addLabel="Ghi chú" /></View>
            <Search value={query} onChange={setQuery} palette={colors} />
            <View style={s.listHead}><Text style={[s.dayLabel, { color: colors.muted }]}>HÔM NAY · {list.length} MỤC</Text><Text style={[s.handText, { color: colors.primaryDark }]}>{copy.nudge}</Text></View>
            {list.length ? <View style={tablet ? s.grid : undefined}>{list.map((item) => <EntryRow key={item.id} item={item} palette={colors} petIcon={petFor(item.id, petSeed)} compact={tablet} onOpen={() => begin(item.kind, item)} onToggle={() => put({ ...item, status: item.status === 'done' ? 'todo' : 'done' })} />)}</View> : <View style={[s.empty, { backgroundColor: colors.surface, borderColor: colors.line }]}><Image source={petFor('empty-today', petSeed)} style={s.emptyPet} /><Text style={[s.sectionTitle, { color: colors.ink }]}>Chưa có gì ở đây</Text><Text style={[s.subtitle, { color: colors.muted }]}>{copy.empty}</Text><Button label="＋ Ghi chú" primary palette={colors} onPress={() => beginQuickNote()} /></View>}
          </>}
          {tab === 'calendar' && <>
            <View style={s.sectionTop}><Text style={[s.sectionTitle, { color: colors.ink }]}>Lịch</Text><QuickActions palette={colors} onRecord={beginVoiceNote} onAdd={() => beginQuickNote()} addLabel="Ghi chú" /></View>
            <Text style={[s.title, { color: colors.ink }]}>{calendarSection === 'events' ? 'Lịch sự kiện' : 'Ghi chú đã lưu'} <Text style={{ color: colors.primary }}>{calendarSection === 'events' ? '☁' : '✎'}</Text></Text>
            <Text style={[s.subtitle, { color: colors.muted }]}>{calendarSection === 'events' ? 'Các sự kiện dài hạn từ app và Google Calendar.' : 'Ảnh, chữ và bản ghi âm được giữ lại lâu dài.'}</Text>
            <View style={[s.calendarTabs, { backgroundColor: colors.surfaceAlt }]}>
              {([['events', 'Sự kiện'], ['notes', 'Ghi chú']] as [CalendarSection, string][]).map(([section, label]) => <Pressable key={section} onPress={() => { setCalendarSection(section); setQuery(''); }} style={[s.calendarTab, { backgroundColor: calendarSection === section ? colors.surface : 'transparent', borderColor: calendarSection === section ? colors.line : 'transparent' }]}><Text style={{ color: calendarSection === section ? colors.ink : colors.muted, fontWeight: '600', fontSize: 12 }}>{label}</Text></Pressable>)}
            </View>
            {calendarSection === 'events' && <>
              <View style={s.calendarTitleRow}><Pressable accessibilityLabel="Lùi lịch" onPress={() => moveCalendar(-1)} style={[s.calendarArrow, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink, fontSize: 20 }}>‹</Text></Pressable><Text style={[s.calendarHeading, { color: colors.ink }]}>{calendarHeading(calendarFocus, calendarMode)}</Text><Pressable accessibilityLabel="Tiến lịch" onPress={() => moveCalendar(1)} style={[s.calendarArrow, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink, fontSize: 20 }}>›</Text></Pressable></View>
              <View style={[s.calendarModes, { backgroundColor: colors.surfaceAlt }]}>{([['month', 'Tháng'], ['week', 'Tuần'], ['day', 'Ngày']] as [CalendarViewMode, string][]).map(([mode, label]) => <Pressable key={mode} onPress={() => setCalendarMode(mode)} style={[s.calendarMode, { backgroundColor: calendarMode === mode ? colors.surface : 'transparent', borderColor: calendarMode === mode ? colors.line : 'transparent' }]}><Text style={{ color: calendarMode === mode ? colors.ink : colors.muted, fontSize: 11, fontWeight: '600' }}>{label}</Text></Pressable>)}</View>
              <CalendarGrid dates={calendarCells} focus={calendarFocus} mode={calendarMode} entries={data.entries.filter((item) => item.kind === 'event')} palette={colors} onSelect={setCalendarFocus} />
            </>}
            <Search value={query} onChange={setQuery} palette={colors} />
            {calendarSection === 'events' ? <>
              <Pressable onPress={syncCalendar} style={[s.integration, { borderColor: colors.line, backgroundColor: colors.surface }]}><Text style={{ fontSize: 22 }}>🗓️</Text><View style={{ flex: 1 }}><Text style={[s.integrationTitle, { color: colors.ink }]}>Google Calendar</Text><Text style={[s.integrationSub, { color: colors.muted }]}>{googleBusy ? 'Đang đồng bộ…' : googleAccessToken && data.googleEmail ? `Đã kết nối · ${data.googleEmail} · Chạm để đồng bộ` : data.googleEmail ? `Tài khoản đã dùng · ${data.googleEmail} · Chạm để kết nối` : 'Đăng nhập trong Setting để đồng bộ'}</Text></View><Text style={{ color: colors.primary, fontSize: 21 }}>{googleAccessToken ? '↻' : '›'}</Text></Pressable>
              {list.map((item) => <EventRow key={item.id} item={item} palette={colors} petIcon={petFor(item.id, petSeed)} onPress={() => setEventDetail(item)} />)}
              {!list.length && <Empty palette={colors} emoji="☕" petIcon={petFor('empty-calendar', petSeed)} title="Chưa có sự kiện sắp tới" label="Đồng bộ Google Calendar" onPress={() => syncCalendar()} />}
            </> : <>
              <View style={[s.noteGrid, { gap: 10 }]}>{list.map((item, index) => <Pressable key={item.id} onPress={() => beginQuickNote(item)} style={[s.note, { backgroundColor: index % 2 ? colors.surfaceAlt : colors.surface, borderColor: colors.line, width: tablet ? '31.5%' : '48%', transform: [{ rotate: index % 2 ? '0.5deg' : '-0.5deg' }] }]}>
                {item.imageUris[0] ? <MediaImage uri={item.imageUris[0]} style={s.photo} /> : <View style={[s.photo, s.photoPlaceholder, { backgroundColor: colors.surfaceAlt }]}><Image source={petFor(item.id, petSeed)} style={s.placeholderPet} /></View>}
                <Text style={[s.noteTitle, { color: colors.ink }]} numberOfLines={2}>{item.title}</Text>
                {!!item.body && <Text style={[s.noteBody, { color: colors.muted }]} numberOfLines={4}>{item.body}</Text>}
                {!!item.imageUris.length && <Text style={[s.noteDate, { color: colors.primaryDark }]}>{item.imageUris.length} ảnh</Text>}
                {item.audioUri && <View style={{ marginTop: 7 }}><AudioPlayback uri={item.audioUri} palette={colors} /></View>}
                <Text style={[s.noteDate, { color: colors.muted }]}>{new Date(item.createdAt).toLocaleDateString('vi-VN')}</Text>
              </Pressable>)}</View>
              {!list.length && <Empty palette={colors} emoji="📔" petIcon={petFor('empty-notes', petSeed)} title="Chưa có ghi chú nào" label="＋ Ghi chú" onPress={() => beginQuickNote()} />}
            </>}
          </>}
          {tab === 'settings' && <>
            <Text style={[s.eyebrow, { color: colors.muted }]}>GÓC CỦA BẠN</Text><Text style={[s.title, { color: colors.ink }]}>Cài đặt nhỏ xinh <Text style={{ color: colors.primary }}>⚙</Text></Text><Text style={[s.subtitle, { color: colors.muted, marginBottom: 22 }]}>Chọn cảm giác hợp với bạn.</Text>
            <Text style={[s.sectionTitle, { color: colors.ink }]}>Màu sắc chủ đạo</Text><Text style={[s.sectionCaption, { color: colors.muted, marginBottom: 12 }]}>Tông ấm, chữ rõ, nét sổ tay handmade.</Text>
            <View style={{ gap: 10 }}>{(Object.keys(palettes) as ThemeName[]).map((key) => {
              const choice = palettes[key]; const selected = data.theme === key;
              return <Pressable key={key} onPress={() => { void chooseTheme(key); }} style={[s.themeChoice, { backgroundColor: choice.surface, borderColor: selected ? choice.primary : choice.line }]}>
                <View style={[s.swatches, { backgroundColor: choice.paper }]}>{[choice.accent, choice.primary, choice.green].map((color) => <View key={color} style={[s.swatch, { backgroundColor: color }]} />)}</View>
                <View style={{ flex: 1 }}><Text style={[s.progressTitle, { color: choice.ink }]}>{choice.name}</Text><Text style={[s.progressCaption, { color: choice.muted }]}>{choice.description}</Text></View><Text style={{ fontSize: 20, color: choice.primary }}>{selected ? '✓' : '○'}</Text>
              </Pressable>;
            })}</View>
            <Text style={[s.sectionTitle, { color: colors.ink, marginTop: 24, marginBottom: 10 }]}>Tài khoản & đồng bộ</Text>
            <View style={[s.integrationBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <Integration icon="G" title={data.googleEmail ? 'Tài khoản Google' : 'Đăng nhập Google'} sub={googleBusy ? 'Đang kết nối…' : data.googleEmail ? googleAccessToken ? `Đã kết nối · ${data.googleEmail}` : `Đã dùng trước đây · ${data.googleEmail} · Chạm để kết nối` : 'Dùng tài khoản có Google Calendar'} palette={colors} onPress={connectGoogle} />
              <View style={[s.divider, { backgroundColor: colors.line }]} />
              <Integration icon="🗓️" title="Google Calendar" sub={googleBusy ? 'Đang đồng bộ…' : data.googleLastSyncedAt ? `Đồng bộ gần nhất · ${new Date(data.googleLastSyncedAt).toLocaleString('vi-VN')}` : 'Chạm để đồng bộ hai chiều'} palette={colors} onPress={syncCalendar} />
            </View>
            <View style={[s.noteHint, { backgroundColor: colors.surfaceAlt, marginTop: 18 }]}><Text>🔒</Text><Text style={{ flex: 1, color: colors.ink, fontSize: 11 }}>Ghi chú ở trên thiết bị. Việc có giờ hẹn đồng bộ với lịch Google.</Text></View>
            <Text style={[s.version, { color: colors.muted }]}>NHỚ NHA · BẢN ĐẦU TIÊN</Text>
          </>}
        </ScrollView>

        <View style={[s.nav, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {([['today', 'home', 'Hôm nay'], ['calendar', 'calendar', 'Lịch'], ['settings', 'settings', 'Setting']] as [Tab, NavGlyphKind, string][]).map(([page, icon, label]) => <Pressable key={page} onPress={() => { setTab(page); setQuery(''); }} style={s.navItem}><NavGlyph kind={icon} color={tab === page ? colors.primaryDark : colors.muted} active={tab === page} palette={colors} /><Text style={[s.navLabel, { color: tab === page ? colors.primaryDark : colors.muted }]}>{label}</Text></Pressable>)}
        </View>
      </View>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={closeComposer}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeComposer} />
          <View style={[s.sheet, { backgroundColor: colors.paper, maxWidth: tablet ? 620 : 600 }]}>
            <View style={[s.handle, { backgroundColor: colors.line }]} />
            <View style={s.sheetHead}><View><Text style={[s.sheetTitle, { color: colors.ink }]}>{composerMode === 'voice' ? 'Ghi âm' : composerMode === 'note' ? editing ? 'Sửa ghi chú' : 'Ghi chú' : composerMode === 'event' ? editing ? 'Sửa sự kiện' : 'Sự kiện' : editing ? 'Sửa việc cần nhớ' : 'Thêm việc cần nhớ'}</Text><Text style={[s.sectionCaption, { color: colors.muted }]}>{composerMode === 'voice' ? 'Chạm nút lớn để bắt đầu nói.' : composerMode === 'note' ? 'Ghi lại điều bạn muốn giữ.' : composerMode === 'event' ? 'Cập nhật thông tin sự kiện.' : 'Thêm một việc cần nhớ.'}</Text></View><Pressable onPress={closeComposer} style={[s.close, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink, fontSize: 20 }}>×</Text></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              {(composerMode === 'task' || composerMode === 'event') && <TextInput value={draft.title} onChangeText={(title) => setDraft((current) => ({ ...current, title }))} placeholder={composerMode === 'event' ? 'Tên sự kiện' : 'Việc cần nhớ là gì?'} placeholderTextColor={colors.muted} style={[s.input, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }]} />}
              {composerMode === 'event' && <><Text style={[s.label, { color: colors.ink }]}>Ngày và giờ</Text><View style={s.eventDateFields}><TextInput value={eventDateText} onChangeText={setEventDateText} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={[s.input, s.eventDateInput, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }]} /><TextInput value={eventTimeText} onChangeText={setEventTimeText} placeholder="HH:MM" placeholderTextColor={colors.muted} style={[s.input, s.eventTimeInput, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }]} /></View></>}
              <TextInput value={draft.body} onChangeText={(body) => setDraft((current) => ({ ...current, body }))} placeholder={composerMode === 'voice' ? transcribing ? 'Đang nghe và chuyển lời nói thành chữ…' : 'Nội dung bạn nói sẽ hiện ở đây.' : composerMode === 'note' ? 'Viết điều bạn muốn nhớ…' : 'Ghi chú thêm (không bắt buộc)'} placeholderTextColor={colors.muted} multiline textAlignVertical="top" style={[s.bodyInput, composerMode === 'voice' && s.voiceTranscript, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }]} />
              {(draft.kind === 'task' || draft.kind === 'routine') && <><Text style={[s.label, { color: colors.ink }]}>Nhắc mình lúc nào?</Text><View style={s.pills}>
                <Pill label="Không nhắc" active={!draft.reminderAt} palette={colors} onPress={() => setDraft((current) => ({ ...current, reminderAt: undefined, reminderChoice: undefined }))} />
                <Pill label="Trong 1 giờ" active={draft.reminderChoice === 'hour'} palette={colors} onPress={() => setDraft((current) => ({ ...current, reminderAt: new Date(Date.now() + 3600000).toISOString(), dueAt: new Date(Date.now() + 3600000).toISOString(), reminderChoice: 'hour' }))} />
                <Pill label="Tối nay" active={!!draft.reminderAt && new Date(draft.reminderAt).getHours() === 20} palette={colors} onPress={() => setDraft((current) => ({ ...current, reminderAt: today(20), dueAt: today(20), reminderChoice: 'evening' }))} />
                <Pill label="Ngày mai" active={!!draft.reminderAt && new Date(draft.reminderAt).getDate() !== new Date().getDate()} palette={colors} onPress={() => { const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0); setDraft((current) => ({ ...current, reminderAt: next.toISOString(), dueAt: next.toISOString(), reminderChoice: 'tomorrow' })); }} />
              </View></>}
              {(composerMode === 'note' || composerMode === 'voice') && <>
                <Text style={[s.label, { color: colors.ink }]}>{composerMode === 'voice' ? 'Ảnh kèm theo (không bắt buộc)' : 'Ảnh (không bắt buộc)'}</Text>
                <View style={s.mediaActions}>
                  <Pressable onPress={() => choosePhoto(true)} style={({ pressed }) => [s.mediaButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.line, opacity: pressed ? 0.75 : 1 }]}><Text style={{ color: colors.ink, fontSize: 12, fontWeight: '600' }}>▧  Chụp ảnh</Text></Pressable>
                  <Pressable onPress={() => choosePhoto(false)} style={({ pressed }) => [s.mediaButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.line, opacity: pressed ? 0.75 : 1 }]}><Text style={{ color: colors.ink, fontSize: 12, fontWeight: '600' }}>▤  Thư viện</Text></Pressable>
                </View>
                {!!draft.imageUris.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingVertical: 10 }}>{draft.imageUris.map((uri) => <View key={uri} style={{ position: 'relative' }}><MediaImage uri={uri} style={s.preview} /><Pressable onPress={() => setDraft((current) => ({ ...current, imageUris: current.imageUris.filter((value) => value !== uri) }))} style={s.removePhoto}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>×</Text></Pressable></View>)}</ScrollView>}
              </>}
              {composerMode === 'voice' && <View style={s.voiceControls}>
                <Pressable accessibilityRole="button" accessibilityLabel={recorderState.isRecording ? 'Dừng và lưu ghi âm' : 'Bắt đầu ghi âm'} onPress={record} style={({ pressed }) => [s.voiceRecordButton, { backgroundColor: recorderState.isRecording ? '#C84535' : colors.primary, opacity: pressed ? 0.82 : 1 }]}>
                  <MicIcon color="#FFFFFF" />
                  <Text style={s.voiceRecordLabel}>{recorderState.isRecording ? 'Dừng và lưu' : 'Bắt đầu ghi âm'}</Text>
                </Pressable>
                <Text style={[s.sectionCaption, { color: colors.muted, textAlign: 'center' }]}>{recorderState.isRecording ? transcribing ? 'Đang ghi và chuyển giọng nói thành chữ…' : 'Đang ghi âm…' : 'Bản ghi âm và phần chữ sẽ tự lưu khi dừng.'}</Text>
                {voiceSaveError && <Pressable onPress={() => finishVoiceNoteRef.current?.()} style={[s.retrySave, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}><Text style={{ color: colors.ink, fontWeight: '700' }}>Thử lưu lại</Text></Pressable>}
              </View>}
              {!!audioUri && composerMode !== 'voice' && <View style={s.pills}><AudioPlayback uri={audioUri} palette={colors} />{composerMode === 'note' && <Text style={{ color: colors.green, fontSize: 10 }}>Có bản ghi âm</Text>}</View>}
              <View style={s.actions}>{editing && <Pressable onPress={() => { void removeEntry(); }} style={[s.delete, { borderColor: colors.line }]}><Text style={{ color: colors.primaryDark }}>Xóa mục</Text></Pressable>}<View style={{ flex: 1 }} />{composerMode !== 'voice' && <><Pressable onPress={closeComposer} style={[s.cancel, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink }}>Để sau</Text></Pressable><Pressable onPress={() => { void save(); }} style={[s.save, { backgroundColor: colors.primary }]}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{composerMode === 'note' ? 'Lưu ghi chú' : composerMode === 'event' ? 'Lưu sự kiện' : 'Lưu lại ✿'}</Text></Pressable></>}</View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!eventDetail} animationType="slide" transparent onRequestClose={() => setEventDetail(null)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEventDetail(null)} />
          <View style={[s.sheet, { backgroundColor: colors.paper, maxWidth: tablet ? 620 : 600 }]}>
            {eventDetail && <>
              <View style={[s.handle, { backgroundColor: colors.line }]} />
              <View style={s.sheetHead}><View><Text style={[s.sectionCaption, { color: colors.primaryDark }]}>{eventDetail.googleEventId ? 'ĐỒNG BỘ GOOGLE CALENDAR' : 'SỰ KIỆN CỦA BẠN'}</Text><Text style={[s.sheetTitle, { color: colors.ink }]}>{eventDetail.title}</Text></View><Pressable onPress={() => setEventDetail(null)} style={[s.close, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink, fontSize: 20 }}>×</Text></Pressable></View>
              <View style={[s.eventDetailCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <Text style={[s.eventDetailDate, { color: colors.primaryDark }]}>{eventDetail.dueAt ? new Date(eventDetail.dueAt).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Chưa đặt ngày'}</Text>
                <Text style={[s.eventDetailTime, { color: colors.ink }]}>{eventDetail.dueAt ? when(eventDetail.dueAt) : ''}</Text>
                {!!eventDetail.body && <Text style={[s.eventDetailBody, { color: colors.muted }]}>{eventDetail.body}</Text>}
              </View>
              <View style={s.eventDetailActions}>
                <Pressable onPress={() => { const item = eventDetail; setEventDetail(null); begin('event', item, 'event'); }} style={[s.eventDetailButton, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink, fontWeight: '600' }}>Chỉnh sửa</Text></Pressable>
                <Pressable onPress={() => { void removeEntry(eventDetail.id); }} style={[s.eventDetailButton, { backgroundColor: '#B83A32' }]}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Xóa sự kiện</Text></Pressable>
              </View>
            </>}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Pill({ label, active, palette, onPress }: { label: string; active: boolean; palette: (typeof palettes)[ThemeName]; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[s.pill, { backgroundColor: active ? palette.primary : palette.surface, borderColor: active ? palette.primary : palette.line }]}><Text style={{ color: active ? '#FFFFFF' : palette.muted, fontSize: 10, fontWeight: '500' }}>{label}</Text></Pressable>;
}
function Button({ label, palette, onPress, primary }: { label: string; palette: (typeof palettes)[ThemeName]; onPress: () => void; primary?: boolean }) {
  return <Pressable onPress={onPress} style={[s.button, { backgroundColor: primary ? palette.primary : palette.surfaceAlt }]}><Text style={{ color: primary ? '#FFFFFF' : palette.ink, fontSize: 11, fontWeight: '500' }}>{label}</Text></Pressable>;
}
function MicIcon({ color }: { color: string }) {
  return <View style={s.micGlyph}><View style={[s.micHead, { backgroundColor: color }]} /><View style={[s.micArch, { borderColor: color }]} /><View style={[s.micStem, { backgroundColor: color }]} /><View style={[s.micFoot, { backgroundColor: color }]} /></View>;
}
function Search({ value, onChange, palette }: { value: string; onChange: (value: string) => void; palette: (typeof palettes)[ThemeName] }) {
  return <View style={[s.search, { backgroundColor: palette.surface, borderColor: palette.line }]}><Text style={{ color: palette.muted, fontSize: 18, marginRight: 8 }}>⌕</Text><TextInput value={value} onChangeText={onChange} placeholder="Tìm trong những điều đã ghi..." placeholderTextColor={palette.muted} style={[s.searchInput, { color: palette.ink }]} />{!!value && <Pressable onPress={() => onChange('')}><Text style={{ color: palette.muted }}>×</Text></Pressable>}</View>;
}
function CalicoMascot({ color }: { color: string }) {
  const tilt = useSharedValue(0);
  const whiskerMove = useSharedValue(1);
  const motionStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  const whiskerStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: whiskerMove.value }] }));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wiggle = () => {
      tilt.value = withSequence(withTiming(-7, { duration: 140 }), withTiming(7, { duration: 170 }), withTiming(0, { duration: 180 }));
      whiskerMove.value = withSequence(withTiming(1.3, { duration: 180 }), withTiming(0.8, { duration: 220 }), withTiming(1, { duration: 160 }));
      timer = setTimeout(wiggle, 4500 + Math.random() * 4500);
    };
    timer = setTimeout(wiggle, 3000 + Math.random() * 2500);
    return () => clearTimeout(timer);
    // Shared-value objects are stable for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[s.calicoMotion, motionStyle]}>
    <Image source={require('../../assets/pets/generic-pixel-icons/cat-calico.png')} style={s.brandPet} />
    <Animated.View style={[s.whiskerGroup, s.whiskersLeft, whiskerStyle]}><View style={[s.whiskerLine, { backgroundColor: color }]} /><View style={[s.whiskerLine, { backgroundColor: color }]} /><View style={[s.whiskerLine, { backgroundColor: color }]} /></Animated.View>
    <Animated.View style={[s.whiskerGroup, s.whiskersRight, whiskerStyle]}><View style={[s.whiskerLine, { backgroundColor: color }]} /><View style={[s.whiskerLine, { backgroundColor: color }]} /><View style={[s.whiskerLine, { backgroundColor: color }]} /></Animated.View>
  </Animated.View>;
}

function EntryRow({ item, palette, onOpen, onToggle, compact, petIcon }: { item: Entry; palette: (typeof palettes)[ThemeName]; onOpen: () => void; onToggle: () => void; compact?: boolean; petIcon: number }) {
  const done = item.status === 'done';
  const wasDone = useRef(done);
  const petScale = useSharedValue(1);
  const petTilt = useSharedValue(0);
  const bloom = useSharedValue(0);
  const petMotionStyle = useAnimatedStyle(() => ({ transform: [{ scale: petScale.value }, { rotate: `${petTilt.value}deg` }] }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bloom.value, [0, 0.2, 1], [0, 1, 0]),
    transform: [{ scale: interpolate(bloom.value, [0, 0.35, 1], [0.25, 1.2, 1.45]) }, { translateY: interpolate(bloom.value, [0, 1], [6, -12]) }],
  }));
  useEffect(() => {
    if (done && !wasDone.current) {
      // Reanimated shared values are intentionally updated in this effect after status changes.
      // eslint-disable-next-line react-hooks/immutability
      petScale.value = withSequence(withSpring(1.5, { damping: 6 }), withSpring(1, { damping: 8 }));
      // eslint-disable-next-line react-hooks/immutability
      petTilt.value = withSequence(withTiming(-8, { duration: 100 }), withTiming(8, { duration: 120 }), withTiming(0, { duration: 150 }));
      // eslint-disable-next-line react-hooks/immutability
      bloom.value = withSequence(withTiming(1, { duration: 220 }), withTiming(0, { duration: 650 }));
    }
    wasDone.current = done;
  }, [done, petScale, petTilt, bloom]);
  const details = when(item.dueAt);
  return <Pressable onPress={onOpen} style={({ pressed }) => [s.entry, compact && s.entryCompact, { backgroundColor: done ? palette.surfaceAlt : palette.surface, borderColor: palette.line, opacity: done ? 0.56 : pressed ? 0.84 : 1 }]}>
    {item.kind !== 'note' && <Pressable onPress={(event) => { event.stopPropagation(); onToggle(); }} accessibilityRole="checkbox" accessibilityState={{ checked: done }} hitSlop={6} style={[s.check, { borderColor: done ? palette.green : palette.line, backgroundColor: done ? palette.green : 'transparent' }]}><Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>{done ? '✓' : ''}</Text></Pressable>}
    <View style={{ flex: 1 }}><View style={s.entryHeadline}><Text numberOfLines={1} style={[s.entryTitle, { color: done ? palette.muted : palette.ink, textDecorationLine: done ? 'line-through' : 'none' }]}>{item.title}</Text><Text style={[s.badge, { backgroundColor: palette.surfaceAlt, color: palette.ink }]}>{KIND_ICON[item.kind]} {KIND_LABEL[item.kind]}</Text></View>
      {!!item.body && <Text numberOfLines={2} style={[s.entryBody, { color: palette.muted }]}>{item.body}</Text>}{!!details && <Text style={[s.meta, { color: palette.muted }]}>{details}</Text>}{!!item.imageUris.length && <Text style={[s.meta, { color: palette.primaryDark }]}>▧ {item.imageUris.length} ảnh</Text>}</View>
    <View style={s.petStage} pointerEvents="none">
      <Animated.Image source={petIcon} style={[s.entryPet, petMotionStyle]} resizeMode="contain" />
      <Animated.Text style={[s.bloomFlower, s.bloomLeft, bloomStyle, { color: palette.pink }]}>✿</Animated.Text>
      <Animated.Text style={[s.bloomFlower, s.bloomTop, bloomStyle, { color: palette.accent }]}>✿</Animated.Text>
      <Animated.Text style={[s.bloomFlower, s.bloomRight, bloomStyle, { color: palette.yellow }]}>✿</Animated.Text>
    </View>
  </Pressable>;
}
function Empty({ palette, emoji, title, label, onPress, petIcon }: { palette: (typeof palettes)[ThemeName]; emoji: string; title: string; label: string; onPress: () => void; petIcon?: number }) {
  return <View style={[s.empty, { backgroundColor: palette.surface, borderColor: palette.line }]}>{petIcon ? <Image source={petIcon} style={s.emptyPet} /> : <Text style={{ fontSize: 32 }}>{emoji}</Text>}<Text style={[s.sectionTitle, { color: palette.ink }]}>{title}</Text><Button label={label} primary palette={palette} onPress={onPress} /></View>;
}
function QuickActions({ palette, onRecord, onAdd, addLabel }: { palette: (typeof palettes)[ThemeName]; onRecord: () => void | Promise<void>; onAdd: () => void; addLabel: string }) {
  return <View style={s.quickActions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Ghi âm" onPress={onRecord} style={({ pressed }) => [s.quickActionButton, { backgroundColor: palette.surfaceAlt, borderColor: palette.line, opacity: pressed ? 0.8 : 1 }]}>
      <MicIcon color={palette.primaryDark} />
      <Text numberOfLines={1} style={[s.quickActionLabel, { color: palette.ink }]}>Ghi âm</Text>
    </Pressable>
    <Pressable accessibilityLabel={addLabel} onPress={onAdd} style={({ pressed }) => [s.quickActionButton, { backgroundColor: palette.primary, borderColor: palette.primary, opacity: pressed ? 0.82 : 1 }]}>
      <Text style={{ color: '#FFFFFF', fontSize: 15, lineHeight: 18, fontWeight: '700' }}>✎</Text>
      <Text numberOfLines={1} style={[s.quickActionLabel, { color: '#FFFFFF' }]}>{addLabel}</Text>
    </Pressable>
  </View>;
}
function CalendarGrid({ dates, focus, mode, entries, palette, onSelect }: { dates: Date[]; focus: Date; mode: CalendarViewMode; entries: Entry[]; palette: (typeof palettes)[ThemeName]; onSelect: (date: Date) => void }) {
  const weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const focusedKey = localDayKey(focus);
  const eventDays = new Set(entries.filter((entry) => entry.dueAt).map((entry) => localDayKey(new Date(entry.dueAt!))));
  return <View style={[s.calendarGridWrap, { backgroundColor: palette.surface, borderColor: palette.line }]}>
    {mode !== 'day' && <View style={s.calendarWeekdays}>{weekdayLabels.map((label) => <Text key={label} style={[s.calendarWeekday, { color: palette.muted }]}>{label}</Text>)}</View>}
    <View style={s.calendarGrid}>{dates.map((date) => {
      const key = localDayKey(date);
      const selected = key === focusedKey;
      const isCurrentMonth = date.getMonth() === focus.getMonth();
      const hasEvents = eventDays.has(key);
      return <Pressable key={key} accessibilityRole="button" accessibilityLabel={date.toLocaleDateString('vi-VN')} onPress={() => onSelect(date)} style={[s.calendarCell, { width: mode === 'day' ? '100%' : '14.28%', minHeight: mode === 'day' ? 48 : 39 }]}>
        <View style={[s.calendarDateBubble, selected && { backgroundColor: palette.primary }]}><Text style={{ color: selected ? (palette.name === 'Thế Anh & Nho' ? '#071719' : '#FFFFFF') : isCurrentMonth || mode !== 'month' ? palette.ink : palette.muted, opacity: isCurrentMonth || mode !== 'month' ? 1 : 0.45, fontSize: mode === 'day' ? 15 : 12, fontWeight: selected ? '700' : '500' }}>{mode === 'day' ? date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' }) : date.getDate()}</Text></View>
        {hasEvents && <View style={[s.calendarEventDot, { backgroundColor: selected ? palette.primary : palette.accent }]} />}
      </Pressable>;
    })}</View>
  </View>;
}
function EventRow({ item, palette, petIcon, onPress }: { item: Entry; palette: (typeof palettes)[ThemeName]; petIcon: number; onPress: () => void }) {
  const date = item.dueAt ? new Date(item.dueAt) : undefined;
  return <Pressable onPress={onPress} style={({ pressed }) => [s.eventRow, { backgroundColor: palette.surface, borderColor: palette.line, opacity: pressed ? 0.78 : 1 }]}>
    <View style={[s.eventDateBadge, { backgroundColor: palette.surfaceAlt }]}><Text style={{ color: palette.primaryDark, fontSize: 10, fontWeight: '700' }}>{date?.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' }) || '—'}</Text><Text style={{ color: palette.muted, fontSize: 9 }}>{when(item.dueAt)}</Text></View>
    <View style={{ flex: 1 }}><Text style={[s.entryTitle, { color: palette.ink }]} numberOfLines={2}>{item.title}</Text>{!!item.body && <Text style={[s.entryBody, { color: palette.muted }]} numberOfLines={2}>{item.body}</Text>}</View>
    <Image source={petIcon} style={s.entryPet} resizeMode="contain" />
  </Pressable>;
}
type NavGlyphKind = 'home' | 'notes' | 'calendar' | 'settings';
function NavGlyph({ kind, color, active, palette }: { kind: NavGlyphKind; color: string; active: boolean; palette: (typeof palettes)[ThemeName] }) {
  return <View style={[s.navGlyph, { backgroundColor: active ? palette.surfaceAlt : 'transparent' }]}>
    {kind === 'home' && <View style={s.houseGlyph}>
      <View style={[s.houseRoofLeft, { backgroundColor: color }]} /><View style={[s.houseRoofRight, { backgroundColor: color }]} />
      <View style={[s.houseBody, { borderColor: color }]}><View style={[s.houseDoor, { backgroundColor: color }]} /></View>
    </View>}
    {kind === 'notes' && <View style={[s.notebookGlyph, { borderColor: color }]}>
      <View style={[s.notebookSpine, { backgroundColor: color }]} />
      <View style={s.notebookLines}>{[0, 1, 2].map((line) => <View key={line} style={[s.notebookLine, { backgroundColor: color }]} />)}</View>
    </View>}
    {kind === 'calendar' && <View style={[s.calendarGlyph, { borderColor: color }]}>
      <View style={[s.calendarHeader, { backgroundColor: color }]} />
      <View style={s.calendarDays}>{[0, 1, 2, 3].map((day) => <View key={day} style={[s.calendarDay, { backgroundColor: color }]} />)}</View>
      <View style={[s.calendarRing, { backgroundColor: color, left: 5 }]} /><View style={[s.calendarRing, { backgroundColor: color, right: 5 }]} />
    </View>}
    {kind === 'settings' && <View style={s.slidersGlyph}>{[0, 1, 2].map((row) => <View key={row} style={s.sliderTrackRow}>
      <View style={[s.sliderTrack, { backgroundColor: color }]} /><View style={[s.sliderKnob, { backgroundColor: palette.surface, borderColor: color, left: row === 0 ? 5 : row === 1 ? 13 : 9 }]} />
    </View>)}</View>}
  </View>;
}

function Integration({ icon, title, sub, palette, onPress }: { icon: string; title: string; sub: string; palette: (typeof palettes)[ThemeName]; onPress: () => void }) {
  return <Pressable onPress={onPress} style={s.integrationRow}><View style={[s.integrationIcon, { backgroundColor: palette.surfaceAlt }]}><Text style={{ color: palette.primaryDark, fontWeight: '600' }}>{icon}</Text></View><View style={{ flex: 1 }}><Text style={[s.integrationTitle, { color: palette.ink }]}>{title}</Text><Text style={[s.integrationSub, { color: palette.muted }]}>{sub}</Text></View><Text style={{ color: palette.muted, fontSize: 20 }}>›</Text></Pressable>;
}

const s = StyleSheet.create({
  safe: { flex: 1 }, shell: { flex: 1, width: '100%', alignSelf: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 21, paddingTop: 7, paddingBottom: 10 },
  logo: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, calicoMotion: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center' }, brandPet: { width: 39, height: 39 }, whiskerGroup: { position: 'absolute', top: 27, width: 8, height: 7, justifyContent: 'space-between' }, whiskersLeft: { left: 1 }, whiskersRight: { right: 1 }, whiskerLine: { height: 1, width: 7, borderRadius: 1 }, avatarPet: { width: 34, height: 34 },
  brand: { fontSize: 18, fontWeight: '700' }, brandSub: { fontSize: 10, marginTop: 1 }, avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 118 },
  hero: { flexDirection: 'row', alignItems: 'center', marginBottom: 17 }, eyebrow: { fontSize: 9, fontWeight: '600', letterSpacing: 1.2, marginBottom: 7 },
  title: { fontSize: 27, fontWeight: '600', lineHeight: 35, letterSpacing: -0.45 }, subtitle: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  progress: { borderWidth: 1, borderRadius: 18, gap: 10, padding: 12, marginBottom: 24 }, progressTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, progressTrack: { height: 8, borderRadius: 5, overflow: 'hidden' }, progressFill: { height: '100%', borderRadius: 5 }, progressPet: { width: 38, height: 38 },
  progressIcon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, progressTitle: { fontSize: 14, fontWeight: '600' }, progressCaption: { fontSize: 12, marginTop: 3 }, progressNumber: { fontSize: 20, fontWeight: '700' },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }, sectionTitle: { fontSize: 18, fontWeight: '600', flexShrink: 1 }, sectionCaption: { fontSize: 12, marginTop: 3 },
  plus: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 9 },
  pill: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 8, minHeight: 32, justifyContent: 'center' },
  search: { borderWidth: 1, borderRadius: 13, minHeight: 42, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  dayLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1 }, handText: { fontSize: 11, fontStyle: 'italic', transform: [{ rotate: '-3deg' }] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15, paddingVertical: 12, paddingHorizontal: 10, minHeight: 68, marginBottom: 8 },
  entryCompact: { width: '49%' }, petStage: { width: 40, height: 40, position: 'relative', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }, entryPet: { width: 40, height: 40 }, bloomFlower: { position: 'absolute', fontSize: 13, lineHeight: 16 }, bloomLeft: { left: 0, top: 5 }, bloomTop: { top: -2, right: 9 }, bloomRight: { right: -1, top: 9 }, check: { width: 30, height: 30, borderWidth: 1.5, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  entryHeadline: { flexDirection: 'row', alignItems: 'center', gap: 5 }, entryTitle: { fontSize: 14, fontWeight: '600', flexShrink: 1 }, badge: { overflow: 'hidden', fontSize: 8, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 6 },
  entryBody: { fontSize: 12, marginTop: 4, lineHeight: 17 }, meta: { fontSize: 10, marginTop: 4 }, noteHint: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 14, marginTop: 12 },
  fabGroup: { position: 'absolute', right: 20, bottom: 94 }, quickActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }, quickActionButton: { width: 76, height: 42, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }, quickActionLabel: { fontSize: 10, fontWeight: '700' }, micGlyph: { width: 23, height: 27, alignItems: 'center' }, micHead: { width: 8, height: 13, borderRadius: 5 }, micArch: { width: 17, height: 9, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, marginTop: -2 }, micStem: { width: 2, height: 4, marginTop: -1 }, micFoot: { width: 10, height: 2 },
  nav: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 1, paddingTop: 7, paddingBottom: Platform.OS === 'ios' ? 2 : 6, flexDirection: 'row', justifyContent: 'space-around' },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, minHeight: 70 }, navGlyph: { width: 42, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, navLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  houseGlyph: { width: 28, height: 26, alignItems: 'center', justifyContent: 'flex-end' }, houseRoofLeft: { position: 'absolute', width: 16, height: 3, borderRadius: 2, top: 7, left: 1, transform: [{ rotate: '-42deg' }] }, houseRoofRight: { position: 'absolute', width: 16, height: 3, borderRadius: 2, top: 7, right: 1, transform: [{ rotate: '42deg' }] }, houseBody: { width: 19, height: 15, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, alignItems: 'center', justifyContent: 'flex-end' }, houseDoor: { width: 5, height: 8, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  notebookGlyph: { width: 22, height: 25, borderWidth: 2, borderRadius: 4, flexDirection: 'row', alignItems: 'center', paddingLeft: 4, gap: 3 }, notebookSpine: { width: 2, height: 17, borderRadius: 2 }, notebookLines: { flex: 1, gap: 4 }, notebookLine: { height: 2, width: 9, borderRadius: 2 },
  calendarGlyph: { width: 24, height: 23, borderWidth: 2, borderRadius: 5, marginTop: 3, overflow: 'visible' }, calendarHeader: { height: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2, marginTop: 2, marginHorizontal: 2 }, calendarDays: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, padding: 4 }, calendarDay: { width: 4, height: 4, borderRadius: 1 }, calendarRing: { position: 'absolute', top: -4, width: 3, height: 7, borderRadius: 2 },
  slidersGlyph: { width: 25, gap: 5 }, sliderTrackRow: { height: 5, justifyContent: 'center' }, sliderTrack: { height: 2, width: 24, borderRadius: 2 }, sliderKnob: { position: 'absolute', top: 0, width: 6, height: 6, borderRadius: 3, borderWidth: 1.5 },
  empty: { alignItems: 'center', gap: 8, padding: 21, borderWidth: 1, borderRadius: 18 }, emptyPet: { width: 84, height: 84 }, placeholderPet: { width: 70, height: 70 }, noteGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 4 },
  note: { borderWidth: 1, borderRadius: 5, padding: 9, marginBottom: 2, minHeight: 165, shadowColor: '#654B3D', shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 1, height: 3 }, elevation: 1 },
  photo: { width: '100%', height: 95, borderRadius: 4, marginBottom: 8, backgroundColor: '#EADFD4' }, photoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  noteTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 }, noteBody: { fontSize: 12, lineHeight: 17, marginTop: 4 }, noteDate: { fontSize: 9, marginTop: 8 },
  calendarBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 17, marginVertical: 17 },
  calendarTabs: { flexDirection: 'row', gap: 5, padding: 4, borderRadius: 14, marginBottom: 14 }, calendarTab: { flex: 1, minHeight: 38, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  calendarTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 17, marginBottom: 10 }, calendarArrow: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, calendarHeading: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', textTransform: 'capitalize' }, calendarModes: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 13, marginBottom: 9 }, calendarMode: { flex: 1, minHeight: 34, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calendarGridWrap: { borderWidth: 1, borderRadius: 14, padding: 8, marginBottom: 14 }, calendarWeekdays: { flexDirection: 'row', marginBottom: 4 }, calendarWeekday: { width: '14.28%', textAlign: 'center', fontSize: 9, fontWeight: '600' }, calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, calendarCell: { alignItems: 'center', justifyContent: 'center', gap: 2 }, calendarDateBubble: { minWidth: 25, minHeight: 25, paddingHorizontal: 6, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, calendarEventDot: { width: 4, height: 4, borderRadius: 2 },
  eventRow: { minHeight: 74, borderWidth: 1, borderRadius: 16, padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, eventDateBadge: { width: 54, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 3 }, eventDateFields: { flexDirection: 'row', gap: 8 }, eventDateInput: { flex: 1, marginBottom: 8 }, eventTimeInput: { width: 104, marginBottom: 8 }, eventDetailCard: { borderWidth: 1, borderRadius: 18, padding: 17, marginTop: 8 }, eventDetailDate: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize' }, eventDetailTime: { fontSize: 27, fontWeight: '700', marginTop: 7 }, eventDetailBody: { fontSize: 14, lineHeight: 21, marginTop: 14 }, eventDetailActions: { flexDirection: 'row', gap: 9, marginTop: 17 }, eventDetailButton: { flex: 1, minHeight: 45, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  integration: { borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginTop: 12 },
  integrationTitle: { fontSize: 11, fontWeight: '600' }, integrationSub: { fontSize: 9, marginTop: 3 },
  themeChoice: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1.5, borderRadius: 16, padding: 11 },
  swatches: { width: 73, height: 36, borderRadius: 12, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' }, swatch: { width: 15, height: 15, borderRadius: 8, borderWidth: 1, borderColor: '#FFFFFF99' },
  integrationBox: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11 }, integrationRow: { minHeight: 63, flexDirection: 'row', alignItems: 'center', gap: 10 },
  integrationIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, divider: { height: 1, marginLeft: 44 },
  version: { textAlign: 'center', fontSize: 8, letterSpacing: 1, marginVertical: 22 },
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: '#342A2770' },
  sheet: { width: '100%', maxHeight: '92%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 18 : 10 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 13 }, sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '600' }, close: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '600', marginTop: 10, marginBottom: 7 }, input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, minHeight: 46, fontSize: 15, marginBottom: 8 },
  bodyInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, minHeight: 82, fontSize: 14, marginBottom: 2 },
  voiceTranscript: { minHeight: 165, fontSize: 16, lineHeight: 24, padding: 15 }, voiceControls: { alignItems: 'center', gap: 11, marginTop: 18 }, voiceRecordButton: { width: '100%', minHeight: 76, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }, voiceRecordLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  color: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, marginRight: 7 }, button: { borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  preview: { width: 84, height: 76, borderRadius: 9 }, removePhoto: { position: 'absolute', top: 4, right: 4, width: 21, height: 21, borderRadius: 11, backgroundColor: '#4C403ACC', justifyContent: 'center', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18 }, delete: { borderWidth: 1, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 11 }, mediaActions: { flexDirection: 'row', gap: 8 }, mediaButton: { flex: 1, minHeight: 43, borderWidth: 1, borderRadius: 13, justifyContent: 'center', alignItems: 'center' }, retrySave: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 14, borderWidth: 1 },
  cancel: { borderRadius: 11, paddingVertical: 10, paddingHorizontal: 13 }, save: { borderRadius: 11, paddingVertical: 10, paddingHorizontal: 16 },
});
