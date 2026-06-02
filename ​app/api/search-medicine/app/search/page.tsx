/**
 * =============================================================================
 *  /search  —  MedFinder Consumer Search Page
 * =============================================================================
 *
 *  Server Component shell. The page is fully public — no auth needed.
 *  All state lives in <SearchClient />.
 * =============================================================================
 */

import type { Metadata } from 'next';
import { SearchClient } from './SearchClient';

export const metadata: Metadata = {
    title: 'Find Medicine',
    description:
        'Search for critical medicines and find the nearest verified pharmacy in Addis Ababa.',
};

export default function SearchPage() {
    return <SearchClient />;
}
