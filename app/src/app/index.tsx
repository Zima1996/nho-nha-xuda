import { useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
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
import { loadAppData, saveAppData, starterData } from '@/data/local-store';
import type { AppData, Entry, EntryKind, ThemeName } from '@/types/entry';

type Tab = 'today' | 'notes' | 'calendar' | 'settings';
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
function persistMedia(uri: string, extension: string) {
  const saved = new File(Paths.document, 'nho-nha-' + id() + extension);
  new File(uri).copy(saved);
  return saved.uri;
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('today');
  const [data, setData] = useState<AppData>(starterData);
  const [ready, setReady] = useState(false);
  const [petSeed, setPetSeed] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setPetSeed(Math.random()), 0); return () => clearTimeout(timer); }, []);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<Draft>(newDraft());
  const [audioUri, setAudioUri] = useState<string>();
  const [transcript, setTranscript] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const transcriptRef = useRef('');
  const partialRef = useRef('');
  const contentBeforeTranscriptRef = useRef('');
  const browserRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const shouldRecognizeRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
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
  useSpeechRecognitionEvent('end', () => setTranscribing(false));
  useSpeechRecognitionEvent('error', (event) => {
    setTranscribing(false);
    if (event.error !== 'aborted') Alert.alert('Chưa chuyển được thành chữ', 'Bạn có thể thử lại hoặc giữ nguyên bản ghi âm.');
  });

  useEffect(() => {
    loadAppData().then((saved) => { setData(saved); setReady(true); }).catch(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready) saveAppData(data).catch((error) => console.warn('Local save failed', error));
  }, [data, ready]);

  const list = useMemo(() => {
    let result = data.entries;
    if (tab === 'today') result = result.filter((item) => item.kind !== 'note');
    if (tab === 'notes') result = result.filter((item) => item.kind === 'note');
    if (tab === 'calendar') result = result.filter((item) => item.kind === 'event' || item.kind === 'routine' || !!item.dueAt);
    if (query.trim()) {
      const needle = query.trim().toLocaleLowerCase('vi');
      result = result.filter((item) => (item.title + ' ' + item.body + ' ' + (item.transcript || '')).toLocaleLowerCase('vi').includes(needle));
    }
    return [...result].sort((a, b) => (a.dueAt || a.createdAt).localeCompare(b.dueAt || b.createdAt));
  }, [data.entries, tab, query]);

  function begin(kindValue: EntryKind = 'task', item?: Entry) {
    setEditing(item?.id || null);
    if (item) {
      const { id: _id, createdAt: _created, ...rest } = item;
      setDraft({ ...rest, imageUris: [...item.imageUris] });
      setAudioUri(item.audioUri);
      setTranscript(item.transcript || '');
    } else {
      setDraft(newDraft(kindValue)); setAudioUri(undefined); setTranscript('');
    }
    transcriptRef.current = item?.transcript || '';
    setVisible(true);
  }
  function put(item: Entry) {
    setData((current) => ({
      ...current,
      entries: current.entries.some((entry) => entry.id === item.id)
        ? current.entries.map((entry) => entry.id === item.id ? item : entry)
        : [item, ...current.entries],
    }));
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
    const title = draft.title.trim() || draft.body.trim().split('\n')[0].slice(0, 54) || transcript.trim().split('\n')[0].slice(0, 54) || (audioUri ? 'Bản ghi âm mới' : '');
    if (!title) { Alert.alert('Thêm một chút nội dung nhé', 'Nhập tiêu đề hoặc ghi chú trước khi lưu.'); return; }
    const previous = data.entries.find((entry) => entry.id === editing);
    if (previous?.notificationId && (!draft.reminderAt || draft.reminderAt !== previous.reminderAt)) {
      Notifications.cancelScheduledNotificationAsync(previous.notificationId).catch(() => undefined);
    }
    const item: Entry = {
      ...draft, title, id: editing || id(), createdAt: previous?.createdAt || new Date().toISOString(),
      audioUri: audioUri || draft.audioUri, transcript: transcript || draft.transcript,
    };
    if (item.reminderAt && (!previous || item.reminderAt !== previous.reminderAt)) {
      try { item.notificationId = await setReminder(item); }
      catch { Alert.alert('Nhắc nhở chưa bật', 'Bạn có thể bật quyền thông báo trong Cài đặt iPhone.'); }
    }
    put(item); setVisible(false);
  }
  function removeEntry() {
    const item = data.entries.find((entry) => entry.id === editing);
    if (item?.notificationId) Notifications.cancelScheduledNotificationAsync(item.notificationId).catch(() => undefined);
    setData((current) => ({ ...current, entries: current.entries.filter((entry) => entry.id !== editing) }));
    setVisible(false);
  }
  async function choosePhoto(camera: boolean) {
    try {
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsEditing: true });
      if (!result.canceled && result.assets[0]?.uri) {
        const uri = persistMedia(result.assets[0].uri, '.jpg');
        setDraft((value) => ({ ...value, imageUris: [...value.imageUris, uri] }));
      }
    } catch { Alert.alert('Chưa thêm được ảnh', 'Thử chụp ảnh hoặc chọn lại từ thư viện nhé.'); }
  }
  async function record() {
    try {
      if (recorderState.isRecording) {
        if (Platform.OS === 'web') { shouldRecognizeRef.current = false; browserRecognitionRef.current?.stop(); }
        await recorder.stop();
        if (recorder.uri) {
          const uri = persistMedia(recorder.uri, '.m4a');
          setAudioUri(uri); setDraft((value) => ({ ...value, audioUri: uri }));
          if (Platform.OS !== 'web') setTimeout(() => transcribe(uri), 250);
        }
      } else {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) { Alert.alert('Cần quyền micro', 'Cho phép dùng micro để ghi âm ghi chú.'); return; }
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
        for (let index = 0; index < event.results.length; index += 1) {
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
        } else setTranscribing(false);
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
      if (!permission.granted) { Alert.alert('Cần quyền nhận dạng giọng nói', 'Cho phép quyền này để tạo văn bản từ bản ghi.'); return; }
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
    } catch { setTranscribing(false); Alert.alert('Chưa chuyển được thành chữ', 'Thiết bị có thể chưa hỗ trợ nhận dạng tiếng Việt cho bản ghi này.'); }
  }
  const total = data.entries.filter((entry) => entry.kind !== 'note').length;
  const done = data.entries.filter((entry) => entry.kind !== 'note' && entry.status === 'done').length;
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
                <Text style={[s.title, { color: colors.ink }]}>Chào buổi sáng, Xuda <Text style={{ color: colors.primary }}>✿</Text></Text>
              </View>
            </View>
            <View style={[s.progress, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={s.progressTop}><View style={[s.progressIcon, { backgroundColor: colors.soft }]}><Image source={petFor('progress', petSeed)} style={s.progressPet} /></View>
                <View style={{ flex: 1 }}><Text style={[s.progressTitle, { color: colors.ink }]}>{done} / {total} việc đã xong</Text></View>
                <Text style={[s.progressNumber, { color: colors.primary }]}>{total ? Math.round(done / total * 100) : 0}%</Text></View>
              <View style={[s.progressTrack, { backgroundColor: colors.line }]}><View style={[s.progressFill, { width: `${total ? Math.round(done / total * 100) : 0}%`, backgroundColor: colors.primary }]} /></View>
            </View>
            <View style={s.sectionTop}><Text style={[s.sectionTitle, { color: colors.ink }]}>Việc cần nhớ</Text></View>
            <Search value={query} onChange={setQuery} palette={colors} />
            <View style={s.listHead}><Text style={[s.dayLabel, { color: colors.muted }]}>HÔM NAY · {list.length} MỤC</Text><Text style={[s.handText, { color: colors.primaryDark }]}>{copy.nudge}</Text></View>
            {list.length ? <View style={tablet ? s.grid : undefined}>{list.map((item) => <EntryRow key={item.id} item={item} palette={colors} petIcon={petFor(item.id, petSeed)} compact={tablet} onOpen={() => begin(item.kind, item)} onToggle={() => put({ ...item, status: item.status === 'done' ? 'todo' : 'done' })} />)}</View> : <View style={[s.empty, { backgroundColor: colors.surface, borderColor: colors.line }]}><Image source={petFor('empty-today', petSeed)} style={s.emptyPet} /><Text style={[s.sectionTitle, { color: colors.ink }]}>Chưa có gì ở đây</Text><Text style={[s.subtitle, { color: colors.muted }]}>{copy.empty}</Text><Button label="＋ Ghi nhanh" primary palette={colors} onPress={() => begin()} /></View>}
          </>}
          {tab === 'notes' && <>
            <Text style={[s.eyebrow, { color: colors.muted }]}>GÓC LƯU GIỮ</Text><Text style={[s.title, { color: colors.ink }]}>Những điều mình cất lại <Text style={{ color: colors.primary }}>✎</Text></Text><Text style={[s.subtitle, { color: colors.muted, marginBottom: 15 }]}>{copy.notes}</Text>
            <Search value={query} onChange={setQuery} palette={colors} />
            <View style={[s.noteGrid, { gap: 10 }]}>{list.map((item, index) => <Pressable key={item.id} onPress={() => begin('note', item)} style={[s.note, { backgroundColor: index % 2 ? colors.surfaceAlt : colors.surface, borderColor: colors.line, width: tablet ? '31.5%' : '48%', transform: [{ rotate: index % 2 ? '0.5deg' : '-0.5deg' }] }]}>
              {item.imageUris[0] ? <Image source={{ uri: item.imageUris[0] }} style={s.photo} /> : <View style={[s.photo, s.photoPlaceholder, { backgroundColor: colors.surfaceAlt }]}><Image source={petFor(item.id, petSeed)} style={s.placeholderPet} /></View>}
              <Text style={[s.noteTitle, { color: colors.ink }]} numberOfLines={2}>{item.title}</Text>
              {!!item.body && <Text style={[s.noteBody, { color: colors.muted }]} numberOfLines={4}>{item.body}</Text>}
              {!!item.imageUris.length && <Text style={[s.noteDate, { color: colors.primaryDark }]}>{item.imageUris.length} ảnh</Text>}
            </Pressable>)}</View>
            {!list.length && <Empty palette={colors} emoji="📔" petIcon={petFor('empty-notes', petSeed)} title="Sổ còn đang chờ bạn" label="＋ Tạo Note" onPress={() => begin('note')} />}
          </>}
          {tab === 'calendar' && <>
            <Text style={[s.eyebrow, { color: colors.muted }]}>LỊCH CỦA MÌNH</Text><Text style={[s.title, { color: colors.ink }]}>Nhìn trước một chút <Text style={{ color: colors.primary }}>☁</Text></Text><Text style={[s.subtitle, { color: colors.muted }]}>Các sự kiện và việc có giờ hẹn.</Text>
            <View style={[s.calendarBanner, { backgroundColor: colors.surfaceAlt }]}><Text style={{ fontSize: 26 }}>🗓️</Text><View><Text style={[s.progressTitle, { color: colors.ink }]}>Hôm nay</Text><Text style={[s.progressCaption, { color: colors.muted }]}>Sự kiện và việc có giờ hẹn.</Text></View></View>
            {list.map((item) => <EntryRow key={item.id} item={item} palette={colors} petIcon={petFor(item.id, petSeed)} onOpen={() => begin(item.kind, item)} onToggle={() => put({ ...item, status: item.status === 'done' ? 'todo' : 'done' })} />)}
            {!list.length && <Empty palette={colors} emoji="☕" petIcon={petFor('empty-calendar', petSeed)} title="Lịch đang thoáng" label="＋ Ghi nhanh" onPress={() => begin('task')} />}
            <View style={[s.integration, { borderColor: colors.line, backgroundColor: colors.surface }]}><Text style={{ fontSize: 22 }}>🌐</Text><View style={{ flex: 1 }}><Text style={[s.integrationTitle, { color: colors.ink }]}>Google Calendar</Text><Text style={[s.integrationSub, { color: colors.muted }]}>Kết nối trong phần Cài đặt.</Text></View><Text style={{ color: colors.primary, fontSize: 21 }}>○</Text></View>
          </>}
          {tab === 'settings' && <>
            <Text style={[s.eyebrow, { color: colors.muted }]}>GÓC CỦA BẠN</Text><Text style={[s.title, { color: colors.ink }]}>Cài đặt nhỏ xinh <Text style={{ color: colors.primary }}>⚙</Text></Text><Text style={[s.subtitle, { color: colors.muted, marginBottom: 22 }]}>Chọn cảm giác hợp với bạn.</Text>
            <Text style={[s.sectionTitle, { color: colors.ink }]}>Màu sắc chủ đạo</Text><Text style={[s.sectionCaption, { color: colors.muted, marginBottom: 12 }]}>Tông ấm, chữ rõ, nét sổ tay handmade.</Text>
            <View style={{ gap: 10 }}>{(Object.keys(palettes) as ThemeName[]).map((key) => {
              const choice = palettes[key]; const selected = data.theme === key;
              return <Pressable key={key} onPress={() => setData((current) => ({ ...current, theme: key }))} style={[s.themeChoice, { backgroundColor: choice.surface, borderColor: selected ? choice.primary : choice.line }]}>
                <View style={[s.swatches, { backgroundColor: choice.paper }]}>{[choice.accent, choice.primary, choice.green].map((color) => <View key={color} style={[s.swatch, { backgroundColor: color }]} />)}</View>
                <View style={{ flex: 1 }}><Text style={[s.progressTitle, { color: choice.ink }]}>{choice.name}</Text><Text style={[s.progressCaption, { color: choice.muted }]}>{choice.description}</Text></View><Text style={{ fontSize: 20, color: choice.primary }}>{selected ? '✓' : '○'}</Text>
              </Pressable>;
            })}</View>
            <Text style={[s.sectionTitle, { color: colors.ink, marginTop: 24, marginBottom: 10 }]}>Tài khoản & đồng bộ</Text>
            <View style={[s.integrationBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <Integration icon="" title="Đăng nhập Apple" sub="Đồng bộ riêng tư giữa thiết bị" palette={colors} onPress={() => Alert.alert('Đăng nhập Apple', 'Đăng nhập sẽ được nối sau khi cấu hình dịch vụ tài khoản.')} />
              <View style={[s.divider, { backgroundColor: colors.line }]} />
              <Integration icon="G" title="Đăng nhập Google" sub="Dùng cùng tài khoản với Calendar" palette={colors} onPress={() => Alert.alert('Đăng nhập Google', 'Đăng nhập sẽ được nối sau khi cấu hình dịch vụ tài khoản.')} />
              <View style={[s.divider, { backgroundColor: colors.line }]} />
              <Integration icon="🗓️" title="Google Calendar" sub="Chưa kết nối · đồng bộ hai chiều" palette={colors} onPress={() => Alert.alert('Google Calendar', 'Đồng bộ cần cấu hình ứng dụng Google Cloud và OAuth.')} />
            </View>
            <Pressable onPress={() => Alert.alert('Đang lưu trên thiết bị', 'Bản đầu lưu dữ liệu cục bộ. Đồng bộ nhiều thiết bị sẽ được nối sau.')} style={[s.noteHint, { backgroundColor: colors.surfaceAlt, marginTop: 18 }]}><Text>🔒</Text><Text style={{ flex: 1, color: colors.ink, fontSize: 11 }}>Nội dung đang được lưu trên thiết bị này.</Text><Text style={{ color: colors.primaryDark }}>›</Text></Pressable>
            <Text style={[s.version, { color: colors.muted }]}>NHỚ NHA · BẢN ĐẦU TIÊN</Text>
          </>}
        </ScrollView>

        {tab !== 'settings' && <View style={s.fabGroup}><Pressable accessibilityLabel="Ghi âm nhanh và tự chuyển thành chữ" onPress={async () => { if (recorderState.isRecording) { await record(); return; } setTab('today'); begin('note'); setTimeout(async () => { await record(); }, 350); }} style={({ pressed }) => [s.quickMic, { backgroundColor: recorderState.isRecording ? '#C84535' : colors.surface, borderColor: recorderState.isRecording ? '#C84535' : colors.line, opacity: pressed ? 0.8 : 1 }]}>{recorderState.isRecording ? <Text style={{ color: '#FFFFFF', fontSize: 17 }}>■</Text> : <MicIcon color={colors.primaryDark} />}</Pressable><Pressable onPress={() => begin(tab === 'notes' ? 'note' : 'task')} style={({ pressed }) => [s.fab, { backgroundColor: colors.primary, shadowColor: colors.primaryDark, opacity: pressed ? 0.85 : 1 }]}><Text style={s.fabPlus}>＋</Text><Text style={s.fabText}>{tab === 'notes' ? 'Thêm Note' : 'Ghi nhanh'}</Text></Pressable></View>}
        <View style={[s.nav, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {([['today', 'home', 'Hôm nay'], ['notes', 'notes', 'Ghi chú'], ['calendar', 'calendar', 'Lịch'], ['settings', 'settings', 'Setting']] as [Tab, NavGlyphKind, string][]).map(([page, icon, label]) => <Pressable key={page} onPress={() => { setTab(page); setQuery(''); }} style={s.navItem}><NavGlyph kind={icon} color={tab === page ? colors.primaryDark : colors.muted} active={tab === page} palette={colors} /><Text style={[s.navLabel, { color: tab === page ? colors.primaryDark : colors.muted }]}>{label}</Text></Pressable>)}
        </View>
      </View>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { setVisible(false); if (recorderState.isRecording) recorder.stop().catch(() => undefined); }}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View style={[s.sheet, { backgroundColor: colors.paper, maxWidth: tablet ? 620 : 600 }]}>
            <View style={[s.handle, { backgroundColor: colors.line }]} />
            <View style={s.sheetHead}><View><Text style={[s.sheetTitle, { color: colors.ink }]}>{editing ? 'Sửa điều đã ghi' : 'Ghi nhanh một điều'}</Text><Text style={[s.sectionCaption, { color: colors.muted }]}>Viết vài chữ, chụp ảnh hay ghi âm đều được.</Text></View><Pressable onPress={() => setVisible(false)} style={[s.close, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink, fontSize: 20 }}>×</Text></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <TextInput value={draft.title} onChangeText={(title) => setDraft((current) => ({ ...current, title }))} placeholder="Tiêu đề ngắn gọn..." placeholderTextColor={colors.muted} style={[s.input, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }]} />
              <TextInput value={draft.body} onChangeText={(body) => setDraft((current) => ({ ...current, body }))} placeholder={draft.kind === 'note' ? 'Viết thêm điều bạn muốn nhớ...' : 'Ghi chú thêm (không bắt buộc)'} placeholderTextColor={colors.muted} multiline textAlignVertical="top" style={[s.bodyInput, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }]} />
              {draft.kind !== 'note' && <><Text style={[s.label, { color: colors.ink }]}>Nhắc mình lúc nào?</Text><View style={s.pills}>
                <Pill label="Không nhắc" active={!draft.reminderAt} palette={colors} onPress={() => setDraft((current) => ({ ...current, reminderAt: undefined, reminderChoice: undefined }))} />
                <Pill label="Trong 1 giờ" active={draft.reminderChoice === 'hour'} palette={colors} onPress={() => setDraft((current) => ({ ...current, reminderAt: new Date(Date.now() + 3600000).toISOString(), dueAt: new Date(Date.now() + 3600000).toISOString(), reminderChoice: 'hour' }))} />
                <Pill label="Tối nay" active={!!draft.reminderAt && new Date(draft.reminderAt).getHours() === 20} palette={colors} onPress={() => setDraft((current) => ({ ...current, reminderAt: today(20), dueAt: today(20), reminderChoice: 'evening' }))} />
                <Pill label="Ngày mai" active={!!draft.reminderAt && new Date(draft.reminderAt).getDate() !== new Date().getDate()} palette={colors} onPress={() => { const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0); setDraft((current) => ({ ...current, reminderAt: next.toISOString(), dueAt: next.toISOString(), reminderChoice: 'tomorrow' })); }} />
              </View></>}
              {draft.kind === 'note' && <>
                <Text style={[s.label, { color: colors.ink }]}>Thêm ảnh vào Note</Text><View style={s.pills}><Button label="📷  Chụp ảnh" palette={colors} onPress={() => choosePhoto(true)} /><Button label="▧  Thư viện" palette={colors} onPress={() => choosePhoto(false)} /></View>
                {!!draft.imageUris.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingVertical: 10 }}>{draft.imageUris.map((uri) => <View key={uri} style={{ position: 'relative' }}><Image source={{ uri }} style={s.preview} /><Pressable onPress={() => setDraft((current) => ({ ...current, imageUris: current.imageUris.filter((value) => value !== uri) }))} style={s.removePhoto}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>×</Text></Pressable></View>)}</ScrollView>}
              </>}
              <Text style={[s.label, { color: colors.ink }]}>{transcribing ? 'Đang chuyển giọng nói thành chữ…' : recorderState.isRecording ? 'Đang ghi âm · chạm nút để dừng' : 'Ghi âm giọng nói'}</Text><View style={[s.pills, { alignItems: 'center' }]}><Button label={recorderState.isRecording ? 'Dừng ghi' : 'Bắt đầu ghi'} primary={recorderState.isRecording} palette={colors} onPress={record} />{audioUri && <Text style={{ color: colors.green, fontSize: 10 }}>✓ Đã lưu bản ghi</Text>}</View>
              {!!audioUri && <View style={s.pills}><AudioPlayback uri={audioUri} palette={colors} />{Platform.OS !== 'web' && <Button label={transcribing ? 'Đang chuyển thành chữ…' : 'A  Chuyển thành văn bản'} palette={colors} onPress={transcribe} />}</View>}
              <View style={s.actions}>{editing && <Pressable onPress={removeEntry} style={[s.delete, { borderColor: colors.line }]}><Text style={{ color: colors.primaryDark }}>Xóa mục</Text></Pressable>}<View style={{ flex: 1 }} /><Pressable onPress={() => setVisible(false)} style={[s.cancel, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.ink }}>Để sau</Text></Pressable><Pressable onPress={save} style={[s.save, { backgroundColor: colors.primary }]}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Lưu lại ✿</Text></Pressable></View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  return <Pressable onPress={onOpen} style={({ pressed }) => [s.entry, compact && s.entryCompact, { backgroundColor: palette.surface, borderColor: palette.line, opacity: pressed ? 0.84 : 1 }]}>
    {item.kind !== 'note' && <Pressable onPress={(event) => { event.stopPropagation(); onToggle(); }} accessibilityRole="checkbox" accessibilityState={{ checked: done }} style={[s.check, { borderColor: done ? palette.green : palette.line, backgroundColor: done ? palette.green : 'transparent' }]}><Text style={{ color: '#FFFFFF', fontSize: 12 }}>{done ? '✓' : ''}</Text></Pressable>}
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
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, sectionTitle: { fontSize: 18, fontWeight: '600' }, sectionCaption: { fontSize: 12, marginTop: 3 },
  plus: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 9 },
  pill: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 8, minHeight: 32, justifyContent: 'center' },
  search: { borderWidth: 1, borderRadius: 13, minHeight: 42, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  dayLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1 }, handText: { fontSize: 11, fontStyle: 'italic', transform: [{ rotate: '-3deg' }] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15, paddingVertical: 12, paddingHorizontal: 10, minHeight: 68, marginBottom: 8 },
  entryCompact: { width: '49%' }, petStage: { width: 40, height: 40, position: 'relative', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }, entryPet: { width: 40, height: 40 }, bloomFlower: { position: 'absolute', fontSize: 13, lineHeight: 16 }, bloomLeft: { left: 0, top: 5 }, bloomTop: { top: -2, right: 9 }, bloomRight: { right: -1, top: 9 }, check: { width: 20, height: 20, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  entryHeadline: { flexDirection: 'row', alignItems: 'center', gap: 5 }, entryTitle: { fontSize: 14, fontWeight: '600', flexShrink: 1 }, badge: { overflow: 'hidden', fontSize: 8, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 6 },
  entryBody: { fontSize: 12, marginTop: 4, lineHeight: 17 }, meta: { fontSize: 10, marginTop: 4 }, noteHint: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 14, marginTop: 12 },
  fabGroup: { position: 'absolute', right: 20, bottom: 94, flexDirection: 'row', alignItems: 'center', gap: 10 }, quickMic: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.16, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } }, micGlyph: { width: 23, height: 27, alignItems: 'center' }, micHead: { width: 8, height: 13, borderRadius: 5 }, micArch: { width: 17, height: 9, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, marginTop: -2 }, micStem: { width: 2, height: 4, marginTop: -1 }, micFoot: { width: 10, height: 2 }, fab: { borderRadius: 20, minHeight: 72, paddingHorizontal: 21, flexDirection: 'row', alignItems: 'center', gap: 9, elevation: 4, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabPlus: { color: '#FFF', fontSize: 30 }, fabText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
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
  color: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, marginRight: 7 }, button: { borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  preview: { width: 84, height: 76, borderRadius: 9 }, removePhoto: { position: 'absolute', top: 4, right: 4, width: 21, height: 21, borderRadius: 11, backgroundColor: '#4C403ACC', justifyContent: 'center', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18 }, delete: { borderWidth: 1, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 11 },
  cancel: { borderRadius: 11, paddingVertical: 10, paddingHorizontal: 13 }, save: { borderRadius: 11, paddingVertical: 10, paddingHorizontal: 16 },
});
