import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthSession {
  /** Set by the login flow; read by the HTTP interceptor. */
  readonly token = signal<string | null>(null);
}
