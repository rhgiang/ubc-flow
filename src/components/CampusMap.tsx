'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import { findBuilding, floorFromRoom } from '@/map/buildings';
import { dayRoute } from '@/map/route';
import { courseColorIndex } from '@/schedule/colors';

// UBC-V's flagpole plaza — the opening view before pins load or when a term
// has nothing to pin.
const CAMPUS_CENTER: [number, number] = [49.2606, -123.246];
const CAMPUS_ZOOM = 15;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

// The route line and its numbered stops are deliberately not a course colour —
// a day's walk crosses several courses. UBC Blue reads on the pale tiles in
// both themes (the map itself never goes dark). Hardcoded rather than read
// from --brand, which sky-themed scopes override to white.
const ROUTE_COLOR = '#002145';

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
  // A weekday selects the route view: that day's buildings in class order,
  // walked. Mutually exclusive with the course filter — a route is all of a
  // day, a course filter is a slice of the week, and composing them mostly
  // produces empty maps.
  const [day, setDay] = useState<(typeof DAYS)[number] | null>(null);
  // Bumped once the map exists, so the marker effect re-runs — a ref changing
  // doesn't re-render on its own.
  const [ready, setReady] = useState(0);

  // One row per distinct meeting place; unlocatable buildings surface below
  // the map instead of silently disappearing.
  const { located, unlocated, courses, routeDays } = useMemo(() => {
    const located: Located[] = [];
    const unlocatedSet = new Set<string>();
    const courseSet = new Set<string>();
    const daySet = new Set<string>();
    for (const e of entries) {
      const course = e.courseCode ?? e.label;
      courseSet.add(course);
      if (!e.building) continue;
      const b = findBuilding(e.building);
      if (b) {
        located.push({ entry: e, building: b, code: e.building.toUpperCase() });
        if (e.startTime) daySet.add(e.day);
      } else {
        unlocatedSet.add(`${e.label} · ${e.building}${e.room ? ` ${e.room}` : ''}`);
      }
    }
    return {
      located,
      unlocated: [...unlocatedSet],
      courses: [...courseSet].sort(),
      // A chip for a day with nothing placeable would draw an empty map.
      routeDays: DAYS.filter((d) => daySet.has(d)),
    };
  }, [entries]);

  // The day's walk, or null outside route view. Also read by the note under
  // the map, so it lives here rather than inside the marker effect.
  const route = useMemo(() => (day ? dayRoute(entries, day) : null), [entries, day]);

  // True only while a touch device has panning switched off.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      // Leaflet sets touch-action: none on its container, so on a phone a
      // finger landing anywhere on a 420px-tall map pans the map instead of
      // scrolling the page - and the map fills most of the screen, so the
      // page can feel stuck. Panning starts off and the student turns it on
      // by tapping, the same bargain scrollWheelZoom: false makes on desktop.
      const touch = L.Browser.mobile;
      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        dragging: !touch,
      }).setView(CAMPUS_CENTER, CAMPUS_ZOOM);
      if (touch) setLocked(true);
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

      // Route view: the day's buildings in class order, numbered, joined by a
      // dashed line, each leg labelled with the schedule gap against the walk
      // it takes — the map answering "can I make it", not just "where is it".
      if (route) {
        const seen = new Map<string, number>();
        const points: [number, number][] = [];
        route.stops.forEach((stop, i) => {
          // The same building visited twice non-consecutively would stack two
          // markers on identical coordinates; a hair of latitude keeps both
          // numbers readable.
          const repeat = seen.get(stop.code) ?? 0;
          seen.set(stop.code, repeat + 1);
          const lat = stop.building.lat + repeat * 0.00012;
          const lng = stop.building.lng;
          points.push([lat, lng]);
          const icon = L.divIcon({
            className: '',
            html: `<span class="campus-pin" style="background: ${ROUTE_COLOR}">${i + 1} · ${stop.code}</span>`,
            iconSize: [0, 0],
          });
          const rows = stop.labels
            .map((l) => `<p style="margin:2px 0">${l}</p>`)
            .join('');
          const dest = `${stop.building.lat},${stop.building.lng}`;
          const directions =
            `<p class="campus-pin-directions">Directions:` +
            ` <a href="https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking" target="_blank" rel="noopener noreferrer">Google Maps</a>` +
            ` · <a href="https://maps.apple.com/?daddr=${dest}&dirflg=w" target="_blank" rel="noopener noreferrer">Apple Maps</a></p>`;
          L.marker([lat, lng], { icon })
            .bindPopup(
              `<p style="margin:2px 0 6px"><strong>${stop.building.name}</strong></p>${rows}${directions}`,
            )
            .addTo(pins);
        });

        if (points.length > 1) {
          L.polyline(points, {
            color: ROUTE_COLOR,
            weight: 3,
            opacity: 0.75,
            dashArray: '6 8',
          }).addTo(pins);
          route.legs.forEach((leg, i) => {
            const [aLat, aLng] = points[i];
            const [bLat, bLng] = points[i + 1];
            // Plain words, not scheduling jargon: "0 min gap" read as a
            // mystery, "back-to-back" reads as a Thursday.
            const between =
              leg.gapMin < 0
                ? 'classes overlap'
                : leg.gapMin === 0
                  ? 'back-to-back'
                  : leg.gapMin >= 60
                    ? `${Math.floor(leg.gapMin / 60)} h${
                        leg.gapMin % 60 ? ` ${leg.gapMin % 60} min` : ''
                      } between classes`
                    : `${leg.gapMin} min between classes`;
            const label = `${between} · ~${leg.walkMin} min walk`;
            L.marker([(aLat + bLat) / 2, (aLng + bLng) / 2], {
              interactive: false,
              icon: L.divIcon({
                className: '',
                html: `<span class="campus-leg${leg.tight ? ' campus-leg-tight' : ''}">${label}</span>`,
                iconSize: [0, 0],
              }),
            }).addTo(pins);
          });
        }

        if (points.length > 0) map.fitBounds(points, { padding: [56, 56], maxZoom: 17 });
        else map.setView(CAMPUS_CENTER, CAMPUS_ZOOM);
        return;
      }

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
        // Directions hand off to the native maps app. Neither URL names an
        // origin, which both apps read as "from where I am now" — and both
        // default to walking, since this is a campus. No SDK, no API key:
        // these are the documented universal-link forms.
        const dest = `${building.lat},${building.lng}`;
        const directions =
          `<p class="campus-pin-directions">Directions:` +
          ` <a href="https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking" target="_blank" rel="noopener noreferrer">Google Maps</a>` +
          ` · <a href="https://maps.apple.com/?daddr=${dest}&dirflg=w" target="_blank" rel="noopener noreferrer">Apple Maps</a></p>`;
        L.marker([building.lat, building.lng], { icon })
          .bindPopup(
            `<p style="margin:2px 0 6px"><strong>${building.name}</strong></p>${rows}${directions}`,
          )
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
  }, [located, selected, route, ready]);

  return (
    <div>
      {courses.length > 1 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto" role="group" aria-label="Show classes">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setDay(null);
            }}
            className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium ${
              selected === null && day === null
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
              onClick={() => {
                setDay(null);
                setSelected(selected === c ? null : c);
              }}
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

      {/* Its own row, with a label saying what these do: on one line with the
          course chips they read as five more filters, and "0 min gap" on the
          map had no caption anywhere explaining that a day is a walked route. */}
      {routeDays.length > 0 && (
        <div
          className="mb-2 flex items-center gap-1.5 overflow-x-auto"
          role="group"
          aria-label="Walk a day's route"
        >
          <span className="shrink-0 pr-1 text-xs text-text-secondary">Day&apos;s route:</span>
          {routeDays.map((d) => (
            <button
              key={d}
              type="button"
              // A day is a route through all courses; a course chip is a slice
              // of the week. One at a time — combined they mostly show nothing.
              onClick={() => {
                setSelected(null);
                setDay(day === d ? null : d);
              }}
              className={`shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium ${
                day === d
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border text-foreground hover:bg-surface-muted'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[420px] w-full overflow-hidden rounded-card border border-border sm:h-[520px]"
          role="application"
          aria-label="Campus map of class locations"
        />
        {locked && (
          <button
            type="button"
            onClick={() => {
              mapRef.current?.dragging.enable();
              setLocked(false);
            }}
            // Above the tiles but below Leaflet's own controls (z-1000), so
            // the zoom buttons keep working while panning is still off.
            className="absolute inset-0 z-[500] flex items-end justify-center rounded-card bg-transparent pb-4"
            aria-label="Enable map panning"
          >
            <span className="rounded-pill bg-foreground/85 px-3 py-1.5 text-xs font-medium text-background shadow-lg">
              Tap to move the map
            </span>
          </button>
        )}
      </div>

      {route && (
        <p className="mt-2 text-xs text-text-tertiary">
          Walk times are estimates from building positions.
          {route.skipped.length > 0 && (
            <> Not on the route (no time or place on record): {route.skipped.join(', ')}.</>
          )}
        </p>
      )}
      {unlocated.length > 0 && !route && (
        <p className="mt-2 text-xs text-text-tertiary">
          Couldn&apos;t place on the map: {unlocated.join(', ')}
        </p>
      )}
    </div>
  );
}
