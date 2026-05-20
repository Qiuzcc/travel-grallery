import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Calendar, MapPin } from 'lucide-react'
import type { PhotoItem } from '@/data/photos'

interface LightboxProps {
  photo: PhotoItem | null
  photos: PhotoItem[]
  onClose: () => void
  onNavigate: (photo: PhotoItem) => void
}

export function Lightbox({ photo, photos, onClose, onNavigate }: LightboxProps) {
  const currentIndex = photo ? photos.findIndex(p => p.id === photo.id) : -1

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      onNavigate(photos[currentIndex - 1])
    }
  }, [currentIndex, photos, onNavigate])

  const handleNext = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      onNavigate(photos[currentIndex + 1])
    }
  }, [currentIndex, photos, onNavigate])

  useEffect(() => {
    if (!photo) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [photo, onClose, handlePrev, handleNext])

  if (!photo) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop - cinematic blur */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-[40px] animate-blur-in"
        onClick={onClose}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 z-50 p-2 sm:p-2.5 rounded-xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.12] text-foreground hover:text-primary hover:bg-white/[0.12] transition-all duration-300 group"
      >
        <X className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" />
      </button>

      {/* Navigation - prev */}
      {currentIndex > 0 && (
        <button
          onClick={handlePrev}
          className="absolute left-2 sm:left-4 md:left-8 z-50 p-2.5 sm:p-4 rounded-xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.12] text-foreground hover:bg-white/[0.15] hover:border-white/[0.2] hover:shadow-[0_4px_16px_-4px_hsl(var(--amber)/0.2)] hover:scale-105 active:scale-95 transition-all duration-200"
        >
          <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      )}
      {/* Navigation - next */}
      {currentIndex < photos.length - 1 && (
        <button
          onClick={handleNext}
          className="absolute right-2 sm:right-4 md:right-8 z-50 p-2.5 sm:p-4 rounded-xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.12] text-foreground hover:bg-white/[0.15] hover:border-white/[0.2] hover:shadow-[0_4px_16px_-4px_hsl(var(--amber)/0.2)] hover:scale-105 active:scale-95 transition-all duration-200"
        >
          <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      )}

      {/* Image with glass frame */}
      <div className="relative z-10 max-w-[95vw] sm:max-w-[90vw] max-h-[90vh] flex flex-col items-center animate-scale-in px-2 sm:px-0">
        <div className="p-0.5 sm:p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl sm:rounded-2xl shadow-[0_24px_64px_-16px_hsl(222_30%_2%/0.7)] flex-shrink-0">
          <img
            src={photo.src}
            alt={photo.title}
            className="max-w-full max-h-[60vh] sm:max-h-[68vh] object-contain rounded-lg sm:rounded-xl"
          />
        </div>

        {/* Photo info panel */}
        {(photo.title || photo.date || photo.location) && (
          <div
            className="mt-3 sm:mt-4 p-3 sm:p-4 bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] rounded-xl animate-slide-in-bottom flex-shrink-0"
            style={{ animationDelay: '0.15s' }}
          >
            {photo.title && (
              <h3 className="text-base sm:text-lg font-bold text-foreground mb-0.5">{photo.title}</h3>
            )}
            {photo.description && (
              <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-2.5 line-clamp-3">{photo.description}</p>
            )}
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
              {photo.date && (
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
                  {photo.date}
                </div>
              )}
              {photo.location && (
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground flex-shrink-0">
                  <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                  {photo.location}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Counter pill */}
      <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-xs sm:text-sm font-medium text-foreground/80">
        {currentIndex + 1} / {photos.length}
      </div>
    </div>
  )
}
