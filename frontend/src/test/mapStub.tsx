/** Stands in for `@/components/map/Map`, whose canvas needs WebGL, absent in jsdom. Mock it with
 *  `vi.mock("@/components/map/Map", () => import("@/test/mapStub"))`. */
export default function MapStub() {
  return <div data-testid="map" />;
}
