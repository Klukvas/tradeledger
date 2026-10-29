import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { APP_CONFIG } from './config'
import type { AppConfig } from './config'
import { configureHttp } from './http'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: false, abortOnError: false })
  const config = app.get<AppConfig>(APP_CONFIG)
  configureHttp(app, config)
  app.enableShutdownHooks()
  await app.listen(config.port, config.host)
}

void bootstrap().catch(() => {
  Logger.error('Server startup failed. Check configuration and database availability.', 'Bootstrap')
  process.exitCode = 1
})
