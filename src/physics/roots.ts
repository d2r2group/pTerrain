// One-dimensional root finding shared by the boundary tracer, the cut crossings and the
// validity checks.

/**
 * A root of f between a and b, where f(a) and f(b) differ in sign, found by bisection down to
 * adjacent floating-point numbers (far below a relative 1e-9).
 */
export function bisect(f: (x: number) => number, a: number, b: number): number {
  let fa = f(a);
  if (fa === 0) return a;
  if (f(b) === 0) return b;
  for (let iter = 0; iter < 200; iter++) {
    const mid = 0.5 * (a + b);
    if (mid === a || mid === b) break;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
    }
  }
  return 0.5 * (a + b);
}

/** Evenly spaced values from a to b, both included. */
export function linspace(a: number, b: number, count: number): Float64Array {
  const out = new Float64Array(count);
  for (let k = 0; k < count; k++) out[k] = k === count - 1 ? b : a + ((b - a) * k) / (count - 1);
  return out;
}

/** Values from a to b (both positive, both included), evenly spaced in log: for the p axis. */
export function logspace(a: number, b: number, count: number): Float64Array {
  const out = linspace(Math.log(a), Math.log(b), count).map(Math.exp);
  out[0] = a;
  out[count - 1] = b;
  return out;
}

/**
 * Every root of f on [a, b] that shows as a sign change (or an exact zero) on a grid of
 * `intervals` equal steps, in increasing order. A NaN is neither a root nor a sign change.
 */
export function findRoots(
  f: (x: number) => number,
  a: number,
  b: number,
  intervals: number,
): number[] {
  const xs = linspace(a, b, intervals + 1);
  const fs = Array.from(xs, f);
  const roots: number[] = [];
  for (let k = 0; k <= intervals; k++) {
    const fk = fs[k] as number;
    const xk = xs[k] as number;
    if (fk === 0) {
      roots.push(xk);
    } else if (k < intervals) {
      const fNext = fs[k + 1] as number;
      if (Math.sign(fNext) * Math.sign(fk) < 0) {
        roots.push(bisect(f, xk, xs[k + 1] as number));
      }
    }
  }
  return roots;
}
