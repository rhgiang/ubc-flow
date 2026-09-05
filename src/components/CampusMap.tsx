'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import { findBuilding, floorFromRoom } from '@/map/buildings';
import { courseColorIndex } from '@/schedule/colors';

// UBC-V's flagpole plaza — the opening view before pins load or when a term
// has nothing to pin.
const CAMPUS_CENTER: [number, number] = [49.2606, -123.246];
const CAMPUS_ZOOM = 15;

type Located = {
  entry: CalendarEntry;
  building: NonNullable<ReturnType<typeof findBuilding>>;
  code: string;
};

/**
 * Campus map of a term's classes: one pin per building, a popup listing the
 * classes inside it (room and floor included), and a chip per course to view
 * one class's pins or all of them at once.
 *
 * Leaflet is imported dynamically inside the effect so its ~40KB only loads
 * for people who actually open a map. Markers are divIcons (styled spans),
 * because Leaflet's default marker images don't survive bundling — and a
 * labeled dot in the course's calendar colour reads better anyway.
 */
export default function CampusMap({ entries }: { entries: CalendarEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pinsRef = useRef<LayerGroup | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // courseCode, null = all
  // Bumped once the map exists, so the marker effect re-runs — a ref changing
  // doesn't re-render on its own.
  const [ready, setReady] = useState(0);

  // One row per distinct meeting place; unlocatable buildings surface below
  // the map instead of silently disappearing.
  const { located, unlocated, courses } = useMemo(() => {
    const located: Located[] = [];
    const unlocatedSet = new Set<string>();
    const courseSet = new Set<string>();
    for (const e of entries) {
      const course = e.courseCode ?? e.label;
      courseSet.add(course);
      if (!e.building) continue;
      const b = findBuilding(e.building);
      if (b) located.push({ entry: e, building: b, code: e.building.toUpperCase() });
      else unlocatedSet.add(`${e.label} · ${e.building}${e.room ? ` ${e.room}` : ''}`);
    }
    return { located, unlocated: [...unlocatedSet], courses: [...courseSet].sort() };
  }, [entries]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
        CAMPUS_CENTER,
        CAMPUS_ZOOM,
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      pinsRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady((r) => r + 1);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      pinsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const pins = pinsRef.current;
    if (!map || !pins) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      pins.clearLayers();

      const shown = located.filter(
        (l) => selected === null || (l.entry.courseCode ?? l.entry.label) === selected,
      );

      // Group by building so co-located classes share one pin.
      const byBuilding = new Map<string, Located[]>();
      for (const l of shown) {
        byBuilding.set(l.code, [...(byBuilding.get(l.code) ?? []), l]);
      }

      const bounds: [number, number][] = [];
      for (const [code, group] of byBuilding) {
        const { building } = group[0];
        bounds.push([building.lat, building.lng]);
        // Pin takes the colour of the (first) course inside, matching the
        // calendar's colour code for the same course.
        const slot = courseColorIndex(group[0].entry.courseCode ?? group[0].entry.label);
        const icon = L.divIcon({
          className: '',
          html: `<span class="campus-pin" style="background: var(--course-${slot}-accent)">${code}</span>`,
          iconSize: [0, 0],
        });
        const rows = group
          .map((l) => {
            const floor = floorFromRoom(l.entry.room);
            const where = [l.entry.room ? `Room ${l.entry.room}` : null, floor]
              .filter(Boolean)
              .join(' · ');
            const when = l.entry.startTime
              ? `${l.entry.day} ${l.entry.startTime}–${l.entry.endTime}`
              : l.entry.day;
            return `<p style="margin:2px 0"><strong>${l.entry.label}</strong><br>${when}${
              where ? `<br>${where}` : ''
            }</p>`;
          })
          .join('');
        L.marker([building.lat, building.lng], { icon })
          .bindPopup(`<p style="margin:2px 0 6px"><strong>${building.name}</strong></p>${rows}`)
          .addTo(pins);
      }
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
      } else {
        map.setView(CAMPUS_CENTER, CAMPUS_ZOOM);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [located, selected, ready]);

  return (
    <div>
      {courses.length > 1 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto" role="group" aria-label="Show classes">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium ${
              selected === null
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border text-foreground hover:bg-surface-muted'
            }`}
          >
            All classes
          </button>
          {courses.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSelected(selected === c ? null : c)}
              className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium ${
                selected === c
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border text-foreground hover:bg-surface-muted'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        className="h-[420px] w-full overflow-hidden rounded-card border border-border sm:h-[520px]"
        role="application"
        aria-label="Campus map of class locations"
      />

      {unlocated.length > 0 && (
        <p className="mt-2 text-xs text-text-tertiary">
          Couldn&apos;t place on the map: {unlocated.join(', ')}
        </p>
      )}
    </div>
  );
}
