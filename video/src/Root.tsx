import { Composition } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";
import { PromoV04, PROMO_V04_DURATION } from "./PromoV04";
import { PromoV05, PROMO_V05_DURATION } from "./PromoV05";
import { PromoV05B, PROMO_V05B_DURATION } from "./PromoV05B";
import { FeatureImport, FEATURE_IMPORT_DURATION } from "./FeatureImport";

export const RemotionRoot = () => {
  return (
    <>
      {/* The 0.3 promo (kept renderable for reference). */}
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={DEMO_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      {/* The v0.4 promo (see record-v04.js + PromoV04.tsx). */}
      <Composition
        id="PromoV04"
        component={PromoV04}
        durationInFrames={PROMO_V04_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      {/* The v0.5 promo A, the portfolio (see record-v05.js + PromoV05.tsx). */}
      <Composition
        id="PromoV05"
        component={PromoV05}
        durationInFrames={PROMO_V05_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      {/* The v0.5 promo B, import and review (see record-v05b.js +
          PromoV05B.tsx). */}
      <Composition
        id="PromoV05B"
        component={PromoV05B}
        durationInFrames={PROMO_V05B_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
      {/* Groundwork for the follow-up archive-import feature video; renders
          once public/clips/x-export-capture.mp4 exists (see FeatureImport.tsx). */}
      <Composition
        id="FeatureImport"
        component={FeatureImport}
        durationInFrames={FEATURE_IMPORT_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
    </>
  );
};
