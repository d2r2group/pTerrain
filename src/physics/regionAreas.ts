// Each phase's stable region as polygons in (T, p), for the figure export's vector fills: the
// faces that the stable parts of the three boundaries cut out of the window. The lines end exactly
// on the window's edges or at the triple point, so the faces tile the window, and two faces that
// meet share the polyline between them. No DOM here.

import { boundary, PAIRS, type Point } from "./boundaries";
import { stablePhase, triplePoint, type Params, type Phase, type PlotWindow } from "./gibbs";

/** A polyline that bounds a face: a stable boundary's, or a straight piece of the window's edge. */
export interface RegionEdge {
  points: readonly Point[];
}

/** One face: its stable phase and its ring of edges, counterclockwise in (T, log p). */
export interface RegionArea {
  phase: Phase;
  /** Each edge, walked from its first point to its last or, `reversed`, the other way. */
  edges: readonly { edge: RegionEdge; reversed: boolean }[];
}

/** How near the triple point, as a share of the window's sides, a line's end is taken to be it. */
const AT_TRIPLE = 1e-6;

/** A position in the window as shares of its sides: T across, log p up. */
type UV = [number, number];

/**
 * The stable regions of `params` in `window`, from its stable boundary lines (`boundary` with
 * `samples` steps, as the diagram draws them). Every face of the window that the lines cut out is
 * one area; its phase is `stablePhase` at a point inside it.
 */
export function regionAreas(params: Params, window: PlotWindow, samples = 256): RegionArea[] {
  const lp0 = Math.log10(window.pmin);
  const lp1 = Math.log10(window.pmax);
  const uv = (q: Point): UV => [
    (q.T - window.Tmin) / (window.Tmax - window.Tmin),
    (Math.log10(q.p) - lp0) / (lp1 - lp0),
  ];
  const tp = triplePoint(params);
  const tpUV = uv(tp);
  const near = (q: Point) => {
    const [u, v] = uv(q);
    return Math.hypot(u - tpUV[0], v - tpUV[1]) < AT_TRIPLE;
  };

  // The stable lines, with an end at the triple point put exactly on it.
  const lines: RegionEdge[] = PAIRS.flatMap(([i, j]) =>
    boundary(i, j, params, window, samples)
      .filter((seg) => seg.stable)
      .map((seg) => {
        const points = seg.points.map((q, k) =>
          (k === 0 || k === seg.points.length - 1) && near(q) ? { ...tp } : q,
        );
        return { points: dedupe(points) };
      })
      .filter((e) => e.points.length >= 2),
  );

  // The window's edge, cut at its corners and at every line's end on it, counterclockwise from
  // (T_min, p_min).
  const corners: Point[] = [
    { T: window.Tmin, p: window.pmin },
    { T: window.Tmax, p: window.pmin },
    { T: window.Tmax, p: window.pmax },
    { T: window.Tmin, p: window.pmax },
  ];
  const around = (q: Point): number | null => {
    if (q.p === window.pmin) return uv(q)[0];
    if (q.T === window.Tmax) return 1 + uv(q)[1];
    if (q.p === window.pmax) return 3 - uv(q)[0];
    if (q.T === window.Tmin) return 4 - uv(q)[1];
    return null;
  };
  const onEdge = new Map<string, { at: number; point: Point }>();
  for (const q of [...corners, ...lines.flatMap((e) => [e.points[0]!, e.points.at(-1)!])]) {
    const at = around(q);
    if (at !== null) onEdge.set(key(q), { at: at % 4, point: q });
  }
  const stops = [...onEdge.values()].sort((a, b) => a.at - b.at);
  const sides: RegionEdge[] = stops.map((s, k) => ({
    points: [s.point, stops[(k + 1) % stops.length]!.point],
  }));

  return faces([...lines, ...sides], uv).map((ring) => {
    const [u, v] = interiorPoint(
      ring.flatMap(({ edge, reversed }) => walk(edge, reversed)).map(uv),
    );
    const T = window.Tmin + u * (window.Tmax - window.Tmin);
    const p = 10 ** (lp0 + v * (lp1 - lp0));
    return { phase: stablePhase(T, p, params), edges: ring };
  });
}

/** An area's ring as points in (T, p), counterclockwise, without repeating its first point. */
export function areaRing(area: RegionArea): Point[] {
  return area.edges.flatMap(({ edge, reversed }) => walk(edge, reversed));
}

/** An edge's points in the direction walked, its last point left to the next edge. */
function walk(edge: RegionEdge, reversed: boolean): Point[] {
  const points = reversed ? [...edge.points].reverse() : [...edge.points];
  return points.slice(0, -1);
}

function key(q: Point): string {
  return `${q.T},${q.p}`;
}

function dedupe(points: readonly Point[]): Point[] {
  return points.filter((q, k) => k === 0 || q.T !== points[k - 1]!.T || q.p !== points[k - 1]!.p);
}

type HalfEdge = { edge: RegionEdge; reversed: boolean; from: string; to: string; angle: number };

/**
 * The bounded faces of the plane graph of `edges`, which meet only at their ends, each as its ring
 * of half-edges with the face on the left (counterclockwise in `uv`). The unbounded face, which
 * runs clockwise around the window, is left out.
 */
function faces(edges: readonly RegionEdge[], uv: (q: Point) => UV): RegionArea["edges"][] {
  const half: HalfEdge[] = edges.flatMap((edge) =>
    [false, true].map((reversed) => {
      const pts = reversed ? [...edge.points].reverse() : edge.points;
      const [a, b] = [uv(pts[0]!), uv(pts[1]!)];
      return {
        edge,
        reversed,
        from: key(pts[0]!),
        to: key(pts.at(-1)!),
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      };
    }),
  );
  const out = new Map<string, HalfEdge[]>();
  for (const h of half) out.set(h.from, [...(out.get(h.from) ?? []), h]);
  for (const list of out.values()) list.sort((a, b) => a.angle - b.angle);
  const twin = (h: HalfEdge) => half.find((t) => t.edge === h.edge && t.reversed !== h.reversed)!;
  // The face's next half-edge leaves where h arrives: the one just clockwise of h's way back.
  const next = (h: HalfEdge): HalfEdge => {
    const list = out.get(h.to)!;
    const k = list.indexOf(twin(h));
    return list[(k - 1 + list.length) % list.length]!;
  };

  const seen = new Set<HalfEdge>();
  const rings: RegionArea["edges"][] = [];
  for (const start of half) {
    if (seen.has(start)) continue;
    const ring: HalfEdge[] = [];
    for (let h = start; !seen.has(h); h = next(h)) {
      seen.add(h);
      ring.push(h);
    }
    const points = ring.flatMap((h) => walk(h.edge, h.reversed)).map(uv);
    if (signedArea(points) > 0) rings.push(ring.map(({ edge, reversed }) => ({ edge, reversed })));
  }
  return rings;
}

/** The shoelace area of a closed ring, positive counterclockwise (y up). */
export function signedArea(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  points.forEach(([x0, y0], k) => {
    const [x1, y1] = points[(k + 1) % points.length]!;
    sum += x0 * y1 - x1 * y0;
  });
  return sum / 2;
}

/**
 * A point inside the ring: on the horizontal line through the middle of its height (moved off any
 * vertex), at the middle of the widest stretch inside.
 */
function interiorPoint(ring: readonly UV[]): UV {
  const vs = ring.map(([, v]) => v);
  let v = 0.5 * (Math.min(...vs) + Math.max(...vs));
  const span = Math.max(...vs) - Math.min(...vs);
  while (vs.includes(v)) v += 1e-9 * span;
  const xs: number[] = [];
  ring.forEach(([u0, v0], k) => {
    const [u1, v1] = ring[(k + 1) % ring.length]!;
    if (v0 < v !== v1 < v) xs.push(u0 + ((v - v0) / (v1 - v0)) * (u1 - u0));
  });
  xs.sort((a, b) => a - b);
  let best: UV = [xs[0] ?? 0, v];
  let width = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1]! - xs[k]! > width) {
      width = xs[k + 1]! - xs[k]!;
      best = [0.5 * (xs[k]! + xs[k + 1]!), v];
    }
  }
  return best;
}
