'use client';

/**
 * DashboardClient — interactive client component.
 *
 * Owns:
 *   - The top KPI cards (Total Stock, Low Stock, Out of Stock, Total Value)
 *   - The inventory table with availability toggles
 *   - The "Add New Batch / Medicine" modal (handles add + edit)
 *   - Lightweight error toasts
 *
 * Data layer is delegated to `useInventory`.
 */

import { useState } from 'react';
import {
    AlertTriangle,
    Boxes,
    DollarSign,
    PackageCheck,
    Plus,
    RefreshCw,
    Wallet,
} from 'lucide-react';

import { Sidebar } from '@/components/dashboard/Sidebar';
import { TopBar } from '@/components/dashboard/TopBar';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { InventoryTable } from '@/components/dashboard/InventoryTable';
import { AddMedicineModal } from '@/components/dashboard/AddMedicineModal';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';

import { useInventory } from '@/hooks/useInventory';
import type { InventoryRow, InventoryMutationPayload } from '@/lib/types';
import { cn, formatEtb } from '@/lib/utils/format';

interface DashboardClientProps {
    pharmacyId: string;
    pharmacyName: string;
}

export function DashboardClient({ pharmacyId, pharmacyName }: DashboardClientProps) {
    const {
        rows,
        kpis,
        medicines,
        isLoading,
        isMutating,
        error,
        refetch,
        add,
        update,
        toggleAvailability,
    } = useInventory();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<InventoryRow | null>(null);

    /* -------------------------- handlers -------------------------------- */
    function openAdd() {
        setEditing(null);
        setIsModalOpen(true);
    }

    function openEdit(row: InventoryRow) {
        setEditing(row);
        setIsModalOpen(true);
    }

    function closeModal() {
        if (isMutating) return;
        setIsModalOpen(false);
        setEditing(null);
    }

    async function handleSubmit(payload: InventoryMutationPayload) {
        const ok = payload.mode === 'add' ? await add(payload) : await update(payload);
        if (ok) {
            // Re-fetch the catalogue so the next "From catalogue" pick
            // includes any newly created medicine.
            if (payload.mode === 'add' && !('id' in payload.medicine)) {
                // useInventory already handles this; nothing extra to do.
            }
            setIsModalOpen(false);
            setEditing(null);
        }
    }

    /* -------------------------- render ---------------------------------- */
    return (
        <div className="min-h-screen bg-slate-50">
            <Sidebar />

            <div className="lg:pl-60">
                <TopBar pharmacyName={pharmacyName} onAddClick={openAdd} />

                <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
                    {/* ---- Pharmacy identity strip ----------------------- */}
                    <PharmacyHeader pharmacyName={pharmacyName} pharmacyId={pharmacyId} />

                    {/* ---- Error banner ----------------------------------- */}
                    {error && (
                        <div
                            role="alert"
                            className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
                        >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div className="flex-1">
                                <p className="font-medium">{error}</p>
                                <p className="mt-0.5 text-xs text-rose-600">
                                    You can retry by clicking the refresh button.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void refetch()}
                                className="rounded-md p-1 text-rose-600 transition hover:bg-rose-100"
                                aria-label="Retry"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    {/* ---- KPI cards -------------------------------------- */}
                    <section
                        aria-label="Key performance indicators"
                        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
                    >
                        <KpiCard
                            label="Total Medicines in Stock"
                            value={isLoading ? '—' : kpis.totalMedicinesInStock.toLocaleString('en-ET')}
                            icon={Boxes}
                            accent="emerald"
                            hint="Across all available batches"
                        />
                        <KpiCard
                            label="Low Stock Alerts"
                            value={isLoading ? '—' : kpis.lowStockAlerts.toLocaleString('en-ET')}
                            icon={PackageCheck}
                            accent="amber"
                            hint={`≤ 10 units remaining`}
                        />
                        <KpiCard
                            label="Out of Stock"
                            value={isLoading ? '—' : kpis.outOfStockItems.toLocaleString('en-ET')}
                            icon={AlertTriangle}
                            accent="rose"
                            hint="Reorder these items"
                        />
                        <KpiCard
                            label="Total Inventory Value"
                            value={isLoading ? '—' : formatEtb(kpis.totalInventoryValueEtb)}
                            icon={Wallet}
                            accent="sky"
                            hint="Stock × price, in ETB"
                        />
                    </section>

                    {/* ---- Section header + primary CTA ------------------- */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-base font-semibold text-slate-900">
                                Active Inventory
                            </h2>
                            <p className="text-sm text-slate-500">
                                Toggle availability to control what customers can see.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void refetch()}
                                leftIcon={<RefreshCw className="h-4 w-4" />}
                                disabled={isLoading}
                            >
                                Refresh
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                onClick={openAdd}
                                leftIcon={<Plus className="h-4 w-4" />}
                            >
                                Add New Batch / Medicine
                            </Button>
                        </div>
                    </div>

                    {/* ---- Table ------------------------------------------ */}
                    <section aria-label="Inventory list" className="relative">
                        {isLoading ? (
                            <LoadingState />
                        ) : (
                            <InventoryTable
                                rows={rows}
                                onEdit={openEdit}
                                onToggleAvailability={toggleAvailability}
                            />
                        )}

                        {/* KPI footnote (tiny "computed live" hint) */}
                        <p className="mt-3 text-right text-[11px] text-slate-400">
                            <DollarSign className="inline h-3 w-3 -translate-y-0.5" /> KPI values
                            update live as you edit stock and prices.
                        </p>
                    </section>
                </main>
            </div>

            {/* ---- Add / edit modal ---------------------------------- */}
            <AddMedicineModal
                isOpen={isModalOpen}
                onClose={closeModal}
                editing={editing}
                medicines={medicines}
                isSubmitting={isMutating}
                onSubmit={handleSubmit}
            />
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function PharmacyHeader({
    pharmacyName,
    pharmacyId,
}: {
    pharmacyName: string;
    pharmacyId: string;
}) {
    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between'
            )}
        >
            <div>
                <p className="text-xs font-medium uppercase tracking-wider text-white/70">
                    Welcome back
                </p>
                <h2 className="mt-0.5 text-xl font-semibold sm:text-2xl">{pharmacyName}</h2>
                <p className="mt-1 text-sm text-white/80">
                    Here's a snapshot of your stock for today.
                </p>
            </div>
            <div className="flex items-center gap-2 self-start rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 ring-1 ring-inset ring-white/20 sm:self-auto">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                Pharmacy ID:&nbsp;
                <code className="font-mono text-[11px] text-white/90">
                    {pharmacyId.slice(0, 8)}…
                </code>
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div
            role="status"
            aria-label="Loading inventory"
            className="flex h-64 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"
        >
            <Spinner className="h-6 w-6 text-emerald-500" />
        </div>
    );
}
