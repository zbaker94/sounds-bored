import { describe, it, expect } from "vitest";
import { buildTree, findFolderNode, getSoundsInSubtree, normalizePath } from "./soundTreeUtils";
import type { GlobalFolder, Sound } from "@/lib/schemas";

function folder(id: string, path: string, name?: string): GlobalFolder {
  return { id, path, name: name ?? id };
}

function sound(id: string, name: string, folderId?: string): Sound {
  return { id, name, tags: [], sets: [], folderId };
}

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("C:\\sounds\\drums")).toBe("C:/sounds/drums");
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizePath("/sounds/drums")).toBe("/sounds/drums");
  });

  it("handles mixed separators", () => {
    expect(normalizePath("C:/sounds\\drums/kicks")).toBe("C:/sounds/drums/kicks");
  });
});

describe("buildTree", () => {
  it("returns sound nodes at root when no folders exist", () => {
    const result = buildTree([sound("s1", "Kick")], []);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("sound");
  });

  it("places sounds with no folderId at root", () => {
    const result = buildTree([sound("s1", "Kick")], [folder("f1", "/sounds")]);
    const rootSounds = result.filter((n) => n.kind === "sound");
    expect(rootSounds).toHaveLength(1);
  });

  it("places sounds with an unknown folderId at root", () => {
    const result = buildTree([sound("s1", "Kick", "nonexistent")], []);
    expect(result[0].kind).toBe("sound");
  });

  it("places sounds inside their matching folder", () => {
    const f1 = folder("f1", "/sounds");
    const s1 = sound("s1", "Kick", "f1");
    const result = buildTree([s1], [f1]);
    expect(result).toHaveLength(1);
    const folderNode = result[0];
    expect(folderNode.kind).toBe("folder");
    if (folderNode.kind === "folder") {
      const sounds = folderNode.children.filter((c) => c.kind === "sound");
      expect(sounds).toHaveLength(1);
    }
  });

  it("nests a child folder under its parent based on path prefix", () => {
    const parent = folder("f1", "/sounds");
    const child = folder("f2", "/sounds/drums");
    const result = buildTree([], [parent, child]);
    expect(result).toHaveLength(1); // only parent at root
    const parentNode = result[0];
    expect(parentNode.kind).toBe("folder");
    if (parentNode.kind === "folder") {
      expect(parentNode.children).toHaveLength(1);
      expect(parentNode.children[0].kind).toBe("folder");
    }
  });

  it("handles grandchild folders (multi-level nesting)", () => {
    const root = folder("f1", "/sounds");
    const mid = folder("f2", "/sounds/drums");
    const leaf = folder("f3", "/sounds/drums/kicks");
    const result = buildTree([], [root, mid, leaf]);
    expect(result).toHaveLength(1);
    const rootNode = result[0];
    if (rootNode.kind === "folder") {
      expect(rootNode.children).toHaveLength(1);
      const midNode = rootNode.children[0];
      if (midNode.kind === "folder") {
        expect(midNode.children).toHaveLength(1);
        expect(midNode.children[0].kind).toBe("folder");
      }
    }
  });

  it("normalizes backslash paths when determining parent-child relationships", () => {
    const parent = folder("f1", "C:\\sounds");
    const child = folder("f2", "C:\\sounds\\drums");
    const result = buildTree([], [parent, child]);
    expect(result).toHaveLength(1); // child is nested under parent
    const parentNode = result[0];
    if (parentNode.kind === "folder") {
      expect(parentNode.children).toHaveLength(1);
    }
  });

  it("returns an empty array when given no sounds and no folders", () => {
    expect(buildTree([], [])).toHaveLength(0);
  });
});

describe("findFolderNode", () => {
  it("finds a root-level folder by id", () => {
    const f1 = folder("f1", "/sounds", "Sounds");
    const tree = buildTree([], [f1]);
    const found = findFolderNode(tree, "f1");
    expect(found).not.toBeNull();
    expect(found?.folder.id).toBe("f1");
  });

  it("finds a nested folder by id", () => {
    const parent = folder("f1", "/sounds");
    const child = folder("f2", "/sounds/drums");
    const tree = buildTree([], [parent, child]);
    const found = findFolderNode(tree, "f2");
    expect(found).not.toBeNull();
    expect(found?.folder.id).toBe("f2");
  });

  it("returns null when folder id is not in tree", () => {
    const tree = buildTree([], [folder("f1", "/sounds")]);
    expect(findFolderNode(tree, "nonexistent")).toBeNull();
  });
});

describe("getSoundsInSubtree", () => {
  it("returns all sounds directly in a folder", () => {
    const f1 = folder("f1", "/sounds");
    const s1 = sound("s1", "Kick", "f1");
    const tree = buildTree([s1], [f1]);
    const folderNode = findFolderNode(tree, "f1")!;
    expect(getSoundsInSubtree(folderNode)).toHaveLength(1);
  });

  it("returns sounds from nested subfolders recursively", () => {
    const parent = folder("f1", "/sounds");
    const child = folder("f2", "/sounds/drums");
    const s1 = sound("s1", "Kick", "f1");
    const s2 = sound("s2", "Snare", "f2");
    const tree = buildTree([s1, s2], [parent, child]);
    const parentNode = findFolderNode(tree, "f1")!;
    expect(getSoundsInSubtree(parentNode)).toHaveLength(2);
  });

  it("returns empty array for a folder with no sounds", () => {
    const f1 = folder("f1", "/sounds");
    const tree = buildTree([], [f1]);
    const folderNode = findFolderNode(tree, "f1")!;
    expect(getSoundsInSubtree(folderNode)).toHaveLength(0);
  });
});
