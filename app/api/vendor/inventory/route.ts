/**
 * =============================================================================
 *  /api/search-medicine  —  MedFinder End-User Search Endpoint
 * =============================================================================
 *
 *  Public, unauthenticated endpoint used by the consumer web/mobile app.
 *
 *  Query string:
 *      ?medicineName=paracetamol
 *      &userLatitude=9.0054
 *      &userLongitude=38.7636
 *      &maxDistanceKm=5          (optional — omit for "anywhere in Addis")
 *      &limit=50                  (optional, default 50, max 100)
 *
 *  Response (ApiResponse<MedicineSearchResult[]>):
 *      { ok: true,  data: [ …50 results sorted by distance… ] }
 *      { ok: false, error: "…" }
 *
 *  Implementation:
 *    - We delegate matching + Haversine distance to a Postgres
 *      function (`public.search_medicines_nearby`) so the database
 *      does the heavy lifting and we can index the search columns.
 *    - The function only returns verified pharmacies with
 *      `is_available = true` and `stock_quantity > 0` — i.e. stock
 *      that is realistically purchasable right now.
 *    - We project a clean public shape (no `owner_id`, no internal
 *      flags) so the consumer UI never sees anything it shouldn't.
 *
 *  Security:
 *    - Uses the SUPABASE_SERVICE_ROLE_KEY (server-only) so the
 *      RLS-restricted public read policy isn't a bottleneck.
 *    - Strips every unsafe field from the row before returning.
 *    - Caches identical GETs at the CDN edge for 30s.
 *
 *  Stack:  Next.js 15 (App Router) · Supabase · PostgreSQL
 * =============================================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import type {
    ApiResponse,
    MedicineSearchResult,
} from '@/lib/types';

export const runtime = 'nodejs';
// No static caching — query params are user-specific.
export const dynamic = 'force-dynamic';

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function parseNumber(value: string | null, label: string): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`\`${label}\` must be a finite number.`);
    }
    return n;
}

function validateQuery(url: URL): {
    medicineName: string;
    userLatitude: number;
    userLongitude: number;
    maxDistanceKm: number | null;
    limit: number;
} {
    const sp = url.searchParams;

    const rawName = (sp.get('medicineName') ?? sp.get('q') ?? '').trim();
    if (rawName.length < 2) {
        throw new Error(
            '`medicineName` is required and must be at least 2 characters long.'
        );
    }
    if (rawName.length > 120) {
        throw new Error('`medicineName` is too long (max 120 characters).');
    }

    const userLatitude = parseNumber(sp.get('userLatitude'), 'userLatitude');
    const userLongitude = parseNumber(sp.get('userLongitude'), 'userLongitude');
    if (userLatitude == null) throw new Error('`userLatitude` is required.');
    if (userLongitude == null) throw new Error('`userLongitude` is required.');
    if (userLatitude < -90 || userLatitude > 90) {
        throw new Error('`userLatitude` must be between -90 and 90.');
    }
    if (userLongitude < -180 || userLongitude > 180) {
        throw new Error('`userLongitude` must be between -180 and 180.');
    }

    const maxRaw = parseNumber(sp.get('maxDistanceKm'), 'maxDistanceKm');
    const maxDistanceKm =
        maxRaw == null ? null : Math.min(Math.max(maxRaw, 0.1), 500);

    const limitRaw = parseNumber(sp.get('limit'), 'limit');
    const limit = Math.min(
        Math.max(Math.floor(limitRaw ?? DEFAULT_LIMIT), 1),
        MAX_LIMIT
    );

    return { medicineName: rawName, userLatitude, userLongitude, maxDistanceKm, limit };
}

/* -------------------------------------------------------------------------- */
/*  Row projection                                                            */
/* -------------------------------------------------------------------------- */

/** Project a raw DB row onto the public-facing shape the UI consumes. */
function projectRow(r: {
    inventory_id: string;
    pharmacy_id: string;
    pharmacy_name: string;
    sub_city: string;
    woreda: string;
    phone: string;
    latitude: number;
    longitude: number;
    brand_name: string;
    generic_name: string;
    category: string;
    manufacturer: string | null;
    stock_quantity: number;
    price_etb: number | string;
    batch_number: string;
    expiry_date: string;
    distance_km: number;
}): MedicineSearchResult {
    return {
        inventoryId: r.inventory_id,
        pharmacyId: r.pharmacy_id,
        pharmacyName: r.pharmacy_name,
        subCity: r.sub_city,
        woreda: r.woreda,
        phone: r.phone,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        brandName: r.brand_name,
        genericName: r.generic_name,
        category: r.category,
        manufacturer: r.manufacturer,
        stockQuantity: Number(r.stock_quantity),
        priceEtb: Number(r.price_etb),
        batchNumber: r.batch_number,
        expiryDate: r.expiry_date,
        distanceKm: Number(r.distance_km),
    };
}

/* -------------------------------------------------------------------------- */
/*  GET                                                                       */
/* -------------------------------------------------------------------------- */

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        let q;
        try {
            q = validateQuery(url);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Invalid query.';
            return NextResponse.json<ApiResponse<MedicineSearchResult[]>>(
                { ok: false, error: message },
                { status: 400 }
            );
        }

        const supabase = createSupabaseServiceClient();

        // Delegate matching + distance to the SECURITY DEFINER RPC.
        // It already enforces: is_verified, is_available, stock_quantity > 0.
        const { data, error } = await supabase.rpc('search_medicines_nearby', {
            search_query: q.medicineName,
            user_lat: q.userLatitude,
            user_lon: q.userLongitude,
            max_distance_km: q.maxDistanceKm,
            result_limit: q.limit,
        });

        if (error) {
            console.error('[search-medicine][GET] supabase.rpc failed:', error);
            return NextResponse.json<ApiResponse<MedicineSearchResult[]>>(
                { ok: false, error: 'Search failed. Please try again.' },
                { status: 500 }
            );
        }

        const results: MedicineSearchResult[] = (data ?? []).map(projectRow);

        return NextResponse.json<ApiResponse<MedicineSearchResult[]>>(
            { ok: true, data: results },
            {
                status: 200,
                headers: {
                    // Short edge cache — same query for 30s returns the
                    // same response, then re-validates.
                    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
                },
            }
        );
    } catch (err) {
        // Catch-all — never let an exception escape as an HTML error page.
        console.error('[search-medicine][GET] unexpected error:', err);
        return NextResponse.json<ApiResponse<MedicineSearchResult[]>>(
            { ok: false, error: 'Unexpected server error.' },
            { status: 500 }
        );
    }
}
