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

/** A place as the administration lists it: its owner (null when shared) and its use. */
export interface PlaceWithUsage extends Omit<Place, 'favorite' | 'distanceMeters'> {
  owner: { id: string; email: string } | null;
  /** Accounts that keep it among their favorites. */
  favorites: number;
}

/** Filter of every place (administration). */
export interface PlaceFilter {
  /** shared: places every account sees (no owner); private: places of an account. */
  scope: 'shared' | 'private' | 'all';
  userId?: string;
  text?: string;
  limit: number;
  offset: number;
}

/**
 * `owner` is the account a place belongs to, or null for the shared places administrators
 * manage, which every account sees.
 */
export interface PlaceRepository {
  create(owner: string | null, input: PlaceInput & { id?: string }): Promise<Place>;
  update(owner: string | null, id: string, input: Partial<PlaceInput>): Promise<Place | null>;
  delete(owner: string | null, id: string): Promise<boolean>;
  findVisible(userId: string | null, id: string): Promise<Place | null>;
  /** Shared and private places matching the filter, newest first. */
  searchAll(filter: PlaceFilter): Promise<{ items: PlaceWithUsage[]; total: number }>;
  search(userId: string, search: PlaceSearch): Promise<Place[]>;
  setFavorite(userId: string, placeId: string, alias: string | null): Promise<void>;
  removeFavorite(userId: string, placeId: string): Promise<boolean>;
}

export const PLACE_REPOSITORY = Symbol('PLACE_REPOSITORY');
