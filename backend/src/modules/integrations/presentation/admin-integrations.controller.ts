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
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/enums';
import type { AuditActor } from '../../audit/application/audit.service';
import { Actor } from '../../audit/presentation/actor.decorator';
import {
  CreateApiKeyDto,
  CreateIntegrationDto,
  CreateWebhookDto,
  ListDeliveriesQueryDto,
  ListIntegrationsQueryDto,
  UpdateIntegrationDto,
  UpdateWebhookDto,
  UsageQueryDto,
} from '../application/dto/integrations.dto';
import { IntegrationsService } from '../application/integrations.service';
import { WebhooksService } from '../application/webhooks.service';

const uuid = new ParseUUIDPipe();

@ApiTags('admin / integrations')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/integrations')
export class AdminIntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get()
  @ApiOperation({ summary: '[admin] Integrations with their account, keys and requests today' })
  list(@Query() query: ListIntegrationsQueryDto) {
    return this.integrations.list(query);
  }

  @Post()
  @ApiOperation({
    summary: '[admin] Connect an external application (new service account or an existing one)',
  })
  create(@Actor() actor: AuditActor, @Body() dto: CreateIntegrationDto) {
    return this.integrations.create(actor, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '[admin] Integration with its API keys and webhooks' })
  get(@Param('id', uuid) id: string) {
    return this.integrations.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '[admin] Rename, enable or disable an integration, or change its quota',
  })
  update(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.integrations.update(actor, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[admin] Remove an integration with its keys and webhooks (its account stays)',
  })
  delete(@Actor() actor: AuditActor, @Param('id', uuid) id: string) {
    return this.integrations.delete(actor, id);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: '[admin] Requests per day made with the keys of an integration' })
  usage(@Param('id', uuid) id: string, @Query() query: UsageQueryDto) {
    return this.integrations.usage(id, query.days);
  }

  @Post(':id/keys')
  @ApiOperation({ summary: '[admin] Create an API key; its secret is returned only this time' })
  createKey(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.integrations.createKey(actor, id, dto);
  }

  @Delete(':id/keys/:keyId')
  @ApiOperation({ summary: '[admin] Revoke an API key (it stops working at once)' })
  revokeKey(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Param('keyId', uuid) keyId: string,
  ) {
    return this.integrations.revokeKey(actor, id, keyId);
  }

  @Post(':id/webhooks')
  @ApiOperation({ summary: '[admin] Add a webhook; its signing secret is returned only this time' })
  createWebhook(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(actor, id, dto);
  }

  @Patch(':id/webhooks/:webhookId')
  @ApiOperation({ summary: '[admin] Change, enable or disable a webhook' })
  updateWebhook(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(actor, id, webhookId, dto);
  }

  @Delete(':id/webhooks/:webhookId')
  @ApiOperation({ summary: '[admin] Remove a webhook and its deliveries' })
  deleteWebhook(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ) {
    return this.webhooks.delete(actor, id, webhookId);
  }

  @Post(':id/webhooks/:webhookId/rotate-secret')
  @HttpCode(200)
  @ApiOperation({
    summary: '[admin] Replace the signing secret of a webhook (shown only this time)',
  })
  rotateSecret(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ) {
    return this.webhooks.rotateSecret(actor, id, webhookId);
  }

  @Post(':id/webhooks/:webhookId/test')
  @HttpCode(202)
  @ApiOperation({ summary: '[admin] Send a webhook.test event to this webhook' })
  test(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ) {
    return this.webhooks.test(actor, id, webhookId);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: '[admin] Webhook deliveries of an integration, newest first' })
  deliveries(@Param('id', uuid) id: string, @Query() query: ListDeliveriesQueryDto) {
    return this.webhooks.deliveries(id, query);
  }

  @Get(':id/deliveries/:deliveryId')
  @ApiOperation({ summary: '[admin] A delivery with the event sent and the answer received' })
  delivery(@Param('id', uuid) id: string, @Param('deliveryId', uuid) deliveryId: string) {
    return this.webhooks.delivery(id, deliveryId);
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @HttpCode(200)
  @ApiOperation({ summary: '[admin] Send a delivery again now' })
  retry(
    @Actor() actor: AuditActor,
    @Param('id', uuid) id: string,
    @Param('deliveryId', uuid) deliveryId: string,
  ) {
    return this.webhooks.retry(actor, id, deliveryId);
  }
}
