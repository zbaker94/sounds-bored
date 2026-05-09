import { PROJECT_FILE_NAME } from "./constants";

export abstract class DocumentValidationError extends Error {
  constructor(
    public readonly docKind: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = `${docKind[0].toUpperCase()}${docKind.slice(1)}ValidationError`;
  }
}

export class ProjectValidationError extends DocumentValidationError {
  constructor(message: string, options?: ErrorOptions) {
    super("project", message, options);
  }
}

export class ProjectNotFoundError extends Error {
  constructor(options?: ErrorOptions) {
    super(`${PROJECT_FILE_NAME} not found in the selected folder`, options);
    this.name = "ProjectNotFoundError";
  }
}
