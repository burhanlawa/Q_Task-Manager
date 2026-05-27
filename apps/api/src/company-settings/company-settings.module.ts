import { Module } from '@nestjs/common';
import { CompanySettingsController } from './company-settings.controller';

@Module({
  controllers: [CompanySettingsController],
})
export class CompanySettingsModule {}
