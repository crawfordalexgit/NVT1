export function daysSinceEpoch(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NaN;
  return Math.floor(d.getTime() / 86400000);
}

function fitLinear(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n === 0) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const rss = ys.reduce((s, y, i) => s + Math.pow(y - (intercept + slope * xs[i]), 2), 0);
  const stderr = n > 2 ? Math.sqrt(rss / (n - 2)) : null;
  return { slope, intercept, stderr, n } as const;
}

export function predictCohort(cohortPBs: { name: string; pbs: { date: string; timeSec: number }[] }[], qualEndIso: string, opts?: { k?: number; minPoints?: number }) {
  const opt = { k: 3, minPoints: 2, ...(opts || {}) };
  const qualDay = daysSinceEpoch(qualEndIso);
  const fits: any[] = [];
  for (const s of cohortPBs) {
    const pts = (s.pbs || [])
      .map((pb) => ({ x: daysSinceEpoch(pb.date), y: pb.timeSec }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length === 0) {
      fits.push({ name: s.name, n: 0, pts: [] });
      continue;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const fit = fitLinear(xs, ys);
    fits.push({ name: s.name, fit, pts });
  }

  const slopes = fits
    .filter((f) => f.fit && isFinite(f.fit.slope))
    .map((f) => ({ slope: f.fit.slope, n: f.fit.n }));
  if (slopes.length === 0) return { rows: [], cohortSlope: null };
  const slopeVals = slopes.map((s) => s.slope).sort((a, b) => a - b);
  const q1 = slopeVals[Math.floor((slopeVals.length - 1) / 4)];
  const q3 = slopeVals[Math.floor((3 * (slopeVals.length - 1)) / 4)];
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const trimmed = slopes.filter((s) => s.slope >= low && s.slope <= high);
  const weightSum = trimmed.reduce((acc, s) => acc + Math.sqrt(Math.max(1, s.n)), 0) || 1;
  const cohortSlope = trimmed.reduce((acc, s) => acc + s.slope * Math.sqrt(Math.max(1, s.n)), 0) / weightSum;

  const rows = fits.map((f) => {
    const n = f.fit ? f.fit.n : 0;
    let swimmerSlope = f.fit ? f.fit.slope : null;
    if (swimmerSlope == null && n < opt.minPoints) swimmerSlope = null;
    const k = opt.k || 3;
    const finalSlope = swimmerSlope == null ? cohortSlope : (n / (n + k)) * swimmerSlope + (k / (n + k)) * cohortSlope;
    const baseline = f.pts && f.pts.length ? f.pts.reduce((a: any, b: any) => (a.x > b.x ? a : b)) : null;
    const daysToQual = baseline ? qualDay - baseline.x : 0;
    const predicted = baseline && Number.isFinite(finalSlope) ? baseline.y + finalSlope * daysToQual : null;
    const method = f.fit && f.fit.n >= 3 ? 'linear' : f.fit && f.fit.n === 2 ? 'two-point' : 'cohort';
    const confidence = f.fit && f.fit.stderr ? Math.max(0, 1 - f.fit.stderr / Math.abs(cohortSlope || 1)) : n > 0 ? 0.5 : 0.2;
    return { name: f.name, n, predicted, method, confidence };
  });
  return { rows, cohortSlope };
}
