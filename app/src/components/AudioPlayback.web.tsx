import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import type { Palette } from '@/constants/palettes';
import { resolveMediaUri } from '@/data/media-store';

export function AudioPlayback({ uri, palette }: { uri: string; palette: Palette }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [loadedUri, setLoadedUri] = useState<string>();
  const [failedUri, setFailedUri] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const ready = loadedUri === uri;
  const failed = failedUri === uri;
  useEffect(() => {
    let active = true;
    resolveMediaUri(uri).then((resolved) => {
      if (!active) return;
      const player = new window.Audio();
      player.preload = 'auto';
      player.src = resolved;
      player.oncanplay = () => { if (active) { setLoadedUri(uri); setFailedUri(undefined); } };
      player.onended = () => { if (active) setPlaying(false); };
      player.onerror = () => { if (active) { setFailedUri(uri); setPlaying(false); } };
      audio.current = player;
      player.load();
      if (player.readyState >= 3) setLoadedUri(uri);
    }).catch(() => { if (active) setFailedUri(uri); });
    return () => { active = false; audio.current?.pause(); audio.current = null; };
  }, [uri]);
  return (
    <Pressable disabled={!ready || failed} onPress={(event) => {
      event.stopPropagation();
      const player = audio.current;
      if (!player) return;
      if (player.paused) { void player.play().then(() => setPlaying(true)).catch(() => setFailedUri(uri)); }
      else { player.pause(); setPlaying(false); }
    }} style={{ backgroundColor: palette.surface, paddingHorizontal: 13, paddingVertical: 12, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: palette.line, opacity: ready ? 1 : 0.72, justifyContent: 'center' }}>
      <Text numberOfLines={1} style={{ color: palette.ink, fontSize: 13, fontWeight: '600' }}>{failed ? 'Không mở được bản ghi' : !ready ? 'Đang tải bản ghi…' : playing ? 'Ⅱ  Tạm dừng' : '▶  Nghe bản ghi'}</Text>
    </Pressable>
  );
}
