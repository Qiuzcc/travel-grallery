import { MapPin } from 'lucide-react'
import type { PhotoItem } from '@/data/photos'

interface PhotoCardProps {
  photo: PhotoItem
  onClick: () => void
  isActive: boolean
}

export function PhotoCard({ photo, onClick, isActive }: PhotoCardProps) {
  return (
    <div
      className={`photo-card cursor-pointer group ${isActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      onClick={onClick}
      data-photo-id={photo.id}
    >
      <div className="relative overflow-hidden rounded-xl ring-1 ring-inset ring-white/[0.03]">
        <img
          src={photo.thumbnail}
          alt={photo.title}
          loading="lazy"
          className="w-full object-cover transition-all duration-500 group-hover:scale-[1.08] group-hover:brightness-105"
          style={{
            aspectRatio: photo.aspectRatio === 'portrait' ? '3/4' :
                         photo.aspectRatio === 'square' ? '1/1' : '4/3'
          }}
        />

        {/* Shimmer effect on hover */}
        <div className="absolute inset-0 -translate-x-full group-hover:animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent pointer-events-none" />

        {/* Deep gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-3.5 backdrop-blur-[2px]">
          {photo.title && (
            <h3 className="text-sm font-bold text-foreground mb-0.5 drop-shadow-md">{photo.title}</h3>
          )}
          {photo.description && (
            <p className="text-xs text-muted-foreground/90 line-clamp-2 drop-shadow-sm">{photo.description}</p>
          )}
          {photo.location && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground/80">
              <MapPin className="h-3 w-3 text-primary shrink-0" />
              <span className="truncate">{photo.location}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
