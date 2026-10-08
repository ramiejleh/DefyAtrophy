/* Folder tree for the step diagram: where each file really sits in the project. */

/**
 * @param {{ path: string }[]} entries step files and context files
 * @returns {{ name: string, path: string, dirs: any[], files: any[] }}
 */
export function buildTree(entries) {
  const root = { name: "", path: "", dirs: [], files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.find((d) => d.name === part);
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push({ ...entry, name: parts.at(-1) });
  }
  return collapse(root);
}

/** Merges folders that only hold a single folder ("src" → "lib" becomes "src/lib"). */
function collapse(node) {
  node.dirs = node.dirs.map(collapse);
  if (node.name && !node.files.length && node.dirs.length === 1) {
    const only = node.dirs[0];
    return { ...only, name: `${node.name}/${only.name}` };
  }
  node.dirs.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
  return node;
}
