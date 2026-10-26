import React, { useEffect, useRef, useState } from 'react';
import { mountNeoMascot } from './neoMascotController.js';
import type { MascotSettings } from '../../data/siteContent';

interface NearGrowMascotProps {
  mood?: 'idle' | 'happy' | 'celebrating' | 'focused';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  interactive?: boolean;
  className?: string;
  onClick?: () => void;
  onRendererFallback?: () => void;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  sizeSettings?: Pick<MascotSettings, 'renderer' | 'desktopScalePercent' | 'mobileScalePercent'>;
  previewBaseSize?: number;
  previewDevice?: 'desktop' | 'mobile';
}

const SIZE_CLASSES: Record<NonNullable<NearGrowMascotProps['size']>, string> = {
  sm: 'w-24 h-24',
  md: 'w-36 h-36',
  lg: 'w-48 h-48',
  xl: 'w-64 h-64 sm:w-80 sm:h-80',
};

export const NearGrowMascot: React.FC<NearGrowMascotProps> = ({
  mood = 'idle',
  size = 'md',
  interactive = true,
  className = '',
  onClick,
  onRendererFallback,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  sizeSettings = { renderer: '3d', desktopScalePercent: 100, mobileScalePercent: 100 },
  previewBaseSize,
  previewDevice = 'desktop',
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const hitTargetRef = useRef<HTMLButtonElement>(null);
  const mascotApiRef = useRef<{
    celebrate: () => void;
    setExpression: (expression: 'happy' | 'excited' | 'wink' | 'laugh' | 'confident' | 'curious', hold?: number) => boolean;
    setSizeSettings: (settings: Pick<MascotSettings, 'desktopScalePercent' | 'mobileScalePercent'>) => void;
  } | null>(null);
  const onClickRef = useRef(onClick);
  const [fallbackRenderer, setFallbackRenderer] = useState<MascotSettings['renderer'] | null>(null);
  onClickRef.current = onClick;
  const useCanvasFallback = fallbackRenderer === sizeSettings.renderer;
  const useReferenceSvg = sizeSettings.renderer === '2d' && !useCanvasFallback;

  useEffect(() => {
    const canvas = canvasRef.current;
    const svgHost = svgHostRef.current;
    const wrapper = wrapperRef.current;
    const hitTarget = hitTargetRef.current;
    if (!canvas || !svgHost || !wrapper || !hitTarget) return;

    let instance: ReturnType<typeof mountNeoMascot>;
    try {
      instance = mountNeoMascot(canvas, hitTarget, wrapper, () => onClickRef.current?.(), {
        floating: false,
        sizeSettings,
        rendererVariant: useCanvasFallback ? 'canvasFallback' : undefined,
        svgHost,
        previewBaseSize,
        previewDevice,
      });
    } catch (error) {
      if (useCanvasFallback || sizeSettings.renderer === '2d') throw error;
      console.warn(`[NearGrow Ads] WebGL is unavailable for NEO's ${sizeSettings.renderer.toUpperCase()} preview; using the animated Canvas fallback for this session.`, error);
      onRendererFallback?.();
      setFallbackRenderer(sizeSettings.renderer);
      return;
    }
    mascotApiRef.current = instance.api;
    return () => {
      mascotApiRef.current = null;
      instance.cleanup();
    };
  }, [sizeSettings.renderer, useCanvasFallback, useReferenceSvg]);

  useEffect(() => {
    mascotApiRef.current?.setSizeSettings(sizeSettings);
  }, [sizeSettings.desktopScalePercent, sizeSettings.mobileScalePercent]);

  useEffect(() => {
    if (mood === 'celebrating') {
      mascotApiRef.current?.celebrate();
    } else {
      mascotApiRef.current?.setExpression(mood === 'focused' ? 'confident' : 'happy');
    }
  }, [mood]);

  const handleClick = () => {
    if (!interactive) return;
    mascotApiRef.current?.celebrate();
    onClickRef.current?.();
  };

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex items-center justify-center select-none ${SIZE_CLASSES[size]} ${className}`}
      role={interactive ? undefined : 'img'}
      aria-label={interactive ? undefined : "Neo, NearGrow Ads' friendly growth mascot"}
      aria-expanded={interactive ? ariaExpanded : undefined}
      aria-controls={interactive ? ariaControls : undefined}
      data-mascot-ignore
    >
      <canvas
        key={`${sizeSettings.renderer}-${useCanvasFallback ? 'canvas-fallback' : 'webgl'}`}
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: useReferenceSvg ? 'none' : undefined }}
        aria-hidden="true"
      />
      <div
        ref={svgHostRef}
        className="pointer-events-none absolute inset-0 overflow-visible"
        style={{ display: useReferenceSvg ? undefined : 'none' }}
        aria-hidden="true"
      />
      <button
        ref={hitTargetRef}
        type="button"
        className={`absolute inset-0 z-[1] rounded-[30%] [-webkit-tap-highlight-color:transparent] ${
          interactive
            ? 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C7F36B]'
            : 'pointer-events-none'
        }`}
        onClick={handleClick}
        onPointerEnter={() => mascotApiRef.current?.setExpression('excited', 1.5)}
        onPointerLeave={() => mascotApiRef.current?.setExpression('happy')}
        aria-label={interactive ? 'Neo mascot. Activate to celebrate.' : undefined}
        aria-hidden={!interactive}
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive}
      />
    </div>
  );
};
