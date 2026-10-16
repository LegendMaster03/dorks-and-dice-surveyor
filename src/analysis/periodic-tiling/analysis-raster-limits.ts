/** The default analysis preparation retains images up to 2048 pixels per side.
 * Every periodic reconstruction and independent original-raster proof stage
 * must accept the same bounded pixel domain, including a 1584 x 1584 grid.
 * Geometry, topology, and projection evidence are still required.
 */
export const PERIODIC_ANALYSIS_MAX_PIXELS = 2048 * 2048;
