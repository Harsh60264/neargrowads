import { useId } from 'react';
import {
  DEFAULT_TEAM_PHOTO_SETTINGS,
  getTeamPhotoImageStyle,
  normalizeTeamPhotoSettings,
  type TeamPhotoSettings,
  type TeamPhotoSettingsInput,
} from '../../data/teamPhotoAdjustments';
import { initials } from '../../data/teamData';

interface Props {
  src: string;
  name: string;
  role: string;
  bio: string;
  value?: TeamPhotoSettingsInput;
  disabled?: boolean;
  onChange: (value: TeamPhotoSettings) => void;
}

const sliderClass = 'mt-1 block w-full accent-[#67D8B7] disabled:opacity-50';
const selectClass = 'mt-1 w-full rounded-lg border border-[#405344] bg-[#19241D] px-3 py-2 text-sm text-[#EAF1EB] disabled:opacity-50';

export function TeamPhotoAdjustmentControls({ src, name, role, bio, value, disabled = false, onChange }: Props) {
  const previewId = useId();
  const settings = normalizeTeamPhotoSettings(value);
  const imageStyle = getTeamPhotoImageStyle(settings);
  const update = (patch: Partial<TeamPhotoSettings>) => onChange(normalizeTeamPhotoSettings({ ...settings, ...patch }));

  return (
    <section className="team-photo-adjustments space-y-4 rounded-2xl border border-[#304135] bg-[#101713] p-4" aria-label="Core Team photo adjustments">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-[#ECF3EE]">Photo adjustments</h3>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...DEFAULT_TEAM_PHOTO_SETTINGS })}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-[#A9B8AD] hover:bg-[#26372B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7] disabled:opacity-50"
        >
          Reset to original framing
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[#B8C7BC]">
          Image fit
          <select
            aria-label="Core Team image fit"
            className={selectClass}
            disabled={disabled}
            value={settings.fit}
            onChange={(event) => {
              if (event.currentTarget.value === 'contain' || event.currentTarget.value === 'cover') {
                update({ fit: event.currentTarget.value });
              }
            }}
          >
            <option value="contain">Contain · show full image</option>
            <option value="cover">Cover · controlled crop</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-[#B8C7BC]">
          Background style
          <select
            aria-label="Core Team image background"
            className={selectClass}
            disabled={disabled}
            value={settings.background}
            onChange={(event) => {
              if (event.currentTarget.value === 'blurred' || event.currentTarget.value === 'solid') {
                update({ background: event.currentTarget.value });
              }
            }}
          >
            <option value="blurred">Auto blurred from photo</option>
            <option value="solid">Theme-matched solid</option>
          </select>
        </label>
      </div>

      <label className="block text-xs font-semibold text-[#B8C7BC]">
        Zoom · {settings.zoom}%
        <input
          aria-label="Core Team image zoom"
          type="range"
          min={settings.fit === 'contain' ? 50 : 100}
          max={settings.fit === 'contain' ? 100 : 200}
          step={1}
          disabled={disabled}
          value={settings.zoom}
          onChange={(event) => update({ zoom: Number(event.currentTarget.value) })}
          className={sliderClass}
        />
        <span className="mt-1 block font-normal text-[#829187]">
          {settings.fit === 'contain' ? 'Contain zoom never crops the original image.' : 'Cover may crop; adjust position to frame the subject.'}
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[#B8C7BC]">
          Horizontal position · {Math.round(settings.positionX)}%
          <input
            aria-label="Core Team horizontal image position"
            type="range"
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            value={settings.positionX}
            onChange={(event) => update({ positionX: Number(event.currentTarget.value) })}
            className={sliderClass}
          />
        </label>
        <label className="block text-xs font-semibold text-[#B8C7BC]">
          Vertical position · {Math.round(settings.positionY)}%
          <input
            aria-label="Core Team vertical image position"
            type="range"
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            value={settings.positionY}
            onChange={(event) => update({ positionY: Number(event.currentTarget.value) })}
            className={sliderClass}
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#B8C7BC]" id={previewId}>Live expanded-card preview</p>
        <div
          className="team-photo-adjust-preview relative mx-auto aspect-[5/4] w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#071426] max-sm:aspect-[7/9]"
          data-background-style={settings.background}
          aria-labelledby={previewId}
        >
          {src ? (
            <>
              {settings.background === 'blurred' && (
                <img
                  src={src}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-[-5%] h-[110%] w-[110%] object-cover"
                  style={{
                    filter: 'blur(18px) brightness(0.42)',
                    transform: 'scale(1.04)',
                    objectPosition: `${settings.positionX}% ${settings.positionY}%`,
                  }}
                />
              )}
              <img src={src} alt={`Preview portrait of ${name}`} className="absolute inset-0 h-full w-full" style={imageStyle} />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#071426] text-4xl font-extrabold text-[#67D8B7]/80" role="img" aria-label={`${name || 'Team member'} photo preview placeholder`}>
              {initials(name)}
            </div>
          )}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#071426] via-[#071426]/35 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4 sm:p-5">
            <p className="truncate text-base font-extrabold text-white">{name || 'Team member name'}</p>
            <p className="mt-1 truncate text-xs font-semibold text-[#A8E8B1]">{role || 'Designation'}</p>
            <p className="mt-2 line-clamp-2 max-w-[48ch] text-[11px] leading-relaxed text-white/75">{bio || 'Bio appears in this lower text-safe area.'}</p>
          </div>
          <span aria-hidden="true" className="absolute bottom-4 right-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-[#071426]/70 text-[10px] font-bold text-white">in</span>
        </div>
        <p className="text-[11px] leading-5 text-[#829187]">
          Full-image mode keeps the original photo visible. Cover mode is the only setting that intentionally crops it.
        </p>
      </div>
    </section>
  );
}
