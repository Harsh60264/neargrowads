import { useEffect, useRef, useState } from 'react';
import { mountNeoMascot } from './neoMascotController.js';
import type { MascotSettings } from '../../data/siteContent';

const mascotExpressions = ['happy', 'excited', 'wink', 'laugh', 'confident', 'curious'] as const;
type MascotExpression = (typeof mascotExpressions)[number];
type MascotApi = {
  celebrate: () => void;
  point: (element: Element) => void;
  setExpression: (expression: MascotExpression, hold?: number) => boolean;
  expressions: string[];
  setSizeSettings: (settings: Pick<MascotSettings, 'desktopScalePercent' | 'mobileScalePercent'>) => void;
  setChatOpen: (open: boolean) => void;
};

declare global {
  interface Window {
    NearGrowMascot?: MascotApi;
    NEO?: MascotApi;
  }
}

export function NeoMascot({ onCelebrate, sizeSettings, chatOpen, onOpenChat }: {
  onCelebrate?: () => void;
  sizeSettings: MascotSettings;
  chatOpen: boolean;
  onOpenChat: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const hitTargetRef = useRef<HTMLButtonElement>(null);
  const mascotApiRef = useRef<MascotApi | null>(null);
  const onCelebrateRef = useRef(onCelebrate);
  const [fallbackRenderer, setFallbackRenderer] = useState<MascotSettings['renderer'] | null>(null);
  onCelebrateRef.current = onCelebrate;
  const useCanvasFallback = fallbackRenderer === sizeSettings.renderer;
  const useReferenceSvg = sizeSettings.renderer === '2d' && !useCanvasFallback;

  useEffect(() => {
    const canvas = canvasRef.current;
    const svgHost = svgHostRef.current;
    const hitTarget = hitTargetRef.current;
    const pageRoot = document.querySelector('main') ?? document.body;
    if (!canvas || !svgHost || !hitTarget) return;

    let instance: ReturnType<typeof mountNeoMascot>;
    try {
      instance = mountNeoMascot(canvas, hitTarget, pageRoot, () => onCelebrateRef.current?.(), {
        sizeSettings,
        rendererVariant: useCanvasFallback ? 'canvasFallback' : undefined,
        svgHost,
      });
    } catch (error) {
      if (useCanvasFallback || sizeSettings.renderer === '2d') throw error;
      console.warn(`[NearGrow Ads] WebGL is unavailable for NEO's ${sizeSettings.renderer.toUpperCase()} display mode; using the animated Canvas fallback for this session.`, error);
      setFallbackRenderer(sizeSettings.renderer);
      return;
    }
    const api = instance.api as MascotApi;
    mascotApiRef.current = api;
    const exposeNearGrow = !window.NearGrowMascot;
    const exposeNeo = !window.NEO;
    if (exposeNearGrow) window.NearGrowMascot = api;
    else console.warn('[NearGrow Ads] window.NearGrowMascot is already defined; preserving the existing API.');
    if (exposeNeo) window.NEO = api;
    else console.warn('[NearGrow Ads] window.NEO is already defined; preserving the existing API.');

    return () => {
      mascotApiRef.current = null;
      if (window.NearGrowMascot === api) delete window.NearGrowMascot;
      if (window.NEO === api) delete window.NEO;
      instance.cleanup();
    };
  }, [sizeSettings.renderer, useCanvasFallback, useReferenceSvg]);

  useEffect(() => {
    mascotApiRef.current?.setSizeSettings(sizeSettings);
  }, [sizeSettings.desktopScalePercent, sizeSettings.mobileScalePercent]);

  useEffect(() => {
    mascotApiRef.current?.setChatOpen(chatOpen);
  }, [chatOpen, useCanvasFallback]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[45]"
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
        aria-label="Open chat with NEO"
        className="absolute left-0 top-0 z-[1] rounded-[30%] pointer-events-auto [-webkit-tap-highlight-color:transparent] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7dff2a]"
        onClick={onOpenChat}
      />
    </div>
  );
}
