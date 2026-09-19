"use client";

import FleetMap from "@/components/maps/FleetMap";

export default function AdminFleetMapPage() {
  return (
    <div className="fleet-map-page-container w-full min-h-[calc(100dvh-48px)] lg:h-[calc(100dvh-48px)] lg:max-h-[calc(100dvh-48px)] overflow-y-auto lg:overflow-hidden no-scrollbar bg-[#05060e] p-3 sm:p-3.5 pb-3.5 sm:pb-4 flex flex-col box-border">
      <FleetMap role="admin" />
    </div>
  );
}

