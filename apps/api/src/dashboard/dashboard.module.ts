import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ManagerDashboardService } from './manager-dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, ManagerDashboardService],
  exports: [DashboardService, ManagerDashboardService],
})
export class DashboardModule {}
