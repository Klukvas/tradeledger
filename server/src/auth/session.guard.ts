import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { APP_CONFIG, type AppConfig } from '../config'
import { AuthService, unauthenticated } from './auth.service'
import type { AuthenticatedRequest } from './auth.types'

const SESSION_DISCOVERY = Symbol('session-discovery')
export const DiscoverSession = (): MethodDecorator => SetMetadata(SESSION_DISCOVERY, true)

export function readSessionCookie(request: AuthenticatedRequest, name: string): unknown {
  const cookies: unknown = request.cookies
  return typeof cookies === 'object' && cookies !== null && Object.hasOwn(cookies, name)
    ? (cookies as Record<string, unknown>)[name] : undefined
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = await this.auth.authenticate(readSessionCookie(request, this.config.sessionCookieName))
    // This header constrains the cookie identity; it never selects an owner.
    if (!this.reflector.get<boolean>(SESSION_DISCOVERY, context.getHandler()) && request.headers['x-tradeledger-user'] !== user.id) throw unauthenticated()
    request.authenticatedUser = user
    return true
  }
}
