import { useState } from 'react';
import StaticMapImage from './StaticMapImage';

/**
 * EvidenceImage
 * -------------
 * Shows the real uploaded photo when one exists. When the image URL is
 * a placeholder (demo seed data such as picsum/example.com, or the
 * image fails to load), it instead renders a real map image of the
 * incident's GPS location — "the actual place", not a random photo.
 */

const PLACEHOLDER = /picsum|storage\.example|mock-storage|example\.com|via\.placeholder|placehold/i;

export function isPlaceholderUrl(src?: string | null): boolean {
  if (!src) return true;
  if (src === 'null' || src === 'undefined') return true;
  return PLACEHOLDER.test(src);
}

interface EvidenceImageProps {
  src?: string | null;
  lat?: number | null;
  lng?: number | null;
  alt?: string;
  className?: string;
  /** Only meaningful when falling back to the map render. */
  zoom?: number;
}

export default function EvidenceImage({
  src,
  lat,
  lng,
  alt = 'Evidence',
  className = '',
  zoom,
}: EvidenceImageProps) {
  const [broken, setBroken] = useState(false);

  if (isPlaceholderUrl(src) || broken) {
    if (typeof lat === 'number' && typeof lng === 'number') {
      return <StaticMapImage lat={lat} lng={lng} zoom={zoom} className={className} alt={alt} />;
    }
    // No usable image AND no coordinates — quiet placeholder
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-slate-300 text-xl ${className}`}
        role="img"
        aria-label={alt}
      >
        📍
      </div>
    );
  }

  return (
    <img
      src={src!}
      alt={alt}
      className={`object-cover bg-slate-100 ${className}`}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
