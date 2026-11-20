export function sessionState(user: { email_confirmed_at?: string } | null, error: unknown) {
  if (error) {
    const failure = error as { status?: number; name?: string };
    if (failure.name === 'AuthSessionMissingError' || [400, 401, 403].includes(failure.status || 0))
      return 'signed-out' as const;
    return 'unavailable' as const;
  }
  if (!user) return 'signed-out' as const;
  return user.email_confirmed_at ? ('signed-in' as const) : ('unverified' as const);
}
