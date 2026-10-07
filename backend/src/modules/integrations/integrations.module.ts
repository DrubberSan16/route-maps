import { Module } from '@nestjs/common';
import { API_KEY_AUTHENTICATOR } from '../../common/auth/auth-ports';
import { ApiKeyAuthenticatorService } from './application/api-key-authenticator.service';
import { IntegrationsService } from './application/integrations.service';
import { WebhooksService } from './application/webhooks.service';
import { SecretBox } from './infrastructure/secret-box';
import { AdminIntegrationsController } from './presentation/admin-integrations.controller';
import { IntegrationSelfController } from './presentation/integration-self.controller';

/** Integrations seen from the API: authentication of their keys and their administration. */
@Module({
  controllers: [AdminIntegrationsController, IntegrationSelfController],
  providers: [
    ApiKeyAuthenticatorService,
    { provide: API_KEY_AUTHENTICATOR, useExisting: ApiKeyAuthenticatorService },
    IntegrationsService,
    WebhooksService,
    SecretBox,
  ],
  exports: [API_KEY_AUTHENTICATOR, ApiKeyAuthenticatorService, IntegrationsService],
})
export class IntegrationsModule {}
