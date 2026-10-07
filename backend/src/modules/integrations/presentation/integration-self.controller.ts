import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiScopes } from '../../../common/decorators/api-scopes.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationSelfController {
  @Get('me')
  @ApiScopes()
  @ApiOperation({
    summary: 'The integration, account, scopes and quota of the API key making the request',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    const key = user.apiKey;
    if (!key) {
      throw new AppException(
        ErrorCode.API_KEY_REQUIRED,
        'Call this endpoint with an API key (X-API-Key)',
        HttpStatus.FORBIDDEN,
      );
    }
    return {
      integration: { id: key.integrationId, name: key.integrationName },
      account: { id: key.userId, email: key.userEmail },
      key: { id: key.keyId, scopes: key.scopes },
      rateLimitPerMinute: key.rateLimitPerMinute,
    };
  }
}
