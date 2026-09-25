import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  Place,
  PLACE_REPOSITORY,
  PlaceInput,
  type PlaceRepository,
  PlaceSearch,
} from '../domain/place.entity';

@Injectable()
export class PlacesService {
  constructor(@Inject(PLACE_REPOSITORY) private readonly places: PlaceRepository) {}

  create(userId: string, input: PlaceInput & { id?: string }): Promise<Place> {
    return this.places.create(userId, input);
  }

  async get(userId: string, id: string): Promise<Place> {
    const place = await this.places.findVisible(userId, id);
    if (!place) throw AppException.notFound(ErrorCode.PLACE_NOT_FOUND, 'Place not found');
    return place;
  }

  async update(userId: string, id: string, input: Partial<PlaceInput>): Promise<Place> {
    const place = await this.places.update(userId, id, input);
    if (!place) throw AppException.notFound(ErrorCode.PLACE_NOT_FOUND, 'Place not found');
    return place;
  }

  async delete(userId: string, id: string): Promise<{ deleted: boolean }> {
    return { deleted: await this.places.delete(userId, id) };
  }

  search(userId: string, search: PlaceSearch): Promise<Place[]> {
    return this.places.search(userId, search);
  }

  async favorite(userId: string, placeId: string, alias: string | null): Promise<Place> {
    await this.get(userId, placeId);
    await this.places.setFavorite(userId, placeId, alias);
    return this.get(userId, placeId);
  }

  async unfavorite(userId: string, placeId: string): Promise<{ removed: boolean }> {
    return { removed: await this.places.removeFavorite(userId, placeId) };
  }
}
