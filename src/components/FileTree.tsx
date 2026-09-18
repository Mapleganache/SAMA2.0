import type { FileNode } from '../data'

type Props = {
  nodes: FileNode[]
  expanded: Record<string, boolean>
  activeFile: string
  onToggle: (folderPath: string) => void
  onOpen: (filePath: string) => void
  depth?: number
  pathPrefix?: string
}

export function FileTree({
  nodes,
  expanded,
  activeFile,
  onToggle,
  onOpen,
  depth = 0,
  pathPrefix = '',
}: Props) {
  return (
    <ul className="tree" style={{ ['--depth' as string]: depth }}>
      {nodes.map((node) => {
        const rel = pathPrefix ? `${pathPrefix}/${node.name}` : node.name
        if (node.type === 'folder') {
          const open = !!expanded[rel]
          return (
            <li key={`${depth}-${rel}`}>
              <button
                type="button"
                className="tree-folder"
                onClick={() => onToggle(rel)}
                style={{ paddingLeft: `${10 + depth * 14}px` }}
              >
                <span className={open ? 'chev open' : 'chev'} />
                {node.name}
              </button>
              {open && node.children && (
                <FileTree
                  nodes={node.children}
                  expanded={expanded}
                  activeFile={activeFile}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  depth={depth + 1}
                  pathPrefix={rel}
                />
              )}
            </li>
          )
        }

        return (
          <li key={`${depth}-${rel}`}>
            <button
              type="button"
              className={activeFile === rel ? 'tree-file active' : 'tree-file'}
              onClick={() => onOpen(rel)}
              style={{ paddingLeft: `${28 + depth * 14}px` }}
            >
              {node.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
