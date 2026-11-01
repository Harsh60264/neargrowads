import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import {
  BLOG_ARTICLE_IMAGE_ASPECT_RATIO,
  BLOG_IMAGE_CONTROL_LABELS,
  createBlogImageAdjustmentDraft,
  getBlogImageAdjustmentStyle,
  getBlogImagePanOverflow,
  hasBlogImageCropFrame,
  normalizeBlogImageAdjustment,
  serializeBlogImageAdjustment,
  type BlogImageEditMode,
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
  const [editMode, setEditMode] = useState<BlogImageEditMode | null>(null);
  const [draft, setDraft] = useState(() => normalizeBlogImageAdjustment(value, defaultFit));
  const previewId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number; positionX: number; positionY: number } | null>(null);
  useEffect(() => {
    if (editMode === null) setDraft(normalizeBlogImageAdjustment(value, defaultFit));
  }, [defaultFit, editMode, value]);

  const adjustment = editMode === null ? normalizeBlogImageAdjustment(value, defaultFit) : draft;
  const hasCropFrame = hasBlogImageCropFrame(adjustment);
  const imageStyle = getBlogImageAdjustmentStyle(adjustment);

  const update = (patch: Partial<BlogImageAdjustment>) => setDraft((current) =>
    normalizeBlogImageAdjustment({
      imageSize: current.fit,
      imagePositionX: current.positionX,
      imagePositionY: current.positionY,
      imageZoom: current.zoom,
      ...patch,
    }, defaultFit));

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
    const image = imageRef.current;
    if (!start || !frame || !image?.naturalWidth || !image.naturalHeight) return;
    const bounds = frame.getBoundingClientRect();
    const overflow = getBlogImagePanOverflow(
      bounds.width,
      bounds.height,
      image.naturalWidth,
      image.naturalHeight,
      adjustment.zoom,
    );
    update({
      ...(overflow.x > 0 ? {
        imagePositionX: Math.max(0, Math.min(100, start.positionX - ((event.clientX - start.pointerX) / overflow.x) * 100)),
      } : {}),
      ...(overflow.y > 0 ? {
        imagePositionY: Math.max(0, Math.min(100, start.positionY - ((event.clientY - start.pointerY) / overflow.y) * 100)),
      } : {}),
    });
  };

  const cancel = () => {
    setDraft(normalizeBlogImageAdjustment(value, defaultFit));
    setEditMode(null);
  };

  const apply = () => {
    onChange(serializeBlogImageAdjustment(draft));
    setEditMode(null);
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-[#304135] bg-[#101713] p-3" data-testid="blog-image-adjust-controls">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={editMode === 'crop'}
          aria-expanded={editMode !== null}
          aria-controls={previewId}
          onClick={() => {
            setDraft(createBlogImageAdjustmentDraft(value, defaultFit, 'crop'));
            setEditMode('crop');
          }}
          className="rounded-lg border border-[#405248] px-3 py-2 text-xs font-semibold text-[#EAF1EB] hover:border-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
        >
          {BLOG_IMAGE_CONTROL_LABELS.crop}
        </button>
        <button
          type="button"
          aria-pressed={editMode === 'adjust'}
          aria-expanded={editMode !== null}
          aria-controls={previewId}
          onClick={() => {
            if (editMode === 'adjust') {
              cancel();
              return;
            }
            if (editMode === null) setDraft(createBlogImageAdjustmentDraft(value, defaultFit, 'adjust'));
            setEditMode('adjust');
          }}
          className="rounded-lg border border-[#405248] px-3 py-2 text-xs font-semibold text-[#EAF1EB] hover:border-[#67D8B7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
        >
          {BLOG_IMAGE_CONTROL_LABELS.adjust}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(createBlogImageAdjustmentDraft(undefined, defaultFit, editMode ?? 'adjust'));
            setEditMode((current) => current ?? 'adjust');
          }}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-[#A9B8AD] hover:bg-[#26372B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
        >
          {BLOG_IMAGE_CONTROL_LABELS.reset}
        </button>
      </div>
      {editMode !== null && (
        <div id={previewId} className="space-y-3" data-adjustment-mode={editMode}>
          {src && (
            <div
              ref={frameRef}
              className={`relative mx-auto flex w-full max-w-xl justify-center overflow-hidden rounded-lg bg-black/30 ${adjustment.fit === 'cover' ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}
              style={hasCropFrame ? { aspectRatio: BLOG_ARTICLE_IMAGE_ASPECT_RATIO } : undefined}
              onPointerDown={startPan}
              onPointerMove={pan}
              onPointerUp={() => { dragStart.current = null; }}
              onPointerCancel={() => { dragStart.current = null; }}
              aria-label={adjustment.fit === 'cover' ? 'Drag image to reposition crop' : 'Image fit preview'}
            >
              <img
                ref={imageRef}
                src={src}
                alt={alt}
                draggable={false}
                className={hasCropFrame
                  ? 'absolute inset-0 h-full w-full select-none'
                  : 'block h-auto w-auto max-w-full select-none'}
                style={imageStyle}
              />
            </div>
          )}
          <p className="text-[11px] leading-5 text-[#A9B8AD]">
            Drag the crop to reposition it. Changes are staged until you apply them; cancel discards them.
          </p>
          <label className="block text-xs text-[#B8C7BC]">
            Fit mode
            <select
              aria-label="Image fit mode"
              value={adjustment.fit}
              onChange={(event) => {
                if (event.target.value === 'cover' || event.target.value === 'contain') {
                  update({ imageSize: event.target.value });
                }
              }}
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
          <div className="flex flex-wrap justify-end gap-2 border-t border-[#304135] pt-3">
            <button type="button" onClick={cancel} className="rounded-lg border border-[#405248] px-3 py-2 text-xs font-semibold text-[#A9B8AD] hover:bg-[#26372B]">
              Cancel
            </button>
            <button type="button" onClick={apply} className="rounded-lg bg-[#286D3B] px-3 py-2 text-xs font-semibold text-white hover:bg-[#347E49]">
              {editMode === 'crop' ? 'Apply crop' : 'Apply adjustments'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
