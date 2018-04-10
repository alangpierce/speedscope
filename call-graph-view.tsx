import { h, Component } from 'preact'
import { itMap } from './utils'
import { Graph, Edge, layoutGraph } from './graph-layout';

interface CallGraphVertex {
  name: string
}
interface CallGraphEdge extends Edge<CallGraphVertex> {}

const graph = new Graph<CallGraphVertex, CallGraphEdge>()
function edge(from: CallGraphVertex, to: CallGraphVertex) {
  graph.addEdge({ from, to })
}
const A = { name: 'A' }
const B = { name: 'B' }
const C = { name: 'C' }
const D = { name: 'D' }
const E = { name: 'E' }
const F = { name: 'F' }
const G = { name: 'G' }
const H = { name: 'H' }
edge(A, B)
edge(A, E)
edge(B, C)
edge(D, H)
edge(E, D)
edge(A, F)
edge(E, G)
edge(F, G)
edge(C, D)
edge(G, H)
edge(F, H)
edge(C, H)
edge(B, F)
edge(A, H)
edge(B, H)

const { levels, nodePositions, edgePaths } = layoutGraph(graph)

export class CallGraphView extends Component<{}, {}> {
  render() {
    return <svg style={{ flex: 1 }}>
      {levels.map(level => {
        return <g>
          {level.map(node => {
            if (!node.vertex) return null
            const pos = nodePositions.get(node)
            if (!pos) throw new Error(`Failed to retrieve position for node ${node}`)
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
          stroke: '#000000',
          fill: 'none'
        }} />
      }))}
    </svg>
  }
}