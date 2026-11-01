import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthSession } from './auth-session';

/** Adds the session token to every API call. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthSession).token();
  if (!token || !req.url.startsWith('/api/')) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
