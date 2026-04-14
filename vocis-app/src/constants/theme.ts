export const Colors = {
  primary: '#6C63FF',
  primaryDark: '#5A52D5',
  primaryLight: '#8B85FF',

  background: '#1A1A2E',
  surface: '#16213E',
  surfaceLight: '#1F2B47',

  text: '#FFFFFF',
  textSecondary: '#A0A0B8',
  textMuted: '#6B6B80',

  accent: '#00D9A6',
  accentDark: '#00B88A',

  error: '#FF6B6B',
  warning: '#FFB84D',
  success: '#00D9A6',

  border: '#2A2A4A',
  borderLight: '#3A3A5A',

  recording: '#FF6B6B',
  recordingGlow: 'rgba(255, 107, 107, 0.3)',
} as const;

export const Typography = {
  heading1: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  heading2: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    color: Colors.text,
    lineHeight: 24,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  price: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.accent,
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  button: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
} as const;
