"""Bounded, reproducible Phase 16 research spike; NOT a generalized detector.

Requires numpy, scipy, opencv-python. Run as an offline experiment; not an API dependency.
Original raster is generated once and never resampled/refit in successive iterations.
"""
import json
import math
import resource
import time
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parent
WIDTH = HEIGHT = 768
S = 64
GROUND_BASIS = [(2 * S, 0), (0, S)]
GROUND_MOTIF = [[(0, 0), (1, 0), (1, 1), (0, 1)],
                [(1, 0), (2, 0), (2, 1)],
                [(1, 0), (2, 1), (1, 1)]]
PHASE = (23, 41)


def original_raster():
    raster = np.full((HEIGHT, WIDTH), 255, dtype=np.uint8)
    for u in range(-2, 8):
        for v in range(-2, 16):
            shift = (PHASE[0] + 2 * S * u, PHASE[1] + S * v)
            for polygon in GROUND_MOTIF:
                vertices = np.array([[round(shift[0] + S * x), round(shift[1] + S * y)]
                                     for x, y in polygon], dtype=np.int32)
                cv2.polylines(raster, [vertices], isClosed=True, color=0,
                              thickness=2, lineType=cv2.LINE_8)
    return raster


def shifted_f1(edge, dx, dy):
    h, w = edge.shape
    a = edge[max(0, dy):min(h, h + dy), max(0, dx):min(w, w + dx)]
    b = edge[max(0, -dy):min(h, h - dy), max(0, -dx):min(w, w - dx)]
    both = np.count_nonzero(a & b)
    total = np.count_nonzero(a) + np.count_nonzero(b)
    return 2 * both / total if total else 0.0


def translation_hypotheses(edge):
    signal = edge.astype(np.float32)
    signal -= float(np.mean(signal))
    spectrum = np.fft.rfft2(signal)
    correlation = np.fft.irfft2(spectrum * np.conjugate(spectrum), s=edge.shape)
    # Local maxima in a bounded, non-wrapped candidate region.
    search = 160
    candidates = []
    best = cv2.dilate(correlation.astype(np.float32), np.ones((5, 5), np.uint8))
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            if dx * dx + dy * dy < 40 * 40 or dx * dx + dy * dy > 180 * 180:
                continue
            y = dy % HEIGHT
            x = dx % WIDTH
            if correlation[y, x] < best[y, x] - 1e-3:
                continue
            candidates.append((float(correlation[y, x]), dx, dy))
    candidates.sort(reverse=True)
    ranked = []
    for _, dx, dy in candidates[:90]:
        quality = shifted_f1(edge, dx, dy)
        if quality >= 0.93:
            ranked.append((dx, dy, quality))
    unique = sorted({(dx, dy, round(q, 5)) for dx, dy, q in ranked},
                    key=lambda r: (r[0] * r[0] + r[1] * r[1], abs(r[0]), abs(r[1])))
    options = []
    for i, one in enumerate(unique):
        for two in unique[i + 1:]:
            det = abs(one[0] * two[1] - one[1] * two[0])
            if det < 2000:
                continue
            options.append((det, one[0] ** 2 + one[1] ** 2 + two[0] ** 2 + two[1] ** 2, one, two))
    if not options:
        return None, unique[:12]
    _, _, one, two = min(options)
    return (one, two), unique[:12]


def segment_cell_polygons(edge):
    interior = (np.logical_not(edge)).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(interior, 8)
    candidates = []
    for i in range(1, count):
        area = int(stats[i, cv2.CC_STAT_AREA])
        x, y, w, h = map(int, stats[i, :4])
        if area < 400 or x <= 0 or y <= 0 or x + w >= WIDTH or y + h >= HEIGHT:
            continue
        mask = (labels[y:y+h, x:x+w] == i).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        polygon = cv2.approxPolyDP(contour, 0.025 * cv2.arcLength(contour, True), True)
        candidates.append({'sides': len(polygon), 'area_pixels': area,
                           'center': list(map(float, centroids[i]))})
    return candidates


def main():
    started = time.perf_counter()
    raster = original_raster()
    cv2.imwrite(str(OUT / 'phase16_mixed_ground_truth.png'), raster)
    # Original, unmodified binary edge mask drives both the FFT and validation.
    edge = raster < 128
    basis, candidates = translation_hypotheses(edge)
    polygons = segment_cell_polygons(edge)
    # Real outline recovery must validate segment incidence and numerical
    # stability before producing any D-symbol; this prototype does not.
    result = {
        'experiment': 'Phase 16 / early Phase 20 mixed square+triangle motif',
        'original_raster': 'phase16_mixed_ground_truth.png',
        'ground_truth': {'image_size': [WIDTH, HEIGHT],
                         'translation_vectors_px': GROUND_BASIS,
                         'motif_cell_side_counts': [4, 3, 3],
                         'motif_cell_count': 3},
        'detected_translation_vectors_px': None if basis is None else [[v[0], v[1]] for v in basis],
        'translation_f1_on_original_raster': None if basis is None else [v[2] for v in basis],
        'leading_candidates': [[v[0], v[1], v[2]] for v in candidates],
        'segmented_interior_components': len(polygons),
        'segmented_side_histogram': {str(n): sum(p['sides'] == n for p in polygons)
                                     for n in sorted({p['sides'] for p in polygons})},
        'reconstructed_incidence': False,
        'reconstructed_d_symbol': None,
        'limitations': ['No robust polygon edge-intersection graph',
                        'No certified chamber quotient derivation from noisy observed incidence',
                        'No rotation, occlusion, severe-noise, or scale robustness study'],
        'runtime_seconds': round(time.perf_counter() - started, 4),
        'max_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    }
    (OUT / 'phase16_mixed_spike_results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
