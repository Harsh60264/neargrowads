export interface PublicWebsiteThemePalette {
  background: string;
  backgroundSoft: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  accent: string;
  border: string;
}

export interface PublicWebsiteThemes {
  light: PublicWebsiteThemePalette;
  dark: PublicWebsiteThemePalette;
}

export type PublicWebsiteThemeMode = keyof PublicWebsiteThemes;
export type PublicWebsiteThemeAssignments = Record<PublicWebsiteThemeMode, string>;

export interface PublicWebsiteThemeDefinition {
  id: string;
  name: string;
  description: string;
  mode: PublicWebsiteThemeMode;
  palette: PublicWebsiteThemePalette;
}

const originalWebsiteThemes: PublicWebsiteThemes = {
  light: {
    background: '#F8F7F2',
    backgroundSoft: '#E7EFE5',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    text: '#18251E',
    textMuted: '#59665E',
    primary: '#23734B',
    primaryHover: '#0D3021',
    primarySoft: '#E7EFE5',
    accent: '#F5A623',
    border: '#DCE3DA',
  },
  dark: {
    background: '#070B13',
    backgroundSoft: '#0D1320',
    surface: '#111725',
    surfaceRaised: '#111725',
    text: '#F5F6FA',
    textMuted: '#A6AEC0',
    primary: '#70BE55',
    primaryHover: '#57A949',
    primarySoft: '#19291F',
    accent: '#F3B94F',
    border: '#232B3A',
  },
};

export const DEFAULT_PUBLIC_WEBSITE_THEMES: PublicWebsiteThemes = originalWebsiteThemes;

export const DEFAULT_PUBLIC_WEBSITE_THEME_ASSIGNMENTS: PublicWebsiteThemeAssignments = {
  light: 'original-website-light',
  dark: 'original-website-dark',
};

export const PUBLIC_WEBSITE_THEME_REGISTRY: readonly PublicWebsiteThemeDefinition[] = [
  {
    id: 'original-website-light',
    name: 'Original Website Light',
    description: 'The original NearGrow light appearance from Git history.',
    mode: 'light',
    palette: originalWebsiteThemes.light,
  },
  {
    id: 'original-website-dark',
    name: 'Original Website Dark',
    description: 'The original NearGrow dark appearance from Git history.',
    mode: 'dark',
    palette: originalWebsiteThemes.dark,
  },
];

export const DEFAULT_ADMIN_CMS_THEME_ASSIGNMENTS: PublicWebsiteThemeAssignments = {
  light: 'original-cms-light',
  dark: 'original-cms-dark',
};

export const ADMIN_CMS_THEME_REGISTRY: readonly PublicWebsiteThemeDefinition[] = [
  {
    id: 'original-cms-light',
    name: 'Original CMS Light',
    description: 'The original CMS light appearance from Git history.',
    mode: 'light',
    palette: originalWebsiteThemes.light,
  },
  {
    id: 'original-cms-dark',
    name: 'Original CMS Dark',
    description: 'The original CMS dark appearance from Git history.',
    mode: 'dark',
    palette: {
      ...originalWebsiteThemes.dark,
      background: '#0D1814',
      backgroundSoft: '#17251D',
      surface: '#17251D',
      surfaceRaised: '#1C2B22',
      text: '#EEF5EF',
      textMuted: '#A1B0A5',
      primary: '#70BE55',
      primaryHover: '#57A949',
      primarySoft: '#20382A',
      border: '#2B3E33',
    },
  },
  {
    id: 'premium-cms-light',
    name: 'Premium CMS Light',
    description: 'Premium off-white workspace with forest-green navigation and refined cards.',
    mode: 'light',
    palette: {
      ...originalWebsiteThemes.light,
      background: '#F4F7F1',
      backgroundSoft: '#E4F0E2',
      surface: '#FFFFFF',
      surfaceRaised: '#FFFFFF',
      text: '#10251A',
      textMuted: '#53675A',
      primary: '#087443',
      primaryHover: '#04562F',
      primarySoft: '#E2F3E4',
      accent: '#A8D96B',
      border: '#D8E5D9',
    },
  },
  {
    id: 'premium-cms-dark',
    name: 'Premium CMS Dark',
    description: 'Premium dark workspace with emerald accents and accessible contrast.',
    mode: 'dark',
    palette: {
      ...originalWebsiteThemes.dark,
      background: '#0A1510',
      backgroundSoft: '#12251A',
      surface: '#14251A',
      surfaceRaised: '#1A3021',
      text: '#F0F7F0',
      textMuted: '#B1C5B5',
      primary: '#73D28A',
      primaryHover: '#98E3A0',
      primarySoft: '#21462C',
      accent: '#B7E77B',
      border: '#31513A',
    },
  },
];

const publicThemesById = new Map(PUBLIC_WEBSITE_THEME_REGISTRY.map((theme) => [theme.id, theme]));
const adminThemesById = new Map(ADMIN_CMS_THEME_REGISTRY.map((theme) => [theme.id, theme]));

const legacyPublicAssignments: Record<string, string> = {
  'royal-light': 'original-website-light',
  'cloud-light': 'original-website-light',
  'legacy-light': 'original-website-light',
  'midnight-dark': 'original-website-dark',
  'ocean-dark': 'original-website-dark',
  'legacy-dark': 'original-website-dark',
};

export const PUBLIC_WEBSITE_THEME_TOKENS = [
  { key: 'background', label: 'Page background' },
  { key: 'backgroundSoft', label: 'Soft background' },
  { key: 'surface', label: 'Surface' },
  { key: 'surfaceRaised', label: 'Raised surface' },
  { key: 'text', label: 'Main text' },
  { key: 'textMuted', label: 'Secondary text' },
  { key: 'primary', label: 'Primary action' },
  { key: 'primaryHover', label: 'Primary hover' },
  { key: 'primarySoft', label: 'Primary tint' },
  { key: 'accent', label: 'Accent' },
  { key: 'border', label: 'Borders' },
] as const satisfies readonly { key: keyof PublicWebsiteThemePalette; label: string }[];

export function parsePublicWebsiteThemes(value: unknown): PublicWebsiteThemes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Partial<Record<PublicWebsiteThemeMode, unknown>>;
  const result = {} as PublicWebsiteThemes;

  for (const mode of ['light', 'dark'] as const) {
    const rawPalette = input[mode];
    if (rawPalette === undefined) {
      result[mode] = { ...DEFAULT_PUBLIC_WEBSITE_THEMES[mode] };
      continue;
    }
    if (!rawPalette || typeof rawPalette !== 'object' || Array.isArray(rawPalette)) return undefined;

    const paletteInput = rawPalette as Partial<Record<keyof PublicWebsiteThemePalette, unknown>>;
    const palette = {} as PublicWebsiteThemePalette;
    for (const { key } of PUBLIC_WEBSITE_THEME_TOKENS) {
      const color = paletteInput[key];
      if (color === undefined) {
        palette[key] = DEFAULT_PUBLIC_WEBSITE_THEMES[mode][key];
      } else if (typeof color === 'string' && /^#[\da-fA-F]{6}$/.test(color)) {
        palette[key] = color.toUpperCase();
      } else {
        return undefined;
      }
    }
    result[mode] = palette;
  }
  return result;
}

function parseThemeAssignments(
  value: unknown,
  registry: Map<string, PublicWebsiteThemeDefinition>,
  aliases: Record<string, string> = {},
): PublicWebsiteThemeAssignments | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Partial<Record<PublicWebsiteThemeMode, unknown>>;
  const assignments = {} as PublicWebsiteThemeAssignments;
  for (const mode of ['light', 'dark'] as const) {
    const rawId = input[mode];
    if (typeof rawId !== 'string') return undefined;
    const id = aliases[rawId] ?? rawId;
    if (!registry.has(id)) return undefined;
    assignments[mode] = id;
  }
  return assignments;
}

export function parsePublicWebsiteThemeAssignments(value: unknown): PublicWebsiteThemeAssignments | undefined {
  return parseThemeAssignments(
    value,
    publicThemesById,
    legacyPublicAssignments,
  );
}

export function parseAdminCmsThemeAssignments(value: unknown): PublicWebsiteThemeAssignments | undefined {
  return parseThemeAssignments(value, adminThemesById);
}

export function getPublicWebsiteThemeDefinition(id: string): PublicWebsiteThemeDefinition | undefined {
  return publicThemesById.get(legacyPublicAssignments[id] ?? id);
}

export function getAdminCmsThemeDefinition(id: string): PublicWebsiteThemeDefinition | undefined {
  return adminThemesById.get(id);
}

export function getPublicWebsiteThemePalette(
  id: string,
  mode: PublicWebsiteThemeMode,
): PublicWebsiteThemePalette {
  return getPublicWebsiteThemeDefinition(id)?.palette ?? DEFAULT_PUBLIC_WEBSITE_THEMES[mode];
}

export function getAdminCmsThemePalette(
  id: string,
  mode: PublicWebsiteThemeMode,
): PublicWebsiteThemePalette {
  return getAdminCmsThemeDefinition(id)?.palette ??
    ADMIN_CMS_THEME_REGISTRY.find((theme) => theme.mode === mode)!.palette;
}

export function publicWebsiteThemeCssVariables(
  palette: PublicWebsiteThemePalette,
): Record<string, string> {
  return {
    '--brand-bg': palette.background,
    '--brand-bg-soft': palette.backgroundSoft,
    '--brand-surface': palette.surface,
    '--brand-text': palette.text,
    '--brand-text-muted': palette.textMuted,
    '--brand-green': palette.primary,
    '--brand-green-hover': palette.primaryHover,
    '--brand-green-light': palette.primarySoft,
    '--brand-orange': palette.accent,
    '--brand-border': palette.border,
  };
}
