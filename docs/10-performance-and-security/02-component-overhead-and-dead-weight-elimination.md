# Domain 10: Component Tree Optimization, Dynamic Splitting & Memory Leak Prevention

## 1. Executive Summary & Component Boundary Architecture

Next.js 16 and React 19 introduce a strict Server Component architecture. Placing `'use client'` at the top of a layout or high-level page forces all child components, third-party libraries, and icons into the client JavaScript bundle. In ADTU ITMS, client boundaries are pushed down to the absolute leaves of the DOM tree ("Islands Architecture"). Heavy libraries (such as GIS mapping engines, QR barcode scanners, and Excel report generators) are strictly loaded on-demand via `next/dynamic` with `ssr: false`.

```mermaid
graph TD
    PAGE[Server Component Page: /admin/students] -->|Renders Static HTML & Skeletons| DOM[Browser DOM]
    PAGE --> ISLAND1[Dynamic Island: StudentTableFilter]
    PAGE --> ISLAND2[Dynamic Lazy Chunk: ExcelJS Export Modal]
    PAGE --> ISLAND3[Dynamic Lazy Chunk: QR Scanner Camera Modal]

    ISLAND2 -->|Only downloaded on click 'Export'| CHUNK_EXCEL[ExcelJS 4.4.0: 680 KB Bundle]
    ISLAND3 -->|Only downloaded on click 'Scan'| CHUNK_QR[Html5Qrcode: 220 KB Bundle]
```

---

## 2. Dynamic Import Splitting & Zero-Dead-Weight Strategy

Heavy third-party libraries are quarantined behind dynamic imports with fallback skeletons:

### 2.1 Lazy-Loaded Modules Catalog
1. **Interactive GIS Maps (`MapLibre / Leaflet`)**:
   - Bundle Weight: ~240 KB gzipped.
   - Dynamic Import:
     ```tsx
     const FleetMap = dynamic(() => import('@/components/maps/FleetMap'), {
       ssr: false,
       loading: () => <MapContainerSkeleton />,
     });
     ```
2. **Spreadsheet Generator (`ExcelJS`)**:
   - Bundle Weight: ~680 KB uncompressed.
   - Dynamic Import: Quarantined into `src/lib/export-helpers.ts`, loaded only when an administrator clicks "Export Excel".
3. **Hardware Barcode Camera (`html5-qrcode`)**:
   - Bundle Weight: ~220 KB.
   - Dynamic Import: Loaded strictly within the student ticket scanner modal:
     ```tsx
     const BarcodeScanner = dynamic(() => import('@/components/scanner/BarcodeScanner'), {
       ssr: false,
       loading: () => <ScannerLoadingSkeleton />,
     });
     ```

---

## 3. Comprehensive Memory Leak Prevention Audit

In long-lived single-page applications (especially driver HUDs and dispatcher dashboards running for 8+ hours on tablet mounts), unreleased resources cause progressive heap bloat and eventual tab crashes. Every dynamic component implements deterministic teardown hooks:

### 3.1 DOM Event Listeners & Body Scroll Locks (`src/components/AppShell.tsx`)
```typescript
// Close mobile menu on escape key with symmetric listener cleanup
useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && mobileOpen) {
      setMobileOpen(false);
    }
  };
  document.addEventListener('keydown', handleEscape);
  return () => document.removeEventListener('keydown', handleEscape);
}, [mobileOpen]);

// Body scroll lock reset
useEffect(() => {
  if (mobileOpen) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
  return () => {
    document.body.style.overflow = '';
  };
}, [mobileOpen]);
```

### 3.2 WebGL Context & ResizeObserver Teardown (`src/components/maps/FleetMap.tsx`)
```typescript
useEffect(() => {
  let isCancelled = false;
  // Initialize MapLibre WebGL instance...
  return () => {
    isCancelled = true;
    if (resizeObserver) resizeObserver.disconnect();
    if (renderTimer) clearTimeout(renderTimer);
    if (mapInstance) {
      mapInstance.remove(); // Frees WebGL shader programs and textures
      mapRef.current = null;
    }
  };
}, []);
```

### 3.3 Hardware Camera Stream Teardown (`src/components/scanner/BarcodeScanner.tsx`)
```typescript
useEffect(() => {
  return () => {
    // 1. Terminate all physical hardware tracks immediately
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    // 2. Clear video DOM element source to release browser camera lock
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    // 3. Cancel outstanding animation frame loops
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };
}, []);
```

### 3.4 Defensive Capacity Division Bounds (`capacity > 0 ? (load / capacity) * 100 : 0`)
All fleet utilization cards and progress indicators guard against unassigned buses or zero-capacity configurations. Calculations strictly enforce `capacity > 0 ? Math.min(100, (load / capacity) * 100) : 0`, completely preventing `Infinity%` or `NaN%` DOM rendering anomalies.

### 3.5 Bounded In-Memory Caches & Module-Level Map Limits
To prevent unbounded heap expansion in long-lived client and server processes, all module-level memory Maps are strictly capped with FIFO/LRU eviction:
- Active trip negative/positive lock caches: capped at 500 entries.
- Route name resolution cache: capped at 200 entries.
- Device session cache: capped at 1,000 entries.
- Student assignment cache: capped at 2,500 entries.

### 3.6 Spreadsheet Export Formula Injection Sanitization (CWE-1236)
When administrators export transit rosters, attendance records, or financial ledgers to CSV/Excel (`src/lib/export-helpers.ts`), all cell values starting with formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically sanitized by prefixing a single quote (`'`), completely preventing formula injection attacks in spreadsheet viewers. (`src/components/scanner/BarcodeScanner.tsx`)
```typescript
useEffect(() => {
  let scannerInstance: Html5Qrcode | null = null;
  // Start camera stream...
  return () => {
    if (scannerInstance && scannerInstance.isScanning) {
      scannerInstance.stop().then(() => {
        scannerInstance.clear();
      }).catch(err => console.warn('Scanner stop error:', err));
    }
  };
}, []);
```
