"use client";
import React from "react";

export default function SwimmerLoader({ label = 'Generating report...' }: { label?: string }) {
    // Prefer a local GIF at /gifs/swim.gif — place your GIF there for local serving.
    const localGif = '/gifs/swim.gif';
    const remoteFallback = 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExNXkyYmQ2eGdhN2NpMzFheHJ2czh4N2lhM3JhODVuOHFubzgydTY1MiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/1HhujOq2uu5zLakOor/giphy.gif';
    return (
        <div className="mb-4">
            <div className="swim-track h-20 w-full bg-gradient-to-r from-gray-800 to-gray-700 rounded flex items-center justify-start">
                <div className="lane" />
                <img src={localGif} alt="swimmer loader" className="swimmer" onError={(e) => { (e.target as HTMLImageElement).src = remoteFallback; }} />
            </div>
            <div className="text-sm text-gray-300 mt-2">{label}</div>
        </div>
    );
}
