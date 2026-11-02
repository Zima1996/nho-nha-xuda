import { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { resolveMediaUri } from '@/data/media-store';

export function MediaImage({ uri, style }: { uri: string; style?: StyleProp<ImageStyle> }) {
  const [resolved, setResolved] = useState(uri.startsWith('xuda-media:') ? '' : uri);
  useEffect(() => {
    let active = true;
    resolveMediaUri(uri).then((value) => { if (active) setResolved(value); }).catch(() => { if (active) setResolved(''); });
    return () => { active = false; };
  }, [uri]);
  return resolved ? <Image source={{ uri: resolved }} style={style} resizeMode="cover" /> : null;
}
