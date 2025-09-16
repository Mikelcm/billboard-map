import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Loader } from "@googlemaps/js-api-loader";

// ---- Dark Google Map styles ----
const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1f2937" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#e5e7eb" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d1d5db" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#c7d2fe" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#064e3b" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#a7f3d0" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#374151" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#e5e7eb" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4b5563" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1f2937" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1020" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#93c5fd" }] },
];

type Billboard = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  locationText?: string;
  sheetSpaceId?: string;
  images?: string[];
  periodsAvailable?: string;
  marker?: google.maps.Marker;
  distanceMeters?: number | null;
  inRadius?: boolean;
};

type CenterPoint = { name: string; location: google.maps.LatLngLiteral } | null;

export default function App() {
  // MAP
  const mapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem("gmaps_api_key") || "");
  const [googleNS, setGoogleNS] = useState<typeof google | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);

  // THEME (fără tailwind `dark:` — folosim condiționale)
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("ui_theme");
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    localStorage.setItem("ui_theme", isDark ? "dark" : "light");
    if (map && googleNS) map.setOptions({ styles: isDark ? DARK_MAP_STYLES : [] });
  }, [isDark, map, googleNS]);

  // CENTRU + RADIUS
  const [centerPoint, setCenterPoint] = useState<CenterPoint>(null);
  const [centerMode, setCenterMode] = useState<"store" | "billboard">("store");
  const [centerMarker, setCenterMarker] = useState<google.maps.Marker | null>(null);
  const [circle, setCircle] = useState<google.maps.Circle | null>(null);
  const [radius, setRadius] = useState<number>(1000);
  // cercuri per-panou pentru vizualizarea simultană a mai multor radii
  const [billboardCircles, setBillboardCircles] = useState<Record<string, google.maps.Circle>>({});
  const allBillboardCirclesRef = useRef<google.maps.Circle[]>([]);

  // PANOURI
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  const [showOnlyInRadius, setShowOnlyInRadius] = useState<boolean>(false);
  const [originalExcelData, setOriginalExcelData] = useState<any[][]>([]);

  // TAB NAVIGATION
  const [activeTab, setActiveTab] = useState<"proximitati" | "panouri" | "disponibilitati">("proximitati");

  // DISPONIBILITATI FILTERS
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [filteredBillboards, setFilteredBillboards] = useState<Billboard[]>([]);
  const [showOnlyFilteredOnMap, setShowOnlyFilteredOnMap] = useState<boolean>(false);

  // POI
  const [poiQuery, setPoiQuery] = useState<string>("");
  const [poiMarkers, setPoiMarkers] = useState<google.maps.Marker[]>([]);
  const [autoSearchOnMove, setAutoSearchOnMove] = useState<boolean>(false);
  const [isSearchingPOI, setIsSearchingPOI] = useState<boolean>(false);
  const poiInfoRef = useRef<google.maps.InfoWindow | null>(null);
  const [poiKeepExisting, setPoiKeepExisting] = useState<boolean>(true);
  const [poiColor, setPoiColor] = useState<string>("#ef4444"); // roșu implicit pentru prima căutare

  // Refs pentru a accesa valorile curente în event listeners
  const circleRef = useRef<google.maps.Circle | null>(null);
  const centerMarkerRef = useRef<google.maps.Marker | null>(null);
  const centerPointRef = useRef<CenterPoint>(null);
  const centerModeRef = useRef<"store" | "billboard">("store");

  useEffect(() => {
    circleRef.current = circle;
  }, [circle]);

  useEffect(() => {
    centerMarkerRef.current = centerMarker;
  }, [centerMarker]);

  useEffect(() => {
    centerPointRef.current = centerPoint;
  }, [centerPoint]);

  useEffect(() => {
    centerModeRef.current = centerMode;
  }, [centerMode]);

  // STATUS
  const [status, setStatus] = useState<string>("");

  // 1) LOAD MAP
  useEffect(() => {
    if (!apiKey || !mapRef.current) return;
    const loader = new Loader({ apiKey, version: "weekly", libraries: ["places", "geometry"] });

    setStatus("Se încarcă Google Maps...");
    loader
      .load()
      .then((google) => {
        setGoogleNS(google);
        const m = new google.maps.Map(mapRef.current as HTMLElement, {
          center: { lat: 45.9432, lng: 24.9668 },
          zoom: 6,
          mapTypeControl: false,
          fullscreenControl: true,
          streetViewControl: false,
          styles: isDark ? DARK_MAP_STYLES : [],
        });
        setMap(m);
        setStatus("");
      })
      .catch((err) => {
        console.error(err);
        setStatus("Eroare la încărcarea Google Maps. Verifică cheia API + Maps JS API / Places / Geocoding.");
      });
  }, [apiKey]); // stilul hărții e actualizat în efectul de theme

  // 2) AUTOCOMPLETE
  useEffect(() => {
    if (!googleNS || !map || !searchInputRef.current) return;
    const ac = new googleNS.maps.places.Autocomplete(searchInputRef.current, {
      fields: ["name", "geometry", "formatted_address"],
      types: ["establishment"],
    });
    ac.bindTo("bounds", map);
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place?.geometry?.location) return;
      const loc = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      map.fitBounds(new googleNS.maps.LatLngBounds(loc, loc));
      map.setZoom(16);

      centerMarker?.setMap(null);
      const cm = new googleNS.maps.Marker({
        map,
        position: loc,
        title: place.name || "Locație selectată",
        icon: {
          path: googleNS.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#0ea5e9",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 2,
        },
      });
      setCenterMarker(cm);
      setCenterPoint({ name: place.name || place.formatted_address || "Locație", location: loc });
      setCenterMode("store");
    });
  }, [googleNS, map, centerMarker]);

  // 3) RADIUS LOGIC
  useEffect(() => {
    if (!googleNS || !map) return;

    if (!centerPoint) {
      circle?.setMap(null);
      setCircle(null);
      if (billboards.length) setBillboards((p) => p.map((b) => ({ ...b, distanceMeters: null, inRadius: false })));
      poiMarkers.forEach((m) => m.setVisible(true));
      return;
    }

    let c = circle;
    if (!c) {
      c = new googleNS.maps.Circle({
        map,
        center: centerPoint.location,
        radius,
        strokeColor: "#0ea5e9",
        strokeOpacity: 0.9,
        strokeWeight: 1,
        fillColor: "#38bdf8",
        fillOpacity: 0.15,
      });
      setCircle(c);
    } else {
      c.setCenter(centerPoint.location);
      c.setRadius(radius);
      c.setMap(map);
    }

    setBillboards((prev) =>
      prev.map((b) => {
        const d = googleNS.maps.geometry.spherical.computeDistanceBetween(
          new googleNS.maps.LatLng(b.lat, b.lng),
          new googleNS.maps.LatLng(centerPoint.location)
        );
        const inside = d <= radius;
        if (centerMode === "store") b.marker?.setVisible(showOnlyInRadius ? inside : true);
        else b.marker?.setVisible(true);
        return { ...b, distanceMeters: d, inRadius: inside };
      })
    );

    if (centerMode === "billboard") {
      const cLatLng = new googleNS.maps.LatLng(centerPoint.location);
      poiMarkers.forEach((m) => {
        const p = m.getPosition();
        if (!p) return;
        const d = googleNS.maps.geometry.spherical.computeDistanceBetween(p, cLatLng);
        const inside = d <= radius;
        m.setVisible(showOnlyInRadius ? inside : true);
      });
    } else {
      poiMarkers.forEach((m) => m.setVisible(true));
    }
  }, [googleNS, map, centerPoint, centerMode, radius, showOnlyInRadius, poiMarkers]);

  // 4) PANOURI HELPERS
  const addBillboardMarker = (b: Omit<Billboard, "marker">, g: typeof google): Billboard => {
    // culori pentru butoane / teme
    const btnPrimaryBg  = isDark ? "#0ea5e9" : "#0284c7";
    const btnPrimaryFg  = "#ffffff";
    const btnSecondaryBg = isDark ? "#0f172a" : "#ffffff";
    const btnSecondaryFg = isDark ? "#e5e7eb" : "#0f172a";
    const btnSecondaryBd = isDark ? "#334155" : "#cbd5e1";

    // card vizual pentru InfoWindow (contrast mai bun)
    const cardBg = isDark ? "#0f172a" : "#ffffff";
    const cardText = isDark ? "#e5e7eb" : "#0f172a";
    const cardSubtle = isDark ? "#94a3b8" : "#475569";
    const cardBorder = isDark ? "#1f2937" : "#e2e8f0";
    const cardShadow = isDark ? "0 10px 25px rgba(0,0,0,0.45)" : "0 10px 25px rgba(2,6,23,0.15)";
  
    const m = new g.maps.Marker({
      position: { lat: b.lat, lng: b.lng },
      title: b.name,
      icon: {
        url:
          "data:image/svg+xml;utf8," +
          encodeURIComponent(
            `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 24 24' fill='none' stroke='red' stroke-width='1.5'>
              <path d='M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7Z' fill='white'/>
              <circle cx='12' cy='9' r='2.5' fill='red'/>
            </svg>`
          ),
        scaledSize: new g.maps.Size(36, 36),
        anchor: new g.maps.Point(18, 34),
      },
    });
    m.setMap(map!);
  
    const info = new g.maps.InfoWindow();
  
    m.addListener("click", () => {
      const dist = b.distanceMeters ?? null;
      const distLabel =
        dist == null || isNaN(dist) ? "–" : dist < 1000 ? `${dist.toFixed(0)} m` : `${(dist / 1000).toFixed(2)} km`;
  
      const imgHtml = (b.images && b.images.length)
        ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${b.images
            .slice(0,3)
            .map((u, idx) => {
              const url = String(u);
              console.log(`Image ${idx + 1} URL:`, url);
              
              // verifică dacă URL-ul este valid și nu este doar text
              if (url && url.trim() && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//') || url.startsWith('www.'))) {
                const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                return `<a href="${safe}" target="_blank" rel="noopener" title="Imagine ${idx + 1}" style="text-decoration:none;">
                          <img src="${safe}" alt="img" style="width:78px;height:60px;object-fit:cover;border-radius:6px;border:1px solid ${cardBorder};cursor:pointer;" 
                               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                          <div style="width:78px;height:60px;background:#f0f0f0;border-radius:6px;border:1px solid ${cardBorder};display:none;align-items:center;justify-content:center;font-size:10px;text-align:center;padding:4px;">Eroare încărcare</div>
                        </a>`;
              } else {
                // dacă nu este URL valid, afișează doar textul
                return `<div style="width:78px;height:60px;background:#f0f0f0;border-radius:6px;border:1px solid ${cardBorder};display:flex;align-items:center;justify-content:center;font-size:10px;text-align:center;padding:4px;color:#666;">${url || 'Fără imagine'}</div>`;
              }
            })
            .join("")}</div>`
        : "";
  
      info.setContent(`
        <div style="
          font-family:ui-sans-serif;
          padding:12px 14px;
          max-width:280px;position:relative;
          background:${cardBg};color:${cardText};
          border:1px solid ${cardBorder};border-radius:12px;
          box-shadow:${cardShadow};
        ">
          <!-- Buton închidere custom îmbunătățit -->
          <button id="bb-close-${b.id}"
            style="
              position:absolute;top:6px;right:6px;
              width:26px;height:26px;
              border:none;border-radius:8px;
              background:transparent;cursor:pointer;
              display:grid;place-items:center;
            "
            aria-label="Închide"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="${isDark ? "#e5e7eb" : "#0f172a"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
  
          <div style="font-weight:700;margin-bottom:6px;font-size:14px;">${b.name || "Panou"}</div>
          <div style="font-size:12px;color:${cardSubtle};margin-bottom:2px;">${b.locationText || b.address || ""}</div>
          <div style="font-size:12px;color:${cardSubtle};margin-bottom:2px;">Lat: ${b.lat.toFixed(6)}, Lng: ${b.lng.toFixed(6)}</div>
          <div style="font-size:12px;color:${cardSubtle};margin-bottom:10px;">
            Distanță față de centru: <b style="color:${cardText}">${distLabel}</b>
          </div>
          ${b.periodsAvailable ? `<div style="font-size:12px;color:${cardSubtle};margin-bottom:8px;">Perioade: <b style="color:${cardText}">${(b.periodsAvailable || '').toString()}</b></div>` : ''}
          ${imgHtml}
  
          <div style="display:flex;gap:8px;">
            <button id="bb-center-${b.id}"
              style="
                font-size:12px;padding:6px 10px;border-radius:8px;
                background:${btnSecondaryBg};color:${btnSecondaryFg};
                border:1px solid ${btnSecondaryBd};cursor:pointer;
              ">
              Centrează pe hartă
            </button>
            <button id="bb-setcenter-${b.id}"
              style="
                font-size:12px;padding:6px 10px;border-radius:8px;
                background:${btnPrimaryBg};color:${btnPrimaryFg};
                border:1px solid ${btnPrimaryBg};cursor:pointer;
              ">
              ${centerPoint && centerMode === "billboard" && Math.abs(centerPoint.location.lat - b.lat) < 0.0001 && Math.abs(centerPoint.location.lng - b.lng) < 0.0001 ? "Ascunde radius" : "Setează ca centru"}
            </button>
          </div>
        </div>
      `);
  
      info.open({ map: map!, anchor: m });
  
      // atașăm acțiunile butoanelor după randarea InfoWindow-ului
      googleNS!.maps.event.addListenerOnce(info, "domready", () => {
        // ascunde butonul implicit de închidere al InfoWindow-ului Google
        document.querySelectorAll('.gm-ui-hover-effect').forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });

        document.getElementById(`bb-close-${b.id}`)?.addEventListener("click", () => {
          info.close();
        });
  
        document.getElementById(`bb-center-${b.id}`)?.addEventListener("click", () => {
          map!.panTo({ lat: b.lat, lng: b.lng });
          map!.setZoom(16);
        });
  
        document.getElementById(`bb-setcenter-${b.id}`)?.addEventListener("click", () => {
          if (!googleNS || !map) return;
          
          console.log("Button clicked for billboard:", b.name);
          console.log("Current centerPoint (ref):", centerPointRef.current);
          console.log("Current centerMode (ref):", centerModeRef.current);
          console.log("Billboard coords:", b.lat, b.lng);
          
          // Verifică dacă acest panou este deja centrul folosind refs
          const currentCenterPoint = centerPointRef.current;
          const currentCenterMode = centerModeRef.current;
          const isCurrentCenter = currentCenterPoint && 
            currentCenterMode === "billboard" && 
            Math.abs(currentCenterPoint.location.lat - b.lat) < 0.0001 && 
            Math.abs(currentCenterPoint.location.lng - b.lng) < 0.0001;
          
          console.log("Is current center:", isCurrentCenter);
          
          if (isCurrentCenter) {
            console.log("Resetting center and hiding radius");
            // Dacă este centrul curent, resetează centrul și ascunde radiusul folosind refs
            circleRef.current?.setMap(null);
            setCircle(null);
            centerMarkerRef.current?.setMap(null);
            setCenterMarker(null);
            setCenterPoint(null);
            setCenterMode("store");
            
            console.log("Reset completed");
            
            // Actualizează textul butonului
            const button = document.getElementById(`bb-setcenter-${b.id}`);
            if (button) {
              button.textContent = "Setează ca centru";
              button.style.background = btnPrimaryBg;
              button.style.color = btnPrimaryFg;
              button.style.borderColor = btnPrimaryBg;
              console.log("Button text updated to: Setează ca centru");
            }
          } else {
            console.log("Setting as center");
            // Dacă nu este centrul, setează-l ca centru
            const loc = { lat: b.lat, lng: b.lng };
            centerMarkerRef.current?.setMap(null);
            const cm = new googleNS.maps.Marker({
              position: loc,
              map,
              title: b.name,
              icon: {
                path: googleNS.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#0ea5e9",
                fillOpacity: 1,
                strokeColor: "white",
                strokeWeight: 2,
              },
            });
            setCenterMarker(cm);
            setCenterPoint({ name: b.name, location: loc });
            setCenterMode("billboard");
            map.panTo(loc);
            map.setZoom(15);
            
            console.log("Center set completed");
            
            // Actualizează textul butonului
            const button = document.getElementById(`bb-setcenter-${b.id}`);
            if (button) {
              button.textContent = "Ascunde radius";
              button.style.background = "#ef4444";
              button.style.color = "#ffffff";
              button.style.borderColor = "#ef4444";
              console.log("Button text updated to: Ascunde radius");
            }
          }
        });
      });
    });
  
    return { ...b, marker: m } as Billboard;
  };

  // Funcție pentru extragerea hyperlink-urilor din Excel
  const extractHyperlinksFromExcel = (ws: any, headerRow: number, dataRows: any[]) => {
    const hyperlinkColumns = ['Imagini 1', 'Imagini 2', 'Imagini 3', 'Schita', 'StreetView'];
    const hyperlinkData: Record<string, string[]> = {};
    
    // Inițializează obiectul pentru fiecare coloană
    hyperlinkColumns.forEach(col => {
      hyperlinkData[col] = [];
    });
    
    dataRows.forEach((row, rowIndex) => {
      hyperlinkColumns.forEach(colName => {
        // Găsește indexul coloanei în header
        const colIndex = Object.keys(row).findIndex(key => {
          const normKey = String(key || "").toLowerCase().replace(/\s+/g, "").replace(/[ăâ]/g, "a").replace(/ș/g, "s").replace(/ț/g, "t").replace(/î/g, "i");
          const normColName = String(colName || "").toLowerCase().replace(/\s+/g, "").replace(/[ăâ]/g, "a").replace(/ș/g, "s").replace(/ț/g, "t").replace(/î/g, "i");
          return normKey.includes(normColName);
        });
        
        if (colIndex !== -1) {
          const cellRef = XLSX.utils.encode_cell({ r: headerRow + rowIndex + 1, c: colIndex });
          const cell = ws[cellRef];
          let hyperlinkUrl = '';
          
          if (cell) {
            // Încercă diferite moduri de a accesa hyperlink-ul
            if (cell.l && cell.l.Target) {
              hyperlinkUrl = cell.l.Target;
            } else if (cell.h && cell.h.link) {
              hyperlinkUrl = cell.h.link;
            } else if (cell.f && cell.f.includes('HYPERLINK')) {
              const match = cell.f.match(/HYPERLINK\("([^"]+)"/);
              if (match) {
                hyperlinkUrl = match[1];
              }
            } else if (cell.v && typeof cell.v === 'string' && cell.v.includes('http')) {
              hyperlinkUrl = cell.v;
            }
          }
          
          hyperlinkData[colName].push(hyperlinkUrl || '');
        } else {
          hyperlinkData[colName].push('');
        }
      });
    });
    
    return hyperlinkData;
  };

  const onFileUpload = async (file: File) => {
    if (!googleNS || !map) return;
    setStatus("Se procesează fișierul...");

    const rows: any[] = [];
    const normalizeKey = (k: any) =>
      String(k || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/\s/g, "")
        .replace(/[ăâ]/g, "a")
        .replace(/ș/g, "s")
        .replace(/ț/g, "t")
        .replace(/î/g, "i");
    const pick = (obj: any, keys: string[]) => {
      const dict: Record<string, any> = {};
      Object.keys(obj || {}).forEach((k) => (dict[normalizeKey(k)] = obj[k]));
      for (const key of keys) {
        const n = normalizeKey(key);
        if (n in dict && dict[n] != null && String(dict[n]).trim() !== "") return dict[n];
      }
      return undefined;
    };
    const toNumber = (v: any): number => {
      if (v == null) return NaN;
      if (typeof v === "number") return v;
      const s = String(v).trim().replace(/\s/g, "").replace(/,/g, ".");
      const m = s.match(/-?[0-9]+(?:\.[0-9]+)?/);
      return m ? parseFloat(m[0]) : NaN;
    };
    const pushRow = (r: any, hyperlinkData?: Record<string, string[]>, rowIndex?: number) => {
      const name = pick(r, ["name", "nume", "title", "denumire", "Spatiu ID"]) || "Panou";
      const latRaw = pick(r, ["lat", "latitude", "latitudine", "Latitudine"]); 
      const lngRaw = pick(r, ["lng", "lon", "long", "longitude", "longitudine", "Longitudine"]);
      const address = pick(r, ["address", "adresa", "location", "locatie", "Locatie"]);
      const locationText = pick(r, ["Locatie", "location_text"]); 
      const sheetSpaceId = pick(r, ["Spatiu ID"]);
      const periodsAvailable = pick(r, ["Perioade Disponibile", "PerioadeDisponibile", "perioade"]);
      
      // Folosește hyperlink-urile extrase dacă sunt disponibile
      let images: string[] = [];
      if (hyperlinkData && typeof rowIndex === 'number') {
        const img1 = hyperlinkData['Imagini 1'][rowIndex] || '';
        const img2 = hyperlinkData['Imagini 2'][rowIndex] || '';
        const img3 = hyperlinkData['Imagini 3'][rowIndex] || '';
        images = [img1, img2, img3].filter((u) => typeof u === "string" && u.trim());
        console.log(`Rând ${rowIndex}: Imagini extrase:`, { img1, img2, img3, images });
      } else {
        // Fallback la metoda veche
        const img1 = pick(r, ["Imagini 1_url", "Imagini 1", "img1", "Imagine1", "Poza1"]);
        const img2 = pick(r, ["Imagini 2_url", "Imagini 2", "img2", "Imagine2", "Poza2"]);
        const img3 = pick(r, ["Imagini 3_url", "Imagini 3", "img3", "Imagine3", "Poza3"]);
        images = [img1, img2, img3].filter((u) => typeof u === "string" && u.trim());
      }
      
      rows.push({ name, latRaw, lngRaw, address, locationText, sheetSpaceId, images, periodsAvailable });
    };

    if (file.name.endsWith(".csv")) {
      await new Promise<void>((resolve, reject) =>
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res: any) => {
            (res.data as any[]).forEach((row) => pushRow(row));
            resolve();
          },
          error: reject,
        })
      );
    } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      
      // Detectează rândul de antet (căutăm "Latitudine"/"Longitudine" sau "Locatie")
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
      let headerRow = 0;
      const headerMatchers = ["latitudine", "longitudine", "locatie", "lat", "lng", "longitude", "latitude"];
      for (let i = 0; i < Math.min(20, aoa.length); i++) {
        const row = aoa[i] || [];
        const norm = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[ăâ]/g, "a").replace(/ș/g, "s").replace(/ț/g, "t").replace(/î/g, "i");
        const has = row.some((c: any) => headerMatchers.includes(norm(c)));
        if (has) {
          headerRow = i;
          break;
        }
      }
      
      const range = XLSX.utils.decode_range(ws['!ref'] as string);
      range.s.r = headerRow; // start from detected header row
      ws['!ref'] = XLSX.utils.encode_range(range);
      
      // Citim datele cu header-ul detectat
      const data = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as any[];
      
      // Salvăm datele originale pentru export
      const originalData = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false, header: 1 }) as any[][];
      setOriginalExcelData(originalData);
      
      // Extragem hyperlink-urile din coloanele specifice
      const hyperlinkData = extractHyperlinksFromExcel(ws, headerRow, data);
      
      // Log pentru debugging
      console.log("Hyperlink-uri extrase:", hyperlinkData);
      
      // Procesăm fiecare rând cu hyperlink-urile extrase
      data.forEach((row, idx) => {
        pushRow(row, hyperlinkData, idx);
      });
    } else {
      setStatus("Format fișier neacceptat. Folosește .csv, .xlsx sau .xls.");
      return;
    }

    const geocoder = new googleNS.maps.Geocoder();
    const out: Billboard[] = [];
    const geocodeOne = (address: string): Promise<google.maps.GeocoderResult | null> =>
      new Promise((resolve) => {
        geocoder.geocode({ address }, (results, status) => {
          if (status === "OK" && results && results[0]) resolve(results[0]);
          else resolve(null);
        });
      });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let lat = toNumber(r.latRaw);
      let lng = toNumber(r.lngRaw);

      if ((!isFinite(lat) || !isFinite(lng)) && r.address) {
        setStatus(`Geocodare: ${r.address} (${i + 1}/${rows.length})...`);
        const gRes = await geocodeOne(r.address);
        if (gRes?.geometry?.location) {
          lat = gRes.geometry.location.lat();
          lng = gRes.geometry.location.lng();
        }
      }

      if (isFinite(lat) && isFinite(lng)) {
        const id = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
        const base: Billboard = {
          id,
          name: r.name || r.address || `Panou ${i + 1}`,
          lat,
          lng,
          address: r.address,
          locationText: r.locationText,
          sheetSpaceId: r.sheetSpaceId,
          images: r.images,
          periodsAvailable: r.periodsAvailable,
          distanceMeters: null,
          inRadius: false,
        };
        out.push(addBillboardMarker(base, googleNS));
      }
    }

    if (out.length) {
      const bounds = new googleNS.maps.LatLngBounds();
      out.forEach((b) => bounds.extend({ lat: b.lat, lng: b.lng }));
      if (centerPoint) bounds.extend(centerPoint.location);
      map.fitBounds(bounds);
    } else {
      setStatus("Nu s-au găsit rânduri cu Latitudine/Longitudine sau adresă validă în foaia încărcată.");
    }

    setBillboards((prev) => [...prev, ...out]);
    setStatus("");
  };

  const clearBillboards = () => {
    billboards.forEach((b) => b.marker?.setMap(null));
    setBillboards([]);
    setOriginalExcelData([]);
    // curăță cercurile individuale
    Object.values(billboardCircles).forEach((c) => c.setMap(null));
    setBillboardCircles({});
    // curăță orice cerc înregistrat global
    allBillboardCirclesRef.current.forEach((c) => c.setMap(null));
    allBillboardCirclesRef.current = [];
  };

  // CSV helpers
  const exportRowsToXLSX = (rows: any[][], filename: string) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "data");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export cu hyperlink-uri păstrate
  const exportRowsToXLSXWithHyperlinks = (rows: any[][], filename: string) => {
    // Folosim datele originale cu hyperlink-urile păstrate
    const ws = XLSX.utils.aoa_to_sheet(originalExcelData);
    
    // Log pentru debugging
    console.log("Datele originale pentru export:", originalExcelData);
    
    // Găsim coloanele cu hyperlink-uri în datele originale
    const hyperlinkColumns = ['Imagini 1', 'Imagini 2', 'Imagini 3', 'Schita', 'StreetView'];
    const normalizeKey = (k: any) =>
      String(k || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/\s/g, "")
        .replace(/[ăâ]/g, "a")
        .replace(/ș/g, "s")
        .replace(/ț/g, "t")
        .replace(/î/g, "i");
    
    // Găsim indexurile coloanelor cu hyperlink-uri în datele originale
    const hyperlinkIndices: Record<string, number> = {};
    if (originalExcelData.length > 0) {
      originalExcelData[0].forEach((header, index) => {
        const normHeader = normalizeKey(header);
        hyperlinkColumns.forEach(colName => {
          const normColName = normalizeKey(colName);
          if (normHeader.includes(normColName)) {
            hyperlinkIndices[colName] = index;
          }
        });
      });
    }
    
    console.log("Coloane cu hyperlink-uri găsite:", hyperlinkIndices);
    
    // Adăugăm hyperlink-urile pentru fiecare celulă relevantă
    Object.entries(hyperlinkIndices).forEach(([, colIndex]) => {
      for (let rowIndex = 1; rowIndex < originalExcelData.length; rowIndex++) { // skip header
        const cellValue = originalExcelData[rowIndex][colIndex];
        if (cellValue && typeof cellValue === 'string' && cellValue.trim()) {
          const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
          
          // Căutăm URL-ul corespunzător în datele originale
          const originalRow = originalExcelData[rowIndex];
          if (originalRow && originalRow[colIndex]) {
            const originalCell = originalRow[colIndex];
            let hyperlinkUrl = '';
            
            // Încercăm să găsim URL-ul din datele originale
            if (typeof originalCell === 'string' && originalCell.includes('http')) {
              hyperlinkUrl = originalCell;
            } else if (originalCell && typeof originalCell === 'object') {
              // Dacă este un obiect cu hyperlink
              if (originalCell.l && originalCell.l.Target) {
                hyperlinkUrl = originalCell.l.Target;
              } else if (originalCell.h && originalCell.h.link) {
                hyperlinkUrl = originalCell.h.link;
              }
            }
            
            // Dacă am găsit un URL, adăugăm hyperlink-ul folosind funcția HYPERLINK
            if (hyperlinkUrl) {
              console.log(`Adăugat hyperlink pentru ${cellRef}: ${hyperlinkUrl}`);
              ws[cellRef] = {
                f: `HYPERLINK("${hyperlinkUrl}","${cellValue}")`,
                v: cellValue
              };
            }
          }
        }
      }
    });
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "data");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const downloadTemplate = () => {
    const rows = [
      ["name", "lat", "lng", "address"],
      ["Panou exemplu (coordonate)", "46.770439", "23.591423", ""],
      ["Panou exemplu (adresa)", "", "", "Bd. Eroilor 10, Cluj-Napoca"],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template_panouri.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };





  // Export panouri din radiusul locației căutate
  const downloadBillboardsInLocationRadius = () => {
    if (!centerPoint || centerMode !== "store") {
      alert("Nu există o locație căutată cu radius pentru a exporta!");
      return;
    }

    const inRadius = billboards.filter((b) => b.inRadius);
    if (!inRadius.length) {
      alert("Nu există panouri în radiusul locației pentru a exporta!");
      return;
    }

    // Creează header-ul pentru Excel
    const header = ["Denumire", "Adresa", "Latitudine", "Longitudine", "Distanța (m)", "În radius"];
    
    // Creează rândurile cu datele panourilor
    const rows: any[][] = [header];
    
    inRadius.forEach((billboard) => {
      const distance = billboard.distanceMeters ? Math.round(billboard.distanceMeters) : 0;
      rows.push([
        billboard.name || "Panou",
        billboard.locationText || billboard.address || "N/A",
        billboard.lat,
        billboard.lng,
        distance,
        "Da"
      ]);
    });

    // Export ca Excel
    exportRowsToXLSX(rows, `panouri_in_radius_${centerPoint.name.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
  };

  // Export grupat în formatul vechi: BILLBOARD + POI-uri separate
  const downloadPOIsForSelectedBillboardsGrouped = () => {
    if (!googleNS || !poiMarkers.length) return;
    const selected = Object.keys(billboardCircles);
    if (!selected.length) {
      alert("Nu există panouri cu cercuri active pentru a exporta!");
      return;
    }

    const rows: any[][] = [];
    selected.forEach((id, idx) => {
      const b = billboards.find((x) => x.id === id);
      if (!b) return;
      const center = new googleNS.maps.LatLng(b.lat, b.lng);
      
      // header de grup
      rows.push(["BILLBOARD", b.name, b.lat, b.lng]);
      rows.push(["name", "address", "lat", "lng", "distance_m"]);

      poiMarkers.forEach((m) => {
        const p = m.getPosition();
        if (!p) return;
        const d = googleNS.maps.geometry.spherical.computeDistanceBetween(p, center);
        if (d <= radius) {
          rows.push([m.getTitle() || "Loc", (m as any).addr || "", p.lat(), p.lng(), Math.round(d)]);
        }
      });
      if (idx !== selected.length - 1) rows.push([""]); // separă grupurile cu o linie goală
    });
    exportRowsToXLSX(rows, "poi_per_billboard_grouped.xlsx");
  };
  const filterBillboardsByAvailability = () => {
    if (!startDate || !endDate) {
      setFilteredBillboards([]);
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const filtered = billboards.filter((billboard) => {
      if (!billboard.periodsAvailable) return false;
      
      // Parsează perioadele disponibile (format: "Disponibil: 01/10/25 : 15/10/25")
      const periods = billboard.periodsAvailable.split(';').map(p => p.trim());
      
      return periods.some(period => {
        const match = period.match(/Disponibil:\s*(\d{2}\/\d{2}\/\d{2})\s*:\s*(\d{2}\/\d{2}\/\d{2})/);
        if (!match) return false;
        
        const periodStart = new Date(`20${match[1].split('/')[2]}-${match[1].split('/')[1]}-${match[1].split('/')[0]}`);
        const periodEnd = new Date(`20${match[2].split('/')[2]}-${match[2].split('/')[1]}-${match[2].split('/')[0]}`);
        
        // Verifică dacă perioada se suprapune cu intervalul căutat
        return (periodStart <= end && periodEnd >= start);
      });
    });
    
    setFilteredBillboards(filtered);
  };

  useEffect(() => {
    filterBillboardsByAvailability();
  }, [startDate, endDate, billboards]);

  // Afișează doar panourile filtrate pe hartă
  const showFilteredOnMap = () => {
    if (filteredBillboards.length === 0) {
      alert("Nu există panouri filtrate pentru a afișa pe hartă!");
      return;
    }
    setShowOnlyFilteredOnMap(true);
    
    // Ascunde toate panourile
    billboards.forEach((b) => b.marker?.setVisible(false));
    
    // Afișează doar panourile filtrate
    filteredBillboards.forEach((b) => b.marker?.setVisible(true));
  };

  // Resetează afișarea tuturor panourilor
  const resetMapDisplay = () => {
    setShowOnlyFilteredOnMap(false);
    
    // Afișează toate panourile
    billboards.forEach((b) => {
      if (centerMode === "store" && showOnlyInRadius) {
        b.marker?.setVisible(b.inRadius || false);
      } else {
        b.marker?.setVisible(true);
      }
    });
  };

  const totalInRadius = useMemo(() => billboards.filter((b) => b.inRadius).length, [billboards]);
  const nearest = useMemo(() => {
    const haveDist = billboards.filter((b) => typeof b.distanceMeters === "number");
    if (!haveDist.length) return null;
    return haveDist.reduce((min, b) => (b.distanceMeters! < min.distanceMeters! ? b : min));
  }, [billboards]);

  const clearPOIs = () => {
    poiMarkers.forEach((m) => m.setMap(null));
    setPoiMarkers([]);
    poiInfoRef.current?.close();
  };

  // Toggle radius pentru un panou, fără a-l seta ca centru
  const toggleBillboardRadius = (b: Billboard) => {
    if (!googleNS || !map) return;
    setBillboardCircles((prev) => {
      const copy = { ...prev };
      const existing = copy[b.id];
      if (existing) {
        existing.setMap(null);
        delete copy[b.id];
        allBillboardCirclesRef.current = allBillboardCirclesRef.current.filter((x) => x !== existing);
      } else {
        const c = new googleNS.maps.Circle({
          map,
          center: { lat: b.lat, lng: b.lng },
          radius,
          strokeColor: "#22d3ee",
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillColor: "#22d3ee",
          fillOpacity: 0.12,
        });
        copy[b.id] = c;
        allBillboardCirclesRef.current.push(c);
      }
      return copy;
    });
  };

  // Arată radius pentru toate panourile
  const showRadiusForAll = () => {
    if (!googleNS || !map) return;
    setBillboardCircles((prev) => {
      const next: Record<string, google.maps.Circle> = { ...prev };
      billboards.forEach((b) => {
        if (!next[b.id]) {
          const c = new googleNS.maps.Circle({
            map,
            center: { lat: b.lat, lng: b.lng },
            radius,
            strokeColor: "#22d3ee",
            strokeOpacity: 0.9,
            strokeWeight: 1,
            fillColor: "#22d3ee",
            fillOpacity: 0.12,
          });
          next[b.id] = c;
          allBillboardCirclesRef.current.push(c);
        }
      });
      return next;
    });
  };

  // Ascunde toate radius-urile active
  const hideRadiusForAll = () => {
    // ascunde cercurile de pe hartă atât din state cât și din registrul global
    Object.values(billboardCircles).forEach((c) => c.setMap(null));
    allBillboardCirclesRef.current.forEach((c) => c.setMap(null));
    allBillboardCirclesRef.current = [];
    setBillboardCircles({});
  };

  // Când se schimbă `radius`, actualizează toate cercurile vizibile per-panou
  useEffect(() => {
    Object.values(billboardCircles).forEach((c) => c.setRadius(radius));
    allBillboardCirclesRef.current.forEach((c) => c.setRadius(radius));
  }, [radius, billboardCircles]);

  const resetKey = () => {
    localStorage.removeItem("gmaps_api_key");
    setApiKey("");
    setGoogleNS(null);
    setMap(null);
    setCircle(null);
    centerMarker?.setMap(null);
    setCenterMarker(null);
    clearBillboards();
    clearPOIs();
    setCenterPoint(null);
  };

  // Șterge locația setată prin căutarea specifică (centru = magazin)
  const clearSelectedLocation = () => {
    circle?.setMap(null);
    setCircle(null);
    centerMarker?.setMap(null);
    setCenterMarker(null);
    setCenterPoint(null);
    setCenterMode("store");
  };

  // 5) POI SEARCH
  const addPOIMarker = (place: google.maps.places.PlaceResult, g: typeof google) => {
    if (!place.geometry?.location) return;
      const addr = (place.formatted_address || place.vicinity || "") as string;
    // marker colorat în funcție de selecția curentă
    const iconUrl =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 24 24' fill='none' stroke='${poiColor}' stroke-width='1.5'>
          <path d='M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7Z' fill='white'/>
          <circle cx='12' cy='9' r='2.5' fill='${poiColor}'/>
        </svg>`
      );
    const m = new g.maps.Marker({
      map: map!,
      position: place.geometry.location,
      title: place.name || "",
      icon: { url: iconUrl, scaledSize: new g.maps.Size(30, 30), anchor: new g.maps.Point(15, 28) },
    });
    (m as any).addr = addr;
    if (!poiInfoRef.current) poiInfoRef.current = new g.maps.InfoWindow();

    // stiluri similare cu cele de la panouri
    const btnPrimaryBg  = isDark ? "#0ea5e9" : "#0284c7";
    const btnPrimaryFg  = "#ffffff";
    const btnSecondaryBg = isDark ? "#0f172a" : "#ffffff";
    const btnSecondaryFg = isDark ? "#e5e7eb" : "#0f172a";
    const btnSecondaryBd = isDark ? "#334155" : "#cbd5e1";
    const cardBg = isDark ? "#0f172a" : "#ffffff";
    const cardText = isDark ? "#e5e7eb" : "#0f172a";
    const cardSubtle = isDark ? "#94a3b8" : "#475569";
    const cardBorder = isDark ? "#1f2937" : "#e2e8f0";
    const cardShadow = isDark ? "0 10px 25px rgba(0,0,0,0.45)" : "0 10px 25px rgba(2,6,23,0.15)";

    m.addListener("click", () => {
      poiInfoRef.current!.setContent(`
        <div style="
          font-family:ui-sans-serif;
          padding:12px 14px;max-width:280px;position:relative;
          background:${cardBg};color:${cardText};
          border:1px solid ${cardBorder};border-radius:12px;box-shadow:${cardShadow};
        ">
          <button id="poi-close"
            style="position:absolute;top:6px;right:6px;width:26px;height:26px;border:none;border-radius:8px;background:transparent;cursor:pointer;display:grid;place-items:center;"
            aria-label="Închide">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isDark ? "#e5e7eb" : "#0f172a"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div style="font-weight:700;margin-bottom:6px;font-size:14px;">${place.name || "Loc"}</div>
          <div style="font-size:12px;color:${cardSubtle};margin-bottom:10px;">${addr}</div>
          <div style="display:flex;gap:8px;">
            <button id="poi-center"
              style="font-size:12px;padding:6px 10px;border-radius:8px;background:${btnSecondaryBg};color:${btnSecondaryFg};border:1px solid ${btnSecondaryBd};cursor:pointer;">
              Centrează pe hartă
            </button>
            <button id="poi-setcenter"
              style="font-size:12px;padding:6px 10px;border-radius:8px;background:${btnPrimaryBg};color:${btnPrimaryFg};border:1px solid ${btnPrimaryBg};cursor:pointer;">
              Setează ca centru
            </button>
          </div>
        </div>
      `);
      poiInfoRef.current!.open({ map: map!, anchor: m });

      g.maps.event.addListenerOnce(poiInfoRef.current!, "domready", () => {
        document.querySelectorAll('.gm-ui-hover-effect').forEach((el) => ((el as HTMLElement).style.display = 'none'));
        document.getElementById("poi-close")?.addEventListener("click", () => poiInfoRef.current!.close());
        document.getElementById("poi-center")?.addEventListener("click", () => {
          const p = m.getPosition();
          if (!p) return;
          map!.panTo(p);
          map!.setZoom(16);
        });
        document.getElementById("poi-setcenter")?.addEventListener("click", () => {
          const p = m.getPosition();
          if (!g || !map || !p) return;
          centerMarker?.setMap(null);
          const cm = new g.maps.Marker({
            position: p, map, title: place.name || "Loc", icon: { path: g.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#0ea5e9", fillOpacity: 1, strokeColor: "white", strokeWeight: 2 }
          });
          setCenterMarker(cm);
          setCenterPoint({ name: place.name || addr || "Loc", location: { lat: p.lat(), lng: p.lng() } });
          setCenterMode("store");
          map.panTo(p);
          map.setZoom(15);
        });
      });
    });
    setPoiMarkers((prev) => [...prev, m]);
  };

  const searchPOIsInBounds = () => {
    if (!googleNS || !map) return;
    const q = poiQuery.trim();
    if (!q) return;
    if (!poiKeepExisting) clearPOIs();
    setIsSearchingPOI(true);
    const svc = new googleNS.maps.places.PlacesService(map);
    const req: google.maps.places.TextSearchRequest = { query: q, bounds: map.getBounds() ?? undefined };
    const consume = (
      results: google.maps.places.PlaceResult[] | null,
      status: google.maps.places.PlacesServiceStatus,
      pagination: google.maps.places.PlaceSearchPagination | null
    ) => {
      if (status === googleNS.maps.places.PlacesServiceStatus.OK && results) {
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        const matches = (r: google.maps.places.PlaceResult) => {
          const name = (r.name || "").toLowerCase();
          return tokens.every((t) => name.includes(t));
        };
        results.filter(matches).forEach((r) => addPOIMarker(r, googleNS));
        if (pagination && pagination.hasNextPage) {
          setTimeout(() => pagination.nextPage(), 300);
          return;
        }
      }
      setIsSearchingPOI(false);
    };
    svc.textSearch(req, consume);
  };

  useEffect(() => {
    if (!googleNS || !map) return;
    let t: number | undefined;
    const handler = () => {
      if (!autoSearchOnMove || !poiQuery.trim()) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => searchPOIsInBounds(), 400);
    };
    const l = map.addListener("idle", handler);
    return () => {
      l.remove();
      if (t) window.clearTimeout(t);
    };
  }, [googleNS, map, autoSearchOnMove, poiQuery]);

  // -------- UI --------
const bg = isDark ? "bg-slate-950" : "bg-slate-50";
const text = isDark ? "text-slate-100" : "text-slate-900";
const panelBg = isDark ? "bg-slate-900/90" : "bg-white/90";
const panelBorder = isDark ? "border-slate-800" : "border-slate-200";
const subtle = isDark ? "text-slate-400" : "text-slate-500";
const inputBorder = isDark ? "border-slate-700" : "border-slate-300";
const hoverBg = isDark ? "hover:bg-slate-800/70" : "hover:bg-slate-50";

return (
  <div
    style={{
      width: "100vw",
      height: "100vh",
      background: isDark ? "#0b1220" : "#f8fafc",
      color: isDark ? "#e5e7eb" : "#0f172a",
      overflow: "hidden",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
    }}
  >
    {/* container orizontal */}
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* --- Sidebar stânga (fix) --- */}
      <aside
        style={{
          width: 400,
          maxWidth: 400,
          height: "100%",
          borderRight: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
          background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header + toggle temă */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Harta panouri publicitare</div>
            <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b" }}>
              Caută, încarcă panouri și lucrează cu radius.
            </div>
          </div>
          <button
            onClick={() => setIsDark((v) => !v)}
            style={{
              fontSize: 12,
              border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
              padding: "6px 10px",
              borderRadius: 10,
              background: "transparent",
              cursor: "pointer",
              color: "inherit",
            }}
            title="Comută tema"
          >
            {isDark ? "🌙 Dark" : "☀️ Light"}
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
            background: isDark ? "#0f172a" : "#f8fafc",
          }}
        >
          {[
            { id: "proximitati", label: "Proximități", icon: "🔍" },
            { id: "panouri", label: "Panouri", icon: "📍" },
            { id: "disponibilitati", label: "Disponibilități", icon: "📅" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                flex: 1,
                padding: "12px 8px",
                border: "none",
                background: activeTab === tab.id ? (isDark ? "#1e293b" : "#ffffff") : "transparent",
                color: activeTab === tab.id ? (isDark ? "#e5e7eb" : "#0f172a") : (isDark ? "#94a3b8" : "#64748b"),
                cursor: "pointer",
                fontSize: 14,
                fontWeight: activeTab === tab.id ? 600 : 400,
                borderBottom: activeTab === tab.id ? `2px solid ${isDark ? "#0ea5e9" : "#0284c7"}` : "2px solid transparent",
                transition: "all 0.2s ease",
              }}
            >
              <span style={{ marginRight: 6 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Conținut scrollabil */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!apiKey ? (
            // --- Panou cheie API ---
            <div
              style={{
                border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Cheie Google Maps API
              </label>
              <input
                type="password"
                placeholder="Introdu cheia ta..."
                style={{
                  width: "100%",
                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  background: "transparent",
                  color: "inherit",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 14,
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      localStorage.setItem("gmaps_api_key", val);
                      setApiKey(val);
                    }
                  }
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  style={{
                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    borderRadius: 10,
                    background: "transparent",
                    padding: "8px 12px",
                    fontSize: 14,
                    cursor: "pointer",
                    color: "inherit",
                  }}
                  onClick={() => {
                    const input = document.querySelector("input[type='password']") as HTMLInputElement;
                    const val = input?.value.trim();
                    if (val) {
                      localStorage.setItem("gmaps_api_key", val);
                      setApiKey(val);
                    }
                  }}
                >
                  Salvează cheia și pornește harta
                </button>
                <button
                  style={{
                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    borderRadius: 10,
                    background: "transparent",
                    padding: "8px 12px",
                    fontSize: 14,
                    cursor: "pointer",
                    color: "inherit",
                  }}
                  onClick={resetKey}
                >
                  Șterge cheia
                </button>
              </div>
              <p style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", marginTop: 8 }}>
                Activează în Google Cloud: <b>Maps JavaScript API</b>, <b>Places API</b> și <b>Geocoding API</b>.
              </p>
            </div>
          ) : (
            <>
              {/* TABUL PROXIMITATI */}
              {activeTab === "proximitati" && (
            <>
              {/* --- Autocomplete un loc --- */}
              <div
                style={{
                  border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Caută o locație specifică
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="ex: Carrefour, Mega Image, Iulius Mall..."
                  style={{
                      flex: 1,
                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    background: "transparent",
                    color: "inherit",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 14,
                  }}
                />
                  {centerPoint && centerMode === "store" && (
                    <button
                      onClick={clearSelectedLocation}
                      title="Șterge locația selectată"
                      style={{
                        border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                        borderRadius: 10,
                        background: "transparent",
                        padding: "8px 12px",
                        fontSize: 14,
                        cursor: "pointer",
                        color: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Șterge locația
                    </button>
                  )}
                </div>
              </div>

              {/* --- Căutare multiplu POI --- */}
              <div
                style={{
                  border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Caută pe hartă (multiplu, ca pe Maps)
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    value={poiQuery}
                    onChange={(e) => setPoiQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchPOIsInBounds()}
                    placeholder="ex: Profi, farmacie, benzinărie..."
                    style={{
                      flex: 1,
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      background: "transparent",
                      color: "inherit",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 14,
                    }}
                  />
                  <input
                    type="color"
                    value={poiColor}
                    onChange={(e) => setPoiColor(e.target.value)}
                    title="Culoare pin"
                    style={{ width: 40, height: 34, border: "none", background: "transparent", cursor: "pointer" }}
                  />
                  <button
                    onClick={searchPOIsInBounds}
                    disabled={isSearchingPOI}
                    style={{
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      borderRadius: 10,
                      background: "transparent",
                      padding: "8px 12px",
                      fontSize: 14,
                      cursor: "pointer",
                      color: "inherit",
                      opacity: isSearchingPOI ? 0.6 : 1,
                    }}
                  >
                    {isSearchingPOI ? "Caut..." : "Caută în zona hărții"}
                  </button>
                </div>

                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={autoSearchOnMove}
                    onChange={(e) => setAutoSearchOnMove(e.target.checked)}
                  />
                  Re-caută automat când miști harta
                </label>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 14, marginLeft: 0 }}>
                  <input
                    type="checkbox"
                    checked={poiKeepExisting}
                    onChange={(e) => setPoiKeepExisting(e.target.checked)}
                  />
                  Păstrează rezultatele existente (adaugă peste)
                </label>

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => clearPOIs()}
                    disabled={!poiMarkers.length}
                    style={{
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      borderRadius: 10,
                      background: "transparent",
                      padding: "8px 12px",
                      fontSize: 14,
                      cursor: poiMarkers.length ? "pointer" : "not-allowed",
                      color: "inherit",
                      opacity: poiMarkers.length ? 1 : 0.6,
                    }}
                  >
                    Curăță rezultate ({poiMarkers.length})
                  </button>
                </div>
              </div>

              {/* --- Radius --- */}
              <div
                style={{
                  border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Radius (metri)
                </label>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <input
                    type="range"
                    min={50}
                    max={10000}
                    step={50}
                    value={radius}
                    onChange={(e) => setRadius(parseInt(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={0}
                    value={radius}
                    onChange={(e) => setRadius(Math.max(0, parseInt(e.target.value || "0")))}
                    style={{
                      width: 110,
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      background: "transparent",
                      color: "inherit",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 14,
                    }}
                  />
                </div>
              </div>


              {/* --- Statistici + acțiuni --- */}
              <div
                style={{
                  border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 14 }}>
                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Total panouri: </span>
                    <b>{billboards.length}</b>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>În radius (panouri): </span>
                    <b>{totalInRadius}</b>
                    {centerPoint && (
                      <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                        {" "}
                        / centru: <b>{centerPoint.name}</b>
                      </span>
                    )}
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}> — centru bazat pe: </span>
                    <b>{centerMode === "store" ? "magazin" : "panou"}</b>
                  </div>
                  {nearest && typeof nearest.distanceMeters === "number" && centerMode === "store" && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Cel mai aproape (față de magazin): </span>
                      <b>
                        {nearest.name} –{" "}
                        {nearest.distanceMeters < 1000
                          ? `${nearest.distanceMeters.toFixed(0)} m`
                          : `${(nearest.distanceMeters / 1000).toFixed(2)} km`}
                      </b>
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={showRadiusForAll}
                      disabled={!billboards.length}
                      style={{
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 14,
                        cursor: !billboards.length ? "not-allowed" : "pointer",
                        color: "#fff",
                        background: "#0ea5e9",
                        opacity: !billboards.length ? 0.5 : 1,
                        border: "none",
                      }}
                    >
                      Arată radius la toate panourile
                    </button>
                    <button
                      onClick={hideRadiusForAll}
                      disabled={!Object.keys(billboardCircles).length}
                      style={{
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 14,
                        cursor: !Object.keys(billboardCircles).length ? "not-allowed" : "pointer",
                        color: "#fff",
                        background: "#334155",
                        opacity: !Object.keys(billboardCircles).length ? 0.5 : 1,
                        border: "none",
                      }}
                    >
                      Ascunde radius la toate
                    </button>
                  </div>

                  <button
                    onClick={downloadBillboardsInLocationRadius}
                    disabled={!billboards.length || !centerPoint || centerMode !== "store"}
                    style={{
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      cursor: !billboards.length || !centerPoint || centerMode !== "store" ? "not-allowed" : "pointer",
                      color: "#fff",
                      background: "#059669",
                      opacity: !billboards.length || !centerPoint || centerMode !== "store" ? 0.5 : 1,
                      border: "none",
                    }}
                  >
                    Exportă panourile din radiusul locației
                  </button>

                  <button
                    onClick={() => downloadPOIsForSelectedBillboardsGrouped()}
                    disabled={!poiMarkers.length || !Object.keys(billboardCircles).length}
                    style={{
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      cursor: !poiMarkers.length || !Object.keys(billboardCircles).length ? "not-allowed" : "pointer",
                      color: "#fff",
                      background: "#dc2626",
                      opacity: !poiMarkers.length || !Object.keys(billboardCircles).length ? 0.5 : 1,
                      border: "none",
                    }}
                  >
                    Exportă Excel: format grupat (BILLBOARD + POI-uri)
                  </button>

                  <button
                    onClick={resetKey}
                    style={{
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      borderRadius: 10,
                      background: "transparent",
                      padding: "8px 12px",
                      fontSize: 14,
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    Schimbă/șterge cheia API
                  </button>
                </div>
              </div>


              {status && (
                <div
                  style={{
                    border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 12,
                    color: isDark ? "#94a3b8" : "#64748b",
                  }}
                >
                  {status}
                </div>
                  )}
                </>
              )}

              {/* TABUL PANOURI */}
              {activeTab === "panouri" && (
                <>
                  {/* --- Upload + filtre --- */}
                  <div
                    style={{
                      border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 16,
                    }}
                  >
                    <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 6 }}>
                      Încarcă panouri (.csv / .xlsx)
                    </label>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => e.target.files && onFileUpload(e.target.files[0])}
                      style={{ width: "100%", fontSize: 14 }}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      <button
                        onClick={downloadTemplate}
                        style={{
                          border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                          borderRadius: 10,
                          background: "transparent",
                          padding: "8px 12px",
                          fontSize: 14,
                          cursor: "pointer",
                          color: "inherit",
                        }}
                      >
                        Descarcă template CSV
                      </button>
                      <button
                        onClick={clearBillboards}
                        style={{
                          border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                          borderRadius: 10,
                          background: "transparent",
                          padding: "8px 12px",
                          fontSize: 14,
                          cursor: "pointer",
                          color: "inherit",
                        }}
                      >
                        Curăță panourile
                      </button>
                    </div>
                    <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 14 }}>
                      <input
                        type="checkbox"
                        checked={showOnlyInRadius}
                        onChange={(e) => setShowOnlyInRadius(e.target.checked)}
                      />
                      Arată doar elementele din radius (panouri = „store", POI = „billboard")
                    </label>
              </div>

              {/* --- Listă panouri --- */}
              <div
                style={{
                  border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Panouri</div>
                {!billboards.length ? (
                  <div style={{ fontSize: 14, color: isDark ? "#94a3b8" : "#64748b" }}>
                    Niciun panou încărcat. Încarcă un fișier CSV/XLSX sau folosește template-ul.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {billboards
                      .filter((b) => (centerMode === "store" && showOnlyInRadius ? b.inRadius : true))
                      .map((b) => (
                        <div
                          key={b.id}
                          style={{
                            border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                            borderRadius: 10,
                            padding: 10,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                            <div
                              style={{
                                fontSize: 12,
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: b.inRadius ? "rgba(16,185,129,0.25)" : "rgba(148,163,184,0.25)",
                                color: b.inRadius ? "#065f46" : "#334155",
                              }}
                            >
                              {b.inRadius ? "în radius" : "în afara radiusului"}
                            </div>
                          </div>
                          
                          {/* Informații complete despre panou */}
                          <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", marginTop: 6 }}>
                            <div><strong>ID:</strong> {b.sheetSpaceId || b.id}</div>
                            <div><strong>Locație:</strong> {b.locationText || b.address || "N/A"}</div>
                            <div><strong>Coordonate:</strong> {b.lat.toFixed(6)}, {b.lng.toFixed(6)}</div>
                            {b.periodsAvailable && (
                              <div><strong>Perioade disponibile:</strong> {b.periodsAvailable}</div>
                            )}
                            {b.images && b.images.length > 0 && (
                              <div><strong>Imagini:</strong> {b.images.length} imagine{b.images.length > 1 ? 'i' : ''}</div>
                            )}
                          {typeof b.distanceMeters === "number" && (
                              <div><strong>Distanță față de centru:</strong>{" "}
                              <b>
                                {b.distanceMeters < 1000
                                  ? `${b.distanceMeters.toFixed(0)} m`
                                  : `${(b.distanceMeters / 1000).toFixed(2)} km`}
                              </b>
                            </div>
                          )}
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                              onClick={() => {
                                if (!googleNS || !map) return;
                                map.panTo({ lat: b.lat, lng: b.lng });
                                map.setZoom(16);
                              }}
                              style={{
                                fontSize: 12,
                                border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                                background: "transparent",
                                color: "inherit",
                                borderRadius: 8,
                                padding: "6px 8px",
                                cursor: "pointer",
                              }}
                            >
                              Centrează pe hartă
                            </button>
                                <button
                                  onClick={() => toggleBillboardRadius(b)}
                                  style={{
                                    fontSize: 12,
                                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                                    background: Object.keys(billboardCircles).includes(b.id) ? "#0ea5e9" : "transparent",
                                    color: Object.keys(billboardCircles).includes(b.id) ? "#fff" : "inherit",
                                    borderRadius: 8,
                                    padding: "6px 8px",
                                    cursor: "pointer",
                                  }}
                                >
                                  {Object.keys(billboardCircles).includes(b.id) ? "Ascunde radius" : "Arată radius"}
                            </button>
                            <button
                              onClick={() => {
                                if (!googleNS || !map) return;
                                const loc = { lat: b.lat, lng: b.lng };
                                centerMarker?.setMap(null);
                                const cm = new googleNS.maps.Marker({
                                  position: loc,
                                  map,
                                  title: b.name,
                                  icon: {
                                    path: googleNS.maps.SymbolPath.CIRCLE,
                                    scale: 8,
                                    fillColor: "#0ea5e9",
                                    fillOpacity: 1,
                                    strokeColor: "white",
                                    strokeWeight: 2,
                                  },
                                });
                                setCenterMarker(cm);
                                setCenterPoint({ name: b.name, location: loc });
                                setCenterMode("billboard"); // centrul devine panou
                                map.panTo(loc);
                                map.setZoom(15);
                              }}
                              style={{
                                fontSize: 12,
                                border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                                background: "transparent",
                                color: "inherit",
                                borderRadius: 8,
                                padding: "6px 8px",
                                cursor: "pointer",
                              }}
                            >
                              Setează ca centru
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
                </>
              )}

              {/* TABUL DISPONIBILITATI */}
              {activeTab === "disponibilitati" && (
                <>
                  {/* --- Filtre disponibilități --- */}
                <div
                  style={{
                    border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                    borderRadius: 12,
                      padding: 16,
                      marginBottom: 16,
                    }}
                  >
                    <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 6 }}>
                      Filtrează panourile după disponibilitate
                    </label>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", display: "block", marginBottom: 4 }}>
                          Data de început
                        </label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          style={{
                            border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                            background: "transparent",
                            color: "inherit",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontSize: 14,
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", display: "block", marginBottom: 4 }}>
                          Data de sfârșit
                        </label>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          style={{
                            border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                            background: "transparent",
                            color: "inherit",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontSize: 14,
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", marginBottom: 12 }}>
                      {filteredBillboards.length > 0 ? (
                        <>Găsite <b>{filteredBillboards.length}</b> panouri disponibile în perioada selectată</>
                      ) : startDate && endDate ? (
                        "Nu s-au găsit panouri disponibile în perioada selectată"
                      ) : (
                        "Selectează o perioadă pentru a filtra panourile"
                      )}
                    </div>
                    
                    {/* Butoane pentru afișare pe hartă */}
                    {filteredBillboards.length > 0 && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={showFilteredOnMap}
                          disabled={showOnlyFilteredOnMap}
                          style={{
                            borderRadius: 10,
                            padding: "8px 12px",
                            fontSize: 14,
                            cursor: showOnlyFilteredOnMap ? "not-allowed" : "pointer",
                            color: "#fff",
                            background: "#059669",
                            opacity: showOnlyFilteredOnMap ? 0.5 : 1,
                            border: "none",
                          }}
                        >
                          📍 Afișează pe hartă
                        </button>
                        <button
                          onClick={resetMapDisplay}
                          disabled={!showOnlyFilteredOnMap}
                          style={{
                            borderRadius: 10,
                            padding: "8px 12px",
                            fontSize: 14,
                            cursor: !showOnlyFilteredOnMap ? "not-allowed" : "pointer",
                            color: "#fff",
                            background: "#dc2626",
                            opacity: !showOnlyFilteredOnMap ? 0.5 : 1,
                            border: "none",
                          }}
                        >
                          🔄 Resetează afișarea
                        </button>
                      </div>
                    )}
                  </div>

                  {/* --- Listă panouri filtrate --- */}
                  {filteredBillboards.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
                        Panouri disponibile ({filteredBillboards.length})
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {filteredBillboards.map((b) => (
                          <div
                            key={b.id}
                            style={{
                              border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                              borderRadius: 10,
                              padding: 10,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                              <div
                                style={{
                    fontSize: 12,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  background: "rgba(16,185,129,0.25)",
                                  color: "#065f46",
                                }}
                              >
                                disponibil
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", marginTop: 4 }}>
                              {b.locationText || b.address || ""}
                            </div>
                            <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", marginTop: 4 }}>
                              Perioade: <b>{b.periodsAvailable}</b>
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                              <button
                                onClick={() => {
                                  if (!googleNS || !map) return;
                                  map.panTo({ lat: b.lat, lng: b.lng });
                                  map.setZoom(16);
                                }}
                                style={{
                                  fontSize: 12,
                                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                                  background: "transparent",
                                  color: "inherit",
                                  borderRadius: 8,
                                  padding: "6px 8px",
                                  cursor: "pointer",
                                }}
                              >
                                Centrează pe hartă
                              </button>
                              <button
                                onClick={() => toggleBillboardRadius(b)}
                                style={{
                                  fontSize: 12,
                                  border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                                  background: Object.keys(billboardCircles).includes(b.id) ? "#0ea5e9" : "transparent",
                                  color: Object.keys(billboardCircles).includes(b.id) ? "#fff" : "inherit",
                                  borderRadius: 8,
                                  padding: "6px 8px",
                                  cursor: "pointer",
                                }}
                              >
                                {Object.keys(billboardCircles).includes(b.id) ? "Ascunde radius" : "Arată radius"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </aside>

      {/* --- Zona hărții (dreapta) --- */}
      <main style={{ position: "relative", flex: 1, minWidth: 0, height: "100vh", zIndex: 0 }}>
        <div ref={mapRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />
        {!apiKey && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              zIndex: 10,
            }}
          >
            <div
              style={{
                background: isDark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)",
                border: `1px solid ${isDark ? "#1f2937" : "#e5e7eb"}`,
                borderRadius: 12,
                padding: 24,
                maxWidth: 480,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                Introduce cheia Google Maps API
              </div>
              <div style={{ fontSize: 14, color: isDark ? "#94a3b8" : "#64748b" }}>
                Adaugă cheia în panoul din stânga pentru a porni harta.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  </div>
);

}
