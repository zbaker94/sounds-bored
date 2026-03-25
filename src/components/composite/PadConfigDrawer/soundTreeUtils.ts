import type { GlobalFolder, Sound } from "@/lib/schemas";

export type TreeNode =
  | { kind: "folder"; folder: GlobalFolder; children: TreeNode[] }
  | { kind: "sound"; sound: Sound };

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function buildTree(sounds: Sound[], folders: GlobalFolder[]): TreeNode[] {
  // Normalize all folder paths for comparison
  const normalized = folders.map((f) => ({ ...f, path: normalizePath(f.path) }));

  // Find the parent of a folder: the registered folder with the longest path that is a strict prefix
  function findParentId(folder: GlobalFolder & { path: string }): string | null {
    let best: (GlobalFolder & { path: string }) | null = null;
    for (const other of normalized) {
      if (other.id === folder.id) continue;
      if (folder.path.startsWith(other.path + "/")) {
        if (!best || other.path.length > best.path.length) {
          best = other;
        }
      }
    }
    return best?.id ?? null;
  }

  // Build folder node map
  const folderNodes = new Map<string, Extract<TreeNode, { kind: "folder" }>>();
  for (const f of normalized) {
    folderNodes.set(f.id, { kind: "folder", folder: f, children: [] });
  }

  // Wire folder nodes into the tree
  const roots: TreeNode[] = [];
  for (const f of normalized) {
    const parentId = findParentId(f);
    const node = folderNodes.get(f.id)!;
    if (parentId && folderNodes.has(parentId)) {
      folderNodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Attach sounds to their folder or root
  for (const sound of sounds) {
    const soundNode: TreeNode = { kind: "sound", sound };
    if (sound.folderId && folderNodes.has(sound.folderId)) {
      folderNodes.get(sound.folderId)!.children.push(soundNode);
    } else {
      roots.push(soundNode);
    }
  }

  return roots;
}

export function findFolderNode(
  nodes: TreeNode[],
  folderId: string
): Extract<TreeNode, { kind: "folder" }> | null {
  for (const node of nodes) {
    if (node.kind === "folder") {
      if (node.folder.id === folderId) return node;
      const found = findFolderNode(node.children, folderId);
      if (found) return found;
    }
  }
  return null;
}

export function getSoundsInSubtree(
  node: Extract<TreeNode, { kind: "folder" }>
): Sound[] {
  const result: Sound[] = [];
  function collect(n: TreeNode) {
    if (n.kind === "sound") {
      result.push(n.sound);
    } else {
      for (const child of n.children) collect(child);
    }
  }
  collect(node);
  return result;
}
