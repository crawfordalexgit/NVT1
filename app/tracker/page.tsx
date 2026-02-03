"use client";
import React, { Suspense } from "react";
import TrackerClient from "./TrackerClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8">Loading tracker…</div>}>
      <TrackerClient />
    </Suspense>
  );
}
