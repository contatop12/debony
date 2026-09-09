export interface ContactPayload {
  name: string;
  email: string;
  message: string;
  /** Honeypot: preenchido só por bot. */
  website?: string;
}

export interface ContactResponse {
  ok: boolean;
  error?: string;
}

export type FormStatus = 'idle' | 'sending' | 'success' | 'error';
