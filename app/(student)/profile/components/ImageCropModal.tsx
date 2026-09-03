'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { ZoomIn } from 'lucide-react';

interface ImageCropModalProps {
  isOpen: boolean;
  imageUrl: string | null; // object URL of the freshly picked file
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

const VIEWPORT = 260;    // px — the square crop window shown to the user
const OUTPUT_SIZE = 480; // px — exported image resolution
const MAX_ZOOM = 3;

/**
 * A dependency-free crop/zoom/pan step between picking a file and
 * uploading it. Renders the source image at explicit pixel width/height/
 * left/top (no CSS transforms) so the exact same left/top/width/height
 * numbers can be reused, scaled, to draw the final crop onto a canvas —
 * what you see in the circular preview is what gets exported.
 */
export function ImageCropModal({ isOpen, imageUrl, onCancel, onConfirm }: ImageCropModalProps) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null);

  // Fresh crop state for each newly picked image.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNaturalSize(null);
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  // The scale at which the image's shorter side exactly fills the
  // viewport — the "cover" fit at zoom = 1.
  const baseScale = naturalSize ? VIEWPORT / Math.min(naturalSize.w, naturalSize.h) : 1;
  const effectiveScale = baseScale * zoom;
  const renderedW = naturalSize ? naturalSize.w * effectiveScale : 0;
  const renderedH = naturalSize ? naturalSize.h * effectiveScale : 0;

  const clampOffset = useCallback((next: { x: number; y: number }, w: number, h: number) => {
    const maxX = Math.max(0, (w - VIEWPORT) / 2);
    const maxY = Math.max(0, (h - VIEWPORT) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  const handleZoomChange = (value: number) => {
    setZoom(value);
    if (!naturalSize) return;
    const w = naturalSize.w * baseScale * value;
    const h = naturalSize.h * baseScale * value;
    setOffset(prev => clampOffset(prev, w, h));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset(
      { x: dragRef.current.startOffset.x + dx, y: dragRef.current.startOffset.y + dy },
      renderedW,
      renderedH
    ));
  };

  const stopDrag = () => { dragRef.current = null; };

  const left = naturalSize ? VIEWPORT / 2 - renderedW / 2 + offset.x : 0;
  const top = naturalSize ? VIEWPORT / 2 - renderedH / 2 + offset.y : 0;

  const handleConfirm = () => {
    if (!naturalSize || !imgRef.current) return;
    setIsSaving(true);

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setIsSaving(false); return; }

    // Reuse the exact same left/top/width/height the user sees in the
    // viewport, just scaled up from VIEWPORT px to OUTPUT_SIZE px —
    // whatever is visible in the preview is exactly what gets exported.
    const outputScale = OUTPUT_SIZE / VIEWPORT;
    ctx.drawImage(
      imgRef.current,
      0, 0, naturalSize.w, naturalSize.h,
      left * outputScale, top * outputScale, renderedW * outputScale, renderedH * outputScale
    );

    canvas.toBlob(blob => {
      setIsSaving(false);
      if (blob) onConfirm(blob);
    }, 'image/jpeg', 0.9);
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Adjust your photo" size="sm">
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative overflow-hidden rounded-full bg-gray-100 dark:bg-white/5 touch-none cursor-move select-none ring-1 ring-black/5 dark:ring-white/10"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          {imageUrl && naturalSize && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              draggable={false}
              className="absolute pointer-events-none select-none max-w-none"
              style={{ width: renderedW, height: renderedH, left, top }}
            />
          )}
        </div>

        <div className="flex items-center gap-3 w-full">
          <ZoomIn className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={e => handleZoomChange(Number(e.target.value))}
            disabled={!naturalSize}
            className="w-full accent-[#e8603c]"
            aria-label="Zoom"
          />
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Drag to reposition, use the slider to zoom.
        </p>

        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={isSaving || !naturalSize}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
