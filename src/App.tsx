import { useState, useCallback, useMemo } from 'react'
import { MapView } from '@/components/MapView'
import { PhotoGallery } from '@/components/PhotoGallery'
import { Lightbox } from '@/components/Lightbox'
import { Hero } from '@/components/Hero'
import { galleryData } from '@/data/photos'
import type { PhotoItem } from '@/data/photos'

function App() {
  const [activeCityIndex, setActiveCityIndex] = useState(galleryData.cities.length - 1)
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoItem | null>(null)

  const cities = useMemo(
    () => galleryData.cities.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng })),
    []
  )

  const routePoints = useMemo(
    () => cities.map((c) => [c.lat, c.lng] as [number, number]),
    [cities]
  )

  const allPhotos = useMemo(
    () => galleryData.cities.flatMap((c) => c.photos),
    []
  )

  const handleMarkerClick = useCallback((cityIndex: number) => {
    setActiveCityIndex(cityIndex)
  }, [])

  const handleCityChange = useCallback((index: number) => {
    if (index >= 0 && index < galleryData.cities.length) {
      setActiveCityIndex(index)
    }
  }, [])

  const handlePhotoClick = useCallback((photo: PhotoItem) => {
    setLightboxPhoto(photo)
  }, [])

  const handleLightboxClose = useCallback(() => {
    setLightboxPhoto(null)
  }, [])

  const handleLightboxNavigate = useCallback((photo: PhotoItem) => {
    setLightboxPhoto(photo)
  }, [])

  return (
    <div className="min-h-screen bg-background noise-overlay">
      <Hero cities={galleryData.cities} />

      {/* Map section */}
      <section className="container mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-8 sm:pb-12">
        <div className="flex items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="section-divider flex-1" />
          <h2 className="text-xs sm:text-sm font-semibold text-foreground/70 tracking-[0.2em] uppercase">骑行路线</h2>
          <div className="section-divider flex-1" />
        </div>

        <div className="relative">
          {/* Ambient glow behind map */}
          <div className="absolute -inset-4 rounded-3xl bg-amber-glow/[0.02] blur-3xl" />
          <div className="map-container relative h-[280px] sm:h-[400px] md:h-[500px] lg:h-[550px]">
            <MapView
              routePoints={routePoints}
              cities={cities}
              activeCityIndex={activeCityIndex}
              onMarkerClick={handleMarkerClick}
            />
          </div>
        </div>
      </section>

      <PhotoGallery
        cities={galleryData.cities}
        activeCityIndex={activeCityIndex}
        onCityChange={handleCityChange}
        onPhotoClick={handlePhotoClick}
      />

      {/* Footer */}
      <footer className="container mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-12 sm:pb-16 text-center">
        <div className="section-divider mb-8 sm:mb-12" />
        <p className="text-sm text-muted-foreground/70">
          摩旅影像记录
        </p>
        <p className="text-xs text-muted-foreground/40 mt-2 sm:mt-3">
          照片均由旅途中拍摄，GPS坐标来自相机EXIF数据
        </p>
      </footer>

      {/* Lightbox */}
      <Lightbox
        photo={lightboxPhoto}
        photos={allPhotos}
        onClose={handleLightboxClose}
        onNavigate={handleLightboxNavigate}
      />
    </div>
  )
}

export default App
