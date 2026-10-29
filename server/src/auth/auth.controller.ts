import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { CookieOptions, Response } from 'express'
import { z } from 'zod'
import type { ApiResult, AuthResponse } from '../../../shared/api'
import { APP_CONFIG, type AppConfig } from '../config'
import { ApiException } from '../http'
import { AuthLimiter } from './auth-limiter'
import { AuthService, parseCredentials, type IssuedSession } from './auth.service'
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types'
import { CurrentUser } from './current-user.decorator'
import { DiscoverSession, readSessionCookie, SessionGuard } from './session.guard'

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(AuthLimiter) private readonly limiter: AuthLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Post('register')
  @HttpCode(200)
  async register(@Body() body: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<ApiResult<AuthResponse>> {
    if (this.config.isProduction) throw new ApiException(403, 'FORBIDDEN', 'Доступ предоставляет владелец TradeLedger.')
    this.limiter.consume('register', request.ip ?? request.socket.remoteAddress ?? 'unknown')
    const session = await this.auth.register(parseCredentials(body))
    return this.respondWithSession(response, session)
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<ApiResult<AuthResponse>> {
    this.limiter.consume('login', request.ip ?? request.socket.remoteAddress ?? 'unknown')
    const session = await this.auth.login(parseCredentials(body))
    return this.respondWithSession(response, session)
  }

  @Get('me')
  @DiscoverSession()
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthenticatedUser): ApiResult<AuthResponse> {
    return { ok: true, value: { user: { id: user.id, email: user.email } } }
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async logout(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<ApiResult<null>> {
    if (!z.strictObject({}).safeParse(body).success) throw new ApiException(400, 'VALIDATION', 'Запрос выхода должен быть пустым объектом.')
    await this.auth.logout(readSessionCookie(request, this.config.sessionCookieName))
    // A delayed logout response must not erase a newer session cookie from another tab.
    return { ok: true, value: null }
  }

  private respondWithSession(response: Response, session: IssuedSession): ApiResult<AuthResponse> {
    response.cookie(this.config.sessionCookieName, session.token, { ...this.cookieOptions(), expires: session.expiresAt, maxAge: this.config.sessionTtlMs })
    return { ok: true, value: { user: session.user } }
  }

  private cookieOptions(): CookieOptions { return { httpOnly: true, sameSite: 'lax', secure: this.config.secureCookies, path: '/' } }
}
