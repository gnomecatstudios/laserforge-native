/** Messages between the UI and the CAM worker. */
import type {
  CamWarning,
  GcodeOptions,
  JobStats,
  LayerStart,
  MachineLimits,
  MoveList,
  Rect,
} from 'libopenlaser/cam';
import type { ColorSelection, EncoderId } from 'libopenlaser/cam';
import type { YAxisMapping } from 'libopenlaser/project';
import type { ImageSettings, Layer, MachineProfile, Project } from 'libopenlaser/project';
import type { Vec2 } from 'libopenlaser/geometry';

export interface CompileRequest {
  type: 'compile';
  id: number;
  project: Project;
  profile: MachineProfile;
  machinePosition?: Vec2;
  limits?: MachineLimits;
  gcode?: Partial<GcodeOptions>;
  absoluteOrigin?: boolean;
}

export interface CompileResult {
  gcode: string[];
  bounds: Rect | null;
  /** Translation from the design to the job (user and current origins). */
  offset: Vec2;
  layerStarts: LayerStart[];
  stats: JobStats;
  warnings: CamWarning[];
  moves: MoveList;
  /** Rotary jobs: how Y goes out, so framing matches the job. */
  yAxis: YAxisMapping | null;
}

/** A controller's own job payload (an .rd file, an upload), built by its CAM encoder. */
export interface EncodeRequest {
  type: 'encode';
  id: number;
  encoder: EncoderId;
  project: Project;
  profile: MachineProfile;
  options: unknown;
}

export interface EncodeResult {
  payload: unknown;
  warnings: CamWarning[];
}

export interface ParseGcodeRequest {
  type: 'parse-gcode';
  id: number;
  text: string;
  maxS: number;
}

export interface ParseGcodeResult {
  lines: string[];
  moves: MoveList;
  /** Lines too long for GRBL (≥ 80 characters). */
  longLines: number[];
}

export interface DitherRequest {
  type: 'dither';
  id: number;
  assetId: string;
  blob: Blob;
  settings: ImageSettings;
  layer: Pick<Layer, 'power' | 'minPower'>;
  widthMm: number;
  heightMm: number;
}

export interface DitherResult {
  width: number;
  height: number;
  burn: Uint8ClampedArray;
}

/** Splits an image by a color selection, at full resolution, into PNG parts. */
export interface SeparateRequest {
  type: 'separate';
  id: number;
  assetId: string;
  blob: Blob;
  selection: ColorSelection;
  /** One part per separate area of the selection. */
  regions: boolean;
}

/** A PNG cropped from the source at (x, y), in source pixels. */
export interface SeparatedPart {
  x: number;
  y: number;
  width: number;
  height: number;
  blob: Blob;
}

export interface SeparateResult {
  sourceWidth: number;
  sourceHeight: number;
  /** The selection, largest first. */
  pieces: SeparatedPart[];
  /** What is left of the image; null when the selection took all of it. */
  rest: SeparatedPart | null;
}

/** Keeps only the pen or marker ink of a photographed sketch (see `extractInk`). */
export interface InkRequest {
  type: 'ink';
  id: number;
  assetId: string;
  blob: Blob;
}

export interface InkResult {
  sourceWidth: number;
  sourceHeight: number;
  /** Black ink on transparency, cropped to the drawing; null when no ink was found. */
  ink: SeparatedPart | null;
}

export type WorkerRequest =
  CompileRequest | EncodeRequest | ParseGcodeRequest | DitherRequest | SeparateRequest | InkRequest;

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      result: CompileResult | EncodeResult | ParseGcodeResult | DitherResult | SeparateResult | InkResult;
    }
  | { id: number; ok: false; error: string };
