import type { Request } from 'express'

export type AuthenticatedUser = Readonly<{ id: string; email: string; workspaceId: string }>
export type AuthenticatedRequest = Request & { authenticatedUser?: AuthenticatedUser }
