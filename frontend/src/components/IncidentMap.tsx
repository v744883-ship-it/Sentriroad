import { useEffect, useRef } from 'react';
import type { GeoPoint } from '../types';

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  image?: string;
  /**
   * 0-100 urgency score. When present the pin is colored on a
   * green → yellow → red scale (low → high urgency).
   */
  urgency?: number;
}

interface IncidentMapProps {
  center?: GeoPoint;
  zoom?: number;
  markerLabel?: string;
  /** All incidents to plot. When provided, the view auto-fits to them. */
  markers?: MapMarker[];
  /** Render the green→red urgency legend overlay on the map. */
  showLegend?: boolean;
  className?: string;
}

const ICONS = {
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
};

/** Hue from 120° (green, low urgency) down to 0° (red, high urgency). */
export function urgencyColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const hue = 120 - (clamped / 100) * 120;
  return `hsl(${hue}, 78%, 42%)`;
}

function pinSvg(color: string): string {
  return (
    `<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.3 21.7 0 14 0z" ` +
    `fill="${color}" stroke="rgba(255,255,255,0.95)" stroke-width="1.5"/>` +
    `<circle cx="14" cy="14" r="5.5" fill="#fff"/>` +
    `</svg>`
  );
}

export default function IncidentMap({
  center,
  zoom = 13,
  markerLabel,
  markers,
  showLegend = false,
  className = '',
}: IncidentMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const points: MapMarker[] = (markers && markers.length ? markers : []).filter(
      (m) => typeof m?.lat === 'number' && typeof m?.lng === 'number'
    );
    const fallback: GeoPoint | undefined =
      center && typeof center.lat === 'number' && typeof center.lng === 'number' ? center : undefined;

    if (points.length === 0 && !fallback) return;

    let cancelled = false;

    const initMap = async () => {
      const L: any = await import('leaflet');

      if (cancelled || !mapRef.current) return;

      // Fix default marker icon paths for bundled apps
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions(ICONS);

      const latLngs = points.length ? points : [{ ...fallback! }];

      const map = L.map(mapRef.current, {
        scrollWheelZoom: false,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const createdMarkers: any[] = [];
      latLngs.forEach((p) => {
        const hasUrgency = typeof p.urgency === 'number';
        const color = hasUrgency ? urgencyColor(p.urgency!) : undefined;
        const title = p.label || markerLabel || 'Incident';

        let marker;
        if (color) {
          const icon = L.divIcon({
            className: 'incident-marker',
            html: pinSvg(color),
            iconSize: [28, 38],
            iconAnchor: [14, 38],
            popupAnchor: [0, -32],
          });
          marker = L.marker([p.lat, p.lng], { icon });
        } else {
          marker = L.marker([p.lat, p.lng]);
        }
        marker.addTo(map);

        const urgencyLine = hasUrgency
          ? `<div style="margin-top:4px;font-weight:700;color:${color}">Urgency ${p.urgency}/100</div>`
          : '';
        if (p.image) {
          marker.bindPopup(
            `<div style="min-width:180px;font-size:13px">
               <img src="${p.image}" style="width:100%;height:110px;object-fit:cover;border-radius:6px;margin-bottom:6px" onerror="this.style.display='none'"/>
               <div style="font-weight:600">${title}</div>
               ${urgencyLine}
             </div>`
          );
        } else if (title || urgencyLine) {
          marker.bindPopup(
            `<div style="font-size:13px;font-weight:500">${title}${urgencyLine}</div>`
          );
        }
        createdMarkers.push(marker);
      });

      if (latLngs.length > 1) {
        map.fitBounds(L.latLngBounds(latLngs.map((p: any) => [p.lat, p.lng])), { padding: [40, 40] });
      } else {
        map.setView([latLngs[0].lat, latLngs[0].lng], points.length === 0 && zoom ? zoom : Math.max(zoom, 14));
      }

      mapInstanceRef.current = map;

      // Auto-open the popup for a lone incident so its address is visible
      if (createdMarkers.length === 1 && (markerLabel || markers?.[0]?.label)) {
        setTimeout(() => {
          if (mapInstanceRef.current === map) createdMarkers[0].openPopup();
        }, 250);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // Rebuild the map whenever the set of points changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    markerLabel,
    // A stable signature of the plotted points, so parent re-renders
    // with identical data don't recreate the map
    center?.lat,
    center?.lng,
    markers ? markers.map((m) => `${m.lat},${m.lng},${m.label ?? ''},${m.urgency ?? ''}`).join('|') : '',
  ]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={mapRef}
        className={`rounded-lg overflow-hidden border border-gray-200 bg-slate-100 w-full`}
        // Height comes from the wrapper's className (e.g. h-64); the
        // min-height floor applies when the caller sets no height.
        style={{ minHeight: 200, height: '100%' }}
      />
      {showLegend && (
        <div className="absolute bottom-2.5 left-2.5 z-[1000] bg-white/95 backdrop-blur rounded-lg shadow px-3 py-2 flex items-center gap-2 text-[11px] text-gray-600">
          <span>Low</span>
          <span
            className="w-24 h-2 rounded-full"
            style={{ background: 'linear-gradient(90deg, #22c55e, #eab308, #ef4444)' }}
          />
          <span>High</span>
          <span className="text-gray-400 pl-1">urgency</span>
        </div>
      )}
    </div>
  );
}