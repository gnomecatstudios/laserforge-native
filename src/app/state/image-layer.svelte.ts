/**
 * Which layer imported images go on. Each import asks (the Image tool, Import a drawing, drag and
 * drop); the answer covers every image in that import. Phone scans pick once in their own dialog.
 */
import type { Id } from 'libopenlaser/project';

export type ImageLayerChoice =
  /** An existing image layer. */
  | { kind: 'layer'; id: Id }
  /** One new layer, named, for all the images. */
  | { kind: 'new'; name: string }
  /** A new layer for each image, named Layer N. */
  | { kind: 'each' };

interface Question {
  /** File names, for the dialog's heading. */
  names: string[];
  /** The images will be cleaned down to their ink (Import a drawing). */
  inkOnly: boolean;
  resolve: (choice: ImageLayerChoice | null) => void;
}

class ImageLayerQuestion {
  pending = $state.raw<Question | null>(null);

  /** Opens the dialog; resolves with the choice, or null when the import is cancelled. */
  ask(names: string[], inkOnly: boolean): Promise<ImageLayerChoice | null> {
    // A newer import replaces a question still open; the older one is cancelled.
    this.pending?.resolve(null);
    return new Promise((resolve) => (this.pending = { names, inkOnly, resolve }));
  }

  answer(choice: ImageLayerChoice | null): void {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(choice);
  }
}

export const imageLayerQuestion = new ImageLayerQuestion();
