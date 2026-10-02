/** Error de negocio: su mensaje se muestra tal cual al usuario. */
export class UserError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "UserError";
  }
}
