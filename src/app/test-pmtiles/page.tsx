"use client";

import { getGuwahatiPmtilesUrl,isNonEmptyHttpUrl } from "@/lib/maps/guwahati-pmtiles";
import { useRef,useState } from "react";

interface TestResult {
  name: string;
  status: "pending" | "running" | "success" | "error";
  message: string;
  duration?: number;
}

export default function PMTilesTestPage() {
  const [tests, setTests] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pmtilesUrl, setPmtilesUrl] = useState("");
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const addTestResult = (name: string, status: TestResult["status"], message: string, duration?: number) => {
    setTests(prev => [...prev, { name, status, message, duration }]);
  };

  const updateTestResult = (index: number, status: TestResult["status"], message: string, duration?: number) => {
    setTests(prev => prev.map((test, i) => i === index ? { ...test, status, message, duration } : test));
  };

  const clearTests = () => setTests([]);

  // Test 1: Environment Variable Check
  const testEnvironmentVariable = async () => {
    const index = tests.length;
    addTestResult("Environment Variable Check", "running", "Checking NEXT_PUBLIC_GUWAHATI_PMTILES_URL...");
    
    const url = getGuwahatiPmtilesUrl();
    setPmtilesUrl(url);
    
    if (!url) {
      updateTestResult(index, "error", "❌ PMTiles URL is empty. Set NEXT_PUBLIC_GUWAHATI_PMTILES_URL or NEXT_PUBLIC_SUPABASE_URL");
      return false;
    }
    
    if (!isNonEmptyHttpUrl(url)) {
      updateTestResult(index, "error", `❌ Invalid URL format: ${url}`);
      return false;
    }
    
    updateTestResult(index, "success", `✅ Valid PMTiles URL: ${url}`);
    return url;
  };

  // Test 2: URL Accessibility Test
  const testURLAccessibility = async (url: string) => {
    const index = tests.length;
    addTestResult("URL Accessibility", "running", `Testing HTTP access to ${url}...`);
    
    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000)
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        updateTestResult(index, "error", `❌ HTTP ${response.status}: ${response.statusText}`, duration);
        return false;
      }
      
      updateTestResult(index, "success", `✅ URL accessible (${duration}ms)`, duration);
      return true;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTestResult(index, "error", `❌ Fetch failed: ${error.message}`, duration);
      return false;
    }
  };

  // Test 3: Range Request Support (Critical for PMTiles)
  const testRangeRequestSupport = async (url: string) => {
    const index = tests.length;
    addTestResult("Range Request Support", "running", "Testing HTTP range request support...");
    
    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Range": "bytes=0-1"
        },
        signal: AbortSignal.timeout(10000)
      });
      
      const duration = Date.now() - startTime;
      
      const acceptRanges = response.headers.get("accept-ranges");
      const contentRange = response.headers.get("content-range");
      const contentType = response.headers.get("content-type");
      
      const isRangeCapable = 
        response.status === 206 || 
        (response.status === 200 && acceptRanges?.toLowerCase() === "bytes");
      
      if (!isRangeCapable) {
        updateTestResult(index, "error", 
          `❌ Range requests not supported. Status: ${response.status}, Accept-Ranges: ${acceptRanges}, Content-Range: ${contentRange}`, 
          duration
        );
        return false;
      }
      
      updateTestResult(index, "success", 
        `✅ Range requests supported (${response.status}, Content-Type: ${contentType})`, 
        duration
      );
      return true;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTestResult(index, "error", `❌ Range request failed: ${error.message}`, duration);
      return false;
    }
  };

  // Test 4: PMTiles Header Validation
  const testPMTilesHeader = async (url: string) => {
    const index = tests.length;
    addTestResult("PMTiles Header Validation", "running", "Reading PMTiles file header...");
    
    const startTime = Date.now();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Range": "bytes=0-127"
        },
        signal: AbortSignal.timeout(10000)
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        updateTestResult(index, "error", `❌ Failed to read header: HTTP ${response.status}`, duration);
        return false;
      }
      
      const buffer = await response.arrayBuffer();
      const header = new Uint8Array(buffer);
      
      // PMTiles magic number: "PMTiles" in ASCII
      const magic = String.fromCharCode(...header.slice(0, 7));
      if (magic !== "PMTiles") {
        updateTestResult(index, "error", 
          `❌ Invalid PMTiles magic number. Expected "PMTiles", got "${magic}"`, 
          duration
        );
        return false;
      }
      
      const version = header[7];
      updateTestResult(index, "success", 
        `✅ Valid PMTiles header (Magic: ${magic}, Version: ${version})`, 
        duration
      );
      return true;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTestResult(index, "error", `❌ Header validation failed: ${error.message}`, duration);
      return false;
    }
  };

  // Test 5: PMTiles Protocol Registration
  const testProtocolRegistration = async () => {
    const index = tests.length;
    addTestResult("PMTiles Protocol Registration", "running", "Registering pmtiles:// protocol...");
    
    const startTime = Date.now();
    try {
      const { ensurePmtilesProtocolRegistered } = await import("@/lib/maps/pmtiles-protocol");
      await ensurePmtilesProtocolRegistered();
      
      const duration = Date.now() - startTime;
      updateTestResult(index, "success", `✅ PMTiles protocol registered successfully (${duration}ms)`, duration);
      return true;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTestResult(index, "error", `❌ Protocol registration failed: ${error.message}`, duration);
      return false;
    }
  };

  // Test 6: MapLibre Loading
  const testMapLibreLoading = async () => {
    const index = tests.length;
    addTestResult("MapLibre Loading", "running", "Loading MapLibre GL library...");
    
    const startTime = Date.now();
    try {
      const maplibregl = await import("maplibre-gl");
      
      const duration = Date.now() - startTime;
      updateTestResult(index, "success", `✅ MapLibre GL loaded (${duration}ms)`, duration);
      return true;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTestResult(index, "error", `❌ MapLibre loading failed: ${error.message}`, duration);
      return false;
    }
  };

  // Test 7: Map Initialization
  const testMapInitialization = async (url: string) => {
    const index = tests.length;
    addTestResult("Map Initialization", "running", "Initializing map with PMTiles source...");
    
    const startTime = Date.now();
    
    try {
      if (!mapContainerRef.current) {
        updateTestResult(index, "error", "Map container not found");
        return false;
      }
      
      const { ensurePmtilesProtocolRegistered } = await import("@/lib/maps/pmtiles-protocol");
      await ensurePmtilesProtocolRegistered();
      
      const maplibregl = await import("maplibre-gl");
      
      const style = {
        version: 8,
        name: "Guwahati PMTiles Test",
        sources: {
          guwahati: {
            type: "vector",
            url: `pmtiles://${url}`,
            attribution: "© ADTU / OSM",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#f8fafc" } },
          {
            id: "water",
            type: "fill",
            source: "guwahati",
            "source-layer": "water",
            paint: { "fill-color": "#e2e8f0" },
          },
          {
            id: "buildings",
            type: "fill",
            source: "guwahati",
            "source-layer": "building",
            paint: { "fill-color": "#cbd5e1" },
          },
        ],
      };
      
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: style as any,
        center: [91.7362, 26.1445],
        zoom: 13,
        minZoom: 10,
        maxZoom: 18,
      });
      
      return new Promise<boolean>((resolve) => {
        map.on("load", () => {
          const duration = Date.now() - startTime;
          updateTestResult(index, "success", `✅ Map initialized successfully (${duration}ms)`, duration);
          resolve(true);
        });
        
        map.on("error", (e) => {
          const duration = Date.now() - startTime;
          updateTestResult(index, "error", `❌ Map error: ${e.error?.message || "Unknown error"}`, duration);
          resolve(false);
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          const duration = Date.now() - startTime;
          updateTestResult(index, "error", `❌ Map initialization timeout (${duration}ms)`, duration);
          resolve(false);
        }, 30000);
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTestResult(index, "error", `❌ Map initialization failed: ${error.message}`, duration);
      return false;
    }
  };

  // Run all tests
  const runAllTests = async () => {
    setIsRunning(true);
    clearTests();
    
    try {
      // Test 1: Environment Variable
      const url = await testEnvironmentVariable();
      if (!url) {
        setIsRunning(false);
        return;
      }
      
      // Test 2: URL Accessibility
      const accessible = await testURLAccessibility(url);
      if (!accessible) {
        setIsRunning(false);
        return;
      }
      
      // Test 3: Range Request Support
      const rangeSupported = await testRangeRequestSupport(url);
      if (!rangeSupported) {
        setIsRunning(false);
        return;
      }
      
      // Test 4: PMTiles Header
      const headerValid = await testPMTilesHeader(url);
      if (!headerValid) {
        setIsRunning(false);
        return;
      }
      
      // Test 5: Protocol Registration
      const protocolRegistered = await testProtocolRegistration();
      if (!protocolRegistered) {
        setIsRunning(false);
        return;
      }
      
      // Test 6: MapLibre Loading
      const mapLibreLoaded = await testMapLibreLoading();
      if (!mapLibreLoaded) {
        setIsRunning(false);
        return;
      }
      
      // Test 7: Map Initialization
      await testMapInitialization(url);
      
    } catch (error: any) {
      addTestResult("Test Suite", "error", `❌ Unexpected error: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusColor = (status: TestResult["status"]) => {
    switch (status) {
      case "success": return "text-green-600 bg-green-50 border-green-200";
      case "error": return "text-red-600 bg-red-50 border-red-200";
      case "running": return "text-blue-600 bg-blue-50 border-blue-200";
      default: return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "success": return "✅";
      case "error": return "❌";
      case "running": return "⏳";
      default: return "⏸️";
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">PMTiles Comprehensive Test Suite</h1>
        <p className="text-gray-600 mb-6">Test the Guwahati PMTiles configuration and functionality</p>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex gap-4 mb-4">
            <button
              onClick={runAllTests}
              disabled={isRunning}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
            >
              {isRunning ? "Running Tests..." : "🚀 Run All Tests"}
            </button>
            <button
              onClick={clearTests}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold"
            >
              🗑️ Clear Results
            </button>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">PMTiles URL:</h3>
            <code className="text-sm bg-white p-2 rounded border block break-all">
              {pmtilesUrl || "Not loaded yet"}
            </code>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Test Results</h2>
          <div className="space-y-3">
            {tests.length === 0 && (
              <p className="text-gray-500 text-center py-8">No tests run yet. Click "Run All Tests" to begin.</p>
            )}
            {tests.map((test, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border ${getStatusColor(test.status)}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{getStatusIcon(test.status)}</span>
                    <span className="font-semibold">{test.name}</span>
                  </div>
                  {test.duration && (
                    <span className="text-sm font-mono">{test.duration}ms</span>
                  )}
                </div>
                <p className="mt-2 text-sm">{test.message}</p>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold mb-4">Map Preview</h2>
          <div
            ref={mapContainerRef}
            className="w-full h-96 rounded-lg border-2 border-gray-300 bg-gray-100"
          />
          <p className="text-sm text-gray-500 mt-2">
            Map will appear here after running all tests successfully
          </p>
        </div>
      </div>
    </div>
  );
}
