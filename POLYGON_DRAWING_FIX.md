# Polygon Drawing Reliability Fix

## Problem Statement
QA reported polygon drawing failures (5/5 times intermittently):
- Clicks would pan/zoom map instead of placing vertices
- No polygon appeared after clicking
- No "SELECTED AREA" indicator
- App remained in EMPTY state

## Root Causes Identified

1. **Map interactions intercepting clicks**: Pan, zoom, and other map handlers were competing with MapboxDraw for click events
2. **Geocoder overlay blocking clicks**: Search suggestions dropdown could block map clicks
3. **No user feedback**: Users couldn't tell if vertices were being placed
4. **Minimal error handling**: No indication when drawing failed
5. **Incomplete event logging**: Couldn't debug why drawing wasn't working

## Implementation Changes

### 1. Map Interaction Management ✅

**Added two helper functions:**
```typescript
disableMapInteractions() // Called when entering draw mode
enableMapInteractions()  // Called when exiting draw mode
```

**Disabled interactions during polygon drawing:**
- `map.dragPan.disable()` - Prevents panning
- `map.dragRotate.disable()` - Prevents rotation
- `map.doubleClickZoom.disable()` - Ensures double-click finishes polygon
- `map.scrollZoom.disable()` - Prevents zoom interference
- `map.boxZoom.disable()` - Prevents box zoom
- `map.keyboard.disable()` - Prevents keyboard shortcuts
- `map.touchZoomRotate.disable()` - Prevents touch gestures

**Why this fixes the issue:**
Map interactions were consuming click events before MapboxDraw could process them. By disabling these interactions during draw mode, all clicks go directly to the MapboxDraw control.

### 2. Geocoder Overlay Dismissal ✅

**In `handleStartDrawing()`:**
```typescript
// Dismiss geocoder overlay to prevent it from blocking map clicks
if (geocoderRef.current) {
  geocoderRef.current.clear();
  // Force close the suggestions dropdown
  const geocoderContainer = document.querySelector(".mapboxgl-ctrl-geocoder");
  if (geocoderContainer) {
    const input = geocoderContainer.querySelector("input");
    if (input) {
      input.blur();
    }
  }
}
```

**Why this fixes the issue:**
The geocoder suggestions dropdown can overlay the map and intercept clicks, preventing vertices from being placed.

### 3. Comprehensive Draw Event Logging ✅

**Added logging for all MapboxDraw events:**

- **draw.modechange**: `[DRAW] draw.modechange mode=<mode>`
  - Logs when entering/exiting draw_polygon mode
  - Starts 5-second timeout to detect failed clicks
  
- **draw.selectionchange**: `[DRAW] draw.selectionchange featureIds=[...]`
  - Logs feature selection changes
  
- **draw.update**: `[DRAW] draw.update points=<n>`
  - Logs each vertex placement
  - Updates vertex count state for UI feedback
  
- **draw.create**: `[DRAW] draw.create id=<id> points=<n>`
  - Logs polygon completion
  - Validates minimum 3 points
  
- **draw.delete**: `[DRAW] draw.delete count=<n>`
  - Logs feature deletion

**Why this helps:**
Comprehensive logging allows developers to diagnose drawing failures by seeing exactly when events fire and what state the draw control is in.

### 4. User Feedback System ✅

**Real-time vertex count display:**
```tsx
{drawingVertexCount > 0 && (
  <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">
    {drawingVertexCount} point{drawingVertexCount !== 1 ? "s" : ""}
  </span>
)}
```

**Error messages:**
```tsx
{drawingError && (
  <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md border border-red-200">
    <span>⚠️</span>
    <p>{drawingError}</p>
  </div>
)}
```

**Dynamic instructions:**
- Shows different messages based on vertex count
- Alerts user when 3+ points are available to finish
- Displays error if clicks aren't registering after 5 seconds

**Why this helps:**
Users get immediate visual confirmation that their clicks are working, reducing confusion and retry attempts.

### 5. Explicit "Finish Polygon" Button ✅

**Appears after 3 vertices are placed:**
```tsx
{drawingVertexCount >= 3 && (
  <button
    onClick={() => {
      drawRef.current.changeMode("simple_select");
      // ... complete polygon
    }}
    className="... animate-pulse"
  >
    ✓ Finish Polygon
  </button>
)}
```

**Why this helps:**
- Provides alternative to double-click (which users might not discover)
- More reliable than double-click on some devices/browsers
- Visual pulsing animation draws attention

### 6. Error Detection ✅

**5-second timeout for failed clicks:**
```typescript
if (e.mode === "draw_polygon") {
  drawTimeoutRef.current = setTimeout(() => {
    const currentVertexCount = features.features[0]?.geometry.coordinates[0]?.length || 0;
    
    if (currentVertexCount === 0) {
      setDrawingError("Clicks aren't registering. Try clicking again or zoom in.");
    }
  }, 5000);
}
```

**Minimum point validation:**
```typescript
if (points < 4) { // 3 unique points + 1 closing point
  setDrawingError("Need at least 3 points to create a polygon.");
  draw.deleteAll();
  return;
}
```

**Why this helps:**
Proactive error detection alerts users before they waste time clicking, and validates data quality.

### 7. Event Listener Registration ✅

**All draw event listeners registered ONCE in map initialization useEffect:**
- Prevents duplicate handlers on component re-renders
- Ensures consistent event handling
- Proper cleanup in useEffect return function

## Files Modified

**`components/MapSelector.tsx`**
- Added refs: `geocoderRef`, `drawTimeoutRef`
- Added state: `drawingVertexCount`, `drawingError`
- Added functions: `disableMapInteractions()`, `enableMapInteractions()`
- Enhanced: `handleStartDrawing()`, `handleClear()`
- Updated: draw event listeners with comprehensive logging
- Added UI: Finish button, vertex counter, error display

## Testing Instructions

### Manual Acceptance Test (Required: 10 consecutive attempts)

1. Open the planner page
2. Click "Define Work Zone"
3. Verify geocoder dropdown closes
4. Verify cursor changes to crosshair
5. Click 4 points on the map
6. Verify vertex counter shows "1 point", "2 points", "3 points", "4 points"
7. Verify "Finish Polygon" button appears after 3rd point
8. Either:
   - Double-click to finish, OR
   - Click "Finish Polygon" button
9. Verify polygon appears with amber fill
10. Verify "Selected Area / Work Zone: N points" appears in output panel
11. Repeat 10 times - should work every time

### Console Verification

**Expected console output:**
```
[DRAW] start requested
[DRAW] Disabling map interactions to prevent click interference
[DRAW] mode=draw_polygon after changeMode
[DRAW] draw.modechange mode=draw_polygon
[DRAW] draw.update points=1
[DRAW] draw.update points=2
[DRAW] draw.update points=3
[DRAW] draw.update points=4
[DRAW] Finish button clicked  (if button used)
[DRAW] draw.create id=<uuid> points=5
[DRAW] Re-enabling map interactions
```

### Error Scenarios to Test

1. **No clicks after entering draw mode**: Should show error after 5 seconds
2. **Try to finish with <3 points**: Should show validation error
3. **Geocoder open when starting draw**: Should auto-dismiss
4. **Pan/zoom while drawing**: Should not interfere (interactions disabled)

## Expected Results

- **>95% reliability**: Polygon drawing should work consistently
- **Immediate feedback**: Users see vertex count update on each click
- **Clear errors**: Users get helpful messages if something goes wrong
- **Debug-friendly**: Console logs show exactly what's happening

## Non-Goals (Not Changed)

- ✅ Auto-layout device placement math (unchanged)
- ✅ TCP rules pack (unchanged)
- ✅ Sign spacing logic (unchanged)
- ✅ Edit mode behavior (unchanged)
- ✅ Plan generation logic (unchanged)

## Summary

This fix transforms polygon drawing from unreliable to robust by:
1. Ensuring clicks reach MapboxDraw (disabled competing interactions)
2. Dismissing overlays that could block clicks
3. Providing real-time feedback (vertex counter, finish button)
4. Detecting and reporting errors (timeout, validation)
5. Adding comprehensive logging for debugging

The changes are isolated to the drawing UX and do not affect any TCP calculation logic.

