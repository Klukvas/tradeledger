import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "../database";
import { MonthlyCloseService } from "./monthly-close.service";

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  providers: [MonthlyCloseService],
  exports: [MonthlyCloseService],
})
export class MonthlyCloseModule {}
