import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataExportService } from '../billing/data-export.service';
import { DATA_EXPORT_QUEUE } from './queue.constants';

// Sprint 20.9 — Worker that runs the export job. The controller queues
// a job with { exportId }; this calls DataExportService.run() which
// builds the ZIP, uploads to R2, and flips the row to 'ready'.
//
// One attempt — the service captures errors onto the row, so a retry
// would just re-fail the same way. If the issue is transient (Redis,
// R2), the customer requests a fresh export from the UI.

type ExportJobData = { exportId: string };

@Processor(DATA_EXPORT_QUEUE)
export class DataExportProcessor extends WorkerHost {
  private readonly log = new Logger(DataExportProcessor.name);

  constructor(private readonly service: DataExportService) {
    super();
  }

  async process(job: Job<ExportJobData>): Promise<void> {
    this.log.log(`Starting data export ${job.data.exportId}`);
    await this.service.run(job.data.exportId);
  }
}
