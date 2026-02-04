"use client";
import React from 'react';
import VirtualClient from './VirtualClient';
export default function Page() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Virtual Rankings</h1>
      <VirtualClient />
    </div>
  );
}
