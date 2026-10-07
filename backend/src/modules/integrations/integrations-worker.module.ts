import { Module } from '@nestjs/common';
import { Housekeeping } from './infrastructure/housekeeping';
import { SecretBox } from './infrastructure/secret-box';
import { WebhookDispatcher } from './infrastructure/webhook-dispatcher';
import { WebhookSender } from './infrastructure/webhook-sender';

/** Integrations seen from the worker process: webhook deliveries and clean-up. */
@Module({
  providers: [SecretBox, WebhookSender, WebhookDispatcher, Housekeeping],
})
export class IntegrationsWorkerModule {}
