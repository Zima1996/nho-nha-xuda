import { useEffect, useState } from 'react';
import { useAudioPlayer } from 'expo-audio';
import { Pressable, Text } from 'react-native';
import type { Palette } from '@/constants/palettes';
import { resolveMediaUri } from '@/data/media-store';

export function AudioPlayback({ uri, palette }: { uri: string; palette: Palette }) {
  const [resolvedUri, setResolvedUri] = useState<string | undefined>(uri.startsWith('xuda-media:') ? undefined : uri);
  useEffect(() => {
    let active = true;
    resolveMediaUri(uri).then((value) => { if (active) setResolvedUri(value); }).catch(() => { if (active) setResolvedUri(undefined); });
    return () => { active = false; };
  }, [uri]);
  const player = useAudioPlayer(resolvedUri);
  return (
    <Pressable disabled={!resolvedUri} onPress={(event) => { event.stopPropagation(); player.play(); }} style={{ backgroundColor: palette.surface, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: palette.line, opacity: resolvedUri ? 1 : 0.65 }}>
      <Text style={{ color: palette.ink, fontSize: 12 }}>{resolvedUri ? '▶  Nghe bản ghi' : 'Đang mở bản ghi…'}</Text>
    </Pressable>
  );
}
