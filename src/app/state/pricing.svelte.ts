/**
 * The pricing calculator in Preview: machine profiles, the inputs on screen and product presets.
 * Kept in this browser's settings store; edits save shortly after they are made.
 */
import { makeId } from 'libopenlaser/project';
import { getSetting, setSetting } from '$lib/storage/db';
import { reportError } from '$lib/ui/errors';
import {
  PRICING_SETTING_KEY,
  defaultPricingData,
  jobFromProduct,
  normalizePricing,
  upsertProduct,
  type PricingData,
  type PricingJob,
  type PricingMachine,
} from '../lib/pricing-data';

const SAVE_DELAY_MS = 300;

class Pricing {
  data = $state.raw<PricingData>(defaultPricingData());
  loaded = $state(false);
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  get job(): PricingJob {
    return this.data.job;
  }

  get machine(): PricingMachine {
    return this.data.machines.find((m) => m.id === this.data.job.machineId) ?? this.data.machines[0];
  }

  get product() {
    return this.data.products.find((p) => p.id === this.data.productId) ?? null;
  }

  /** Reads the saved calculator once; later calls wait for the same read. */
  load(): Promise<void> {
    this.loading ??= getSetting(PRICING_SETTING_KEY)
      .then((stored) => {
        // Edits made before the read finished win over what was stored.
        if (!this.loaded) this.data = normalizePricing(stored);
      })
      .catch((error: unknown) => reportError(error, 'Pricing'))
      .finally(() => (this.loaded = true));
    return this.loading;
  }

  private set(next: PricingData): void {
    this.data = next;
    this.loaded = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Writes pending edits now. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      await setSetting(PRICING_SETTING_KEY, this.data);
    } catch (error) {
      reportError(error, 'Pricing');
    }
  }

  updateJob(change: (job: PricingJob) => PricingJob): void {
    this.set({ ...this.data, job: change(this.data.job) });
  }

  selectMachine(id: string): void {
    if (!this.data.machines.some((m) => m.id === id)) return;
    this.updateJob((job) => ({ ...job, machineId: id }));
  }

  updateMachine(patch: Partial<Omit<PricingMachine, 'id'>>): void {
    const id = this.machine.id;
    this.set({
      ...this.data,
      machines: this.data.machines.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  }

  addMachine(machine: Omit<PricingMachine, 'id'>): void {
    const added = { ...machine, id: makeId() };
    this.set({
      ...this.data,
      machines: [...this.data.machines, added],
      job: { ...this.data.job, machineId: added.id },
    });
  }

  /** Removes the machine on screen; there is always one left. */
  removeMachine(): void {
    if (this.data.machines.length <= 1) return;
    const id = this.machine.id;
    const machines = this.data.machines.filter((m) => m.id !== id);
    const keep = (job: PricingJob) => (job.machineId === id ? { ...job, machineId: machines[0].id } : job);
    this.set({
      ...this.data,
      machines,
      job: keep(this.data.job),
      products: this.data.products.map((p) => ({ ...p, job: keep(p.job) })),
    });
  }

  /** Saves the inputs on screen as a product, replacing one with the same name. */
  saveProduct(name: string): void {
    const { products, id } = upsertProduct(this.data.products, name, this.data.job, makeId);
    this.set({ ...this.data, products, productId: id });
  }

  loadProduct(id: string): void {
    const preset = this.data.products.find((p) => p.id === id);
    if (!preset) return;
    const job = jobFromProduct(
      preset,
      this.data.job,
      this.data.machines.map((m) => m.id),
    );
    this.set({ ...this.data, job, productId: id });
  }

  deleteProduct(id: string): void {
    this.set({
      ...this.data,
      products: this.data.products.filter((p) => p.id !== id),
      productId: this.data.productId === id ? null : this.data.productId,
    });
  }
}

export const pricing = new Pricing();
