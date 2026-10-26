/** Layer ids of the event pins, shared with the site layers that must stay under them. The
 *  cluster layer is the lowest of them. */
export const CLUSTER_LAYER = "clusters";
export const STACK_LAYER = "stacks-circle";
export const POINT_LAYERS = ["points-selected", "points-circle"];

/** Every layer a tap can target (a query returns matches topmost first whatever the order here). */
export const TAP_TARGET_LAYERS = [CLUSTER_LAYER, STACK_LAYER, ...POINT_LAYERS];
