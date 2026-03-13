import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { CurrentProjectProvider, useCurrentProject } from "./currentProjectStore";
import { createMockProject, createMockHistoryEntry } from "@/test/factories";

describe("CurrentProjectProvider - dirty state tracking", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CurrentProjectProvider>{children}</CurrentProjectProvider>
  );

  beforeEach(() => {
    // Reset any state if needed
  });

  it("should initialize with null currentProject", () => {
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.currentProject).toBeNull();
  });

  describe("setCurrentProject", () => {
    it("should set currentProject with isTemporary=true and isDirty=false for new projects", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      act(() => {
        result.current.setCurrentProject(historyEntry, project, true);
      });

      expect(result.current.currentProject).not.toBeNull();
      expect(result.current.currentProject?.isTemporary).toBe(true);
      expect(result.current.currentProject?.isDirty).toBe(false);
      expect(result.current.currentProject?.project.name).toBe(project.name);
    });

    it("should set currentProject with isTemporary=false and isDirty=false for existing projects", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });

      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(false);
    });

    it("should default isTemporary to true when not provided", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();

      act(() => {
        result.current.setCurrentProject(historyEntry);
      });

      expect(result.current.currentProject?.isTemporary).toBe(true);
      expect(result.current.currentProject?.isDirty).toBe(false);
    });
  });

  describe("updateProject - dirty state tracking", () => {
    it("should set isDirty=true when project is updated", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject({ name: "Original Project" });

      // Load project
      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });

      expect(result.current.currentProject?.isDirty).toBe(false);

      // Update project
      const updatedProject = { ...project, name: "Updated Project" };
      act(() => {
        result.current.updateProject(updatedProject);
      });

      expect(result.current.currentProject?.isDirty).toBe(true);
      expect(result.current.currentProject?.project.name).toBe("Updated Project");
    });

    it("should keep isDirty=true through multiple updates", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject({ name: "Project v1" });

      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });

      // First update
      act(() => {
        result.current.updateProject({ ...project, name: "Project v2" });
      });
      expect(result.current.currentProject?.isDirty).toBe(true);

      // Second update
      act(() => {
        result.current.updateProject({ ...project, name: "Project v3" });
      });
      expect(result.current.currentProject?.isDirty).toBe(true);

      // Third update
      act(() => {
        result.current.updateProject({ ...project, name: "Project v4" });
      });
      expect(result.current.currentProject?.isDirty).toBe(true);
    });

    it("should not update anything when currentProject is null", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const project = createMockProject();

      act(() => {
        result.current.updateProject(project);
      });

      expect(result.current.currentProject).toBeNull();
    });

    it("should preserve isTemporary flag when updating", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      // Test with isTemporary=false
      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });

      act(() => {
        result.current.updateProject({ ...project, name: "Updated" });
      });

      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(true);
    });
  });

  describe("markAsPermanent - move to permanent location", () => {
    it("should set isDirty=false when project is moved to permanent location", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      // Load project and update it (making it dirty)
      act(() => {
        result.current.setCurrentProject(historyEntry, project, true);
      });

      act(() => {
        result.current.updateProject({ ...project, name: "Modified" });
      });

      expect(result.current.currentProject?.isDirty).toBe(true);

      // Mark as permanent
      const newHistoryEntry = createMockHistoryEntry({ path: "/new/path" });
      act(() => {
        result.current.markAsPermanent(newHistoryEntry);
      });

      expect(result.current.currentProject?.isDirty).toBe(false);
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.historyEntry.path).toBe("/new/path");
    });

    it("should handle markAsPermanent when project was not dirty", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      act(() => {
        result.current.setCurrentProject(historyEntry, project, true);
      });

      expect(result.current.currentProject?.isDirty).toBe(false);

      act(() => {
        result.current.markAsPermanent(historyEntry);
      });

      expect(result.current.currentProject?.isDirty).toBe(false);
      expect(result.current.currentProject?.isTemporary).toBe(false);
    });

    it("should not do anything when currentProject is null", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();

      act(() => {
        result.current.markAsPermanent(historyEntry);
      });

      expect(result.current.currentProject).toBeNull();
    });
  });

  describe("full workflow - new project lifecycle", () => {
    it("should track dirty state through entire new project lifecycle", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry({ path: "/tmp/project" });
      const project = createMockProject({ name: "New Project" });

      // 1. Create new project (temporary, not dirty)
      act(() => {
        result.current.setCurrentProject(historyEntry, project, true);
      });
      expect(result.current.currentProject?.isTemporary).toBe(true);
      expect(result.current.currentProject?.isDirty).toBe(false);

      // 2. Make changes (temporary, dirty)
      act(() => {
        result.current.updateProject({ ...project, name: "Modified Project" });
      });
      expect(result.current.currentProject?.isTemporary).toBe(true);
      expect(result.current.currentProject?.isDirty).toBe(true);

      // 3. Save to permanent location (permanent, not dirty)
      const permanentEntry = createMockHistoryEntry({ path: "/home/user/projects/project" });
      act(() => {
        result.current.markAsPermanent(permanentEntry);
      });
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(false);

      // 4. Make more changes (permanent location, but dirty again)
      act(() => {
        result.current.updateProject({ ...project, name: "Further Modified" });
      });
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(true);

      // 5. Save again (permanent, not dirty)
      act(() => {
        result.current.markAsPermanent(permanentEntry);
      });
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(false);
    });
  });

  describe("full workflow - existing project lifecycle", () => {
    it("should track dirty state through entire existing project lifecycle", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry({ path: "/home/user/projects/project" });
      const project = createMockProject({ name: "Existing Project" });

      // 1. Open existing project (permanent, not dirty)
      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(false);

      // 2. Make changes (permanent location, but dirty)
      act(() => {
        result.current.updateProject({ ...project, name: "Modified Existing" });
      });
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(true);

      // 3. Save changes (permanent, not dirty)
      act(() => {
        result.current.markAsPermanent(historyEntry);
      });
      expect(result.current.currentProject?.isTemporary).toBe(false);
      expect(result.current.currentProject?.isDirty).toBe(false);
    });
  });

  describe("hasUnsavedChanges helper", () => {
    it("should return true for temporary new projects", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      act(() => {
        result.current.setCurrentProject(historyEntry, project, true);
      });

      expect(result.current.hasUnsavedChanges()).toBe(true);
    });

    it("should return true for temporary project even after auto-save clears dirty flag", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const tempPath = "/tmp/soundsbored_test_123";
      const historyEntry = createMockHistoryEntry({ path: tempPath });
      const project = createMockProject();

      // Start with a temporary project
      act(() => {
        result.current.setCurrentProject(historyEntry, project, true);
      });

      expect(result.current.hasUnsavedChanges()).toBe(true);

      // Make a change (simulating user edit)
      act(() => {
        result.current.updateProject({ ...project, name: "Modified" });
      });

      expect(result.current.currentProject?.isDirty).toBe(true);
      expect(result.current.hasUnsavedChanges()).toBe(true);

      // Simulate auto-save clearing the dirty flag
      // This should NOT set isTemporary=false because we're still in temp location!
      act(() => {
        result.current.clearDirtyFlag();
      });

      // After auto-save, isDirty should be false but isTemporary should still be true
      // because we're still in a temporary location
      expect(result.current.currentProject?.isDirty).toBe(false);

      // REGRESSION TEST: This should still be true because we're in temp location
      expect(result.current.currentProject?.isTemporary).toBe(true);

      // CRITICAL: Should still have unsaved changes because project is in temp location
      expect(result.current.hasUnsavedChanges()).toBe(true);
    });

    it("should return true for dirty permanent projects", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });

      act(() => {
        result.current.updateProject({ ...project, name: "Modified" });
      });

      expect(result.current.hasUnsavedChanges()).toBe(true);
    });

    it("should return false for permanent and clean projects", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });
      const historyEntry = createMockHistoryEntry();
      const project = createMockProject();

      act(() => {
        result.current.setCurrentProject(historyEntry, project, false);
      });

      expect(result.current.hasUnsavedChanges()).toBe(false);
    });

    it("should return false when no project is loaded", () => {
      const { result } = renderHook(() => useCurrentProject(), { wrapper });

      expect(result.current.hasUnsavedChanges()).toBe(false);
    });
  });
});
