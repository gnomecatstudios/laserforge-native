import type { ArrangeMode } from '../lib/arrange';
class Arrangement {
  open = $state(false);
  mode = $state<ArrangeMode>('automatic');
  nesting = $state(false);
  show(mode: ArrangeMode = 'automatic', nesting = false): void {
    this.mode = mode;
    this.nesting = nesting;
    this.open = true;
  }
}
export const arrangement = new Arrangement();
