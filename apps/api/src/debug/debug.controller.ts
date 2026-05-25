import { Controller, Get } from '@nestjs/common';

@Controller('debug-sentry')
export class DebugSentryController {
  @Get()
  throwError(): never {
    throw new Error('Sentry test error from @qtm/api');
  }
}
