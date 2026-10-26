import { useAudioPlayer } from 'expo-audio';
import { Pressable, Text } from 'react-native';
import type { Palette } from '@/constants/palettes';

export function AudioPlayback({ uri, palette }: { uri: string; palette: Palette }) {
  const player = useAudioPlayer(uri);
  return (
    <Pressable onPress={() => player.play()} style={{ backgroundColor: palette.surface, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: palette.line }}>
      <Text style={{ color: palette.ink, fontSize: 12 }}>▶  Nghe bản ghi</Text>
    </Pressable>
  );
}
