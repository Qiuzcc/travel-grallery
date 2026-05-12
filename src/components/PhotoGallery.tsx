import { useCallback, useMemo } from 'react'
import { MapPin, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import type { CityData, PhotoItem } from '@/data/photos'
import { PhotoCard } from './PhotoCard'

interface PhotoGalleryProps {
  cities: CityData[]
  activeCityIndex: number
  onCityChange: (index: number) => void
  onPhotoClick: (photo: PhotoItem) => void
}

interface DateGroup {
  date: string
  photos: PhotoItem[]
}

function groupByDate(photos: PhotoItem[]): DateGroup[] {
  const map = new Map<string, PhotoItem[]>()
  for (const photo of photos) {
    const key = photo.date || '未知日期'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(photo)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, photos]) => ({ date, photos }))
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === '未知日期') return '未知日期'
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    return `${parts[1]}月${parts[2]}日`
  }
  return dateStr
}

export function PhotoGallery({ cities, activeCityIndex, onCityChange, onPhotoClick }: PhotoGalleryProps) {
  const activeCity = cities[activeCityIndex]

  const dateGroups = useMemo(
    () => (activeCity ? groupByDate(activeCity.photos) : []),
    [activeCity]
  )

  const handlePrevCity = useCallback(() => {
    if (activeCityIndex > 0) {
      onCityChange(activeCityIndex - 1)
    }
  }, [activeCityIndex, onCityChange])

  const handleNextCity = useCallback(() => {
    if (activeCityIndex < cities.length - 1) {
      onCityChange(activeCityIndex + 1)
    }
  }, [activeCityIndex, cities.length, onCityChange])

  if (cities.length === 0) {
    return (
      <section className="container mx-auto px-6 py-12 text-center">
        <p className="text-muted-foreground">暂无照片数据</p>
      </section>
    )
  }

  return (
    <section className="container mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-12">
      <div className="flex items-center gap-3 sm:gap-4 mb-8 sm:mb-10">
        <div className="section-divider flex-1" />
        <h2 className="text-xs sm:text-sm font-semibold text-foreground/70 tracking-[0.2em] uppercase">旅途影像</h2>
        <div className="section-divider flex-1" />
      </div>

      {/* City navigation - glass panel */}
      <div className="glass-panel rounded-2xl p-3 sm:p-5 mb-8 sm:mb-12">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handlePrevCity}
            disabled={activeCityIndex === 0}
            className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all border bg-white/[0.05] border-white/[0.08] text-foreground hover:bg-amber-glow/[0.1] hover:border-amber-glow/[0.2] hover:text-primary disabled:opacity-20 disabled:pointer-events-none shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">上一站</span>
          </button>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm sm:text-base font-bold text-foreground truncate">{activeCity?.name}</span>
            <span className="text-xs text-primary bg-primary/[0.1] rounded-full px-2 sm:px-2.5 py-0.5 font-medium shrink-0">
              {activeCityIndex + 1}/{cities.length}
            </span>
          </div>

          <button
            onClick={handleNextCity}
            disabled={activeCityIndex === cities.length - 1}
            className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all border bg-white/[0.05] border-white/[0.08] text-foreground hover:bg-amber-glow/[0.1] hover:border-amber-glow/[0.2] hover:text-primary disabled:opacity-20 disabled:pointer-events-none shrink-0"
          >
            <span className="hidden sm:inline">下一站</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Timeline + Photos */}
      <div className="relative">
        {/* Timeline vertical line */}
        <div className="timeline-line hidden md:block" />

        {/* Date groups */}
        <div className="space-y-10 sm:space-y-16">
          {dateGroups.map((group, groupIndex) => (
            <div
              key={group.date}
              className="relative animate-fade-in"
              style={{ animationDelay: `${groupIndex * 0.1}s` }}
            >
              {/* Timeline node */}
              <div className="hidden md:flex absolute left-4 top-2 w-5 h-5 items-center justify-center">
                <div className="w-3.5 h-3.5 rounded-full bg-primary border-2 border-background ring-2 ring-amber-glow/20 glow-dot" />
              </div>

              {/* Date header */}
              <div className="md:ml-16 mb-5">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/[0.05] backdrop-blur-sm border border-white/[0.08] text-primary text-sm font-medium">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(group.date)}
                </span>
              </div>

              {/* Photo masonry grid */}
              <div className="md:ml-16 masonry-grid">
                {group.photos.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    isActive={false}
                    onClick={() => onPhotoClick(photo)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* City dots indicator */}
      <div className="flex justify-center flex-wrap gap-1.5 sm:gap-2 mt-10 sm:mt-14">
        {cities.map((city, index) => (
          <button
            key={city.name}
            onClick={() => onCityChange(index)}
            className={`rounded-full transition-all duration-300 ${
              index === activeCityIndex
                ? 'bg-primary w-6 sm:w-8 h-2 sm:h-2.5 shadow-[0_0_12px_hsl(var(--amber)/0.4)]'
                : 'bg-white/[0.15] w-2 sm:w-2.5 h-2 sm:h-2.5 hover:bg-white/[0.3]'
            }`}
            title={city.name}
          />
        ))}
      </div>
    </section>
  )
}
