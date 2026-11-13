import { proxy } from "valtio";
import { type Bank, DEFAULT_LOOP_LENGTH, newId } from "../model/types";
import type { PianoRollNote } from "../pianoRoll/types";

// UI-facing state lives in valtio proxies: components read through
// useSnapshot and re-render only for the fields they touched. Nothing hot
// (timing, MIDI ports, note data mid-gesture) goes through these.
export const banksStore = proxy<{ banks: Record<string, Bank> }>({ banks: {} });

export function getBank(id: string): Bank | undefined {
  return banksStore.banks[id];
}

export function listBanks(runnerType?: string): Bank[] {
  const all = Object.values(banksStore.banks);
  const filtered = runnerType ? all.filter((bank) => bank.runnerType === runnerType) : all;
  return filtered.sort((a, b) => a.createdAt - b.createdAt);
}

function nextBankName(runnerType: string): string {
  const existing = new Set(listBanks(runnerType).map((bank) => bank.name));
  for (let i = 1; ; i += 1) {
    const candidate = `${runnerType} ${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export function createBank(runnerType: string, init: Partial<Bank> = {}): Bank {
  const now = Date.now();
  const bank: Bank = {
    id: init.id ?? newId("bank"),
    name: init.name ?? nextBankName(runnerType),
    runnerType,
    notes: init.notes ?? [],
    loopLength: init.loopLength ?? DEFAULT_LOOP_LENGTH,
    createdAt: init.createdAt ?? now,
    updatedAt: now,
  };
  banksStore.banks[bank.id] = bank;
  return banksStore.banks[bank.id];
}

export function duplicateBank(id: string): Bank | undefined {
  const source = getBank(id);
  if (!source) return undefined;
  return createBank(source.runnerType, {
    name: `${source.name} copy`,
    notes: source.notes.map((note) => ({ ...note, metadata: note.metadata ? structuredClone(note.metadata) : undefined })),
    loopLength: source.loopLength,
  });
}

/** Notes are replaced as one array so a roll sees one identity change per edit. */
export function setBankNotes(id: string, notes: PianoRollNote[]): void {
  const bank = banksStore.banks[id];
  if (!bank) return;
  bank.notes = notes;
  bank.updatedAt = Date.now();
}

export function setBankLoopLength(id: string, loopLength: number): void {
  const bank = banksStore.banks[id];
  if (!bank || !Number.isFinite(loopLength) || loopLength <= 0) return;
  bank.loopLength = loopLength;
  bank.updatedAt = Date.now();
}

export function renameBank(id: string, name: string): void {
  const bank = banksStore.banks[id];
  if (!bank) return;
  bank.name = name;
  bank.updatedAt = Date.now();
}

export function deleteBank(id: string): void {
  delete banksStore.banks[id];
}

export function replaceAllBanks(banks: Bank[]): void {
  banksStore.banks = Object.fromEntries(banks.map((bank) => [bank.id, bank]));
}
