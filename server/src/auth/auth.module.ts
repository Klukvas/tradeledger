import { Module } from '@nestjs/common'
import { ConfigModule } from '../config'
import { DatabaseModule } from '../database'
import { AuthLimiter, authLimitsProvider } from './auth-limiter'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './password.service'
import { SessionGuard } from './session.guard'

@Module({ imports: [ConfigModule, DatabaseModule], controllers: [AuthController],
  providers: [AuthService, PasswordService, AuthLimiter, authLimitsProvider, SessionGuard], exports: [SessionGuard, AuthService] })
export class AuthModule {}
