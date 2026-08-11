import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { SignedImage } from '@/lib/fileUrl';

export default function PhotoLightboxModal({ urls, index, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(index);

  const goNext = useCallback(() => {
    setCurrentIndex(i => (i + 1) % urls.length);
  }, [urls.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex(i => (i - 1 + urls.length) % urls.length);
  }, [urls.length]);

  useEffect(() => {
    if (urls.length <= 1) return;
    const handleKey = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, onClose, urls.length]);

  // Touch swipe support
  useEffect(() => {
    if (!urls.length) return;
    let touchStartX = 0;
    const handleTouchStart = (e) => { touchStartX = e.touches[0].clientX; };
    const handleTouchEnd = (e) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0) goPrev(); else goNext();
      }
    };
    const el = document.getElementById('lightbox-overlay');
    if (el) {
      el.addEventListener('touchstart', handleTouchStart, { passive: true });
      el.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    return () => {
      if (el) {
        el.removeEventListener('touchstart', handleTouchStart);
        el.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [goNext, goPrev, urls.length]);

  if (!urls?.length) return null;

  return (
    <div
      id="lightbox-overlay"
      className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center select-none"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Left arrow (hidden if only one photo) */}
      {urls.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-2 sm:left-4 z-10 w-12 h-12 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <ChevronLeft className="w-7 h-7" />
        </button>
      )}

      {/* Image */}
      <SignedImage
        src={urls[currentIndex]}
        alt=""
        className="max-w-[95vw] max-h-[92vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Right arrow (hidden if only one photo) */}
      {urls.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-2 sm:right-4 z-10 w-12 h-12 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <ChevronRight className="w-7 h-7" />
        </button>
      )}

      {/* Counter */}
      {urls.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-white/15 backdrop-blur-sm text-white text-sm rounded-full">
          {currentIndex + 1} / {urls.length}
        </div>
      )}
    </div>
  );
}