/** Typed HTTP errors rendered as the `ApiError` DTO from @paskamer/schema. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'authentication required', code = 'unauthorized') => new HttpError(401, code, message);
export const paymentRequired = (message: string, details?: unknown) => new HttpError(402, 'payment_required', message, details);
export const forbidden = (message = 'forbidden', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const gone = (message: string) => new HttpError(410, 'gone', message);
export const unprocessable = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);
export const tooLarge = (message: string) => new HttpError(413, 'payload_too_large', message);
export const serviceUnavailable = (code: string, message: string) => new HttpError(503, code, message);
