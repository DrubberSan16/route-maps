import { Coordinate } from '../../../common/geo/geojson';

export interface Place {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  location: Coordinate;
  /** Only present in proximity searches. */
  distanceMeters?: number;
  favorite?: { alias: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaceInput {
  name: string;
  description?: string | null;
  category?: string | null;
  address?: string | null;
  location: Coordinate;
}

export interface PlaceSearch {
  text?: string;
  near?: Coordinate & { radiusMeters: number };
  favoritesOnly?: boolean;
  limit: number;
  offset: number;
}

export interface PlaceRepository {
  create(userId: string, input: PlaceInput & { id?: string }): Promise<Place>;
  update(userId: string, id: string, input: Partial<PlaceInput>): Promise<Place | null>;
  delete(userId: string, id: string): Promise<boolean>;
  findVisible(userId: string, id: string): Promise<Place | null>;
  search(userId: string, search: PlaceSearch): Promise<Place[]>;
  setFavorite(userId: string, placeId: string, alias: string | null): Promise<void>;
  removeFavorite(userId: string, placeId: string): Promise<boolean>;
}

export const PLACE_REPOSITORY = Symbol('PLACE_REPOSITORY');
