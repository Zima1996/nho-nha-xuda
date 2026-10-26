import type { ThemeName } from '@/types/entry';

export type Palette = {
  name: string;
  description: string;
  paper: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  muted: string;
  primary: string;
  primaryDark: string;
  soft: string;
  accent: string;
  line: string;
  green: string;
  yellow: string;
  pink: string;
};

export const palettes: Record<ThemeName, Palette> = {
  energy: {
    name: 'Năng lượng',
    description: 'Trắng sáng · Cam nổi bật',
    paper: '#FFFFFF',
    surface: '#FFFCF7',
    surfaceAlt: '#F8E6D7',
    ink: '#111111',
    muted: '#665548',
    primary: '#C65317',
    primaryDark: '#A94414',
    soft: '#F5C18E',
    accent: '#F2762B',
    line: '#E5C8AE',
    green: '#477B51',
    yellow: '#D9A52E',
    pink: '#C85F51',
  },
  nature: {
    name: 'Thiên nhiên',
    description: 'Xanh lime · Đen',
    paper: '#EFF5D9',
    surface: '#FBFCF5',
    surfaceAlt: '#C8E94F',
    ink: '#111111',
    muted: '#3D442C',
    primary: '#11130F',
    primaryDark: '#080A07',
    soft: '#C8E94F',
    accent: '#A9D52C',
    line: '#B9C78D',
    green: '#252A1A',
    yellow: '#D5A92E',
    pink: '#C85F51',
  },
  'the-anh': {
    name: 'Thế Anh & Nho',
    description: 'Đen xanh · Cyan rực sáng',
    paper: '#071719',
    surface: '#102426',
    surfaceAlt: '#1B3436',
    ink: '#F1FAF9',
    muted: '#A9C0BF',
    primary: '#24D3D0',
    primaryDark: '#0CA9AA',
    soft: '#174347',
    accent: '#55E7E0',
    line: '#315153',
    green: '#51B88B',
    yellow: '#E9B84E',
    pink: '#E17B91',
  },};

export const entryColorOptions = ['#B94A2B', '#C8891D', '#466A4D', '#47758A', '#70517A'];
