import { useEffect, useRef } from 'react';

/**
 * StaticMapImage
 * --------------
 * Renders a real, up-to-date map image of the given GPS location by
 * compositing OpenStreetMap raster tiles onto a <canvas> (same tile
 * source the interactive Leaflet maps use, no API key needed). This is
 * used as the "evidence image of the place" whenever a report/work
 * order only has a placeholder image (demo seed data) rather than a
 * real uploaded photo.
 */

const TILE = 256;
const DEFAULT_ZOOM = 17;

function lonToX(lng: number, zoom: number) {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

function latToY(lat: number, zoom: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * Math.pow(2, zoom);
}

interface StaticMapImageProps {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
  alt?: string;
}

export default function StaticMapImage({
  lat,
  lng,
  zoom = DEFAULT_ZOOM,
  className = '',
  alt = 'Map of the location',
}: StaticMapImageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const W = Math.max(Math.round(wrap.getBoundingClientRect().width), 120);
    const H = Math.max(Math.round(wrap.getBoundingClientRect().height), 90);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // getContext('2d') is supported in every browser we target — non-null
    // assertion keeps the canvas context type flowing into the closures
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels

    const px = lonToX(lng, zoom) * TILE;
    const py = latToY(lat, zoom) * TILE;
    const left = px - W / 2;
    const top = py - H / 2;
    const col0 = Math.floor(left / TILE);
    const row0 = Math.floor(top / TILE);
    const cols = Math.ceil(W / TILE) + 1;
    const rows = Math.ceil(H / TILE) + 1;
    const maxTile = Math.pow(2, zoom);

    type Slot = { img: HTMLImageElement; dx: number; dy: number };
    const slots: Slot[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = col0 + c;
        const ty = row0 + r;
        if (tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = paint;
        img.onerror = paint;
        img.src = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
        slots.push({ img, dx: tx * TILE - left, dy: ty * TILE - top });
      }
    }

    let cancelled = false;

    function paint() {
      if (cancelled) return;
      // Base layer
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 0, W, H);
      for (const { img, dx, dy } of slots) {
        if (img.complete && img.naturalWidth) {
          ctx.drawImage(img, dx, dy, TILE, TILE);
        }
      }
      drawPin(ctx, W, H);
      drawCredit(ctx, W, H);
    }

    function drawPin(c: CanvasRenderingContext2D, w: number, h: number) {
      const cx = w / 2;
      const cy = h / 2;
      // tail
      c.beginPath();
      c.moveTo(cx, cy + 8);
      c.lineTo(cx - 5, cy - 2);
      c.lineTo(cx + 5, cy - 2);
      c.closePath();
      c.fillStyle = '#7c3aed';
      c.fill();
      // head
      c.beginPath();
      c.arc(cx, cy - 6, 7, 0, Math.PI * 2);
      c.fillStyle = '#7c3aed';
      c.fill();
      c.beginPath();
      c.arc(cx, cy - 6, 3, 0, Math.PI * 2);
      c.fillStyle = '#ffffff';
      c.fill();
    }

    function drawCredit(c: CanvasRenderingContext2D, w: number, h: number) {
      c.font = '9px system-ui, sans-serif';
      const txt = '© OpenStreetMap';
      const tw = c.measureText(txt).width;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(w - tw - 8, h - 15, tw + 4, 11);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillText(txt, w - tw - 6, h - 6);
    }

    paint(); // draw immediately (blank + pin), tiles fill in as they load

    return () => {
      cancelled = true;
    };
  }, [lat, lng, zoom]);

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-slate-200 ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-label={alt} />
    </div>
  );
}
