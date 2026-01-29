# @avtools/creative-algs

## Summary

`@avtools/creative-algs` is a pure TypeScript utility library providing computational geometry and data structure algorithms for creative coding. It contains four modules:

- **Voronoi** -- Fortune's algorithm for Voronoi diagram generation, with polygon extraction and point-deduplication helpers.
- **Shape Helpers** -- 2D polygon and line-segment utilities: bounding boxes, segment intersection, directional sweep clipping, point-in-polygon testing, and closest-edge queries.
- **VariationTree** -- A tree data structure for algorithmic exploration of generative variations, with a mini command language for navigating, branching, and bookmarking nodes.
- **Combiners** -- Finite sequence combiners (`Zipper`, `RootLooper`, `Nester`) that combine multiple named lists into composite output sequences with different cycling strategies.

The package has zero external dependencies and is written as pure TypeScript with a Deno-style entry point (`mod.ts`).

**Package path**: `packages/creative-algs/`
**Entry point**: `packages/creative-algs/mod.ts`
**Package name (import map)**: `@avtools/creative-algs`

---

## Monorepo Relationships

This package is consumed by:

- **`apps/browser-projections`** -- Uses `Voronoi`, `getVoronoiPolygons`, `filterSimilarPoints`, `directionSweep`, `findClosestPolygonLineAtPoint`, `isPointInPolygon`, and `lineToPointDistance` in Vue sketches for Voronoi visualization, polygon fill animations, and generative path artwork.
- **`apps/deno-notebooks`** -- Uses `VariationTree` in Deno Jupyter notebooks for experimentation.
- **Deno notebook experiments** in `browser-projections/deno_notebook_stuff/` -- Uses `Zipper` combiner.

The import alias `@avtools/creative-algs` is configured in:
- Root `deno.json` import map
- Per-app `deno.json` files
- Vite config `resolve.alias` entries
- TypeScript `paths` in `tsconfig.app.json`

---

## Source Files

| File | Purpose |
|------|---------|
| `mod.ts` | Barrel re-export of all modules |
| `voronoi.ts` | Voronoi class (Fortune's algorithm), `getVoronoiPolygons`, `filterSimilarPoints` |
| `shapeHelpers.ts` | 2D geometry utilities for polygons and line segments |
| `transformTree.ts` | `VariationTree` and `VariationNode` classes |
| `combiners.ts` | `Zipper`, `RootLooper`, `Nester` combiner classes |

---

## Core Concepts

### Point Type Convention

Throughout the library, points are represented as `{ x: number, y: number }`. This is defined locally in each module (not shared across modules), but all modules use the same shape. The `Polygon` type used in shape helpers is `{ points: Point[] }`.

### Voronoi Diagrams

The Voronoi class implements Fortune's sweep-line algorithm. It is a port of Raymond Hill's `rhill-voronoi-core.js` (MIT license). The file is annotated with `@ts-nocheck` because it uses prototype-based patterns. The class is designed for reuse: call `recycle(diagram)` before `compute()` to reclaim internal objects and reduce GC pressure.

### VariationTree Navigation

The `VariationTree` is designed for live-coding and performance contexts where you want to explore a tree of generative variations. You register transform functions in the `transformMap`, then use the command language to navigate, create children (applying transforms), and bookmark positions. Each node stores the transform key that created it, enabling filtered traversal by transform type.

### Combiners

Combiners take a dictionary of named arrays and produce a sequence of "picks" from each array. The three strategies differ in how indices advance:

- **Zipper**: All indices advance in lockstep (each wrapping independently).
- **RootLooper**: All indices are driven by the first list's cycle -- when the first list wraps, all others reset.
- **Nester**: Indices advance like a multi-digit odometer -- the first list is the "ones digit," the second is the "tens digit," etc.

---

## API Reference

### Voronoi Module (`voronoi.ts`)

#### `Voronoi` class

```typescript
class Voronoi {
  compute(
    sites: { x: number; y: number; voronoiId?: number }[],
    bbox: { xl: number; xr: number; yt: number; yb: number }
  ): VDiagram;

  recycle(diagram: VDiagram): void;
}
```

**`compute(sites, bbox)`**
Computes a Voronoi diagram for the given site points within the bounding box. The bounding box uses `xl`/`xr` for left/right x bounds and `yt`/`yb` for top/bottom y bounds. Returns a diagram object with `cells`, `edges`, `vertices`, and `execTime` properties. Sites are not mutated but each site gets a `voronoiId` property assigned.

**`recycle(diagram)`**
Surrenders a previously computed diagram's internal objects (vertices, edges, cells) back to the Voronoi instance for memory reuse. Call this before `compute()` when recomputing diagrams in a loop.

#### Diagram Types

```typescript
type VDiagram = {
  cells: VCell[];
  edges: any[];      // Edge objects with lSite, rSite, va, vb
  vertices: any[];   // Vertex objects with x, y
  execTime: number;  // Milliseconds
};

type VCell = {
  site: VSite;
  halfedges: VHalfedge[];
};

type VSite = {
  x: number;
  y: number;
  voronoiId: number;
};

type VHalfedge = {
  getStartpoint(): { x: number; y: number };
  getEndpoint(): { x: number; y: number };
};
```

Each `VCell` also has methods on its prototype:
- `prepareHalfedges()` -- Removes degenerate halfedges and sorts counterclockwise.
- `getNeighborIds()` -- Returns an array of neighboring cell voronoiIds.
- `getBbox()` -- Returns `{ x, y, width, height }` of the cell.
- `pointIntersection(x, y)` -- Returns `1` (inside), `0` (on perimeter), `-1` (outside).

#### `getVoronoiPolygons(diagram, origSiteList?)`

```typescript
function getVoronoiPolygons(
  diagram: VDiagram,
  origSiteList?: VSite[]
): { x: number; y: number }[][];
```

Extracts polygon point arrays from a Voronoi diagram. If `origSiteList` is provided, returns polygons ordered to match the original site list (using `voronoiId` mapping). Otherwise returns polygons in cell array order.

#### `filterSimilarPoints(points, threshold?)`

```typescript
function filterSimilarPoints(
  points: { x: number; y: number }[],
  threshold?: number  // default: 0.002
): { x: number; y: number }[];
```

Removes consecutive near-duplicate points from a polygon point list. Also checks and removes duplicates between the first and last point (wrapping). Useful for cleaning up Voronoi cell polygons before rendering.

---

### Shape Helpers Module (`shapeHelpers.ts`)

#### `getBBox(region)`

```typescript
function getBBox(region: Point[]): {
  minX: number; maxX: number;
  minY: number; maxY: number;
};
```

Computes the axis-aligned bounding box of a set of points.

#### `segment_intersection(ray1, ray2)`

```typescript
function segment_intersection(
  ray1: Point[],  // [startPoint, endPoint]
  ray2: Point[]   // [startPoint, endPoint]
): { x: number; y: number; valid: boolean };
```

Computes the intersection point of two line segments. Returns an object with `valid: true` if the segments actually intersect within their bounds, or `valid: false` (with `x: -1, y: -1`) if they do not intersect or are parallel.

#### `directionSweep(cellPoints, frac, direction)`

```typescript
function directionSweep(
  cellPoints: Point[],
  frac: number,           // 0 to 1
  direction: 'top' | 'bottom' | 'left' | 'right'
): {
  polygon: Array<{ x: number; y: number; theta: number }>;
  line: Point[];
};
```

Clips a polygon by sweeping a line from the named direction. At `frac=0`, the result is empty; at `frac=1`, the result is the full polygon. The sweep line moves from the named edge inward (e.g., `'top'` sweeps downward from the top edge). Returns the clipped sub-polygon (sorted by angle from centroid) and the sweep line endpoints.

This is the core function used for polygon fill animations in `browser-projections`.

#### `lineToPointDistance(p1, p2, point)`

```typescript
function lineToPointDistance(
  p1: Point,
  p2: Point,
  point: Point
): number;
```

Computes the minimum distance from a point to a line segment defined by `p1` and `p2`. Handles the three cases: projection falls before `p1`, after `p2`, or onto the segment.

#### `findClosestPolygonLineAtPoint(polygons, point)`

```typescript
type Polygon = { points: Point[] };

function findClosestPolygonLineAtPoint(
  polygons: Polygon[],
  point: Point
): {
  polygonIndex: number;
  lineIndex: number;
  distance: number;
};
```

Finds the closest edge (across all polygons) to a given point. Returns the polygon index, the edge index within that polygon, and the distance. Polygons are assumed to be closed (the last point connects back to the first).

#### `isPointInPolygon(polygon, point)`

```typescript
function isPointInPolygon(
  polygon: Polygon,
  point: Point
): boolean;
```

Ray-casting algorithm for point-in-polygon testing. Works for any simple polygon (convex or concave).

---

### VariationTree Module (`transformTree.ts`)

#### `VariationNode<T>`

```typescript
class VariationNode<T> {
  value: T;
  children: VariationNode<T>[];
  childrenByTransform: Map<string, VariationNode<T>[]>;
  parent: VariationNode<T> | null;
  transformKey: string;

  constructor(
    value: T,
    parent?: VariationNode<T> | null,
    transformKey?: string
  );
}
```

A node in the variation tree. Each node stores its value, its children (both as a flat list and grouped by transform key), a reference to its parent, and the transform key that was used to create it.

#### `VariationTree<T>`

```typescript
class VariationTree<T> {
  root: VariationNode<T>;
  currentNode: VariationNode<T>;
  defaultTransform: (value: T) => T;
  transformMap: Map<string, (value: T) => T>;
  bookmarkedNodes: Map<string, VariationNode<T>>;

  constructor(
    rootVal: T,
    defaultTransform?: (value: T) => T  // defaults to identity
  );

  // Read state
  get currentVal(): T;
  siblings(): VariationNode<T>[];
  numSiblings(): number;
  siblingIndex(): number;

  // Navigation
  moveUp(): void;
  returnToRoot(): void;
  jumpToNode(node: VariationNode<T>): void;

  // Child operations
  makeChild(transformKey: string): void;
  jumpToChild(transformKey: string, ind: number): void;
  jumpToRandomChild(transformKey: string): void;

  // Sibling operations
  makeSibling(transformKey: string): void;
  jumpToSibling(transformKey: string, ind: number): void;
  jumpToRandSibling(transformKey: string): void;
  moveInSiblingList(transformKey: string, amt: number): void;

  // Command language
  run(commandString: string): VariationNode<T>[];
  commandIsValid(command: string): boolean;
  commandStringExecute(command: string): VariationNode<T> | null;
}
```

**Key behavioral notes:**

- `makeChild(transformKey)` -- Creates a new child of `currentNode` by applying the transform associated with `transformKey` (or `defaultTransform` if key is not found). Moves `currentNode` to the new child.
- `makeSibling(transformKey)` -- Creates a new sibling of `currentNode` by applying the transform to the parent's value. Moves `currentNode` to the new sibling. If `currentNode` is root, delegates to `makeChild`.
- `jumpToChild(transformKey, ind)` -- Jumps to the child at index `ind` (modular). If no children exist (or none with the given transform key), creates one first.
- `moveInSiblingList(transformKey, amt)` -- Moves relatively within the sibling list by `amt` positions (wrapping with modular arithmetic).
- Transform key filtering: When a `transformKey` is provided, operations filter children/siblings to only those created with that key. If the key is not found, falls back to the unfiltered list.

#### Command Language

The `run(commandString)` method accepts a whitespace-separated string of commands. Each command returns the resulting node (except `C` which returns null). The method returns an array of all non-null result nodes.

| Command Pattern | Description | Examples |
|----------------|-------------|----------|
| `D_[transformKey]_<index\|r\|n\|l>` | **Down** (to child). `r`=random, `n`=new (create), `l`=last, number=index | `D_n`, `D_r`, `D_split_n`, `D_3` |
| `S_[transformKey]_<index\|r\|n\|l>` | **Sibling** (jump to sibling by index). Same suffixes as D | `S_n`, `S_r`, `S_rev_0` |
| `M_[transformKey]_<amount\|r\|n\|l>` | **Move** (relative movement in sibling list). Default amount is 1 | `M_1`, `M_-2`, `M_r` |
| `U_[count]` | **Up** (to parent). Optional count for multiple levels. Default is 1 | `U`, `U_3` |
| `R` | **Root** (return to root node) | `R` |
| `C_<name>` | **Create bookmark** at current node. Does not produce an output node | `C_start` |
| `B_<name>` | **Bookmark jump** to a previously bookmarked node | `B_start` |

The transform key is optional in D, S, and M commands. When omitted, the operation works on the full children/sibling list. When provided, it filters to children/siblings created with that transform key.

---

### Combiners Module (`combiners.ts`)

#### Types

```typescript
type CombinerInput<T> = {
  [K in keyof T]: T[K][];
};

type CombinerOutput<T> = {
  [K in keyof T]: T[K];
};
```

The generic parameter `T` describes the shape of a single output: an object where each key maps to a value type. `CombinerInput<T>` wraps each value in an array. `CombinerOutput<T>` is the unwrapped single-pick version.

#### `FiniteCombiner<T>` (abstract base)

```typescript
abstract class FiniteCombiner<T> {
  next(): CombinerOutput<T>;
  nextN(n: number): CombinerOutput<T>[];
  directGet(n: number): CombinerOutput<T>;
  resetIndices(): void;
}
```

- `next()` -- Returns the current combination and advances indices.
- `nextN(n)` -- Returns `n` successive combinations.
- `directGet(n)` -- Returns the combination at position `n` without mutating internal state (stateless random access).
- `resetIndices()` -- Resets all indices to 0.

#### `Zipper<T>`

All list indices advance by 1 each step, wrapping independently.

```typescript
// For lists of lengths [3, 4]:
// Step 0: indices [0, 0]
// Step 1: indices [1, 1]
// Step 2: indices [2, 2]
// Step 3: indices [0, 3]  (first wraps)
// Step 4: indices [1, 0]  (second wraps)
```

#### `RootLooper<T>`

The first list is the "driver." All other lists advance in lockstep, but when the first list wraps back to 0, all other lists also reset to 0. Essentially, only one full cycle of the first list is played before everything resets.

```typescript
// For lists { nums: [1,2,3], letters: ['a','b','c','d'] }:
// Step 0: { nums: 1, letters: 'a' }
// Step 1: { nums: 2, letters: 'b' }
// Step 2: { nums: 3, letters: 'c' }
// Step 3: { nums: 1, letters: 'a' }  (first list wrapped, all reset)
```

#### `Nester<T>`

Indices advance like an odometer. The first key is the fastest-changing digit. The total unique combinations before the full sequence repeats is the product of all list lengths.

```typescript
// For lists { nums: [1,2,3], letters: ['a','b'] }:
// Step 0: { nums: 1, letters: 'a' }  indices [0, 0]
// Step 1: { nums: 2, letters: 'a' }  indices [1, 0]
// Step 2: { nums: 3, letters: 'a' }  indices [2, 0]
// Step 3: { nums: 1, letters: 'b' }  indices [0, 1]  (first wraps, second increments)
// Step 4: { nums: 2, letters: 'b' }  indices [1, 1]
// Step 5: { nums: 3, letters: 'b' }  indices [2, 1]
// Step 6: { nums: 1, letters: 'a' }  indices [0, 0]  (full cycle)
```

---

## Usage Patterns

### Basic Voronoi Diagram

```typescript
import { Voronoi, getVoronoiPolygons, filterSimilarPoints } from '@avtools/creative-algs';

const voronoi = new Voronoi();
const sites = [
  { x: 100, y: 100 },
  { x: 300, y: 200 },
  { x: 200, y: 400 },
  { x: 500, y: 150 },
];
const bbox = { xl: 0, xr: 800, yt: 0, yb: 600 };

const diagram = voronoi.compute(sites, bbox);
const polygons = getVoronoiPolygons(diagram, sites);

// Clean up near-duplicate points in each polygon
const cleanPolygons = polygons.map(poly => filterSimilarPoints(poly));

// When recomputing (e.g., in an animation loop):
voronoi.recycle(diagram);
const newDiagram = voronoi.compute(newSites, bbox);
```

### Polygon Fill Animation with Direction Sweep

```typescript
import { directionSweep } from '@avtools/creative-algs';

// Given a polygon (array of {x, y} points), animate a fill sweep:
function drawPartialFill(ctx: CanvasRenderingContext2D, polygon: Point[], progress: number) {
  const { polygon: clipped } = directionSweep(polygon, progress, 'top');

  ctx.beginPath();
  clipped.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fill();
}
```

### VariationTree for Generative Exploration

```typescript
import { VariationTree } from '@avtools/creative-algs';

// Create a tree of numbers with transform functions
const tree = new VariationTree<number>(100, (n) => n + Math.random() * 10);

// Register named transforms
tree.transformMap.set('double', (n) => n * 2);
tree.transformMap.set('half', (n) => n / 2);
tree.transformMap.set('noise', (n) => n + (Math.random() - 0.5) * 50);

// Navigate using the command language
const nodes = tree.run('D_double_n D_noise_n U D_half_n');
// nodes[0]: child created with 'double' transform
// nodes[1]: grandchild created with 'noise' transform
// nodes[2]: back at the 'double' child (after U)
// nodes[3]: second child of 'double' node, created with 'half'

// Bookmark and recall
tree.run('C_home');           // bookmark current node as 'home'
tree.run('D_noise_n D_noise_n'); // go deeper
tree.run('B_home');           // jump back to bookmarked node

// Access current value
console.log(tree.currentVal);
```

### Combiners for Sequence Generation

```typescript
import { Zipper, Nester, RootLooper } from '@avtools/creative-algs';

const params = {
  color: ['red', 'blue', 'green'],
  size: [10, 20],
  shape: ['circle', 'square', 'triangle', 'diamond'],
};

// Zipper: all advance independently
const zipper = new Zipper(params);
const zipResults = zipper.nextN(6);
// Each list cycles at its own length

// Nester: exhaustive combinations (odometer style)
const nester = new Nester(params);
// Total unique combos = 3 * 2 * 4 = 24
const allCombos = nester.nextN(24);

// Random access without mutating state
const combo5 = nester.directGet(5);

// RootLooper: first list drives the cycle length
const looper = new RootLooper(params);
const loopResults = looper.nextN(6);
// Resets every 3 steps (length of first list 'color')
```

### Point-in-Polygon and Closest Edge Queries

```typescript
import { isPointInPolygon, findClosestPolygonLineAtPoint } from '@avtools/creative-algs';

const polygon = {
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
};

const inside = isPointInPolygon(polygon, { x: 50, y: 50 });  // true
const outside = isPointInPolygon(polygon, { x: 150, y: 50 }); // false

// Find which polygon edge is closest to a point
const closest = findClosestPolygonLineAtPoint([polygon], { x: 50, y: -5 });
// closest.polygonIndex === 0
// closest.lineIndex === 0  (the top edge from (0,0) to (100,0))
// closest.distance === 5
```

---

## Caveats and Notes

1. **Voronoi module uses `@ts-nocheck`** -- The `voronoi.ts` file is a TypeScript port of a JavaScript library that uses prototype-based patterns. It is annotated with `@ts-nocheck` and `eslint-disable`. Do not expect full type safety from its internals. The public API (`compute`, `recycle`, `getVoronoiPolygons`, `filterSimilarPoints`) is well-typed.

2. **Point type is module-local** -- Each module defines its own `Point = { x: number; y: number }` type. They are structurally identical but not shared. When passing points between modules, structural compatibility is sufficient.

3. **Polygon type in shapeHelpers** -- The `Polygon` type is `{ points: Point[] }` (an object wrapping an array), while Voronoi polygon outputs from `getVoronoiPolygons` are bare `Point[]` arrays. You may need to wrap: `{ points: voronoiPolygon }`.

4. **`directionSweep` returns theta-sorted points** -- The returned polygon points include a `theta` property (angle from centroid). The array is sorted by descending theta for counterclockwise ordering. The `x` and `y` properties are still present.

5. **Combiner key order matters** -- The order of keys in the input object determines which list is "first" for `RootLooper` and `Nester`. JavaScript object key order follows insertion order for string keys, so the first key you define is the driver/fastest-changing list.

6. **VariationTree transform key fallback** -- When you call `makeChild('someKey')` and `'someKey'` is not in `transformMap`, the `defaultTransform` is used and the child is stored under the key `'default'` in `childrenByTransform`. However, the node's `transformKey` property is still set to the original key string passed in. This asymmetry can cause unexpected behavior when filtering by transform key.

7. **`filterSimilarPoints` default threshold** -- The default threshold of `0.002` is designed for normalized coordinate spaces (0-1 range). If working in pixel coordinates, you will likely need to increase the threshold.

8. **`segment_intersection` epsilon** -- Uses a fixed epsilon of `0.0000001` for the between-check. Very small segments or very large coordinate values may cause precision issues.

9. **No runtime Deno or Node dependencies** -- This is a pure TypeScript package with no imports. It works in any JavaScript runtime (browser, Deno, Node).
