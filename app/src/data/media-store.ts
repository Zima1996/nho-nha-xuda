import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

const DB_NAME = 'nho-nha-media-v1';
const STORE_NAME = 'media';
const MEDIA_PREFIX = 'xuda-media:';
const objectUrls = new Map<string, string>();
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Kho media trên trình duyệt không khả dụng.'));
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không mở được kho media.'));
    });
  }
  return database;
}

function mediaId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function extensionFor(blob: Blob, fallback: string): string {
  if (blob.type === 'audio/mpeg') return '.mp3';
  if (blob.type === 'audio/mp4' || blob.type === 'audio/aac') return '.m4a';
  if (blob.type === 'audio/webm') return '.webm';
  if (blob.type === 'image/png') return '.png';
  if (blob.type === 'image/webp') return '.webp';
  if (blob.type === 'image/jpeg') return '.jpg';
  return fallback;
}

/** Persist photos and recordings outside localStorage so large files survive app restarts. */
export async function saveMedia(sourceUri: string, fallbackExtension: string): Promise<string> {
  if (Platform.OS !== 'web') {
    const extension = sourceUri.match(/\.([a-z\d]+)(?:[?#]|$)/i)?.[0]?.split(/[?#]/)[0] || fallbackExtension;
    const saved = new File(Paths.document, `nho-nha-${mediaId()}${extension}`);
    new File(sourceUri).copy(saved);
    return saved.uri;
  }

  const response = await fetch(sourceUri);
  if (!response.ok) throw new Error('Không đọc được media vừa tạo.');
  const blob = await response.blob();
  const key = mediaId();
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Không lưu được media.'));
    transaction.onabort = () => reject(transaction.error || new Error('Không lưu được media.'));
  });
  return `${MEDIA_PREFIX}${key}${extensionFor(blob, fallbackExtension)}`;
}

/** Resolve an IndexedDB media reference to a browser-playable/displayable URL. */
export async function resolveMediaUri(uri: string): Promise<string> {
  if (!uri.startsWith(MEDIA_PREFIX)) return uri;
  const cached = objectUrls.get(uri);
  if (cached) return cached;
  const key = uri.slice(MEDIA_PREFIX.length).replace(/\.[a-z\d]+$/i, '');
  const db = await openDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error || new Error('Không đọc được media đã lưu.'));
  });
  if (!blob) throw new Error('Không tìm thấy media đã lưu.');
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(uri, objectUrl);
  return objectUrl;
}
