import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuditActor } from '../../audit/application/audit.service';
import { Actor } from '../../audit/presentation/actor.decorator';
import { AdminUsersService } from '../application/admin-users.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  UpdateUserDto,
} from '../application/dto/admin.dto';
import { AdminOnly } from './admin-roles';

const uuid = new ParseUUIDPipe();

@ApiTags('admin / accounts')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: '[admin] Accounts with their devices, trips and integrations' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Post()
  @ApiOperation({
    summary: '[admin] Create an account; without a password a temporary one is returned once',
  })
  create(@Actor() actor: AuditActor, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '[admin] Account detail: devices, integrations, data and sessions' })
  get(@Param('id', uuid) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '[admin] Change name, role or state (disabling closes its sessions at once)',
  })
  update(@Actor() actor: AuditActor, @Param('id', uuid) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Post(':id/password')
  @HttpCode(200)
  @ApiOperation({
    summary: '[admin] Set a new password (generated when absent) and close every session',
  })
  resetPassword(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.users.resetPassword(actor, id, dto);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: '[admin] Sign the account out of every app and panel session' })
  revokeSessions(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.users.revokeSessions(actor, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '[admin] Delete the account and everything it holds' })
  delete(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.users.delete(actor, id);
  }
}
