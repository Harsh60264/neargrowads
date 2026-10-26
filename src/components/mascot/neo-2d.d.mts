export type NeoExpression = 'happy' | 'excited' | 'wink' | 'laugh' | 'confident' | 'curious';
export interface Neo2DOptions {
  /** Full canvas height in CSS pixels, including antennae/flame/tail. */
  size?: number;
  autoplay?: boolean;
  autoExpressions?: boolean;
  onActivate?: (event: MouseEvent) => void;
  label?: string;
}
export interface Neo2D {
  readonly element: HTMLDivElement;
  readonly renderer: 'svg-2d';
  readonly expressions: NeoExpression[];
  setSize(height: number): void;
  setExpression(name: NeoExpression, holdSeconds?: number): void;
  lookAt(clientX: number, clientY: number): void;
  setGaze(x: number, y: number): void;
  clearGaze(): void;
  wave(): void;
  celebrate(): void;
  update(deltaSeconds?: number): void;
  pause(): void;
  resume(): void;
  destroy(): void;
  getState(): { expression: NeoExpression; size: number; gesture: string; gaze: {x: number; y: number}; renderer: 'svg-2d'; paused: boolean; destroyed: boolean };
}
export declare function createNeo2D(host: Element, options?: Neo2DOptions): Neo2D;
