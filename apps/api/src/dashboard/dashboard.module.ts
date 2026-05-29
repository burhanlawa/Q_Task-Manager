import { Module } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ManagerDashboardService } from './manager-dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, ManagerDashboardService, AdminDashboardService],
  exports: [DashboardService, ManagerDashboardService, AdminDashboardService],
})
export class DashboardModule {}
