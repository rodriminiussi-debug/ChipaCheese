/**
 * Generador pseudoaleatorio determinista (mulberry32). El seed de presentación NO usa Math.random:
 * con la misma semilla produce exactamente los mismos datos (incluidos los ids).
 */
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** Número en [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Real en [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Entero en [min, max] (ambos inclusive). */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Elige según pesos relativos. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1]![0];
  }

  /** Aproximación normal (suma de 4 uniformes), acotada a ±2 desvíos. */
  gauss(mean: number, sd: number): number {
    const z = (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
    return mean + Math.max(-2, Math.min(2, z)) * sd;
  }

  /** uuid v4 determinista. */
  uuid(): string {
    const hex = (n: number) =>
      Array.from({ length: n }, () => Math.floor(this.next() * 16).toString(16)).join("");
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(this.next() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
  }
}
