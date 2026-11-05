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

export const DEFAULT_PUBLIC_WEBSITE_THEMES: PublicWebsiteThemes = {
  light: {
    background: '#F7F9FE',
    backgroundSoft: '#EFF3FC',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    text: '#101D38',
    textMuted: '#53627C',
    primary: '#2457D6',
    primaryHover: '#1946B8',
    primarySoft: '#E8EEFF',
    accent: '#168CE8',
    border: '#DCE4F2',
  },
  dark: {
    background: '#070F24',
    backgroundSoft: '#0D1934',
    surface: '#111F3D',
    surfaceRaised: '#17284B',
    text: '#F3F6FF',
    textMuted: '#B4C0DB',
    primary: '#315ECD',
    primaryHover: '#78A0FF',
    primarySoft: '#172B59',
    accent: '#35C4F4',
    border: '#293B62',
  },
};

export const DEFAULT_PUBLIC_WEBSITE_THEME_ASSIGNMENTS: PublicWebsiteThemeAssignments = {
  light: 'royal-light',
  dark: 'midnight-dark',
};

export const PUBLIC_WEBSITE_THEME_REGISTRY: readonly PublicWebsiteThemeDefinition[] = [
  {
    id: 'royal-light',
    name: 'Royal Blue',
    description: 'Clean white surfaces with royal blue accents.',
    mode: 'light',
    palette: DEFAULT_PUBLIC_WEBSITE_THEMES.light,
  },
  {
    id: 'cloud-light',
    name: 'Cloud',
    description: 'Soft neutral surfaces with crisp navy text.',
    mode: 'light',
    palette: {
      background: '#F6F8FB',
      backgroundSoft: '#EBF0F6',
      surface: '#FFFFFF',
      surfaceRaised: '#FFFFFF',
      text: '#172235',
      textMuted: '#536174',
      primary: '#315B91',
      primaryHover: '#24466F',
      primarySoft: '#E5EDF7',
      accent: '#4982B8',
      border: '#D8E0EA',
    },
  },
  {
    id: 'midnight-dark',
    name: 'Midnight Electric',
    description: 'Midnight navy with electric blue and clear light text.',
    mode: 'dark',
    palette: DEFAULT_PUBLIC_WEBSITE_THEMES.dark,
  },
  {
    id: 'ocean-dark',
    name: 'Deep Ocean',
    description: 'Deep blue surfaces with bright ocean-cyan accents.',
    mode: 'dark',
    palette: {
      background: '#07151F',
      backgroundSoft: '#0B202D',
      surface: '#102A3A',
      surfaceRaised: '#18394B',
      text: '#F2FAFF',
      textMuted: '#B6CFDC',
      primary: '#168DB8',
      primaryHover: '#35B4DE',
      primarySoft: '#12394B',
      accent: '#53D5E8',
      border: '#294958',
    },
  },
] as const;

const publicWebsiteThemesById = new Map(
  PUBLIC_WEBSITE_THEME_REGISTRY.map((theme) => [theme.id, theme]),
);

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

const cssVariableByToken: Record<keyof PublicWebsiteThemePalette, string> = {
  background: '--website-background',
  backgroundSoft: '--website-background-soft',
  surface: '--website-surface',
  surfaceRaised: '--website-surface-raised',
  text: '--website-text',
  textMuted: '--website-text-muted',
  primary: '--website-primary',
  primaryHover: '--website-primary-hover',
  primarySoft: '--website-primary-soft',
  accent: '--website-accent',
  border: '--website-border',
};

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

export function parsePublicWebsiteThemeAssignments(value: unknown): PublicWebsiteThemeAssignments | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Partial<Record<PublicWebsiteThemeMode, unknown>>;
  const assignments = {} as PublicWebsiteThemeAssignments;
  for (const mode of ['light', 'dark'] as const) {
    const id = input[mode];
    if (typeof id !== 'string' ||
      (id !== `legacy-${mode}` && !publicWebsiteThemesById.has(id))) return undefined;
    assignments[mode] = id;
  }
  return assignments;
}

export function getPublicWebsiteThemeDefinition(id: string): PublicWebsiteThemeDefinition | undefined {
  return publicWebsiteThemesById.get(id);
}

export function getPublicWebsiteThemePalette(
  id: string,
  mode: PublicWebsiteThemeMode,
  legacyPalette: PublicWebsiteThemePalette,
): PublicWebsiteThemePalette {
  if (id === `legacy-${mode}`) return legacyPalette;
  return publicWebsiteThemesById.get(id)?.palette ?? DEFAULT_PUBLIC_WEBSITE_THEMES[mode];
}

export function publicWebsiteThemeCssVariables(
  palette: PublicWebsiteThemePalette,
): Record<string, string> {
  return Object.fromEntries(
    PUBLIC_WEBSITE_THEME_TOKENS.map(({ key }) => [cssVariableByToken[key], palette[key]]),
  );
}
