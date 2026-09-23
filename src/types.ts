export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  /** URL em que o visitante chegou com os parâmetros. */
  landing_page?: string;
  referrer?: string;
  captured_at?: string;
  /** Página em que o formulário foi enviado. */
  page_url?: string;
}

export interface ContactPayload {
  name: string;
  email: string;
  /** WhatsApp ou telefone com DDD, como o visitante digitou. */
  phone: string;
  message: string;
  /** Honeypot: preenchido só por bot. */
  website?: string;
  attribution?: Attribution;
}

export interface ContactResponse {
  ok: boolean;
  error?: string;
}

export type FormStatus = 'idle' | 'sending' | 'success' | 'error';
