import { useMemo } from 'react'
import { MapPin, Calendar, Camera } from 'lucide-react'
import type { CityData } from '@/data/photos'

interface HeroProps {
  cities: CityData[]
}

export function Hero({ cities }: HeroProps) {
  const stats = useMemo(() => {
    const totalPhotos = cities.reduce((sum, c) => sum + c.photos.length, 0)
    const allDates = cities.flatMap((c) => c.photos.map((p) => p.date)).filter(Boolean).sort()
    let ridingDays = 0
    if (allDates.length >= 2) {
      const earliest = new Date(allDates[0])
      const latest = new Date(allDates[allDates.length - 1])
      ridingDays = Math.round((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24))
    }
    return [
      { icon: Calendar, label: '骑行天数', value: `${ridingDays} 天` },
      { icon: Camera, label: '照片总数', value: `${totalPhotos} 张` },
      { icon: MapPin, label: '途径城市', value: `${cities.length} 个` },
    ]
  }, [cities])

  return (
    <section className="relative h-[50vh] min-h-[340px] flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="/gallery/images/hero-bg.png"
          alt="摩旅风景"
          className="h-full w-full object-cover"
        />
        {/* Multi-layer gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-background/50 to-background" />
        {/* Radial vignette */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, hsl(222 30% 4%) 100%)' }} />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-6 py-8 text-center">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 animate-fade-in text-foreground drop-shadow-[0_2px_16px_rgba(0,0,0,0.5)]">
          骑行在路上的
          <span className="text-gradient-amber"> 每一帧风景</span>
        </h1>

        {/* Glass stats bar */}
        <div
          className="inline-flex items-center gap-0 rounded-2xl backdrop-blur-xl border border-white/[0.08] px-2 py-3 animate-fade-in"
          style={{ animationDelay: '0.2s', background: 'hsl(0 0% 100% / 0.04)', boxShadow: 'inset 0 1px 0 0 hsl(0 0% 100% / 0.06)' }}
        >
          {stats.map((stat, i) => (
            <div key={stat.label} className="flex items-center">
              {i > 0 && <div className="w-px h-5 bg-white/[0.1] mx-4" />}
              <div className="flex items-center gap-2 px-3">
                <stat.icon className="h-4 w-4 text-primary" />
                <span className="font-bold text-foreground">{stat.value}</span>
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
