import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import { unauthenticated } from './auth.service'
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types'

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().authenticatedUser
  if (!user) throw unauthenticated()
  return user
})
