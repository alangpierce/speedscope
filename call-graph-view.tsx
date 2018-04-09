import { h, Component } from 'preact'
import { getOrInsert, getOrElse, itForEach, itMap, sortBy } from './utils'
import { Rect, Vec2 } from './math'

// Generic Directed Graph
interface Edge<V> {
  from: V,
  to: V,
}
export class Graph<V, E extends Edge<V>> {
  private vertices = new Set<V>()
  private edges = new Set<E>()

  private edgesEnteringVertex = new Map<V, Set<E>>()
  private edgesLeavingVertex = new Map<V, Set<E>>()

  addVertex(v: V) { this.vertices.add(v) }
  addEdge(e: E) {
    this.addVertex(e.from)
    this.addVertex(e.to)
    this.edges.add(e)
    const inEdges = getOrInsert(this.edgesEnteringVertex, e.to, () => new Set())
    inEdges.add(e)
    const outEdges = getOrInsert(this.edgesLeavingVertex, e.from, () => new Set())
    outEdges.add(e)
  }

  getEdges(): Set<E> { return this.edges }
  getVertices(): Set<V> { return this.vertices }
  getEdgesLeaving(v: V): Set<E> {
    return this.edgesLeavingVertex.get(v) || new Set()
  }
  getEdgesEntering(v: V): Set<E> {
    return this.edgesEnteringVertex.get(v) || new Set()
  }
}

// Determine the "rank" of each vertex. The rank of a vertex will determine
// which row in the laid out graph the vertex is placed in.
function rankVertices<V, E extends Edge<V>>(graph: Graph<V, E>): Map<V, number> {
  const ranks = new Map<V, number>()

  const visited = new Set<V>()
  function getRank(v: V) {
    if (visited.has(v)) {
      if (ranks.has(v)) {
        return ranks.get(v)!
      }

      // If we've visited v, but it doesn't yet
      // have a rank, it means there's a cycle.
      // TODO(jlfwong): I'm not sure if returning -1
      // here is correct
      return -1
    }
    visited.add(v)

    let maxParentRank = -1
    for (let enteringEdge of graph.getEdgesEntering(v)) {
      maxParentRank = Math.max(getRank(enteringEdge.from), maxParentRank)
    }
    const vRank = maxParentRank + 1
    ranks.set(v, vRank)
    return vRank
  }

  itForEach(graph.getVertices(), getRank)
  return ranks
}

interface LevelNode<V> {
  parents: LevelNode<V>[]
  vertex: V | null
  index: number
}
function reindexLevel<V>(level: LevelNode<V>[]) {
  for (let i = 0; i < level.length; i++) {
    level[i].index = i
  }
}

interface LevelResult<V, E> {
  levels: LevelNode<V>[][]
  edgeToLevelNodes: Map<E, LevelNode<V>[]>
}
// Given the ranks of the vertex & the edges in the graph, fill
// rows with vertices & "virtual nodes" to allow space for edges
// which traverse multiple rows. It's also in this step in which
// we'll order the nodes in each row in order to minimize edge crossings
// between levels.
function ranksToLevels<V, E extends Edge<V>>(ranks: Map<V, number>, edges: Set<E>): LevelResult<V, E> {
  const levels: LevelNode<V>[][] = []

  const rankToLevelNode = new Map<number, LevelNode<V>[]>()

  const vertexToLevelNode = new Map<V, LevelNode<V>>()
  const edgeToLevelNodes = new Map<E, LevelNode<V>[]>()

  let minRank = 0
  let maxRank = 0

  const makeEmpty = () => []
  for (let [vertex, rank] of ranks) {
    minRank = Math.min(minRank, rank)
    maxRank = Math.max(maxRank, rank)
    const levelNode = { parents: [], vertex, index: 0 }
    vertexToLevelNode.set(vertex, levelNode)
    const levelNodeList = getOrInsert(rankToLevelNode, rank, makeEmpty)
    levelNodeList.push(levelNode)
  }

  function handleEdge(from: V, to: V): LevelNode<V>[] {
    if (from === to) {
      const node = vertexToLevelNode.get(from)
      if (!node) throw new Error("Missing level node or self cycle")
      return [node]
    }

    const fromRank = ranks.get(from)
    const toRank = ranks.get(to)

    if (fromRank == null || toRank == null) {
      throw new Error("Vertex with no rank")
    }

    if (toRank === fromRank) {
      console.log(from, to, toRank, fromRank)
      throw new Error(`Found sideways edge: ${from} -> ${to}`)
    } else if (toRank < fromRank) {
      // Back edge
      const nodes = handleEdge(to, from)
      nodes.reverse()
      return nodes
    }

    const fromLevelNode = vertexToLevelNode.get(from)
    const toLevelNode = vertexToLevelNode.get(to)

    if (!fromLevelNode || !toLevelNode) {
      throw new Error("Missing level node")
    }

    const levelNodesForEdge = [fromLevelNode]
    let parent = fromLevelNode
    for (let rank = fromRank + 1; rank < toRank; rank++) {
      const levelNodeList = getOrInsert(rankToLevelNode, rank, makeEmpty)
      const levelNode = { parents: [], vertex: null, index: 0 }
      levelNodeList.push(levelNode)
      levelNodesForEdge.push(levelNode)
    }
    toLevelNode.parents.push(parent)
    levelNodesForEdge.push(toLevelNode)
    return levelNodesForEdge
  }

  itForEach(edges, e => {
    edgeToLevelNodes.set(e, handleEdge(e.from, e.to))
  })

  for (let rank = minRank; rank <= maxRank; rank++) {
    const level = getOrElse(rankToLevelNode, rank, makeEmpty)
    reindexLevel(level)
    levels.push(level)
  }

  // Sort to minimize crossings
  // TODO(jlfwong): It may be necessary to multiple passes of this?
  function levelNodeWeight(n: LevelNode<V>) {
    return n.parents.reduce((accum: number, p: LevelNode<V>) => accum + p.index, 0) / n.parents.length
  }
  for (let level of levels) {
    sortBy(level, levelNodeWeight)
    reindexLevel(level)
  }

  return { edgeToLevelNodes, levels }
}

// Assign rectangular bounding boxes
function positionNodes<V>(levels: LevelNode<V>[][]): Map<LevelNode<V>, Rect> {
  const positions = new Map<LevelNode<V>, Rect>()

  const width = 230 / 2
  const height = 50 / 2
  const verticalSpacing = 90 / 2
  const horizontalSpacing = 50 / 2

  const maxCount = levels.reduce((max, cur) => Math.max(max, cur.length), 0)
  const totalWidth = maxCount * width + (maxCount - 1) * horizontalSpacing

  let y = 0
  for (let level of levels) {
    const count = level.length
    const levelWidth = count * width + (count - 1) * horizontalSpacing
    let x = totalWidth / 2 - levelWidth / 2
    for (let node of level) {
      if (!node.vertex) {
        positions.set(node, new Rect(
          new Vec2(x + width / 2, y + height / 2),
          new Vec2(0, 0)
        ))
      } else {
        positions.set(node, new Rect(
          new Vec2(x, y),
          new Vec2(width, height)
        ))
      }
      x += width + horizontalSpacing
    }
    y += height + verticalSpacing
  }
  return positions
}

function makeEdgePaths<V, E extends Edge<V>>(edgeToLevelNodes: Map<E, LevelNode<V>[]>, positions: Map<LevelNode<V>, Rect>): Map<E, string> {
  const edgePaths = new Map<E, string>()

  for (let [edge, nodeList] of edgeToLevelNodes) {
    let from = nodeList[0]
    let path = ''

    for (let i = 1; i < nodeList.length; i++) {
      const to = nodeList[i]
      const fromRect = positions.get(from) || new Rect()
      const toRect = positions.get(to) || new Rect()

      let fromAnchor = new Vec2(fromRect.left() + fromRect.width() / 2, fromRect.top())
      let toAnchor = new Vec2(toRect.left() + toRect.width() / 2, toRect.top())

      if (fromRect.top() < toRect.top()) {
        fromAnchor = fromAnchor.plus(new Vec2(0, fromRect.height()))
      } else {
        toAnchor = toAnchor.plus(new Vec2(0, toRect.height()))
      }

      path += `M ${fromAnchor.x} ${fromAnchor.y} L ${toAnchor.x} ${toAnchor.y}`

      from = to
    }
    edgePaths.set(edge, path)
  }

  return edgePaths
}

interface CallGraphVertex {
  name: string
}
interface CallGraphEdge extends Edge<CallGraphVertex> {
  from: CallGraphVertex
  to: CallGraphVertex
}

const graph = new Graph<CallGraphVertex, CallGraphEdge>()
const A = { name: 'A' }
const B = { name: 'B' }
const C = { name: 'C' }
const D = { name: 'D' }
const E = { name: 'E' }
const F = { name: 'F' }
const G = { name: 'G' }
const H = { name: 'H' }
function edge(from: CallGraphVertex, to: CallGraphVertex) {
  graph.addEdge({ from, to })
}
edge(A, B)
edge(A, E)
edge(B, C)
edge(D, H)
edge(A, F)
edge(E, G)
edge(F, G)
edge(C, D)
edge(G, H)
/*
edge(A, B)
edge(B, A)
*/
const ranks = rankVertices(graph)
console.log(ranks)
const levelResult = ranksToLevels(ranks, graph.getEdges())
const positions = positionNodes(levelResult.levels)
console.log(levelResult)
const edgePaths = makeEdgePaths(levelResult.edgeToLevelNodes, positions)

export class CallGraphView extends Component<{}, {}> {
  render() {
    return <svg style={{ flex: 1 }}>
      {levelResult.levels.map(level => {
        return <g>
          {level.map(node => {
            if (!node.vertex) return null
            const pos = positions.get(node) || new Rect()
            return <g transform={`translate(${pos.left()}, ${pos.top() })`}>
              <rect x={0} y={0} width={pos.width()} height={pos.height()} style={{
                fill: '#00FF00'
              }} />
              <text style={{
                'alignment-baseline': 'hanging'
              }} fill='#FF0000' > { node.vertex.name }</text>
            </g>
          })}
        </g>
      })}
      {Array.from(itMap(graph.getEdges(), (e) => {
        const path = edgePaths.get(e) || ''
        return <path d={path} style={{
          strokeWeight: 2,
          stroke: '#000000'
        }} />
      }))}
    </svg>
  }
}