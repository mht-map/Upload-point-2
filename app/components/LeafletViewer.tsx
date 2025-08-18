'use client';

import dynamic from 'next/dynamic';

// Dynamically import Leaflet to avoid SSR issues
const LeafletViewerComponent = dynamic(() => import('./LeafletViewerComponent'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="text-4xl mb-4">🗺️</div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  )
});

export default function LeafletViewer() {
  return <LeafletViewerComponent />;
}