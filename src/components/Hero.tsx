import { useMemo, useState, useRef, useEffect } from 'react'
import { MapPin, Calendar, Camera } from 'lucide-react'
import type { CityData } from '@/data/photos'

const DOUYIN_QR_URL = import.meta.env.VITE_DOUYIN_QR_URL as string | undefined
const DOUYIN_URL = import.meta.env.VITE_DOUYIN_URL as string | undefined

function DouyinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.321 5.562a5.124 5.124 0 0 1-.443-.258 6.228 6.228 0 0 1-1.138-.963c-.851-.97-1.166-1.956-1.288-2.648h.005C16.356 1.227 16.4 1 16.4 1h-3.797v14.4c0 .205 0 .407-.008.607-.008.2-.024.398-.051.595v.028a3.203 3.203 0 0 1-.632 1.43 3.19 3.19 0 0 1-2.58 1.316c-1.761 0-3.19-1.435-3.19-3.205 0-1.77 1.429-3.205 3.19-3.205.33 0 .65.052.95.147l.005-3.87a7.067 7.067 0 0 0-.955-.065C6.148 9.178 3 12.34 3 16.258 3 20.177 6.148 23.34 10.087 23.34c3.94 0 7.087-3.163 7.087-7.082V9.123c1.37.98 3.05 1.559 4.826 1.559V6.9c-.972 0-1.88-.484-2.679-1.338z"/>
    </svg>
  )
}

function DouyinQrPopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!DOUYIN_QR_URL) return null

  return (
    <div ref={ref} className="relative">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={(e) => {
          // 移动到弹窗内部时不关闭
          const related = e.relatedTarget as Node | null
          if (ref.current && ref.current.contains(related)) return
          setOpen(false)
        }}
        onClick={() => {
          if (DOUYIN_URL) window.open(DOUYIN_URL, '_blank', 'noopener,noreferrer')
        }}
        className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-foreground hover:text-[#FE2C55] hover:bg-white/[0.12] hover:border-white/[0.18] transition-all duration-200"
        title="抖音"
      >
        <DouyinIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 z-50 animate-scale-in w-52"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="p-3 rounded-2xl bg-white/[0.08] backdrop-blur-2xl border border-white/[0.12] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]">
            <img
              src={DOUYIN_QR_URL}
              alt="抖音二维码"
              className="w-full aspect-square rounded-xl object-contain"
            />
            <p className="text-center text-xs text-muted-foreground mt-2 font-medium">扫码关注抖音</p>
          </div>
        </div>
      )}
    </div>
  )
}

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
    <section className="relative h-[45vh] sm:h-[50vh] min-h-[300px] sm:min-h-[340px] flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="/gallery/images/hero-bg.jpg"
          alt="摩旅风景"
          className="h-full w-full object-cover"
        />
        {/* Multi-layer gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-background/50 to-background" />
        {/* Radial vignette */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, hsl(222 30% 4%) 100%)' }} />
      </div>

      {/* Douyin icon - top right */}
      <div className="absolute top-4 right-4 sm:top-5 sm:right-5 z-20">
        <DouyinQrPopover />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 sm:px-6 py-6 sm:py-8 text-center">
        <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 sm:mb-6 animate-fade-in text-foreground drop-shadow-[0_2px_16px_rgba(0,0,0,0.5)]">
          骑行在路上的
          <span className="text-gradient-amber"> 每一帧风景</span>
        </h1>

        {/* Glass stats bar */}
        <div
          className="inline-flex flex-wrap justify-center items-center gap-0 rounded-2xl backdrop-blur-xl border border-white/[0.08] px-2 py-2.5 sm:py-3 animate-fade-in"
          style={{ animationDelay: '0.2s', background: 'hsl(0 0% 100% / 0.04)', boxShadow: 'inset 0 1px 0 0 hsl(0 0% 100% / 0.06)' }}
        >
          {stats.map((stat, i) => (
            <div key={stat.label} className="flex items-center">
              {i > 0 && <div className="w-px h-4 sm:h-5 bg-white/[0.1] mx-2 sm:mx-4" />}
              <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3">
                <stat.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
                <span className="text-sm sm:text-base font-bold text-foreground">{stat.value}</span>
                <span className="text-xs sm:text-sm text-muted-foreground">{stat.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
