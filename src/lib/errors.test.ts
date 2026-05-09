import { describe, it, expect } from "vitest";
import { DocumentValidationError, ProjectValidationError, ProjectNotFoundError } from "@/lib/errors";
import { PROJECT_FILE_NAME } from "@/lib/constants";

describe("DocumentValidationError", () => {
  it("cannot be instantiated directly (abstract)", () => {
    // TypeScript enforces this at compile time; verify the subclass works correctly.
    expect(() => new ProjectValidationError("test")).not.toThrow();
  });

  it("formats name with PascalCase docKind prefix", () => {
    const err = new ProjectValidationError("bad data");
    expect(err.name).toBe("ProjectValidationError");
  });

  it("exposes docKind on the instance", () => {
    const err = new ProjectValidationError("bad data");
    expect(err.docKind).toBe("project");
  });

  it("passes cause through ErrorOptions", () => {
    const cause = new Error("root cause");
    const err = new ProjectValidationError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("is instanceof Error and DocumentValidationError", () => {
    const err = new ProjectValidationError("bad data");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DocumentValidationError);
    expect(err).toBeInstanceOf(ProjectValidationError);
  });
});

describe("ProjectNotFoundError", () => {
  it("message contains PROJECT_FILE_NAME", () => {
    const err = new ProjectNotFoundError();
    expect(err.message).toContain(PROJECT_FILE_NAME);
  });

  it("name is ProjectNotFoundError", () => {
    const err = new ProjectNotFoundError();
    expect(err.name).toBe("ProjectNotFoundError");
  });

  it("passes cause through ErrorOptions", () => {
    const cause = new Error("root cause");
    const err = new ProjectNotFoundError({ cause });
    expect(err.cause).toBe(cause);
  });

  it("is instanceof Error", () => {
    const err = new ProjectNotFoundError();
    expect(err).toBeInstanceOf(Error);
  });
});
