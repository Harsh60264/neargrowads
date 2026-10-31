import { useRef, useState, type PointerEvent } from 'react';
import {
  BLOG_ARTICLE_IMAGE_ASPECT_RATIO,
  BLOG_IMAGE_CONTROL_LABELS,
  normalizeBlogImageAdjustment,
  type BlogImageAdjustment,
} from '../../data/blogImageAdjustments';

interface Props {
  src: string;
  alt: string;
  value: BlogImageAdjustment;
  defaultFit: 'cover' | 'contain';
  onChange: (value: BlogImageAdjustment) => void;
}

export function BlogImageAdjustControls({ src, alt, value, defaultFit, onChange }: Props) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number; positionX: number; positionY: number } | null>(null);
  const adjustment = normalizeBlogImageAdjustment(value, defaultFit);

  const update = (patch: Partial<BlogImageAdjustment>) => onChange({
    imageSize: adjustment.fit,
    imagePositionX: adjustment.positionX,
    imagePositionY: adjustment.positionY,
    imageZoom: adjustment.zoom,
    ...patch,
  });

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (adjustment.fit !== 'cover') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      positionX: adjustment.positionX,
      positionY: adjustment.positionY,
    };
  };

  const pan = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    const frame = frameRef.current;
    if (!start || !frame) return;
    const bounds = frame.getBoundingClientRect();
    update({
      imagePositionX: Math.max(0, Math.min(100, start.positionX - ((event.clientX - start.pointerX) / bounds.width) * 100)),
      imagePositionY: Math.max(0, Math.min(100, start.positionY - ((event.clientY - start.pointerY) / bounds.height) * 100)),
    });
  };

  const reset = () => onChange({
    imageSize: defaultFit,
    imagePositionX: 50,
    imagePositionY: 50,
    imageZoom: 100,
  });

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-[#304135] bg-[#101713] p-3" data-testid="blog-image-adjust-controls">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={adjustment.fit === 'cover'}
          onClick={() => update({ imageSize: 'cover' })}
          className="rounded-lg border border-[#405248] px-3 py-2 text-xs font-semibold text-[#EAF1EB] hover:border-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
        >
          {BLOG_IMAGE_CONTROL_LABELS.crop}
        </button>
        <button
          type="button"
          aria-expanded={adjustOpen}
          onClick={() => setAdjustOpen((open) => !open)}
          className="rounded-lg border border-[#405248] px-3 py-2 text-xs font-semibold text-[#EAF1EB] hover:border-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
        >
          {BLOG_IMAGE_CONTROL_LABELS.adjust}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-[#A9B8AD] hover:bg-[#26372B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
        >
          {BLOG_IMAGE_CONTROL_LABELS.reset}
        </button>
      </div>
      {adjustOpen && (
        <div className="space-y-3">
          {src && (
            <div
              ref={frameRef}
              className={`relative mx-auto w-full max-w-xl overflow-hidden rounded-lg bg-black/30 ${adjustment.fit === 'cover' ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}
              style={adjustment.fit === 'cover' ? { aspectRatio: BLOG_ARTICLE_IMAGE_ASPECT_RATIO } : undefined}
              onPointerDown={startPan}
              onPointerMove={pan}
              onPointerUp={() => { dragStart.current = null; }}
              onPointerCancel={() => { dragStart.current = null; }}
              aria-label={adjustment.fit === 'cover' ? 'Drag image to reposition crop' : 'Image fit preview'}
            >
              <img
                src={src}
                alt={alt}
                draggable={false}
                className={adjustment.fit === 'cover' ? 'absolute inset-0 h-full w-full select-none' : 'block h-auto w-full select-none'}
                style={{
                  objectFit: adjustment.fit,
                  objectPosition: `${adjustment.positionX}% ${adjustment.positionY}%`,
                  transform: `scale(${adjustment.zoom / 100})`,
                  transformOrigin: `${adjustment.positionX}% ${adjustment.positionY}%`,
                }}
              />
            </div>
          )}
          <label className="block text-xs text-[#B8C7BC]">
            Fit mode
            <select
              aria-label="Image fit mode"
              value={adjustment.fit}
              onChange={(event) => update({ imageSize: event.target.value as 'cover' | 'contain' })}
              className="mt-1 w-full rounded-lg border border-[#405248] bg-[#19241D] px-3 py-2 text-[#EAF1EB]"
            >
              <option value="cover">Cover · crop to fill</option>
              <option value="contain">Contain · show full image</option>
            </select>
          </label>
          <label className="block text-xs text-[#B8C7BC]">
            Zoom · {adjustment.zoom}%
            <input
              aria-label="Image zoom"
              type="range"
              min={100}
              max={300}
              step={1}
              value={adjustment.zoom}
              onChange={(event) => update({ imageZoom: Number(event.target.value) })}
              className="mt-2 block w-full accent-[#67D8B7]"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[#B8C7BC]">
              Horizontal position · {Math.round(adjustment.positionX)}%
              <input
                aria-label="Image horizontal position"
                type="range"
                min={0}
                max={100}
                step={1}
                value={adjustment.positionX}
                onChange={(event) => update({ imagePositionX: Number(event.target.value) })}
                className="mt-2 block w-full accent-[#67D8B7]"
              />
            </label>
            <label className="block text-xs text-[#B8C7BC]">
              Vertical position · {Math.round(adjustment.positionY)}%
              <input
                aria-label="Image vertical position"
                type="range"
                min={0}
                max={100}
                step={1}
                value={adjustment.positionY}
                onChange={(event) => update({ imagePositionY: Number(event.target.value) })}
                className="mt-2 block w-full accent-[#67D8B7]"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
