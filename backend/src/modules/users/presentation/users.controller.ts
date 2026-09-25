import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { UsersService } from '../application/users.service';
import {
  DeviceResponse,
  RegisterDeviceDto,
  UpdateProfileDto,
  UserProfileResponse,
} from '../application/dto/users.dto';
import { toUserProfile } from '../domain/user.entity';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({ type: UserProfileResponse })
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return toUserProfile(await this.users.updateProfile(user.id, dto));
  }

  @Post('me/devices')
  @ApiOperation({ summary: 'Register (or refresh) the current mobile device' })
  @ApiOkResponse({ type: DeviceResponse })
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.users.registerDevice(user.id, dto);
  }

  @Get('me/devices')
  @ApiOperation({ summary: 'List devices of the authenticated user' })
  @ApiOkResponse({ type: DeviceResponse, isArray: true })
  listDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listDevices(user.id);
  }
}
