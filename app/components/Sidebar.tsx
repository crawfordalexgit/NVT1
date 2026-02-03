"use client";
import React from "react";
import Link from "next/link";

export default function Sidebar() {
  const runGenerate = async () => {
    try {
      await fetch('/api/generateReport');
      alert('Generate requested; check /report when ready.');
    } catch (e) {
      alert('Generate request failed: ' + String(e));
    }
  };

  const clearCache = async () => {
    if (!confirm('Clear server cache?')) return;
    try {
      const res = await fetch('/api/clearCache');
      if (res.ok) alert('Cache cleared');
      else alert('Clear cache failed');
    } catch (e) {
      alert('Clear cache error: ' + String(e));
    }
  };

  return (
    <aside className="w-56 p-4 bg-gray-800 text-white min-h-screen">
      <div className="mb-6">
        <div className="text-lg font-semibold">TSC Tools</div>
        <div className="text-xs text-gray-300">Tracker & Reports</div>
      </div>
      <nav className="space-y-2">
        <Link href="/tracker" className="sidebar-link">Tracker</Link>
        <Link href="/report" className="sidebar-link">Report</Link>
        <button onClick={clearCache} className="w-full text-left sidebar-link" style={{ color: '#ffb4b4' }}>Clear Cache</button>
      </nav>
    </aside>
  );
}
