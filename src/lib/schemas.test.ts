import { describe, it, expect } from "vitest";
import {
  ProjectHistoryEntrySchema,
  ProjectHistorySchema,
  ProjectSchema,
  type ProjectHistoryEntry,
  type ProjectHistory,
  type Project,
} from "@/lib/schemas";

describe("ProjectHistoryEntrySchema", () => {
  it("should validate a valid project history entry", () => {
    const validEntry = {
      name: "Test Project",
      path: "/test/path",
      date: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectHistoryEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validEntry);
    }
  });

  it("should reject entry without name", () => {
    const invalidEntry = {
      path: "/test/path",
      date: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it("should reject entry without path", () => {
    const invalidEntry = {
      name: "Test Project",
      date: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it("should reject entry without date", () => {
    const invalidEntry = {
      name: "Test Project",
      path: "/test/path",
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });

  it("should reject entry with wrong types", () => {
    const invalidEntry = {
      name: 123,
      path: true,
      date: {},
    };

    const result = ProjectHistoryEntrySchema.safeParse(invalidEntry);
    expect(result.success).toBe(false);
  });
});

describe("ProjectHistorySchema", () => {
  it("should validate an empty array", () => {
    const result = ProjectHistorySchema.safeParse([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("should validate an array of valid entries", () => {
    const validHistory: ProjectHistory = [
      {
        name: "Project 1",
        path: "/path/1",
        date: "2026-03-13T10:00:00.000Z",
      },
      {
        name: "Project 2",
        path: "/path/2",
        date: "2026-03-13T11:00:00.000Z",
      },
    ];

    const result = ProjectHistorySchema.safeParse(validHistory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe("Project 1");
      expect(result.data[1].name).toBe("Project 2");
    }
  });

  it("should reject non-array input", () => {
    const result = ProjectHistorySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject array with invalid entries", () => {
    const invalidHistory = [
      {
        name: "Valid Project",
        path: "/path/1",
        date: "2026-03-13T10:00:00.000Z",
      },
      {
        name: "Invalid Project",
        // missing path
        date: "2026-03-13T11:00:00.000Z",
      },
    ];

    const result = ProjectHistorySchema.safeParse(invalidHistory);
    expect(result.success).toBe(false);
  });
});

describe("ProjectSchema", () => {
  it("should validate a project with only required fields", () => {
    const minimalProject = {
      name: "Test Project",
    };

    const result = ProjectSchema.safeParse(minimalProject);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Test Project");
      expect(result.data.version).toBeUndefined();
      expect(result.data.description).toBeUndefined();
      expect(result.data.lastSaved).toBeUndefined();
    }
  });

  it("should validate a project with all fields", () => {
    const fullProject: Project = {
      name: "Full Project",
      version: "2.0.0",
      description: "A complete project",
      lastSaved: "2026-03-13T10:00:00.000Z",
    };

    const result = ProjectSchema.safeParse(fullProject);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(fullProject);
    }
  });

  it("should reject project without name", () => {
    const invalidProject = {
      version: "1.0.0",
      description: "A project without name",
    };

    const result = ProjectSchema.safeParse(invalidProject);
    expect(result.success).toBe(false);
  });

  it("should reject project with wrong types", () => {
    const invalidProject = {
      name: 123,
      version: true,
      description: [],
      lastSaved: {},
    };

    const result = ProjectSchema.safeParse(invalidProject);
    expect(result.success).toBe(false);
  });

  it("should allow optional fields to be undefined", () => {
    const project = {
      name: "Partial Project",
      version: undefined,
      description: undefined,
      lastSaved: undefined,
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });

  it("should validate project with version only", () => {
    const project = {
      name: "Versioned Project",
      version: "3.1.4",
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("3.1.4");
    }
  });

  it("should validate project with description only", () => {
    const project = {
      name: "Described Project",
      description: "This is a description",
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("This is a description");
    }
  });

  it("should validate project with lastSaved only", () => {
    const project = {
      name: "Saved Project",
      lastSaved: "2026-03-13T12:34:56.789Z",
    };

    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastSaved).toBe("2026-03-13T12:34:56.789Z");
    }
  });
});

describe("Type exports", () => {
  it("should infer correct types from schemas", () => {
    // This is a compile-time test
    const entry: ProjectHistoryEntry = {
      name: "test",
      path: "/test",
      date: "2026-03-13T10:00:00.000Z",
    };

    const history: ProjectHistory = [entry];

    const project: Project = {
      name: "test",
    };

    // If these compile without errors, the types are correctly exported
    expect(entry).toBeDefined();
    expect(history).toBeDefined();
    expect(project).toBeDefined();
  });
});
