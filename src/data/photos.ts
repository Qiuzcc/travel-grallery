export interface PhotoItem {
  id: string;
  src: string;
  thumbnail: string;
  title: string;
  description: string;
  date: string;
  lat: number;
  lng: number;
  location?: string;
  aspectRatio?: "landscape" | "portrait" | "square";
}

export interface CityData {
  name: string;
  lat: number;
  lng: number;
  photos: PhotoItem[];
}

export interface GalleryData {
  cities: CityData[];
}

import data from "./generated-photos.json";
export const galleryData: GalleryData = data as GalleryData;
