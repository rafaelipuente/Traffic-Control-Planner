# DEV-ONLY Debug Overlay for Polygon Drawing

## Purpose
Provides instant visibility into polygon drawing state for diagnosing failures without opening DevTools Console.

## Implementation

### Location
Top-left corner of map container, overlaying the map with high z-index (z-50).

### Activation
**DEV ONLY**: Automatically appears when `process.env.NODE_ENV !== "production"`
- No production impact
- No bundle size impact in production builds (tree-shaken)

## Overlay Fields

### 1. drawMode
- **Source**: MapboxDraw's current mode from `draw.modechange` event
- **Values**: `"simple_select"`, `"draw_polygon"`, `"direct_select"`, etc.
- **Highlighting**: Yellow bold when in `"draw_polygon"` mode
- **Purpose**: Confirms MapboxDraw successfully entered polygon drawing mode

### 2. isDrawing
- **Source**: React component state (`isDrawing`)
- **Values**: `true` / `false`
- **Highlighting**: Green bold when `true`, gray when `false`
- **Purpose**: Shows if component thinks drawing is active

### 3. pointsPlaced
- **Source**: `drawingVertexCount` state, updated from `draw.update` events
- **Values**: Number (0-N)
- **Purpose**: Real-time vertex count as user clicks

### 4. lastEvent
- **Source**: Updated by all draw event handlers
- **Values**: `"modechange"`, `"update"`, `"create"`, `"selectionchange"`, `"delete"`, `"clear"`, `"none"`
- **Color**: Cyan
- **Purpose**: Shows which event most recently fired

### 5. interactionsDisabled
- **Source**: React state (`debugInteractionsDisabled`)
- **Values**: `true` / `false`
- **Highlighting**: Green bold when `true`, red when `false`
- **Purpose**: Confirms map interactions are disabled (critical for reliable drawing)
- **Updated by**: `disableMapInteractions()` and `enableMapInteractions()`

### 6. geocoderOpen
- **Source**: DOM query of geocoder input element
- **Values**: `"true"`, `"false"`, `"unknown"`
- **Logic**: 
  - Checks if geocoder input is focused OR has a value
  - Returns `"unknown"` if geocoder element not found
- **Purpose**: Detects if geocoder overlay might be blocking clicks

## Force Draw Mode Button

### Purpose
Manually trigger polygon drawing from the overlay, useful for testing.

### Behavior
1. Logs `[DRAW] force-start from debug overlay`
2. Switches to "Area (Advanced)" mode if not already selected
3. Calls `handleStartDrawing()`

### Visual
Yellow button with lightning bolt emoji: `⚡ Force Draw Mode`

## Usage Instructions

### For Developers

**Quick diagnosis workflow:**
1. Open planner page in development mode
2. Debug overlay appears in top-left of map
3. Click "Define Work Zone" (or "Force Draw Mode" button)
4. Check overlay state:
   - ✅ `drawMode` should be `"draw_polygon"`
   - ✅ `isDrawing` should be `true`
   - ✅ `interactionsDisabled` should be `true`
   - ✅ `geocoderOpen` should be `false`
5. Click map to place vertices
6. Watch `pointsPlaced` increment
7. Check `lastEvent` shows `"update"` after each click

### Common Failure Patterns

**Pattern 1: Clicks don't register**
```
drawMode: "draw_polygon"    ✅
isDrawing: true             ✅
interactionsDisabled: false ❌ <- PROBLEM!
lastEvent: "modechange"     
pointsPlaced: 0
```
**Diagnosis**: Map interactions not disabled, clicks going to pan/zoom handlers
**Fix**: Check `disableMapInteractions()` is called

---

**Pattern 2: Geocoder blocking**
```
drawMode: "draw_polygon"    ✅
isDrawing: true             ✅
interactionsDisabled: true  ✅
geocoderOpen: true          ❌ <- PROBLEM!
lastEvent: "modechange"
pointsPlaced: 0
```
**Diagnosis**: Geocoder suggestions dropdown blocking map clicks
**Fix**: Check geocoder dismissal logic in `handleStartDrawing()`

---

**Pattern 3: Mode didn't change**
```
drawMode: "simple_select"   ❌ <- PROBLEM!
isDrawing: true             ✅
interactionsDisabled: true  ✅
geocoderOpen: false         ✅
lastEvent: "none"
pointsPlaced: 0
```
**Diagnosis**: MapboxDraw didn't enter polygon mode
**Fix**: Check `drawRef.current.changeMode("draw_polygon")` is executing

---

**Pattern 4: Events not firing**
```
drawMode: "draw_polygon"    ✅
isDrawing: true             ✅
interactionsDisabled: true  ✅
geocoderOpen: false         ✅
lastEvent: "modechange"     <- Stays stuck here
pointsPlaced: 0             <- Never updates
```
**Diagnosis**: `draw.update` events not firing when clicking
**Fix**: Check if duplicate event listeners, or if MapboxDraw instance is broken

## State Update Flow

### On Draw Start
1. User clicks "Define Work Zone" OR "Force Draw Mode"
2. `handleStartDrawing()` called
3. `disableMapInteractions()` → sets `debugInteractionsDisabled = true`
4. `draw.changeMode("draw_polygon")` → triggers `draw.modechange` event
5. Event handler sets `debugDrawMode = "draw_polygon"` and `debugLastEvent = "modechange"`
6. Overlay updates instantly

### On Vertex Placement
1. User clicks map
2. MapboxDraw fires `draw.update` event
3. Event handler:
   - Sets `debugLastEvent = "update"`
   - Updates `drawingVertexCount`
   - Overlay shows incremented `pointsPlaced`

### On Polygon Complete
1. User double-clicks OR clicks "Finish Polygon"
2. MapboxDraw fires `draw.create` event
3. Event handler:
   - Sets `debugLastEvent = "create"`
   - Calls `enableMapInteractions()` → sets `debugInteractionsDisabled = false`
   - Sets `isDrawing = false`
4. Overlay updates to show inactive state

### On Clear
1. User clicks "Clear"
2. `handleClear()` called
3. Sets `debugDrawMode = "simple_select"` and `debugLastEvent = "clear"`
4. Calls `enableMapInteractions()` → sets `debugInteractionsDisabled = false`
5. Overlay shows reset state

## Technical Implementation

### Component State
```typescript
const [debugDrawMode, setDebugDrawMode] = useState<string>("simple_select");
const [debugLastEvent, setDebugLastEvent] = useState<string>("none");
const [debugInteractionsDisabled, setDebugInteractionsDisabled] = useState(false);

const IS_DEV = process.env.NODE_ENV !== "production";
```

### Event Handler Integration
Every draw event handler calls appropriate debug state setters:
- `map.on("draw.modechange")` → `setDebugDrawMode()`, `setDebugLastEvent("modechange")`
- `map.on("draw.update")` → `setDebugLastEvent("update")`
- `map.on("draw.create")` → `setDebugLastEvent("create")`
- `map.on("draw.selectionchange")` → `setDebugLastEvent("selectionchange")`
- `map.on("draw.delete")` → `setDebugLastEvent("delete")`

### Geocoder Detection
```typescript
{(() => {
  const geocoderInput = document.querySelector(".mapboxgl-ctrl-geocoder input");
  if (!geocoderInput) return "unknown";
  const isFocused = document.activeElement === geocoderInput;
  const hasValue = (geocoderInput as HTMLInputElement).value.length > 0;
  const isOpen = isFocused || hasValue;
  return isOpen ? "true" : "false";
})()}
```

## Production Safety

### Tree-Shaking
```typescript
{IS_DEV && (
  <div className="...">
    {/* Debug overlay content */}
  </div>
)}
```

When `NODE_ENV === "production"`, the entire overlay and its logic are removed by the bundler.

### No Production Impact
- Zero runtime overhead in production
- No additional bundle size
- No accidental UI exposure to users

## Testing the Overlay

### Manual Test
1. Start dev server: `npm run dev`
2. Open planner page
3. Verify overlay appears in top-left of map
4. Click "Force Draw Mode" button
5. Verify all fields update correctly
6. Place vertices and verify `pointsPlaced` increments
7. Complete polygon and verify state resets

### Production Build Test
1. Build for production: `npm run build`
2. Check bundle: Overlay code should NOT be present
3. Run production build: `npm start`
4. Open planner page
5. Verify overlay does NOT appear

## Benefits

1. **Instant Diagnosis**: See draw state without opening console
2. **Real-time Feedback**: Watch state change as you interact
3. **Pattern Recognition**: Quickly identify failure patterns
4. **Testing Tool**: "Force Draw Mode" button for reproducible tests
5. **Zero Production Cost**: Completely removed in production builds

## Maintenance Notes

### Adding New Debug Fields
1. Add state variable: `const [debugNewField, setDebugNewField] = useState(...)`
2. Update relevant event handlers to set the state
3. Add display in overlay JSX

### Updating Event Tracking
When adding/modifying draw event listeners, remember to:
1. Call `setDebugLastEvent("event_name")`
2. Update `setDebugDrawMode()` if mode changes

### Changing Overlay Position
Edit the positioning classes in the overlay div:
```typescript
className="absolute top-2 left-2 ..."  // Change top-2/left-2 as needed
```

## Related Documentation
- `POLYGON_DRAWING_FIX.md` - Comprehensive fix documentation
- Console logs prefixed with `[DRAW]` - Complementary debugging info

