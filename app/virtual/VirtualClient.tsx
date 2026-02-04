"use client";
import React, { useState } from 'react';
import { eventNameToCode } from '@/utils/eventNameToCode';

const eventOptions = Object.keys(eventNameToCode);
export default function VirtualClient() {
  const [event, setEvent] = useState(eventOptions[0]);
  const [ageGroup, setAgeGroup] = useState('13');
  const [sex, setSex] = useState<'M'|'F'>('M');
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<any[]>([]);

  async function build() {
    setLoading(true);
    try {
      const q = new URLSearchParams({ event, ageGroup, sex, months: String(months) });
      const res = await fetch(`/api/virtualRanking?${q.toString()}`);
      const j = await res.json();
      if (j.ok) setSeries(j.months || []);
      else setSeries([]);
    } catch (e) {
      setSeries([]);
    } finally { setLoading(false); }
  }

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); build(); }} className="card p-4 space-y-3">
        <div>
          <label className="block mb-1">Event</label>
          <select value={event} onChange={e => setEvent(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white">
            {eventOptions.map(ev => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </div>
        <div>
          <label className="block mb-1">Age Group</label>
          <select value={ageGroup} onChange={e => setAgeGroup(e.target.value)} className="w-full p-2 border rounded bg-gray-900 text-white">
            {[13,14,15,16,17,18].map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block mb-1">Sex</label>
          <select value={sex} onChange={e => setSex(e.target.value as any)} className="w-full p-2 border rounded bg-gray-900 text-white">
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </div>
        <div>
          <label className="block mb-1">Months</label>
          <input type="number" min={1} max={36} value={months} onChange={e => setMonths(Number(e.target.value))} className="w-full p-2 border rounded bg-gray-900 text-white" />
        </div>
        <div>
          <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Building…' : 'Build Virtual Ranking'}</button>
        </div>
      </form>

      <div className="mt-6">
        {series.length === 0 && <div className="text-sm text-gray-400">No data yet — build a ranking.</div>}
        {series.map((s: any) => (
          <div key={s.month} className="card p-3 my-3">
            <div className="font-semibold">{s.month}</div>
            <ol className="list-decimal list-inside mt-2">
              {s.ranking.slice(0,20).map((r: any, i: number) => (
                <li key={i}>{r.name || r.tiref || 'unknown'} — {r.time?.toFixed(2) ?? 'n/a'}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
