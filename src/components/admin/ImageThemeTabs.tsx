import type { PublicImageTheme, ThemeImageSource } from '../../data/themeImages';

interface ImageThemeTabsProps {
  theme: PublicImageTheme;
  source: ThemeImageSource;
  onChange: (theme: PublicImageTheme) => void;
}

export function ImageThemeTabs({ theme, source, onChange }: ImageThemeTabsProps) {
  const sourceLabel = source === 'dedicated'
    ? `Using dedicated ${theme === 'light' ? 'Light Mode' : 'Dark Mode'} image`
    : source === 'empty'
      ? 'No image assigned; the existing empty state is shown'
      : source === 'other-theme'
        ? `Preview uses the other theme image as a fallback`
        : `Preview uses the legacy/default image as a fallback`;

  return (
    <div>
      <div className="inline-flex rounded-lg border border-[#304135] bg-[#101812] p-1" role="tablist" aria-label="Image appearance">
        {(['dark', 'light'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={theme === value}
            onClick={() => onChange(value)}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              theme === value ? 'bg-[#286D3B] text-white' : 'text-[#A9B8AD] hover:bg-white/5 hover:text-white'
            }`}
          >
            {value === 'dark' ? 'Dark Mode' : 'Light Mode'}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#A9B8AD]" aria-live="polite">{sourceLabel}</p>
    </div>
  );
}
