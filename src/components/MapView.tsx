import { useEffect, useRef, useCallback, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Plus, Minus, Maximize, Layers } from 'lucide-react'
import { AMAP_CONFIG } from '@/config/amap'

type LayerMode = 'satellite' | 'standard'

interface MapCity {
  name: string
  lat: number
  lng: number
}

interface MapViewProps {
  routePoints: [number, number][]
  cities: MapCity[]
  activeCityIndex: number
  onMarkerClick: (cityIndex: number) => void
}

export function MapView({ routePoints, cities, activeCityIndex, onMarkerClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const polylineRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const amapClassRef = useRef<any>(null)
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null)
  const onMarkerClickRef = useRef(onMarkerClick)
  onMarkerClickRef.current = onMarkerClick
  const [layerMode, setLayerMode] = useState<LayerMode>('satellite')
  const [showLayerPanel, setShowLayerPanel] = useState(false)

  const drawRoute = useCallback((AMap: any, map: any, points: [number, number][]) => {
    if (polylineRef.current) {
      map.remove(polylineRef.current)
      polylineRef.current = null
    }
    if (points.length < 2) return

    const path = points.map(([lat, lng]) => new AMap.LngLat(lng, lat))
    const polyline = new AMap.Polyline({
      path,
      strokeColor: '#F59E0B',
      strokeWeight: 4,
      strokeOpacity: 0.9,
      strokeStyle: 'dashed',
      strokeDasharray: [12, 6],
      lineJoin: 'round',
      lineCap: 'round',
      showDir: true,
    })
    map.add(polyline)
    polylineRef.current = polyline
    map.setFitView([polyline], false, [60, 60, 60, 60])
  }, [])

  const drawMarkers = useCallback((AMap: any, map: any, mapCities: MapCity[], activeIdx: number) => {
    if (markersRef.current.length > 0) {
      map.remove(markersRef.current)
      markersRef.current = []
    }

    const markers = mapCities.map((city, index) => {
      const isActive = index === activeIdx
      const size = isActive ? 18 : 12
      const marker = new AMap.Marker({
        position: new AMap.LngLat(city.lng, city.lat),
        content: `<div style="
          width:${size}px;height:${size}px;
          background:${isActive ? '#F59E0B' : '#D97706'};
          border:2px solid ${isActive ? '#FDE68A' : '#FCD34D'};
          border-radius:50%;
          box-shadow:0 0 ${isActive ? '14px' : '6px'} rgba(245,158,11,${isActive ? '0.7' : '0.4'});
          cursor:pointer;transition:all 0.3s ease;
        "></div>`,
        offset: new AMap.Pixel(-size / 2, -size / 2),
      })

      marker.on('click', () => {
        onMarkerClickRef.current(index)
      })

      marker.on('mouseover', () => {
        const info = new AMap.InfoWindow({
          isCustom: true,
          content: `<div style="
            padding:6px 12px;
            font-size:13px;
            line-height:1.4;
            color:#fff;
            background:rgba(30,30,30,0.85);
            backdrop-filter:blur(8px);
            border:1px solid rgba(255,255,255,0.15);
            border-radius:8px;
            box-shadow:0 4px 16px rgba(0,0,0,0.4);
            white-space:nowrap;
            font-weight:600;
          ">${city.name}</div>`,
          offset: new AMap.Pixel(0, -size / 2 - 10),
        })
        info.open(map, marker.getPosition())
      })

      return marker
    })

    map.add(markers)
    markersRef.current = markers
  }, [])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false

    AMapLoader.load({
      key: AMAP_CONFIG.key,
      version: AMAP_CONFIG.version,
      plugins: AMAP_CONFIG.plugins,
    }).then((AMap) => {
      if (destroyed || !containerRef.current) return
      amapClassRef.current = AMap

      // Compute initial center from route points
      let center: [number, number] = [116.4, 39.9]
      if (routePoints.length > 0) {
        const avgLat = routePoints.reduce((s, p) => s + p[0], 0) / routePoints.length
        const avgLng = routePoints.reduce((s, p) => s + p[1], 0) / routePoints.length
        center = [avgLng, avgLat]
      }

      const map = new AMap.Map(containerRef.current, {
        zoom: 6,
        center,
        mapStyle: 'amap://styles/dark',
        layers: [
          new AMap.TileLayer.Satellite(),
          new AMap.TileLayer.RoadNet({ opacity: 0.3 }),
        ],
        viewMode: '3D',
        pitch: 15,
        scrollWheel: false,
      })

      // Enable scroll zoom only when Ctrl/Cmd is held
      const container = containerRef.current
      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          const delta = e.deltaY > 0 ? -1 : 1
          map.setZoom(map.getZoom() + delta)
        }
      }
      wheelHandlerRef.current = handleWheel
      container.addEventListener('wheel', handleWheel, { passive: false })

      map.addControl(new AMap.Scale({ position: 'LB' }))
      mapInstanceRef.current = map

      drawRoute(AMap, map, routePoints)
      drawMarkers(AMap, map, cities, activeCityIndex)
    }).catch((e) => {
      console.error('AMap load error:', e)
    })

    return () => {
      destroyed = true
      if (containerRef.current && wheelHandlerRef.current) {
        containerRef.current.removeEventListener('wheel', wheelHandlerRef.current)
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.destroy()
        mapInstanceRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update route when points change
  useEffect(() => {
    if (!mapInstanceRef.current || !amapClassRef.current) return
    drawRoute(amapClassRef.current, mapInstanceRef.current, routePoints)
  }, [routePoints, drawRoute])

  // Update markers when cities or active city changes
  useEffect(() => {
    if (!mapInstanceRef.current || !amapClassRef.current) return
    drawMarkers(amapClassRef.current, mapInstanceRef.current, cities, activeCityIndex)

    // Pan to active city
    if (cities[activeCityIndex]) {
      const city = cities[activeCityIndex]
      mapInstanceRef.current.setCenter(
        new amapClassRef.current.LngLat(city.lng, city.lat),
        true
      )
    }
  }, [cities, activeCityIndex, drawMarkers])

  const handleZoomIn = useCallback(() => {
    const map = mapInstanceRef.current
    if (map) map.setZoom(map.getZoom() + 1, false, 300)
  }, [])

  const handleZoomOut = useCallback(() => {
    const map = mapInstanceRef.current
    if (map) map.setZoom(map.getZoom() - 1, false, 300)
  }, [])

  const handleFitView = useCallback(() => {
    const map = mapInstanceRef.current
    if (map && polylineRef.current) {
      map.setFitView([polylineRef.current], false, [60, 60, 60, 60])
    } else if (map && markersRef.current.length > 0) {
      map.setFitView(markersRef.current, false, [60, 60, 60, 60])
    }
  }, [])

  const handleSwitchLayer = useCallback((mode: LayerMode) => {
    const map = mapInstanceRef.current
    const AMap = amapClassRef.current
    if (!map || !AMap) return

    setLayerMode(mode)
    setShowLayerPanel(false)

    const layers =
      mode === 'satellite'
        ? [new AMap.TileLayer.Satellite(), new AMap.TileLayer.RoadNet({ opacity: 0.3 })]
        : [new AMap.TileLayer()]

    map.setLayers(layers)
  }, [])

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full rounded-2xl"
      />
      {/* Zoom controls - top right */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
        <button
          onClick={handleZoomIn}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-foreground hover:bg-white/[0.12] hover:border-white/[0.18] hover:shadow-[0_4px_16px_-4px_hsl(var(--amber)/0.2)] transition-all duration-200"
          title="放大"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-foreground hover:bg-white/[0.12] hover:border-white/[0.18] hover:shadow-[0_4px_16px_-4px_hsl(var(--amber)/0.2)] transition-all duration-200"
          title="缩小"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleFitView}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-foreground hover:bg-white/[0.12] hover:border-white/[0.18] hover:shadow-[0_4px_16px_-4px_hsl(var(--amber)/0.2)] transition-all duration-200"
          title="最佳视野"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
      {/* Layer switcher - bottom right */}
      <div className="absolute bottom-3 right-3 z-10">
        <button
          onClick={() => setShowLayerPanel((v) => !v)}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-foreground hover:bg-white/[0.12] hover:border-white/[0.18] hover:shadow-[0_4px_16px_-4px_hsl(var(--amber)/0.2)] transition-all duration-200"
          title="切换图层"
        >
          <Layers className="h-4 w-4" />
        </button>
        {showLayerPanel && (
          <div className="absolute bottom-11 right-0 flex flex-col gap-1 p-2 rounded-xl bg-white/[0.08] backdrop-blur-2xl border border-white/[0.12] shadow-xl min-w-[84px] animate-scale-in">
            <button
              onClick={() => handleSwitchLayer('satellite')}
              className={`px-3 py-2 text-xs rounded-lg text-left transition-all ${layerMode === 'satellite' ? 'bg-primary/[0.15] text-primary font-semibold' : 'text-foreground hover:bg-white/[0.06]'}`}
            >
              卫星
            </button>
            <button
              onClick={() => handleSwitchLayer('standard')}
              className={`px-3 py-2 text-xs rounded-lg text-left transition-all ${layerMode === 'standard' ? 'bg-primary/[0.15] text-primary font-semibold' : 'text-foreground hover:bg-white/[0.06]'}`}
            >
              标准
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
